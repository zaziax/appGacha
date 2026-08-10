/**
 * AI 双通道抽象 — 决策 3：自带 Key 优先，无 Key 走平台代理（消耗积分）。
 *
 * - direct：用户自有 OpenAI 兼容 Key，直连不花积分
 * - proxy ：登录 + 平台代理通道启用时，经后端 /proxy/chat 转发，按 token 扣积分
 *
 * 所有 AI 调用点（fcDriver 扭蛋机芯 / wishChat 许愿引导 / wishSuggest 灵感骰子 /
 * capabilities/ai 蛋内 egg.ai）统一走本模块，不再各自拼 URL。
 */

import { net } from 'electron'
import { getAiSettings } from './settings'
import { getAccessToken } from './auth'
import { apiFetchRaw } from './api'

export type AiEndpoint =
  | { kind: 'direct'; baseURL: string; model: string; apiKey: string }
  | { kind: 'proxy'; defaultModel: string }

/** 未配置 AI（无自有 Key 且平台通道不可用） */
export class AiNotConfiguredError extends Error {
  constructor() { super('AI_NOT_CONFIGURED') }
}

/** 平台通道业务错误：402 积分不足 / 503 通道未启用或未配置上游 */
export class AiProxyError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message)
    this.name = 'AiProxyError'
  }
  get insufficientCredits(): boolean { return this.status === 402 }
}

interface ClientConfig { enabled: boolean; default_model: string }
let clientConfigCache: { at: number; data: ClientConfig | null } | null = null
const CLIENT_CONFIG_TTL = 60_000

async function fetchClientConfig(): Promise<ClientConfig | null> {
  if (clientConfigCache && Date.now() - clientConfigCache.at < CLIENT_CONFIG_TTL) {
    return clientConfigCache.data
  }
  const res = await apiFetchRaw('/proxy/client-config')
  if (!res.ok) {
    // 未登录或后端不可达：视为通道不可用（不缓存失败，下次重试）
    return null
  }
  const data = (await res.json()) as ClientConfig
  clientConfigCache = { at: Date.now(), data }
  return data
}

/** 登录态变化时清缓存（登录/登出后通道可用性会变）；auth.ts 会发该事件 */
export function invalidateAiChannel(): void {
  clientConfigCache = null
}
process.on('appgacha:auth-changed' as never, invalidateAiChannel as never)

/**
 * 解析当前 AI 端点：自有 Key 优先；否则登录 + 平台通道启用时回落代理。
 * 返回 null = 两条通道都不可用（调用方决定报 AiNotConfiguredError 还是降级）。
 */
export async function resolveAiEndpoint(): Promise<AiEndpoint | null> {
  const cfg = getAiSettings()
  if (cfg?.apiKey && cfg.baseURL && cfg.model) {
    return { kind: 'direct', baseURL: cfg.baseURL, model: cfg.model, apiKey: cfg.apiKey }
  }
  if (!getAccessToken()) return null
  try {
    const pc = await fetchClientConfig()
    if (pc?.enabled && pc.default_model) {
      return { kind: 'proxy', defaultModel: pc.default_model }
    }
  } catch {
    // 网络异常视为不可用
  }
  return null
}

/**
 * 发起 chat completions 请求，返回原始 Response（调用方自行判状态码/读流）。
 * - direct → {baseURL}/chat/completions
 * - proxy  → 后端 /proxy/chat（鉴权走用户 token）
 * body 里无需带 model 时可传 modelOverride 指定。
 */
export async function chatCompletionFetch(
  endpoint: AiEndpoint,
  body: Record<string, unknown>,
  opts: { signal?: AbortSignal; timeout?: number; modelOverride?: string } = {}
): Promise<Response> {
  if (endpoint.kind === 'direct') {
    return net.fetch(`${endpoint.baseURL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${endpoint.apiKey}` },
      body: JSON.stringify({ model: endpoint.model, ...body }),
      ...(opts.signal ? { signal: opts.signal } : {})
    })
  }
  return apiFetchRaw('/proxy/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: opts.modelOverride || endpoint.defaultModel, ...body }),
    ...(opts.signal ? { signal: opts.signal } : {}),
    timeout: opts.timeout ?? 60_000
  })
}

/** 解析 SSE 格式的 AI 响应：逐行读 "data: <json>"，拼接所有 content 片段 */
export function parseSseContent(raw: string): string {
  const parts: string[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith(':')) continue
    if (!trimmed.startsWith('data:')) continue
    const json = trimmed.slice(5).trim()
    if (json === '[DONE]') break
    try {
      const obj = JSON.parse(json) as { choices?: { delta?: { content?: string }; message?: { content?: string } }[] }
      for (const c of obj.choices ?? []) {
        const text = c.delta?.content ?? c.message?.content ?? ''
        if (text) parts.push(text)
      }
    } catch { /* 跳过无法解析的行 */ }
  }
  return parts.join('')
}

/** 把通道错误翻译成用户可读异常（非流式调用点通用） */
export async function throwForProxyStatus(res: Response): Promise<void> {
  if (res.status !== 402 && res.status !== 503) return
  let code = res.status === 402 ? 'insufficient_credits' : 'proxy_unavailable'
  try {
    const data = (await res.json()) as { detail?: { code?: string } | string }
    if (data.detail && typeof data.detail === 'object' && data.detail.code) code = data.detail.code
  } catch { /* body 可能非 JSON */ }
  throw new AiProxyError(res.status, code, `AI proxy HTTP ${res.status}: ${code}`)
}
