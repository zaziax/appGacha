/**
 * 统一 HTTP 客户端 — 所有后端通信走这里
 *
 * - 自动附加 Authorization: Bearer <jwt>
 * - 401 时自动 refresh，失败则触发重新登录
 * - 网络错误优雅降级（离线模式 = 自配 key 直连）
 */

import { app, net } from 'electron'
import { getAccessToken, getRefreshToken, updateTokens, logout } from './auth'
import { logLine } from './log'
import { makeError, ErrorCode } from '../shared/types'

// API 地址：开发 → localhost，打包 → 线上
// 注意：不在模块顶层访问 app.isPackaged —— Electron 37 在模块初始化时 app 可能未就绪
function getApiBase(): string {
  return app.isPackaged
    ? 'https://api.appgacha.com'
    : (process.env.APPGACHA_API_BASE || 'http://localhost:8000')
}

interface ApiOptions {
  method?: string
  headers?: Record<string, string>
  body?: string | FormData | Buffer | Uint8Array
  /** 跳过自动 refresh（用于 refresh 请求本身） */
  skipRefresh?: boolean
  /** 超时毫秒数，默认 30s */
  timeout?: number
  /** refresh 失败时是否触发 logout（默认 false，仅 apiFetch 会 logout） */
  logoutOnAuthFail?: boolean
}

export interface DownloadStreamProgress {
  bytesReceived: number
  totalBytes: number
  percent: number
}

export interface DownloadStreamResult {
  buffer: Buffer
  headers: Headers
}

interface ApiResult<T = unknown> {
  ok: boolean
  status: number
  data?: T
  error?: string
}

/**
 * 发起带鉴权的 API 请求
 * 401 时自动尝试 refresh token，成功后重试原请求
 */
export async function apiFetch<T = unknown>(path: string, opts: ApiOptions = {}): Promise<ApiResult<T>> {
  const { method = 'GET', headers = {}, body, skipRefresh = false, timeout = 30_000 } = opts

  const doFetch = async (token: string | null): Promise<Response> => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)
    try {
      return await net.fetch(`${getApiBase()}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...headers
        },
        body: body as BodyInit | undefined,
        signal: controller.signal
      })
    } finally {
      clearTimeout(timer)
    }
  }

  try {
    let token = getAccessToken()
    let res = await doFetch(token)

    // 401 → 尝试 refresh
    if (res.status === 401 && !skipRefresh) {
      const refreshed = await tryRefresh()
      if (refreshed) {
        token = getAccessToken()
        res = await doFetch(token)
      } else {
        // refresh 失败 → 登出
        await logout()
        return { ok: false, status: 401, error: '登录已过期，请重新登录' }
      }
    }

    if (!res.ok) {
      const text = (await res.text().catch(() => '')).slice(0, 300)
      return { ok: false, status: res.status, error: text || `HTTP ${res.status}` }
    }

    const data = await res.json() as T
    return { ok: true, status: res.status, data }
  } catch (e) {
    const msg = (e as Error).name === 'AbortError'
      ? makeError(ErrorCode.TIMEOUT, '请求超时')
      : (e as Error).message
    logLine('[api] fetch error:', path, msg)
    return { ok: false, status: 0, error: msg }
  }
}

/**
 * 尝试刷新 token
 * @returns true 刷新成功
 */
async function tryRefresh(): Promise<boolean> {
  const refreshToken = getRefreshToken()
  if (!refreshToken) return false

  try {
    const res = await net.fetch(`${getApiBase()}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken })
    })

    if (!res.ok) {
      logLine('[api] refresh failed:', res.status)
      return false
    }

    const data = await res.json() as { access_token: string; refresh_token: string }
    updateTokens(data.access_token, data.refresh_token)
    logLine('[api] token refreshed')
    return true
  } catch (e) {
    logLine('[api] refresh error:', (e as Error).message)
    return false
  }
}

/**
 * 发起带鉴权的 API 请求，返回原始 Response（供 SSE 流式消费）。
 * 与 apiFetch 同款 401 自动 refresh，但不消费响应体。
 */
export async function apiFetchRaw(path: string, opts: ApiOptions = {}): Promise<Response> {
  const { method = 'GET', headers = {}, body, skipRefresh = false, timeout = 30_000, logoutOnAuthFail = false } = opts

  const doFetch = async (token: string | null): Promise<Response> => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)
    try {
      return await net.fetch(`${getApiBase()}${path}`, {
        method,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...headers
        },
        body: body as BodyInit | undefined,
        signal: controller.signal
      })
    } finally {
      clearTimeout(timer)
    }
  }

  let token = getAccessToken()
  let res = await doFetch(token)
  if (res.status === 401 && !skipRefresh) {
    const refreshed = await tryRefresh()
    if (refreshed) {
      token = getAccessToken()
      res = await doFetch(token)
    } else if (logoutOnAuthFail) {
      await logout()
    }
  }
  return res
}

/**
 * 流式下载二进制文件，带进度回调。
 * 内部调用 apiFetchRaw 处理鉴权，然后流式读取 response.body 逐 chunk 报告进度。
 * 返回完整 Buffer——大文件注意内存。超时默认 5 分钟。
 */
export async function apiDownloadStream(
  path: string,
  onProgress?: (p: DownloadStreamProgress) => void,
  opts: ApiOptions = {}
): Promise<DownloadStreamResult> {
  const res = await apiFetchRaw(path, { ...opts, logoutOnAuthFail: true, timeout: opts.timeout ?? 300_000 })
  if (!res.ok) {
    const text = (await res.text().catch(() => '')).slice(0, 300)
    throw new Error(text || `HTTP ${res.status}`)
  }

  const contentLength = Number(res.headers.get('content-length') || '0')
  const body = res.body as ReadableStream<Uint8Array> | null

  if (!body) {
    // 降级：ReadableStream 不可用时一次性读取
    const arrayBuf = await res.arrayBuffer()
    const buf = Buffer.from(arrayBuf)
    onProgress?.({ bytesReceived: buf.length, totalBytes: buf.length, percent: 100 })
    return { buffer: buf, headers: res.headers }
  }

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let bytesReceived = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    bytesReceived += value.length
    if (onProgress && contentLength > 0) {
      onProgress({
        bytesReceived,
        totalBytes: contentLength,
        percent: Math.round((bytesReceived / contentLength) * 100)
      })
    }
  }

  return { buffer: Buffer.concat(chunks), headers: res.headers }
}

/**
 * 检查服务端连通性（健康检查）
 */
export async function checkHealth(): Promise<boolean> {
  try {
    const res = await net.fetch(`${getApiBase()}/health`, { method: 'GET' })
    return res.ok
  } catch {
    return false
  }
}
