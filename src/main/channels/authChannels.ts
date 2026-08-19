import { startLogin, logout, getAuthStatus, sendEmailCode, verifyEmailCode, loginWithPassword, setPassword, resetPassword } from '../auth'
import { checkHealth, apiFetch } from '../api'
import { handle } from './ipc'

export function registerAuthChannels(): void {
  handle('shelf:authStatus', () => getAuthStatus())

  handle('shelf:authLogin', async () => {
    const result = await startLogin()
    if (!result.started) throw new Error(result.error || '启动登录失败')
    return { started: true }
  })

  handle('shelf:authLogout', async () => {
    await logout()
    return { ok: true }
  })

  handle('shelf:sendCode', async (email) => {
    const res = await sendEmailCode(String(email))
    if (!res.ok) throw new Error(res.error || '发送失败')
    return { ok: true }
  })

  handle('shelf:verifyCode', async (email, code) => {
    const res = await verifyEmailCode(String(email), String(code))
    if (!res.ok) throw new Error(res.error || '验证失败')
    return { ok: true, hasPassword: res.hasPassword }
  })

  handle('shelf:loginPassword', async (email, password) => {
    const res = await loginWithPassword(String(email), String(password))
    if (!res.ok) throw new Error(res.error || '登录失败')
    return { ok: true }
  })

  handle('shelf:setPassword', async (password, oldPassword) => {
    const res = await setPassword(String(password), oldPassword ? String(oldPassword) : undefined)
    if (!res.ok) throw new Error(res.error || '设置失败')
    return { ok: true }
  })

  handle('shelf:resetPassword', async (email, code, newPassword) => {
    const res = await resetPassword(String(email), String(code), String(newPassword))
    if (!res.ok) throw new Error(res.error || '重置失败')
    return { ok: true }
  })

  handle('shelf:serverHealth', async () => {
    return { online: await checkHealth() }
  })

  handle('shelf:authProfile', async () => {
    const res = await apiFetch('/auth/me')
    if (!res.ok) throw new Error(res.error || '获取用户信息失败')
    return res.data
  })
}
