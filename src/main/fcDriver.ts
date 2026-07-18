import { net } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { getAiSettings } from './settings'
import { validateEgg } from './validate'
import { testEgg } from './test'

export interface DriverJob {
  wish: string
  stagingDir: string
  templateDir: string
  maxRounds: number
  /** 升级模式：舱里是现有蛋的代码而非空白模板 */
  upgrade?: { baseWish: string }
  onStage: (stage: string, detail?: string) => void
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
const REQUEST_TIMEOUT_MS = 180_000

interface ToolCall { id: string; function: { name: string; arguments: string } }
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
        return listAllFiles(job.stagingDir).join('\n')
      case 'read_file':
        job.onStage('crank', `读取 ${args.path}…`)
        return fs.readFileSync(resolveSafe(job.stagingDir, String(args.path)), 'utf-8')
      case 'write_file': {
        const abs = resolveSafe(job.stagingDir, String(args.path))
        if (typeof args.content !== 'string') throw new Error('content 必须是字符串')
        job.onStage('crank', `正在写 ${args.path}…`)
        fs.mkdirSync(path.dirname(abs), { recursive: true })
        fs.writeFileSync(abs, args.content, 'utf-8')
        return `已写入 ${args.path}（${Buffer.byteLength(args.content)} 字节）`
      }
      case 'check_egg': {
        job.onStage('clack', `自检中（第 ${rounds} 轮）…`)
        const { report } = await runCheck()
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

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    let data: { choices?: { message?: AssistantMessage }[]; usage?: { total_tokens?: number } }
    try {
      const res = await net.fetch(`${cfg.baseURL}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify({ model: cfg.model, messages, tools: TOOLS, temperature: 0.3 }),
        signal: controller.signal
      })
      if (!res.ok) {
        const text = (await res.text().catch(() => '')).slice(0, 300)
        return { ok: false, rounds, turns, error: `模型请求失败 HTTP ${res.status}: ${text}` }
      }
      data = await res.json()
    } catch (e) {
      return { ok: false, rounds, turns, error: `模型请求异常: ${(e as Error).message}` }
    } finally {
      clearTimeout(timer)
    }

    totalTokens += data.usage?.total_tokens ?? 0
    const msg = data.choices?.[0]?.message
    if (!msg) return { ok: false, rounds, turns, error: '模型响应异常：没有 message' }
    messages.push(msg)

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
