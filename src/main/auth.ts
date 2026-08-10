/**
 * Google OAuth 登录模块（Web 中转模式）
 *
 * 流程：
 * 1. 打开官网登录页 https://appgacha.com/login?from=desktop
 * 2. 用户在官网完成 Google OAuth → 官网已登录
 * 3. 官网调后端 /auth/device-link 生成一次性短码
 * 4. 官网 deep link: appgacha://callback?link_code=xxx
 * 5. Electron 收到 link_code → 调后端 /auth/device-exchange 换取 JWT
 * 6. safeStorage 加密存储 token
 */

import { app, net, safeStorage, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { logLine } from './log'

// ─── 配置 ───

// 官网地址：开发 → localhost，打包 → 线上
const WEB_BASE = app.isPackaged
  ? 'https://appgacha.com'
  : (process.env.APPGACHA_WEB_BASE || 'http://localhost:5173')

// API 地址：开发 → localhost，打包 → 线上
const API_BASE = app.isPackaged
  ? 'https://api.appgacha.com'
  : (process.env.APPGACHA_API_BASE || 'http://localhost:8000')

// ─── Token 存储 ───

interface AuthTokens {
  accessToken: string
  refreshToken: string
  user: {
    id: string
    email: string
    name: string
    avatar_url: string | null
  }
}

interface StoredAuth {
  accessTokenEnc?: string
  refreshTokenEnc?: string
  accessTokenPlain?: string
  refreshTokenPlain?: string
  user: AuthTokens['user']
}

function authFilePath(): string {
  return path.join(app.getPath('userData'), 'auth.json')
}

function saveTokens(tokens: AuthTokens): void {
  const dir = path.dirname(authFilePath())
  fs.mkdirSync(dir, { recursive: true })

  let stored: StoredAuth
  if (safeStorage.isEncryptionAvailable()) {
    stored = {
      accessTokenEnc: safeStorage.encryptString(tokens.accessToken).toString('base64'),
      refreshTokenEnc: safeStorage.encryptString(tokens.refreshToken).toString('base64'),
      user: tokens.user
    }
  } else {
    stored = {
      accessTokenPlain: tokens.accessToken,
      refreshTokenPlain: tokens.refreshToken,
      user: tokens.user
    }
  }

  const tmp = authFilePath() + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(stored, null, 2), 'utf-8')
  fs.renameSync(tmp, authFilePath())
  logLine('[auth] tokens saved')
  process.emit('appgacha:auth-changed' as never)
}

function loadTokens(): AuthTokens | null {
  try {
    const raw = JSON.parse(fs.readFileSync(authFilePath(), 'utf-8')) as StoredAuth
    let accessToken = ''
    let refreshToken = ''

    if (raw.accessTokenEnc && safeStorage.isEncryptionAvailable()) {
      accessToken = safeStorage.decryptString(Buffer.from(raw.accessTokenEnc, 'base64'))
      refreshToken = safeStorage.decryptString(Buffer.from(raw.refreshTokenEnc!, 'base64'))
    } else if (raw.accessTokenPlain) {
      accessToken = raw.accessTokenPlain
      refreshToken = raw.refreshTokenPlain || ''
    }

    if (!accessToken) return null
    return { accessToken, refreshToken, user: raw.user }
  } catch {
    return null
  }
}

function clearTokens(): void {
  try { fs.rmSync(authFilePath(), { force: true }) } catch { /* ignore */ }
  logLine('[auth] tokens cleared')
  process.emit('appgacha:auth-changed' as never)
}

// ─── 公开 API ───

/** 当前登录状态 */
export function getAuthStatus(): { loggedIn: boolean; user?: AuthTokens['user'] } {
  const tokens = loadTokens()
  if (!tokens) return { loggedIn: false }
  return { loggedIn: true, user: tokens.user }
}

/** 获取当前 access token（供 api.ts 使用） */
export function getAccessToken(): string | null {
  return loadTokens()?.accessToken ?? null
}

/** 获取 refresh token */
export function getRefreshToken(): string | null {
  return loadTokens()?.refreshToken ?? null
}

/** 更新 token（refresh 成功后调用） */
export function updateTokens(accessToken: string, refreshToken: string): void {
  const existing = loadTokens()
  if (!existing) return
  saveTokens({ accessToken, refreshToken, user: existing.user })
}

/**
 * 发起登录：打开官网登录页
 * 官网完成 OAuth 后会 deep link 回 appgacha://callback?link_code=xxx
 */
export async function startLogin(): Promise<{ started: boolean; error?: string }> {
  const url = `${WEB_BASE}/login?from=desktop`
  logLine('[auth] opening website login:', url)
  try {
    await shell.openExternal(url)
    return { started: true }
  } catch (e) {
    return { started: false, error: (e as Error).message }
  }
}

/** 打开官网指定页面（如定价页 /pricing），用于升级引导 */
export async function openWebPage(path: string): Promise<void> {
  const url = `${WEB_BASE}${path}`
  logLine('[auth] opening website page:', url)
  await shell.openExternal(url)
}

/**
 * 处理官网 deep link 回调（由 index.ts 的协议路由调用）
 * @param callbackUrl 完整回调 URL，如 appgacha://callback?link_code=xxx
 */
export async function handleCallback(callbackUrl: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const url = new URL(callbackUrl)
    const linkCode = url.searchParams.get('link_code')
    if (!linkCode) {
      return { ok: false, error: '回调缺少 link_code 参数' }
    }

    logLine('[auth] exchanging link_code for tokens...')

    // 用一次性短码向后端换取 JWT
    const res = await net.fetch(`${API_BASE}/auth/device-exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ link_code: linkCode })
    })

    if (!res.ok) {
      const text = (await res.text().catch(() => '')).slice(0, 300)
      logLine('[auth] device-exchange failed:', res.status, text)
      return { ok: false, error: `登录失败 (HTTP ${res.status})` }
    }

    const data = await res.json() as {
      access_token: string
      refresh_token: string
      user: AuthTokens['user']
    }

    saveTokens({
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      user: data.user
    })

    logLine('[auth] login success:', data.user.email)
    return { ok: true }
  } catch (e) {
    logLine('[auth] callback error:', (e as Error).message)
    return { ok: false, error: (e as Error).message }
  }
}

/** 登出：清除本地 token */
export async function logout(): Promise<void> {
  const tokens = loadTokens()
  if (tokens) {
    // 尽力通知服务端吊销（失败不阻塞）
    try {
      await net.fetch(`${API_BASE}/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokens.accessToken}` }
      })
    } catch { /* 离线时忽略 */ }
  }
  clearTokens()
}

// ─── 邮箱验证码登录 ───

/** 发送验证码 */
export async function sendEmailCode(email: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await net.fetch(`${API_BASE}/auth/send-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({})) as { detail?: string }
      return { ok: false, error: data.detail || `HTTP ${res.status}` }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/** 验证邮箱验证码并登录 */
export async function verifyEmailCode(email: string, code: string): Promise<{ ok: boolean; error?: string; hasPassword?: boolean }> {
  try {
    const res = await net.fetch(`${API_BASE}/auth/verify-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code })
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({})) as { detail?: string }
      return { ok: false, error: data.detail || `HTTP ${res.status}` }
    }
    const data = await res.json() as {
      access_token: string
      refresh_token: string
      user: AuthTokens['user'] & { has_password?: boolean }
    }
    saveTokens({
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      user: data.user
    })
    logLine('[auth] email login success:', data.user.email)
    return { ok: true, hasPassword: !!data.user.has_password }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/** 邮箱 + 密码登录 */
export async function loginWithPassword(email: string, password: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await net.fetch(`${API_BASE}/auth/login-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({})) as { detail?: string }
      return { ok: false, error: data.detail || `HTTP ${res.status}` }
    }
    const data = await res.json() as {
      access_token: string
      refresh_token: string
      user: AuthTokens['user']
    }
    saveTokens({
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      user: data.user
    })
    logLine('[auth] password login success:', data.user.email)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/** 设置/修改密码（已登录） */
export async function setPassword(password: string, oldPassword?: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const token = getAccessToken()
    if (!token) return { ok: false, error: '未登录' }
    const res = await net.fetch(`${API_BASE}/auth/set-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ password, old_password: oldPassword || null })
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({})) as { detail?: string }
      return { ok: false, error: data.detail || `HTTP ${res.status}` }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/** 忘记密码：邮箱验证码 + 新密码重置 */
export async function resetPassword(email: string, code: string, newPassword: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await net.fetch(`${API_BASE}/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code, new_password: newPassword })
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({})) as { detail?: string }
      return { ok: false, error: data.detail || `HTTP ${res.status}` }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}
