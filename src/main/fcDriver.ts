import { net } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { getAiSettings } from './settings'
import { validateEgg } from './validate'
import { testEgg } from './test'

export type ActivityType = 'think' | 'tool' | 'write' | 'check' | 'retry' | 'error'

export interface DriverJob {
  wish: string
  stagingDir: string
  templateDir: string
  maxRounds: number
  /** 升级模式：舱里是现有蛋的代码而非空白模板 */
  upgrade?: { baseWish: string }
  onStage: (stage: string, detail?: string) => void
  /** 机芯实况：AI 思考、工具调用、文件写入、自检结果等。id 相同的条目原地替换（用于流式思考实时更新） */
  onActivity?: (type: ActivityType, text: string, id?: string) => void
}

export interface DriverResult {
  ok: boolean
  rounds: number
  turns: number
  error?: string
}

const MAX_TURNS = 60
const MAX_TOTAL_TOKENS = 300_000
const OVERALL_TIMEOUT_MS = 15 * 60 * 1000
const STALL_TIMEOUT_MS = 60_000        // 流式断流检测：60 秒收不到任何数据即判定中断
const REQUEST_HARD_CAP_MS = 8 * 60_000 // 单次请求硬上限（防模型无限吐字）
const MAX_RETRIES = 2

interface ToolCall { id: string; type: 'function'; function: { name: string; arguments: string } }
interface AssistantMessage { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: '列出装配舱里蛋的全部文件',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: '读取蛋内一个文件的完整内容',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: '相对路径，如 app.js' } },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: '整文件写入（覆盖）。蛋文件都很小，永远整文件重写，不要输出片段',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '相对路径，如 app.js' },
          content: { type: 'string', description: '文件完整内容' }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'check_egg',
      description: '运行完整验收（静态检查 + 沙箱试跑）。写完所有文件后调用它查看问题',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'finish',
      description: '声明制造完成。会触发最终验收，不通过会把问题反馈给你继续修',
      parameters: {
        type: 'object',
        properties: { summary: { type: 'string', description: '一句话说明做了什么' } },
        required: ['summary']
      }
    }
  }
]

function resolveSafe(root: string, rel: string): string {
  const abs = path.normalize(path.join(root, rel))
  const normRoot = path.normalize(root)
  if (abs !== normRoot && !abs.startsWith(normRoot + path.sep)) {
    throw new Error(`路径越出装配舱: ${rel}`)
  }
  return abs
}

function listAllFiles(root: string, rel = ''): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const relPath = rel ? `${rel}/${entry.name}` : entry.name
    if (entry.isDirectory()) out.push(...listAllFiles(root, relPath))
    else out.push(relPath)
  }
  return out
}

function buildSystemPrompt(templateDir: string): string {
  const guide = fs.readFileSync(path.join(templateDir, 'EGG_GUIDE.md'), 'utf-8')
  const dts = fs.readFileSync(path.join(templateDir, 'egg.d.ts'), 'utf-8')
  return [
    '你是 appGacha 的扭蛋机芯——一个把用户愿望制造成桌面小应用（扭蛋）的工程智能体。',
    '装配舱里已放好模板文件，你通过工具读写文件完成制造。做法：先规划功能，然后整文件写出 manifest.json（只改 name/permissions）、index.html、style.css、app.js，随后调用 check_egg 自检，修完所有问题后调用 finish。',
    '',
    '=== 制造规范（EGG_GUIDE.md） ===',
    guide,
    '',
    '=== 宿主 API 类型声明（egg.d.ts） ===',
    dts
  ].join('\n')
}

// HTTP 业务错误（4xx/5xx）——与网络/断流错误区分，不重试
class HttpError extends Error {
  constructor(public status: number, public body: string) { super(`HTTP ${status}`) }
}

interface StreamResult { message: AssistantMessage; estimatedTokens: number }

/**
 * 流式请求（SSE）+ 断流检测。
 * 与 Claude Code / Codex 等工具同款的超时策略：只要 token 还在流就不算超时，
 * 只有“断流”（60 秒无任何数据）才中断并重试。tool_calls 以增量 delta 拼接。
 */
async function streamCompletion(
  cfg: { baseURL: string; model: string; apiKey: string },
  messages: unknown[],
  onDelta: (accumulatedText: string) => void
): Promise<StreamResult> {
  const controller = new AbortController()
  const hardTimer = setTimeout(
    () => controller.abort(new Error('单次生成超过 8 分钟上限')),
    REQUEST_HARD_CAP_MS
  )
  let stallTimer: ReturnType<typeof setTimeout> | undefined
  const feedStallWatchdog = () => {
    clearTimeout(stallTimer)
    stallTimer = setTimeout(
      () => controller.abort(new Error('响应流中断（60 秒无数据）')),
      STALL_TIMEOUT_MS
    )
  }
  feedStallWatchdog()

  try {
    const res = await net.fetch(`${cfg.baseURL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({ model: cfg.model, messages, tools: TOOLS, temperature: 0.3, stream: true }),
      signal: controller.signal
    })
    if (!res.ok) {
      const text = (await res.text().catch(() => '')).slice(0, 300)
      throw new HttpError(res.status, text)
    }
    if (!res.body) throw new Error('响应没有数据流')

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let content = ''
    const tcMap = new Map<number, { id: string; name: string; args: string }>()

    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      feedStallWatchdog()
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const t = line.trim()
        if (!t.startsWith('data:')) continue
        const payload = t.slice(5).trim()
        if (!payload || payload === '[DONE]') continue
        let chunk: {
          choices?: {
            delta?: {
              content?: string
              tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[]
            }
          }[]
        }
        try { chunk = JSON.parse(payload) } catch { continue }
        const delta = chunk.choices?.[0]?.delta
        if (!delta) continue
        if (delta.content) {
          content += delta.content
          onDelta(content)
        }
        for (const tcd of delta.tool_calls ?? []) {
          const idx = tcd.index ?? 0
          const acc = tcMap.get(idx) ?? { id: '', name: '', args: '' }
          if (tcd.id) acc.id = tcd.id
          if (tcd.function?.name) acc.name += tcd.function.name
          if (tcd.function?.arguments) acc.args += tcd.function.arguments
          tcMap.set(idx, acc)
        }
      }
    }

    const tool_calls = [...tcMap.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, tc], i) => ({
        id: tc.id || `call_stream_${i}_${Date.now()}`,
        type: 'function' as const,
        function: { name: tc.name, arguments: tc.args }
      }))

    const message: AssistantMessage = {
      role: 'assistant',
      content: content || null,
      ...(tool_calls.length ? { tool_calls } : {})
    }
    // 流式模式多数提供商不返回 usage，用字符数粗估（预算护栏是软性的）
    const totalChars = content.length + [...tcMap.values()].reduce((s, t) => s + t.args.length, 0)
    return { message, estimatedTokens: Math.ceil(totalChars / 3) }
  } finally {
    clearTimeout(hardTimer)
    clearTimeout(stallTimer)
  }
}

export async function runFcDriver(job: DriverJob): Promise<DriverResult> {
  const cfg = getAiSettings()
  if (!cfg || !cfg.apiKey) return { ok: false, rounds: 0, turns: 0, error: 'AI_NOT_CONFIGURED: 请先在设置里配置模型' }

  const deadline = Date.now() + OVERALL_TIMEOUT_MS
  let totalTokens = 0
  let rounds = 1
  let turns = 0

  const opening = job.upgrade
    ? [
        '这是一次对现有扭蛋的升级改造，装配舱里是这颗蛋当前的完整代码（data/ 数据不在舱内，运行时会在）。',
        `蛋的原始愿望：${job.upgrade.baseWish}`,
        `本次升级愿望：${job.wish}`,
        '',
        '要求：先读现有代码，在其基础上增量修改，保留原有功能与数据。',
        '若改动数据库表结构，必须在启动逻辑里写好旧结构到新结构的迁移（如 try/catch 包裹 ALTER TABLE），旧数据一条都不能丢。',
        '完成后调用 finish。'
      ].join('\n')
    : `用户的愿望：${job.wish}\n\n请开始制造这颗扭蛋。`

  const messages: unknown[] = [
    { role: 'system', content: buildSystemPrompt(job.templateDir) },
    { role: 'user', content: opening }
  ]

  const runCheck = async (): Promise<{ pass: boolean; report: string }> => {
    const issues = validateEgg(job.stagingDir)
    if (issues.length > 0) {
      return { pass: false, report: '静态检查未通过：\n' + issues.map(i => `- [${i.file}] ${i.message}`).join('\n') }
    }
    const t = await testEgg(job.stagingDir, {
      screenshotTo: path.join(job.stagingDir, '..', `${path.basename(job.stagingDir)}.test.png`)
    })
    if (t.error) return { pass: false, report: `试跑失败：${t.error}` }
    if (!t.ok) {
      const parts = []
      if (t.consoleErrors.length) parts.push('console 错误：\n' + t.consoleErrors.join('\n'))
      if (t.blank) parts.push('页面是空白的——初始化没有渲染出任何内容')
      if (t.crashed) parts.push('渲染进程崩溃了')
      return { pass: false, report: '沙箱试跑未通过：\n' + parts.join('\n') }
    }
    return { pass: true, report: '验收通过：静态检查零问题，沙箱试跑零报错、界面有内容。' }
  }

  const execTool = async (name: string, args: Record<string, unknown>): Promise<string> => {
    switch (name) {
      case 'list_files':
        job.onStage('crank', '查看装配舱文件…')
        job.onActivity?.('tool', '查看装配舱文件清单')
        return listAllFiles(job.stagingDir).join('\n')
      case 'read_file':
        job.onStage('crank', `读取 ${args.path}…`)
        job.onActivity?.('tool', `读取 ${args.path}`)
        return fs.readFileSync(resolveSafe(job.stagingDir, String(args.path)), 'utf-8')
      case 'write_file': {
        const abs = resolveSafe(job.stagingDir, String(args.path))
        if (typeof args.content !== 'string') throw new Error('content 必须是字符串')
        job.onStage('crank', `正在写 ${args.path}…`)
        const lines = args.content.split('\n').length
        job.onActivity?.('write', `写入 ${args.path}（${lines} 行）`)
        fs.mkdirSync(path.dirname(abs), { recursive: true })
        fs.writeFileSync(abs, args.content, 'utf-8')
        return `已写入 ${args.path}（${Buffer.byteLength(args.content)} 字节）`
      }
      case 'check_egg': {
        job.onStage('clack', `自检中（第 ${rounds} 轮）…`)
        const { pass, report } = await runCheck()
        job.onActivity?.('check', pass ? `自检通过（第 ${rounds} 轮）` : `自检发现问题（第 ${rounds} 轮），准备修复…`)
        return report
      }
      default:
        throw new Error(`未知工具 ${name}`)
    }
  }

  while (turns < MAX_TURNS) {
    if (Date.now() > deadline) return { ok: false, rounds, turns, error: '机芯超时（15 分钟）' }
    if (totalTokens > MAX_TOTAL_TOKENS) return { ok: false, rounds, turns, error: 'token 预算耗尽' }
    turns++
    job.onStage('crank', `第 ${turns} 回合，模型思考中…`)

    let stream: StreamResult | undefined
    let lastError = ''
    let lastThinkEmit = 0
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        stream = await streamCompletion(cfg, messages, partial => {
          // 思考内容节流上报（同 id 原地替换，前端看到文字逐字生长）
          const now = Date.now()
          if (now - lastThinkEmit < 1200) return
          lastThinkEmit = now
          job.onActivity?.('think', partial.trim().slice(0, 200), `think-${turns}`)
        })
        break
      } catch (e) {
        if (e instanceof HttpError) {
          // HTTP 业务错误不重试（通常是配置/余额问题）
          return { ok: false, rounds, turns, error: `模型请求失败 HTTP ${e.status}: ${e.body}` }
        }
        lastError = (e as Error).message
        if (attempt < MAX_RETRIES) {
          job.onActivity?.('retry', `模型请求中断（${lastError}），第 ${attempt + 1} 次重试…`)
          await new Promise(r => setTimeout(r, 2000))
        }
      }
    }
    if (!stream) {
      return { ok: false, rounds, turns, error: `模型请求异常（已重试 ${MAX_RETRIES} 次）: ${lastError}` }
    }

    totalTokens += stream.estimatedTokens
    const msg = stream.message
    messages.push(msg)

    // 机芯实况：AI 的完整思考（替换流式片段）
    if (msg.content && msg.content.trim()) {
      job.onActivity?.('think', msg.content.trim().slice(0, 200), `think-${turns}`)
    }

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      messages.push({ role: 'user', content: '请继续使用工具完成制造；全部完成后调用 finish。' })
      continue
    }

    for (const tc of msg.tool_calls) {
      let args: Record<string, unknown> = {}
      try {
        args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {}
      } catch {
        messages.push({ role: 'tool', tool_call_id: tc.id, content: '工具参数不是合法 JSON，请重试' })
        continue
      }

      if (tc.function.name === 'finish') {
        job.onStage('clack', `最终验收（第 ${rounds} 轮）…`)
        const { pass, report } = await runCheck()
        if (pass) return { ok: true, rounds, turns }
        if (rounds >= job.maxRounds) {
          return { ok: false, rounds, turns, error: `${job.maxRounds} 轮自检仍未通过。最后的问题：\n${report}` }
        }
        rounds++
        messages.push({ role: 'tool', tool_call_id: tc.id, content: `${report}\n请修复以上问题后再次 finish。` })
        continue
      }

      try {
        const out = await execTool(tc.function.name, args)
        messages.push({ role: 'tool', tool_call_id: tc.id, content: out.slice(0, 30_000) })
      } catch (e) {
        messages.push({ role: 'tool', tool_call_id: tc.id, content: `工具执行失败: ${(e as Error).message}` })
      }
    }
  }

  return { ok: false, rounds, turns, error: `超过最大回合数（${MAX_TURNS}）仍未完成` }
}
