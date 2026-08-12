import { EggContext } from '../eggs'
import { resolveAiEndpoint, chatCompletionFetch, throwForProxyStatus, parseSseContent } from '../aiChannel'

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface ChatOpts {
  temperature?: number
  maxTokens?: number
}

const TIMEOUT_MS = 60_000
const MAX_TOTAL_CHARS = 64_000
const RATE_LIMIT_PER_MIN = 20

// 每蛋滑动窗口限速
const callLog = new Map<string, number[]>()

function checkRate(eggId: string): void {
  const now = Date.now()
  const log = (callLog.get(eggId) ?? []).filter(t => now - t < 60_000)
  if (log.length >= RATE_LIMIT_PER_MIN) {
    throw new Error(`AI_RATE_LIMITED: 该蛋一分钟内调用超过 ${RATE_LIMIT_PER_MIN} 次，稍后再试`)
  }
  log.push(now)
  callLog.set(eggId, log)
}

function validateMessages(messages: unknown): asserts messages is ChatMessage[] {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('AI_BAD_REQUEST: messages 必须是非空数组')
  }
  let total = 0
  for (const m of messages as ChatMessage[]) {
    if (!m || !['system', 'user', 'assistant'].includes(m.role) || typeof m.content !== 'string') {
      throw new Error('AI_BAD_REQUEST: message 必须是 {role: system|user|assistant, content: string}')
    }
    total += m.content.length
  }
  if (total > MAX_TOTAL_CHARS) {
    throw new Error(`AI_BAD_REQUEST: messages 总长度超过 ${MAX_TOTAL_CHARS} 字符`)
  }
}

async function completions(body: Record<string, unknown>): Promise<string> {
  // 双通道：自有 Key 直连；无 Key 且平台代理启用 → 走平台通道耗积分
  const endpoint = await resolveAiEndpoint()
  if (!endpoint) {
    throw new Error('AI_NOT_CONFIGURED: 主应用还没有配置模型，请在收藏柜右上角「设置」里填写，或登录账号使用平台积分')
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  let res: Response
  try {
    res = await chatCompletionFetch(endpoint, body, { signal: controller.signal, timeout: TIMEOUT_MS + 5_000 })
  } catch (e) {
    throw new Error(`AI_NETWORK: ${(e as Error).message}`)
  } finally {
    clearTimeout(timer)
  }

  if (!res.ok) {
    try {
      await throwForProxyStatus(res)
    } catch (e) {
      const msg = (e as Error).message
      if (res.status === 402) throw new Error(`AI_CREDITS: 积分不足，请充值后再使用蛋内 AI（${msg}）`)
      throw new Error(`AI_PROXY: 平台 AI 通道暂不可用（${msg}）`)
    }
    const text = (await res.text().catch(() => '')).slice(0, 300)
    throw new Error(`AI_HTTP_${res.status}: ${text}`)
  }
  // 先取原文再判断格式（代理可能无视 Content-Type 返回 SSE）
  const rawText = await res.text()
  const ct = res.headers.get('content-type') || ''
  let content: string
  if (ct.includes('text/event-stream') || ct.includes('application/x-ndjson') || rawText.startsWith('data:')) {
    content = parseSseContent(rawText)
  } else {
    try {
      const msg = (JSON.parse(rawText) as { choices?: { message?: { content?: string; reasoning_content?: string } }[] }).choices?.[0]?.message
      content = msg?.content || msg?.reasoning_content || ''
    } catch {
      content = parseSseContent(rawText)
    }
  }
  if (typeof content !== 'string' || content.length === 0) throw new Error('AI_BAD_RESPONSE: 响应里没有 choices[0].message.content')
  return content
}

export async function chat(ctx: EggContext, messages: unknown, opts?: ChatOpts): Promise<string> {
  validateMessages(messages)
  if (ctx.aiMock) return '（测试模式：这是一条模拟的 AI 回复）'
  checkRate(ctx.eggId)
  return completions({
    messages,
    ...(opts?.temperature !== undefined ? { temperature: opts.temperature } : {}),
    ...(opts?.maxTokens !== undefined ? { max_tokens: opts.maxTokens } : {})
  })
}

// 按 JSON Schema 生成假数据，测试模式下让 extract 不烧真 token
function mockFromSchema(schema: Record<string, unknown>): unknown {
  const type = schema.type
  if (type === 'object') {
    const out: Record<string, unknown> = {}
    const props = (schema.properties ?? {}) as Record<string, Record<string, unknown>>
    for (const [key, sub] of Object.entries(props)) out[key] = mockFromSchema(sub)
    return out
  }
  if (type === 'array') return [mockFromSchema((schema.items ?? { type: 'string' }) as Record<string, unknown>)]
  if (type === 'number' || type === 'integer') return 1
  if (type === 'boolean') return true
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0]
  return '示例文本'
}

export async function extract(ctx: EggContext, text: unknown, schema: unknown): Promise<unknown> {
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new Error('AI_BAD_REQUEST: text 必须是非空字符串')
  }
  if (text.length > MAX_TOTAL_CHARS) throw new Error(`AI_BAD_REQUEST: text 超过 ${MAX_TOTAL_CHARS} 字符`)
  if (typeof schema !== 'object' || schema === null) {
    throw new Error('AI_BAD_REQUEST: schema 必须是 JSON Schema 对象')
  }
  if (ctx.aiMock) return mockFromSchema(schema as Record<string, unknown>)
  checkRate(ctx.eggId)

  const content = await completions({
    messages: [
      {
        role: 'system',
        content:
          '你是结构化提取引擎。仅输出一个 JSON 对象，不要输出任何其它文字或代码块标记。' +
          '输出必须严格符合以下 JSON Schema：\n' + JSON.stringify(schema)
      },
      { role: 'user', content: text }
    ],
    response_format: { type: 'json_object' },
    temperature: 0
  })

  try {
    return JSON.parse(content)
  } catch {
    // 有些模型无视 response_format 包了代码块，剥一层再试
    const stripped = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '')
    try {
      return JSON.parse(stripped)
    } catch {
      throw new Error('AI_BAD_JSON: 模型没有返回合法 JSON')
    }
  }
}
