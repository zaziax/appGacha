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

// API 地址：开发 → localhost，打包 → 线上
export const API_BASE = app.isPackaged
  ? 'https://api.appgacha.com'
  : (process.env.APPGACHA_API_BASE || 'http://localhost:8000')

interface ApiOptions {
  method?: string
  headers?: Record<string, string>
  body?: string | FormData
  /** 跳过自动 refresh（用于 refresh 请求本身） */
  skipRefresh?: boolean
  /** 超时毫秒数，默认 30s */
  timeout?: number
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
      return await net.fetch(`${API_BASE}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...headers
        },
        body,
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
    const msg = (e as Error).name === 'AbortError' ? '请求超时' : (e as Error).message
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
    const res = await net.fetch(`${API_BASE}/auth/refresh`, {
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
  const { method = 'GET', headers = {}, body, skipRefresh = false, timeout = 30_000 } = opts

  const doFetch = async (token: string | null): Promise<Response> => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)
    try {
      return await net.fetch(`${API_BASE}${path}`, {
        method,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...headers
        },
        body,
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
    }
  }
  return res
}

/**
 * 检查服务端连通性（健康检查）
 */
export async function checkHealth(): Promise<boolean> {
  try {
    const res = await net.fetch(`${API_BASE}/health`, { method: 'GET' })
    return res.ok
  } catch {
    return false
  }
}
