import fs from 'node:fs'
import path from 'node:path'
import { getAiSettings } from './settings'
import { validateEgg } from './validate'
import { testEgg } from './test'
import { resolveAiEndpoint, chatCompletionFetch, type AiEndpoint } from './aiChannel'
import { logLine } from './log'

export type ActivityType = 'think' | 'tool' | 'write' | 'check' | 'retry' | 'error'

/**
 * 主进程→渲染进程的文案载体：
 * i18n 键 + 插值参数（翻译在渲染进程做，主进程不持有任何语言包）；
 * 或裸字符串（AI 原始输出、技术性错误诊断，前端原样展示）。
 */
export type IpcText = { key: string; params?: Record<string, string | number> } | string

export interface DriverJob {
  wish: string
  stagingDir: string
  templateDir: string
  maxRounds: number
  /** 用户界面语言：生成物文案 + AI 实况解说的输出语言 */
  lang: 'zh' | 'en'
  /** 升级模式：舱里是现有蛋的代码而非空白模板 */
  upgrade?: { baseWish: string }
  onStage: (stage: string, detail?: IpcText) => void
  /** 机芯实况：AI 思考、工具调用、文件写入、自检结果等。id 相同的条目原地替换（用于流式思考实时更新） */
  onActivity?: (type: ActivityType, text: IpcText, id?: string) => void
}

export interface DriverResult {
  ok: boolean
  rounds: number
  turns: number
  error?: IpcText
}

const MAX_TURNS = 60
const MAX_TOTAL_TOKENS = 300_000
const OVERALL_TIMEOUT_MS = 15 * 60 * 1000
const STALL_TIMEOUT_MS = 60_000        // 流式断流检测：60 秒收不到任何数据即判定中断
const REQUEST_HARD_CAP_MS = 8 * 60_000 // 单次请求硬上限（防模型无限吐字）
const MAX_RETRIES = 2

// ─── 上下文窗口管理 ───
const DEFAULT_CONTEXT_TOKENS = 256_000 // ↑ 128K→256K，现代模型普遍支持 128K–1M 上下文
const CONTEXT_USAGE_RATIO = 0.85       // ↑ 0.7→0.85，现代模型近满上下文处理能力大幅提升
const KEEP_RECENT = 16                 // ↑ 12→16，保留更多最近消息
const CRITICAL_TOOL_KEEP = 24_000      // 验收报告/指南：修 bug 的唯一依据，尽可能保留
const NORMAL_TOOL_KEEP = 4_000         //  文件内容/读取结果：旧版本价值递减
const STRUCTURAL_KEEP = 3_000          //  文件列表：旧快照只要骨架
const OLD_ASSISTANT_KEEP = 400         //  旧思考：保留开头供上下文连贯

/** 工具重要性分级：验收与指南是修 bug 的唯一依据，压缩时必须优先保护 */
const CRITICAL_TOOLS = new Set(['check_egg', 'read_guide'])

/**
 * 上下文压缩（v2——重要性分级）：
 *   保留：system(0) + 第一条 user(1) + 最近 KEEP_RECENT 条完整不动。
 *   中间区域：
 *     - check_egg / finish 失败反馈 / read_guide → 关键级（最多保留 CRITICAL_TOOL_KEEP）
 *     - list_files → 结构级（最多保留 STRUCTURAL_KEEP）
 *     - read_file / write_file → 普通级（最多保留 NORMAL_TOOL_KEEP）
 *     - assistant → 保留首 OLD_ASSISTANT_KEEP 字
 *
 *   额外：已被后续 write_file 覆盖的旧 read_file 结果只保留路径标记（1KB），
 *   避免智能体引用已过时的代码片段。
 */
function compactMessages(messages: unknown[], charBudget: number, lang: 'zh' | 'en'): void {
  const totalChars = messages.reduce((s: number, m) => s + JSON.stringify(m).length, 0)
  if (totalChars <= charBudget) return

  // 收集被写过的文件路径：旧 read_file 结果对它们已失效
  const writtenPaths = new Set<string>()
  for (let i = messages.length - 1; i >= 2; i--) {
    const m = messages[i] as Record<string, unknown>
    const toolName = m._tool as string | undefined
    if (toolName === 'write_file' && typeof m.content === 'string') {
      const match = m.content.match(/^已写入 (.+?)（/)
      if (match) writtenPaths.add(match[1])
    }
  }

  const compactEnd = messages.length - KEEP_RECENT
  const marker = lang === 'zh'
    ? { critical: (n: number) => `\n…[关键记录已压缩，原 ${n} 字]`, normal: (n: number) => `\n…[已压缩，原 ${n} 字]`, stale: (path: string, n: number) => `\n[此文件已被后续 write_file 覆盖，原内容 ${n} 字已丢弃]`, think: '…[思考已压缩]' }
    : { critical: (n: number) => `\n…[critical record compressed, was ${n} chars]`, normal: (n: number) => `\n…[compressed, was ${n} chars]`, stale: (path: string, n: number) => `\n[this file was overwritten by a later write_file, ${n} chars discarded]`, think: '…[thinking compressed]' }

  for (let i = 2; i < compactEnd; i++) {
    const m = messages[i] as Record<string, unknown>

    if (m.role === 'tool' && typeof m.content === 'string') {
      const content = m.content as string
      const toolName = m._tool as string | undefined

      // 关键工具：验收报告、指南、finish 失败反馈
      if (toolName && CRITICAL_TOOLS.has(toolName) || content.includes('请修复以上问题后再次 finish')) {
        if (content.length > CRITICAL_TOOL_KEEP) {
          m.content = content.slice(0, CRITICAL_TOOL_KEEP) + marker.critical(content.length)
        }
        continue
      }

      // 旧 read_file：文件已被后续写入覆盖 → 只保留路径标记
      if (toolName === 'read_file') {
        const readPath = m._path as string | undefined
        if (readPath && writtenPaths.has(readPath) && content.length > 1000) {
          m.content = marker.stale(readPath, content.length)
          continue
        }
      }

      // 结构级：list_files
      if (toolName === 'list_files' && content.length > STRUCTURAL_KEEP) {
        m.content = content.slice(0, STRUCTURAL_KEEP) + marker.normal(content.length)
        continue
      }

      // 普通级：read_file / write_file 确认
      if (content.length > NORMAL_TOOL_KEEP) {
        m.content = content.slice(0, NORMAL_TOOL_KEEP) + marker.normal(content.length)
      }
    } else if (m.role === 'assistant' && typeof m.content === 'string') {
      const content = m.content as string
      if (content.length > OLD_ASSISTANT_KEEP) {
        m.content = content.slice(0, 300) + marker.think
      }
    }
  }
}

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
  },
  {
    type: 'function',
    function: {
      name: 'read_guide',
      description: '读取能力指南。复杂能力（如联机、AI、3D widget）有专属深度指南，实现前必须先读取。参数示例："net-lan"（总纲）或 "net-lan/sync-pattern"（具体章节）',
      parameters: {
        type: 'object',
        properties: { topic: { type: 'string', description: '指南路径，如 net-lan 或 net-lan/sync-pattern' } },
        required: ['topic']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_icon',
      description: '批量搜索可用图标名。一次调用传入所有需要的图标关键词，返回去重后的紧凑列表（总量 ≤30），从中挑选最合适的即可。不要 read_file 读 icons-manifest.json——那文件太长会撑爆上下文。优先使用 EGG_GUIDE 中已有的图标，只在需要特殊图标时调用此工具。',
      parameters: {
        type: 'object',
        properties: {
          keywords: { type: 'array', items: { type: 'string' }, description: '所有需要搜索的图标关键词一次性传入，如 ["chart", "bell", "wand", "send"]。不要逐词分多次调用' }
        },
        required: ['keywords']
      }
    }
  }
]

/** 根据 wish 关键词检测是否需要强制读取指南 */
function detectGuideHint(wish: string, lang: 'zh' | 'en'): string | null {
  const netKeywords = /联机|对战|多人|局域网|房间|双人对|在线|PvP|多人游戏|实时同步|multiplayer|online|LAN|co-op|versus|two.?player/i
  if (netKeywords.test(wish)) {
    return lang === 'zh'
      ? '❗ 本愿望涉及局域网联机能力。你必须先调用 read_guide(\'net-lan\') 读取联机指南总纲，再根据需要读取具体章节（sync-pattern / handshake / disconnect），然后才能开始写代码。'
      : "❗ This wish involves LAN multiplayer capability. You MUST first call read_guide('net-lan') to read the networking guide overview, then read specific chapters (sync-pattern / handshake / disconnect) as needed, before writing any code."
  }
  return null
}

/** 递归列出 guides/ 下所有可用指南路径（不含 .md 后缀） */
function listGuides(dir: string, prefix = ''): string[] {
  if (!fs.existsSync(dir)) return []
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      const sub = path.join(dir, entry.name)
      if (fs.existsSync(path.join(sub, 'index.md'))) out.push(prefix + entry.name)
      out.push(...listGuides(sub, prefix + entry.name + '/'))
    } else if (entry.name.endsWith('.md') && entry.name !== 'index.md') {
      out.push(prefix + entry.name.replace(/\.md$/, ''))
    }
  }
  return out
}

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

function buildSystemPrompt(templateDir: string, lang: 'zh' | 'en'): string {
  const guide = fs.readFileSync(path.join(templateDir, 'EGG_GUIDE.md'), 'utf-8')
  const dts = fs.readFileSync(path.join(templateDir, 'egg.d.ts'), 'utf-8')
  const langDirective = lang === 'zh'
    ? '用户界面语言：中文。生成的应用中所有用户可见文本（manifest.name、UI 文案、按钮、提示）必须使用中文；你的所有回复与实况解说也必须使用中文。'
    : 'User interface language: English. ALL user-visible text in the generated app (manifest.name, UI copy, buttons, hints) MUST be in English; ALL your replies and live commentary MUST also be in English.'
  return [
    '你是 appGacha 的扭蛋机芯——一个把用户愿望制造成桌面小应用（扭蛋）的工程智能体。',
    '装配舱里已放好模板文件，你通过工具读写文件完成制造。',
    '',
    '制造流程（严格遵守）：',
    '1.【规划】收到愿望后先输出制造方案（窗口形态、文件结构、核心模块、permissions），不调工具。',
    '2.【执行】按方案依次写出 manifest.json、icon.svg、index.html、style.css、app.js（及 src/ 子模块）。icon.svg 是收藏柜里展示的应用图标，规格见 EGG_GUIDE。',
    '3.【验收】调用 check_egg 自检，修完所有问题后调用 finish。',
    '',
    '=== 制造规范（EGG_GUIDE.md） ===',
    guide,
    '',
    '=== 宿主 API 类型声明（egg.d.ts） ===',
    dts,
    '',
    '=== 输出语言（最高优先级） ===',
    langDirective
  ].join('\n')
}

// HTTP 业务错误（4xx/5xx）——与网络/断流错误区分，不重试
class HttpError extends Error {
  constructor(public status: number, public body: string) { super(`HTTP ${status}`) }
}

interface StreamResult { message: AssistantMessage; estimatedTokens: number }

/**
 * 流式请求（SSE）+ 断流检测，双通道（自有 Key 直连 / 平台代理耗积分）。
 * 与 Claude Code / Codex 等工具同款的超时策略：只要 token 还在流就不算超时，
 * 只有“断流”（60 秒无任何数据）才中断并重试。tool_calls 以增量 delta 拼接。
 */
async function streamCompletion(
  endpoint: AiEndpoint,
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
    // ─── 调试日志：请求概要 ───
    logLine(`[fc] stream req:`, `endpoint=${endpoint.kind}`, `model=${endpoint.kind === 'direct' ? endpoint.model : endpoint.defaultModel}`,
      `msgCount=${messages.length}`, `lastMsg=${JSON.stringify(messages[messages.length - 1]).slice(0, 200)}`)

    const res = await chatCompletionFetch(endpoint, {
      messages, tools: TOOLS, temperature: 0.3, stream: true
    }, { signal: controller.signal, timeout: REQUEST_HARD_CAP_MS + 30_000 })
    if (!res.ok) {
      const text = (await res.text().catch(() => '')).slice(0, 300)
      throw new HttpError(res.status, text)
    }
    if (!res.body) throw new Error('响应没有数据流')

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let content = ''
    let chunkCount = 0
    let firstPayload = ''
    let rawBody = ''  // 收集全部响应原文，0 chunk 时用于诊断
    const tcMap = new Map<number, { id: string; name: string; args: string }>()

    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      feedStallWatchdog()
      const text = decoder.decode(value, { stream: true })
      buffer += text
      if (rawBody.length < 2000) rawBody += text  // 前 2000 字符用于诊断
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const t = line.trim()
        if (!t.startsWith('data:')) continue
        const payload = t.slice(5).trim()
        if (!payload || payload === '[DONE]') continue
        chunkCount++
        if (!firstPayload) firstPayload = payload.slice(0, 400)
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

    // ─── 调试日志：流式接收统计 ───
    logLine(`[fc] stream recv:`, `${chunkCount} SSE chunks, content="${content.slice(0, 150)}", toolCalls=${tool_calls.length}`)
    if (firstPayload) logLine(`[fc] stream first delta:`, firstPayload)
    if (chunkCount === 0) {
      logLine(`[fc] stream ⚠ ZERO chunks — raw body (first 2000 chars):`, rawBody.slice(0, 2000) || '(completely empty)')
      logLine(`[fc] stream response:`, `status=${res.status}`, `contentType=${res.headers.get('content-type')}`,
        `contentLength=${res.headers.get('content-length')}`)
    }

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
  // 双通道：自有 Key 直连；无 Key 且登录 + 平台代理启用 → 走平台通道耗积分
  const endpoint = await resolveAiEndpoint()
  if (!endpoint) return { ok: false, rounds: 0, turns: 0, error: { key: 'err.aiNotConfigured' } }

  // 从配置的模型上下文窗口派生字符预算（token × 3 ≈ 字符，取 70% 作为消息体上限）
  const contextTokens = (endpoint.kind === 'direct' ? getAiSettings()?.contextTokens : 0) || DEFAULT_CONTEXT_TOKENS
  const charBudget = Math.floor(contextTokens * 3 * CONTEXT_USAGE_RATIO)

  const deadline = Date.now() + OVERALL_TIMEOUT_MS
  let totalTokens = 0
  let rounds = 1
  let turns = 0
  let planDone = false  // P1 规划守卫：AI 输出过规划文本后才允许 write_file
  let consecutiveEmpty = 0  // 连续空响应计数：连续 3 次空响应视为模型失联

  // ─── 调试日志：任务概况 ───
  logLine('[fc] ===== 新任务开始 =====',
    `mode=${job.upgrade ? 'upgrade' : 'create'}`,
    `wish="${job.wish.slice(0, 120)}${job.wish.length > 120 ? '…' : ''}"`,
    `lang=${job.lang}`,
    `contextTokens=${contextTokens}`,
    `charBudget=${charBudget}`)

  const opening = job.upgrade
    ? (job.lang === 'zh' ? [
        '这是一次对现有扭蛋的升级改造，装配舱里是这颗蛋当前的完整代码（data/ 数据不在舱内，运行时会在）。',
        `蛋的原始愿望：${job.upgrade.baseWish}`,
        `本次升级愿望：${job.wish}`,
        '',
        '要求：先读现有代码，在其基础上增量修改，保留原有功能与数据。',
        '先 list_files 确认 vendor/ 里实际有哪些库——只 import 确实存在的文件；若需要的库已在 vendor/ 中，直接用静态 import，禁止 try/catch 动态降级（功能静默死亡比报错更糟）。',
        '若改动数据库表结构，必须在启动逻辑里写好旧结构到新结构的迁移（如 try/catch 包裹 ALTER TABLE），旧数据一条都不能丢。',
        '完成后调用 finish。'
      ].join('\n') : [
        'This is an upgrade of an existing gacha egg — the cabin contains its full current code (data/ is not in the cabin but exists at runtime).',
        `Original wish: ${job.upgrade.baseWish}`,
        `Upgrade wish: ${job.wish}`,
        '',
        'Requirements: read the existing code first, make incremental changes on top of it, preserve all existing features and data.',
        'First list_files to check which libraries actually exist in vendor/ — only import files that exist; if a needed library is already in vendor/, use a static import directly, no try/catch dynamic fallback (silent feature death is worse than an error).',
        'If you change the database schema, write old-to-new migration in the startup logic (e.g. ALTER TABLE wrapped in try/catch) — not a single row of old data may be lost.',
        'Call finish when done.'
      ].join('\n'))
    : job.lang === 'zh'
      ? `用户的愿望：${job.wish}\n\n请开始制造这颗扭蛋。`
      : `User's wish: ${job.wish}\n\nStart manufacturing this gacha egg.`

  // 管线预判：wish 关键词命中复杂能力时，追加强制读指南提示
  const guideHint = detectGuideHint(job.wish, job.lang)
  const userContent = guideHint ? `${opening}\n\n${guideHint}` : opening

  const messages: unknown[] = [
    { role: 'system', content: buildSystemPrompt(job.templateDir, job.lang) },
    { role: 'user', content: userContent }
  ]

  // ─── 调试日志：初始消息 ───
  const sysPrompt = String((messages[0] as Record<string,unknown>).content)
  logLine('[fc] system prompt:', `${sysPrompt.length} chars`)
  logLine('[fc] system prompt (head 500):', sysPrompt.slice(0, 500))
  logLine('[fc] user[0]:', userContent.slice(0, 400))

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
        job.onStage('crank', { key: 'feed.listing' })
        job.onActivity?.('tool', { key: 'feed.list' })
        return listAllFiles(job.stagingDir).join('\n')
      case 'read_file':
        job.onStage('crank', { key: 'feed.reading', params: { path: String(args.path) } })
        job.onActivity?.('tool', { key: 'feed.read', params: { path: String(args.path) } })
        return fs.readFileSync(resolveSafe(job.stagingDir, String(args.path)), 'utf-8')
      case 'write_file': {
        if (!planDone) return '✘ 请先输出制造方案（窗口形态、文件结构、核心模块设计）再开始写文件。'
        const abs = resolveSafe(job.stagingDir, String(args.path))
        if (typeof args.content !== 'string') throw new Error('content 必须是字符串')
        job.onStage('crank', { key: 'feed.writing', params: { path: String(args.path) } })
        const lines = args.content.split('\n').length
        job.onActivity?.('write', { key: 'feed.write', params: { path: String(args.path), lines } })
        fs.mkdirSync(path.dirname(abs), { recursive: true })
        fs.writeFileSync(abs, args.content, 'utf-8')
        return `已写入 ${args.path}（${Buffer.byteLength(args.content)} 字节）`
      }
      case 'check_egg': {
        job.onStage('clack', { key: 'feed.checking', params: { n: rounds } })
        const { pass, report } = await runCheck()
        job.onActivity?.('check', pass
          ? { key: 'feed.checkPass', params: { n: rounds } }
          : { key: 'feed.checkFail', params: { n: rounds } })
        return report
      }
      case 'read_guide': {
        const topic = String(args.topic || '').replace(/\\/g, '/').replace(/\.\./g, '')
        const guidesDir = path.join(job.templateDir, 'guides')
        // topic 可以是 "net-lan"（读 index.md）或 "net-lan/sync-pattern"（读具体章节）
        const file = topic.includes('/') ? `${topic}.md` : path.join(topic, 'index.md')
        const abs = path.join(guidesDir, file)
        if (!abs.startsWith(guidesDir)) throw new Error('非法指南路径')
        if (!fs.existsSync(abs)) {
          // 列出可用指南帮助 AI 自纠
          const available = listGuides(guidesDir)
          return `指南不存在：${topic}\n可用指南：\n${available.join('\n')}`
        }
        job.onActivity?.('tool', { key: 'feed.guide', params: { topic } })
        return fs.readFileSync(abs, 'utf-8')
      }
      case 'search_icon': {
        // 批量搜索：keywords 数组（新），也兼容 keyword 单字符串（旧）
        const raw = args.keywords ?? (args.keyword ? [args.keyword] : [])
        if (!Array.isArray(raw) || raw.length === 0) return '请提供 keywords 参数，如 search_icon({ keywords: ["chart", "bell"] })'
        const keywords: string[] = raw.map((k: unknown) => String(k || '').toLowerCase().trim()).filter(Boolean)
        if (keywords.length === 0) return '请提供至少一个有效的图标关键词'
        const manifestPath = path.join(job.templateDir, 'icons-manifest.json')
        if (!fs.existsSync(manifestPath)) return '图标清单文件不存在，请直接使用 EGG_GUIDE 中列出的高频图标名'
        const allIcons: string[] = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
        const PER_KW = 8
        const TOTAL = 30
        const seen = new Set<string>()
        const collected: string[] = []
        for (const kw of keywords) {
          let added = 0
          for (const name of allIcons) {
            if (!name.toLowerCase().includes(kw)) continue
            if (seen.has(name)) continue
            seen.add(name)
            collected.push(name)
            added++
            if (added >= PER_KW) break
          }
        }
        if (collected.length === 0) {
          return `未找到匹配 "${keywords.join(', ')}" 的图标。请换关键词，或直接使用 EGG_GUIDE 中的高频图标。`
        }
        const list = collected.slice(0, TOTAL).join(', ')
        const tail = collected.length > TOTAL ? ` … 还有 ${collected.length - TOTAL} 个省略` : ''
        return `匹配 ${keywords.length} 个关键词的图标（${collected.length} 个，去重）：${list}${tail}`
      }
      default:
        throw new Error(`未知工具 ${name}`)
    }
  }

  while (turns < MAX_TURNS) {
    if (Date.now() > deadline) {
      logLine(`[fc] RESULT: timeout`, `turns=${turns}, rounds=${rounds}, tokens=${totalTokens}`)
      return { ok: false, rounds, turns, error: { key: 'err.timeout' } }
    }
    if (totalTokens > MAX_TOTAL_TOKENS) {
      logLine(`[fc] RESULT: tokenBudget exceeded`, `turns=${turns}, rounds=${rounds}, tokens=${totalTokens}`)
      return { ok: false, rounds, turns, error: { key: 'err.tokenBudget' } }
    }
    turns++
    job.onStage('crank', { key: 'feed.turn', params: { n: turns } })

    // ─── 调试日志：回合开始 ───
    const countChars = (arr: unknown[]) => arr.reduce((s: number, m) => s + JSON.stringify(m).length, 0)
    const msgChars = countChars(messages)
    logLine(`[fc] turn ${turns} start:`, `${messages.length} msgs, ~${msgChars} chars, ~${totalTokens} tokens, round ${rounds}`)

    // 上下文压缩：消息体超过预算时截断旧工具输出（v2：重要性分级）
    const beforeCompact = countChars(messages)
    compactMessages(messages, charBudget, job.lang)
    const afterCompact = countChars(messages)
    if (beforeCompact > afterCompact) {
      logLine(`[fc] turn ${turns} compact:`, `${beforeCompact} → ${afterCompact} chars (budget=${charBudget})`)
    }

    let stream: StreamResult | undefined
    let lastError = ''
    let lastThinkEmit = 0
    const streamStart = Date.now()
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        stream = await streamCompletion(endpoint, messages, partial => {
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
          logLine(`[fc] HTTP error:`, e.status, e.body.slice(0, 300))
          if (e.status === 402) {
            // 积分不足：引导充值（断点续建待后续版本支持）
            return { ok: false, rounds, turns, error: { key: 'err.insufficientCredits' } }
          }
          if (e.status === 503) {
            return { ok: false, rounds, turns, error: { key: 'err.proxyUnavailable' } }
          }
          return { ok: false, rounds, turns, error: { key: 'err.http', params: { status: e.status, body: e.body } } }
        }
        lastError = (e as Error).message
        logLine(`[fc] turn ${turns} stream error:`, lastError)
        if (attempt < MAX_RETRIES) {
          job.onActivity?.('retry', { key: 'feed.retry', params: { error: lastError, n: attempt + 1 } })
          await new Promise(r => setTimeout(r, 2000))
        }
      }
    }
    if (!stream) {
      logLine(`[fc] RESULT: retriesExhausted`, `turns=${turns}, error="${lastError}"`)
      return { ok: false, rounds, turns, error: { key: 'err.retriesExhausted', params: { n: MAX_RETRIES, error: lastError } } }
    }

    totalTokens += stream.estimatedTokens
    const msg = stream.message
    messages.push(msg)

    const streamMs = Date.now() - streamStart
    // ─── 调试日志：AI 响应全文 ───
    logLine(`[fc] turn ${turns} stream done in ${streamMs}ms:`, `estTokens=${stream.estimatedTokens}`, `totalTokens=${totalTokens}`,
      `hasContent=${!!msg.content}`, `contentLen=${msg.content?.length ?? 0}`,
      `toolCalls=${msg.tool_calls?.length ?? 0}`)
    if (msg.content) {
      logLine(`[fc] turn ${turns} AI full:`, msg.content)
    }
    if (msg.tool_calls && msg.tool_calls.length > 0) {
      for (const tc of msg.tool_calls) {
        const argsPreview = tc.function.arguments.length > 500
          ? tc.function.arguments.slice(0, 500) + `… (${tc.function.arguments.length} chars total)`
          : tc.function.arguments
        logLine(`[fc] turn ${turns} tool_call:`, tc.function.name, argsPreview)
      }
    }

    // ─── 空响应告警：模型既没输出文本也没调工具 → 可能是网络断流或模型拒绝响应 ───
    if (!msg.content && (!msg.tool_calls || msg.tool_calls.length === 0)) {
      consecutiveEmpty++
      logLine(`[fc] turn ${turns} ⚠ EMPTY RESPONSE #${consecutiveEmpty} — no content, no tool calls. Raw msg:`,
        JSON.stringify(msg).slice(0, 500))
      if (consecutiveEmpty >= 3) {
        logLine(`[fc] RESULT: emptyLoop — ${consecutiveEmpty} consecutive empty responses, model appears unresponsive`)
        return { ok: false, rounds, turns, error: `模型连续 ${consecutiveEmpty} 次空响应，可能网络断流或模型异常` }
      }
    } else {
      consecutiveEmpty = 0
    }

    // P1 规划守卫：检测 AI 是否已输出规划（content 超过 80 字即视为规划完成）
    if (msg.content && msg.content.trim().length > 80) planDone = true

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
        messages.push({ role: 'tool', tool_call_id: tc.id, content: '工具参数不是合法 JSON，请重试', _tool: '_error' })
        continue
      }

      if (tc.function.name === 'finish') {
        job.onStage('clack', { key: 'feed.finalCheck', params: { n: rounds } })
        const { pass, report } = await runCheck()
        logLine(`[fc] turn ${turns} finish check:`, pass ? 'PASS' : 'FAIL', `round=${rounds}/${job.maxRounds}`)
        if (!pass) {
          logLine(`[fc] turn ${turns} finish report:`, report.slice(0, 800))
        }
        if (pass) {
          logLine(`[fc] RESULT: success`, `turns=${turns}, rounds=${rounds}, tokens=${totalTokens}`)
          return { ok: true, rounds, turns }
        }
        if (rounds >= job.maxRounds) {
          logLine(`[fc] RESULT: maxRounds exceeded`, `turns=${turns}, rounds=${rounds}, tokens=${totalTokens}`)
          return { ok: false, rounds, turns, error: { key: 'err.checksFailed', params: { n: job.maxRounds, report } } }
        }
        rounds++
        messages.push({ role: 'tool', tool_call_id: tc.id, content: `${report}\n请修复以上问题后再次 finish。`, _tool: 'finish' })
        continue
      }

      try {
        const out = await execTool(tc.function.name, args)
        // ─── 调试日志：工具结果 ───
        const outPreview = out.length > 600
          ? out.slice(0, 600) + `… (${out.length} chars total)`
          : out
        logLine(`[fc] turn ${turns} tool_result:`, tc.function.name, outPreview)
        const toolMsg: Record<string, unknown> = { role: 'tool', tool_call_id: tc.id, content: out.slice(0, 30_000), _tool: tc.function.name }
        // 为 read_file 记录路径，供压缩时检测过期引用（write_file 后旧 read 结果自动废弃）
        if (tc.function.name === 'read_file') toolMsg._path = String(args.path)
        messages.push(toolMsg)
      } catch (e) {
        const errMsg = `工具执行失败: ${(e as Error).message}`
        logLine(`[fc] turn ${turns} tool_error:`, tc.function.name, (e as Error).message)
        messages.push({ role: 'tool', tool_call_id: tc.id, content: errMsg, _tool: tc.function.name })
      }
    }
  }

  // 超过最大回合数
  logLine(`[fc] RESULT: maxTurns reached`, `turns=${turns}, rounds=${rounds}, tokens=${totalTokens}`)
  return { ok: false, rounds, turns, error: { key: 'err.maxTurns', params: { n: MAX_TURNS } } }
}
