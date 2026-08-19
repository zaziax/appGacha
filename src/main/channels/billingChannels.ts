import { shell } from 'electron'
import { openWebPage } from '../auth'
import { apiFetch } from '../api'
import { handle } from './ipc'

export function registerBillingChannels(): void {
  handle('shelf:billingSummary', async () => {
    const res = await apiFetch('/billing/summary')
    if (!res.ok) throw new Error(res.error || '获取计费信息失败')
    return res.data
  })

  /** 积分余额 + 近期流水（用户面板“明细”展开用） */
  handle('shelf:billingCredits', async () => {
    const res = await apiFetch('/billing/credits?limit=5')
    if (!res.ok) throw new Error(res.error || '获取积分流水失败')
    return res.data
  })

  /** 打开官网定价页（升级 Pro 引导） */
  handle('shelf:openPricing', async () => {
    const res = await apiFetch<{ link_code?: string }>('/auth/device-link', { method: 'POST' })
    const code = (res.ok && res.data?.link_code) ? res.data.link_code : ''
    await openWebPage(code ? `/pricing?link_code=${encodeURIComponent(code)}` : '/pricing')
    return { ok: true }
  })

  handle('shelf:openAccount', async () => {
    // 生成一次性短码 → 浏览器端 /account 用 link_code 换取登录态
    const res = await apiFetch<{ link_code?: string }>('/auth/device-link', { method: 'POST' })
    const code = (res.ok && res.data?.link_code) ? res.data.link_code : ''
    await openWebPage(code ? `/account?link_code=${encodeURIComponent(code)}` : '/account')
    return { ok: true }
  })

  /** 创建支付收银台会话并用系统浏览器打开（type: subscription | credits） */
  handle('shelf:checkout', async (type, packId) => {
    const body: Record<string, string> = { type: String(type) }
    if (packId) body.pack_id = String(packId)
    const res = await apiFetch<{ checkout_url?: string }>('/billing/checkout', {
      method: 'POST',
      body: JSON.stringify(body),
    })
    if (!res.ok || !res.data?.checkout_url) throw new Error(res.error || '创建支付会话失败')
    await shell.openExternal(res.data.checkout_url)
    return { ok: true }
  })
}
