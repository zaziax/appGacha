import { net } from 'electron'
import { EggContext } from '../eggs'
import { getAiSettings } from '../settings'

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
  const cfg = getAiSettings()
  if (!cfg || !cfg.apiKey) {
    throw new Error('AI_NOT_CONFIGURED: 主应用还没有配置模型，请在收藏柜右上角「设置」里填写')
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  let res: Response
  try {
    res = await net.fetch(`${cfg.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`
      },
      body: JSON.stringify({ model: cfg.model, ...body }),
      signal: controller.signal
    })
  } catch (e) {
    throw new Error(`AI_NETWORK: ${(e as Error).message}`)
  } finally {
    clearTimeout(timer)
  }

  if (!res.ok) {
    const text = (await res.text().catch(() => '')).slice(0, 300)
    throw new Error(`AI_HTTP_${res.status}: ${text}`)
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  const content = data.choices?.[0]?.message?.content
  if (typeof content !== 'string') throw new Error('AI_BAD_RESPONSE: 响应里没有 choices[0].message.content')
  return content
}

export async function chat(ctx: EggContext, messages: unknown, opts?: ChatOpts): Promise<string> {
  validateMessages(messages)
  checkRate(ctx.eggId)
  return completions({
    messages,
    ...(opts?.temperature !== undefined ? { temperature: opts.temperature } : {}),
    ...(opts?.maxTokens !== undefined ? { max_tokens: opts.maxTokens } : {})
  })
}

export async function extract(ctx: EggContext, text: unknown, schema: unknown): Promise<unknown> {
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new Error('AI_BAD_REQUEST: text 必须是非空字符串')
  }
  if (text.length > MAX_TOTAL_CHARS) throw new Error(`AI_BAD_REQUEST: text 超过 ${MAX_TOTAL_CHARS} 字符`)
  if (typeof schema !== 'object' || schema === null) {
    throw new Error('AI_BAD_REQUEST: schema 必须是 JSON Schema 对象')
  }
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
