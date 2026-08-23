import { net } from 'electron'
import { getAiSettings, getAiSettingsMasked, setAiSettings, hasProviderKey, getProviderKey, clearProviderKey, getAppSettings, setAppSettings, setLang, getEggAutoStart, setEggAutoStart, getCategories, saveCategory, deleteCategory, getEggCategoryMap, setEggCategory, setSyncDisabledForEgg, isSyncDisabledForEgg, type CloseBehavior } from '../settings'
import { executeCloseAction } from '../shelfWindow'
import { getEgg } from '../eggs'
import { apiFetchRaw } from '../api'
import { makeError, ErrorCode } from '../../shared/types'
import { handle } from './ipc'

export function registerSettingsChannels(): void {
  handle('shelf:getAiSettings', () => getAiSettingsMasked())

  handle('shelf:saveAiSettings', (s) => {
    const v = s as { baseURL?: string; model?: string; apiKey?: string; providerId?: string; contextTokens?: number; noKey?: boolean }
    const pid = v.providerId || 'custom'
    // AppGacha 平台通道：无需 baseURL/model/Key，选中即保存
    if (pid === 'appgacha') {
      setAiSettings({ baseURL: '', model: '', apiKey: '', providerId: 'appgacha' })
      return
    }
    if (!v?.baseURL?.trim() || !v?.model?.trim()) throw new Error('baseURL 和 model 不能为空')
    const current = getAiSettings()
    // key 留空 → 沿用该平台自己已存的 key（绝不借用其他平台的）；noKey 平台（Ollama）允许空 key
    const apiKey = v.apiKey?.trim() || getProviderKey(pid) || (current?.providerId === pid ? current.apiKey : '') || ''
    if (!apiKey && !v.noKey) throw new Error('API Key 不能为空')
    setAiSettings({ baseURL: v.baseURL, model: v.model, apiKey, providerId: pid, contextTokens: v.contextTokens })
  })

  /** 验证 Key + 拉取平台真实模型列表（GET /models，免费无推理） */
  handle('shelf:fetchModels', async (params) => {
    const v = (params ?? {}) as { baseURL?: string; apiKey?: string; providerId?: string }
    // AppGacha 平台通道：探测 /proxy/client-config（需登录 + 管理端启用通道）
    if (v.providerId === 'appgacha') {
      let res: Response
      try {
        res = await apiFetchRaw('/proxy/client-config')
      } catch {
        throw new Error('无法连接 AppGacha 平台服务')
      }
      if (res.status === 401) throw new Error('未登录 AppGacha 账号，请先登录')
      if (!res.ok) throw new Error(`平台服务不可用（HTTP ${res.status}）`)
      const data = await res.json() as { enabled?: boolean; default_model?: string }
      if (!data.enabled) throw new Error(makeError(ErrorCode.PROXY_UNAVAILABLE, '平台 AI 通道未启用，请联系管理员'))
      if (!data.default_model) throw new Error('平台未配置默认模型')
      return { models: [data.default_model] }
    }
    const saved = getAiSettings()
    const baseURL = v.baseURL?.trim() || saved?.baseURL || ''
    // Key 优先级：表单输入 > 该平台已存 Key > 当前活跃配置 Key
    const apiKey = v.apiKey?.trim() || (v.providerId ? getProviderKey(v.providerId) : '') || saved?.apiKey || ''
    if (!baseURL) throw new Error('请先填写接口地址')
    const headers: Record<string, string> = apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15_000)
    try {
      const res = await net.fetch(`${baseURL}/models`, { headers, signal: controller.signal })
      if (res.status === 401 || res.status === 403) {
        throw new Error(`HTTP ${res.status}: API Key 无效或无权限`)
      }
      if (!res.ok) {
        const text = (await res.text().catch(() => '')).slice(0, 200)
        throw new Error(`HTTP ${res.status}: ${text}`)
      }
      const data = await res.json() as { data?: { id: string }[] }
      const models = (data.data ?? []).map(m => m.id).filter(Boolean).sort()
      return { models }
    } finally {
      clearTimeout(timer)
    }
  })

  /** 查询某平台是否已保存过 Key */
  handle('shelf:hasProviderKey', (providerId) => ({ hasKey: hasProviderKey(String(providerId)) }))

  /** 清除某平台的已存 Key */
  handle('shelf:clearProviderKey', (providerId) => { clearProviderKey(String(providerId)); return { ok: true } })

  // ─── P3 生命周期设置 ───

  handle('shelf:getAppSettings', () => getAppSettings())

  handle('shelf:setLang', (lang) => {
    setLang(lang as 'en' | 'zh')
    // 动态导入避免循环依赖（tray.ts → i18n.ts → settings.ts ← shelf.ts）
    const { rebuildTrayMenu } = require('../tray')
    rebuildTrayMenu()
  })

  handle('shelf:setAppSettings', (s) => {
    const patch = s as { autoStartApp?: boolean; closeBehavior?: CloseBehavior; soundEnabled?: boolean; autoUpdate?: boolean }
    setAppSettings(patch)
  })

  // 收藏柜 UI 关闭询问弹窗的回传：tray=最小化到托盘 / quit=直接退出
  handle('shelf:resolveCloseAction', (action, remember) => {
    executeCloseAction(action as 'tray' | 'quit', remember === true)
  })

  handle('shelf:getEggAutoStart', (eggId) => {
    const egg = getEgg(eggId as string)
    if (!egg) throw new Error('egg not found')
    return getEggAutoStart(egg.eggId, egg.manifest.window?.autoStart ?? false)
  })

  handle('shelf:setEggAutoStart', (eggId, enabled) => {
    setEggAutoStart(eggId as string, enabled === true)
  })

  handle('shelf:getSyncDisabled', (eggId) => {
    return isSyncDisabledForEgg(eggId as string)
  })

  handle('shelf:setSyncDisabled', (eggId, disabled) => {
    setSyncDisabledForEgg(eggId as string, Boolean(disabled))
  })

  // ─── 分类管理 ───

  handle('shelf:getCategories', () => ({
    categories: getCategories(),
    assignments: getEggCategoryMap()
  }))

  handle('shelf:saveCategory', (c) => {
    const v = c as { id?: string; name?: string }
    if (!v?.name?.trim()) throw new Error(makeError(ErrorCode.CATEGORY_NAME_EMPTY, '分类名不能为空'))
    return saveCategory({ id: v.id, name: v.name })
  })

  handle('shelf:deleteCategory', (id) => {
    deleteCategory(String(id))
  })

  handle('shelf:setEggCategory', (eggId, categoryId) => {
    setEggCategory(String(eggId), categoryId == null ? null : String(categoryId))
  })
}
