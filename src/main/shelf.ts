import { app, dialog, ipcMain, net, shell, IpcMainInvokeEvent, BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { allEggs, getEgg, loadManifest, registerEgg, removeEgg } from './eggs'
import { openEgg, closeEggWindow } from './eggWindow'
import { openEggSmart, getSpace, spaceAdd, spaceRemove, spaceReorder, spaceActivate, spaceSetBounds, spaceSetVisible, spacePurgeEgg, onSpaceFocusEvent } from './space'
import { isShelfSender, sendToShelf, executeCloseAction } from './shelfWindow'
import { cancelAllForEgg, initSchedules } from './schedule'
import { getAiSettings, getAiSettingsMasked, setAiSettings, hasProviderKey, getProviderKey, clearProviderKey, getAppSettings, setAppSettings, setLang, getEggAutoStart, setEggAutoStart, getCategories, saveCategory, deleteCategory, getEggCategoryMap, setEggCategory, setSyncDisabledForEgg, isSyncDisabledForEgg } from './settings'
import { dataRoot } from './paths'
import { copyDir } from './fsutil'
import { packGacha, unpackGacha } from './gachaPkg'
import { createEggShortcut } from './assoc'
import { writeEggIco } from './ico'
import { apiFetchRaw } from './api'
import { logLine } from './log'
import { runGacha, runUpgrade, isGachaBusy, hasBackup, restoreLatestBackup } from './pipeline'
import { buildWishGuideSystem, buildWishSuggestPrompt, type WishGuideContext } from './wishGuide'
import type { IpcText } from './fcDriver'
import { startLogin, logout, getAuthStatus, sendEmailCode, verifyEmailCode, loginWithPassword, setPassword, resetPassword, openWebPage } from './auth'
import { checkHealth, apiFetch } from './api'
import { resolveAiEndpoint, chatCompletionFetch, throwForProxyStatus, AiNotConfiguredError, AiProxyError } from './aiChannel'
import { randomUUID } from 'node:crypto'
import { listCloudEggs, syncEgg, downloadEgg, deleteCloudEgg, setSyncEnabled } from './sync'
import { initAutoUpdater, stopAutoUpdater, checkForUpdatesNow, installUpdateNow, getCurrentUpdateStatus } from './updater'

// ---- 许愿引导 AI ----

interface WishQuestion { text: string; options: string[] }
interface WishChatResult { done: boolean; questions: WishQuestion[]; styleNote?: string }

/** 把平台通道错误翻成用户可读文案（许愿链路） */
function proxyErrText(e: unknown): string | null {
  if (e instanceof AiProxyError && e.insufficientCredits) return '积分不足，请先充值'
  if (e instanceof AiProxyError) return '平台 AI 通道暂不可用'
  return null
}

async function wishChatAi(messages: { role: string; content: string }[], systemPrompt: string): Promise<WishChatResult> {
  const endpoint = await resolveAiEndpoint()
  if (!endpoint) throw new AiNotConfiguredError()

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30_000)
  try {
    const res = await chatCompletionFetch(endpoint, {
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      response_format: { type: 'json_object' },
      temperature: 0.3,
      max_tokens: 800
    }, { signal: controller.signal, timeout: 35_000 })
    if (!res.ok) {
      await throwForProxyStatus(res)
      const text = (await res.text().catch(() => '')).slice(0, 200)
      throw new Error(`AI HTTP ${res.status}: ${text}`)
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    const content = data.choices?.[0]?.message?.content ?? ''
    const stripped = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '')
    const parsed = JSON.parse(stripped) as WishChatResult
    // 基本校验
    if (typeof parsed.done !== 'boolean') parsed.done = true
    if (!Array.isArray(parsed.questions)) parsed.questions = []
    parsed.questions = parsed.questions.slice(0, 3).map(q => ({
      text: String(q.text ?? ''),
      options: Array.isArray(q.options) ? q.options.slice(0, 4).map(String) : []
    }))
    if (typeof parsed.styleNote !== 'string' || parsed.styleNote.trim().length === 0) delete parsed.styleNote
    return parsed
  } catch (e) {
    const friendly = proxyErrText(e)
    if (friendly) throw new Error(friendly)
    if (e instanceof AiNotConfiguredError) throw new Error('尚未配置模型，请先在设置里填写 API 或登录账号')
    if ((e as Error).name === 'AbortError') throw new Error('AI 响应超时，请重试')
    throw e
  } finally {
    clearTimeout(timer)
  }
}

export function eggsRoot(): string {
  return dataRoot('eggs')
}

type ShelfHandler = (...args: unknown[]) => unknown

// 收藏柜通道只认收藏柜窗口，蛋窗口调不动
function handle(channel: string, fn: ShelfHandler): void {
  ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    try {
      if (!isShelfSender(event.sender.id)) throw new Error('caller is not the shelf window')
      return { ok: true, value: await fn(...args) }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })
}

function listEggs() {
  return allEggs().filter(e => !e.ephemeral).map(e => {
    let createdAt = 0
    try {
      const st = fs.statSync(e.dir)
      createdAt = st.birthtimeMs || st.mtimeMs  // Windows 有 birthtime，拿不到降级 mtime
    } catch { /* 目录异常时不阻断列表 */ }
    // 图标：读取蛋目录下的 icon.svg（限 16KB，防异常文件撑爆列表）
    let icon = ''
    try {
      const p = path.join(e.dir, 'icon.svg')
      if (fs.existsSync(p) && fs.statSync(p).size <= 16 * 1024) icon = fs.readFileSync(p, 'utf-8')
    } catch { /* 图标缺失不影响列表 */ }
    return {
      eggId: e.eggId,
      name: e.manifest.name,
      version: e.manifest.version,
      wish: e.manifest.wish ?? '',
      permissions: e.manifest.permissions,
      folder: path.basename(e.dir),
      hasBackup: hasBackup(e.eggId),
      createdAt,
      icon,
      // 窗口形态：widget 禁止进扭蛋空间，UI 据此隐藏相关入口
      windowType: e.manifest.window?.type === 'widget' ? 'widget' : 'standard'
    }
  })
}

function uniqueFolder(root: string, baseName: string): string {
  let dir = path.join(root, `${baseName}.gacha`)
  let i = 2
  while (fs.existsSync(dir)) dir = path.join(root, `${baseName}-${i++}.gacha`)
  return dir
}

/**
 * 导入 .gacha 包文件：解包到临时目录 → 校验 → 冲突检测 → 移入收藏柜 → 注册。
 * 收藏柜导入按钮与双击 .gacha 文件共用此入口。
 */
export async function importGachaFile(gachaFile: string): Promise<{ name: string; eggId: string }> {
  const tmp = dataRoot('staging', `__import-${Date.now()}`)
  fs.mkdirSync(tmp, { recursive: true })
  try {
    await unpackGacha(gachaFile, tmp)
    const manifest = loadManifest(tmp) // 校验不通过会抛错给调用方
    if (getEgg(manifest.eggId)) throw new Error(`「${manifest.name}」已在收藏柜里（eggId 相同）`)
    const dest = uniqueFolder(eggsRoot(), manifest.name)
    try {
      fs.renameSync(tmp, dest)
    } catch {
      copyDir(tmp, dest) // Windows 文件锁致 rename 失败时降级复制
    }
    const ctx = registerEgg(dest)
    initSchedules([ctx]) // 蛋若随身带着提醒，落地即生效
    return { name: manifest.name, eggId: manifest.eggId }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

/**
 * 导入 .gacha 为新副本：解包后替换 eggId（避免与原蛋冲突），移入收藏柜。
 * 用于"仅应用"导出文件的冲突解决——用户选择"导入为新副本"时走此路径。
 */
export async function importGachaAsNew(gachaFile: string): Promise<{ name: string; eggId: string }> {
  const tmp = dataRoot('staging', `__import-${Date.now()}`)
  fs.mkdirSync(tmp, { recursive: true })
  try {
    await unpackGacha(gachaFile, tmp)
    const manifest = loadManifest(tmp)
    // 重写 eggId 为新 UUID，避免与原蛋冲突
    const newId = randomUUID().toLowerCase()
    const manifestPath = path.join(tmp, 'manifest.json')
    const m = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
    m.eggId = newId
    fs.writeFileSync(manifestPath, JSON.stringify(m, null, 2), 'utf-8')
    const dest = uniqueFolder(eggsRoot(), manifest.name)
    try {
      fs.renameSync(tmp, dest)
    } catch {
      copyDir(tmp, dest)
    }
    const ctx = registerEgg(dest)
    initSchedules([ctx])
    return { name: manifest.name, eggId: newId }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

// 扭蛋/升级共用：进度落日志再转发收藏柜（闪退时 app.log 里能看到最后一步）
function reportProgress(p: { stage: string; detail?: IpcText }): void {
  logLine('[gacha]', p.stage, typeof p.detail === 'string' ? p.detail : (p.detail?.key ?? ''))
  sendToShelf('gacha:progress', p)
}

// 拉最新积分余额（结算通知用；未登录/失败静默返回 null）
async function getCreditBalance(): Promise<number | null> {
  try {
    const res = await apiFetch('/billing/credits')
    if (!res.ok) return null
    const b = (res.data as { balance?: number })?.balance
    return typeof b === 'number' ? b : null
  } catch {
    return null
  }
}

// 扭蛋/升级共用的收尾：done 事件带 upgraded 标记（系统通知由渲染端发，那边才知道 UI 语言）
// 同时对比前后余额：走平台通道时构建完成后推 billing:settled，让渲染端提示“本次消耗”
function launchGacha(run: Promise<{ ok: boolean; name?: string; error?: IpcText }>, upgraded: boolean): void {
  void (async () => {
    const before = await getCreditBalance()
    let result: { ok: boolean; name?: string; error?: IpcText }
    try {
      result = await run
    } catch (e) {
      // 兜底：管线意外 reject 时也必须通知前端，否则 running 永远为 true
      result = { ok: false, error: (e as Error).message || { key: 'err.unexpected' } }
      logLine('[gacha] unexpected error', result.error)
    }
    logLine('[gacha] done', result)
    sendToShelf('gacha:done', { ...result, upgraded })
    // 构建成功且有扣费时通知渲染端（自带 Key 时余额不变，不会发）
    if (result.ok && before !== null) {
      const after = await getCreditBalance()
      if (after !== null) {
        const spent = Math.round((before - after) * 10) / 10
        if (spent > 0) sendToShelf('billing:settled', { spent, balance: after })
      }
    }
  })()
}

export function registerShelfChannels(): void {
  // 空间聚焦事件 → 推送收藏柜 UI 切到空间视图（space.ts 不直依 shelfWindow）
  onSpaceFocusEvent(eggId => sendToShelf('space:focusEgg', { eggId }))

  handle('shelf:list', () => listEggs())

  handle('shelf:open', (eggId) => {
    const egg = getEgg(eggId as string)
    if (!egg) throw new Error('egg not found')
    // 蛋已配置进扭蛋空间 → 聚焦空间 tab，不再弹独立窗口
    openEggSmart(egg)
  })

  handle('shelf:import', async () => {
    const res = await dialog.showOpenDialog({
      title: '选择 .gacha 文件',
      filters: [{ name: '扭蛋应用', extensions: ['gacha'] }],
      properties: ['openFile']
    })
    if (res.canceled || res.filePaths.length === 0) return { imported: false }
    const { name } = await importGachaFile(res.filePaths[0])
    return { imported: true, name }
  })

  // .gacha 导入冲突：UI 弹窗询问后回传选择（eggId 是冲突原蛋的 ID，open 时复用）
  handle('shelf:resolveImportConflict', async (file, eggId, action) => {
    const filePath = file as string
    const act = action as 'open' | 'import'
    if (act === 'open') {
      const egg = getEgg(eggId as string)
      if (egg) openEggSmart(egg)
      return
    }
    // import as new copy
    const { eggId: newId } = await importGachaAsNew(filePath)
    sendToShelf('shelf:eggsChanged', { eggId: newId })
    const egg = getEgg(newId)
    if (egg) openEggSmart(egg)
  })

  handle('shelf:export', async (eggId, includeData) => {
    const egg = getEgg(eggId as string)
    if (!egg) throw new Error('egg not found')
    // 是否带数据由 UI 端的自定义弹窗决定（includeData 传入），这里只负责选位 + 打包
    const res = await dialog.showSaveDialog({
      title: '导出扭蛋',
      defaultPath: path.join(app.getPath('desktop'), `${egg.manifest.name}.gacha`),
      filters: [{ name: '扭蛋应用', extensions: ['gacha'] }]
    })
    if (res.canceled || !res.filePath) return { exported: false }
    await packGacha(egg.dir, res.filePath, { includeData: includeData === true })
    shell.showItemInFolder(res.filePath)
    return { exported: true, dest: res.filePath }
  })

  handle('shelf:shortcut', (eggId, iconPngs) => {
    const egg = getEgg(eggId as string)
    if (!egg) throw new Error('egg not found')
    // 渲染进程离屏渲染产出的多尺寸 PNG → 写入蛋目录 icon.ico（每次重建，保证最新）
    const pngs = iconPngs as Record<number, string> | undefined
    if (pngs && Object.keys(pngs).length > 0) {
      try { writeEggIco(egg.dir, pngs) } catch (e) { console.error('[shelf] 写入 icon.ico 失败:', (e as Error).message) }
    }
    const lnk = createEggShortcut(egg.manifest.name, egg.eggId, egg.dir)
    return { created: true, path: lnk }
  })

  handle('shelf:trash', async (eggId) => {
    const egg = getEgg(eggId as string)
    if (!egg) throw new Error('egg not found')
    closeEggWindow(egg.eggId)
    spacePurgeEgg(egg.eggId) // 同步从扭蛋空间移除
    cancelAllForEgg(egg.eggId) // 拆掉它的所有定时提醒
    await shell.trashItem(egg.dir) // 进回收站，可反悔
    removeEgg(egg.eggId)
    setEggCategory(egg.eggId, null) // 清掉分类归属，避免脏映射
    // 云端同步删除（best-effort：网络不通 / 未登录 / 免费用户均静默跳过，不阻塞本地操作）
    deleteCloudEgg(egg.eggId).catch(() => {})
  })

  handle('shelf:wish', async (wish, lang) => {
    if (isGachaBusy()) throw new Error('机芯正忙，请等上一颗蛋出来')
    const l = lang === 'en' ? 'en' : 'zh'
    // 不 await：扭蛋过程通过 gacha:progress 事件流式上报，完成事件里带结果
    launchGacha(runGacha(String(wish ?? ''), l, reportProgress), false)
    return { started: true }
  })

  handle('shelf:upgrade', async (eggId, wish, lang) => {
    if (isGachaBusy()) throw new Error('机芯正忙，请等上一颗蛋出来')
    const l = lang === 'en' ? 'en' : 'zh'
    launchGacha(runUpgrade(String(eggId), String(wish ?? ''), l, reportProgress), true)
    return { started: true }
  })

  handle('shelf:rollback', async (eggId) => {
    const egg = getEgg(eggId as string)
    if (!egg) throw new Error('egg not found')
    closeEggWindow(egg.eggId)
    cancelAllForEgg(egg.eggId)
    const name = restoreLatestBackup(egg.eggId, egg.dir)
    egg.manifest = loadManifest(egg.dir)
    initSchedules([egg]) // 还原回来的提醒重新装弹
    return { name }
  })

  handle('shelf:wishChat', async (messages, context) => {
    const msgs = messages as { role: string; content: string }[]
    if (!Array.isArray(msgs) || msgs.length === 0) throw new Error('messages 不能为空')
    // 场景上下文装配：升级 → 注入目标蛋档案；新愿望 → 注入已有蛋名单
    const ctx = context as { upgradeEggId?: string } | undefined
    const guideCtx: WishGuideContext = {}
    if (ctx?.upgradeEggId) {
      const egg = getEgg(ctx.upgradeEggId)
      if (egg) {
        guideCtx.upgrade = {
          name: egg.manifest.name,
          wish: egg.manifest.wish ?? '',
          permissions: Array.isArray(egg.manifest.permissions) ? egg.manifest.permissions : []
        }
      }
    } else {
      guideCtx.existingEggNames = allEggs().filter(e => !e.ephemeral).map(e => e.manifest.name).slice(0, 20)
    }
    return wishChatAi(msgs, buildWishGuideSystem(guideCtx))
  })

  handle('shelf:wishSuggest', async (lang) => {
    const endpoint = await resolveAiEndpoint()
    if (!endpoint) throw new Error('AI not configured')
    const existing = allEggs().filter(e => !e.ephemeral).map(e => e.manifest.name).slice(0, 20)
    const prompt = buildWishSuggestPrompt(lang === 'zh' ? 'zh' : 'en', existing)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15_000)
    try {
      const res = await chatCompletionFetch(endpoint, {
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: lang === 'zh' ? '给我来 3 个灵感！' : 'Give me 3 ideas!' }
        ],
        response_format: { type: 'json_object' },
        temperature: 1.0,
        max_tokens: 200
      }, { signal: controller.signal, timeout: 20_000 })
      if (!res.ok) throw new Error(`AI HTTP ${res.status}`)
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
      const content = data.choices?.[0]?.message?.content ?? ''
      const parsed = JSON.parse(content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '')) as { suggestions?: string[] }
      return { suggestions: (parsed.suggestions ?? []).slice(0, 3).map(String) }
    } catch (e) {
      logLine(`[wishSuggest] AI 灵感生成失败，UI 将降级到本地池: ${(e as Error).message}`)
      throw e
    } finally {
      clearTimeout(timer)
    }
  })

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
      if (!data.enabled) throw new Error('平台 AI 通道未启用，请联系管理员')
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
    const { rebuildTrayMenu } = require('./tray')
    rebuildTrayMenu()
  })

  handle('shelf:setAppSettings', (s) => {
    const patch = s as { autoStartApp?: boolean; minimizeToTray?: boolean; soundEnabled?: boolean; autoUpdate?: boolean }
    // 设置面板手动改动关闭行为 = 用户已明确选择，关闭时不再询问
    setAppSettings({
      ...patch,
      ...(patch.minimizeToTray !== undefined ? { closeActionKnown: true } : {})
    })
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
    if (!v?.name?.trim()) throw new Error('分类名不能为空')
    return saveCategory({ id: v.id, name: v.name })
  })

  handle('shelf:deleteCategory', (id) => {
    deleteCategory(String(id))
  })

  handle('shelf:setEggCategory', (eggId, categoryId) => {
    setEggCategory(String(eggId), categoryId == null ? null : String(categoryId))
  })

  // ─── 扭蛋空间（GachaSpace）───

  handle('space:get', () => getSpace())

  handle('space:add', (eggId) => spaceAdd(eggId as string))

  handle('space:remove', (eggId) => spaceRemove(eggId as string))

  handle('space:reorder', (ids) => spaceReorder(ids))

  handle('space:activate', (eggId) => spaceActivate(eggId as string))

  // 右侧内容区 bounds（UI ResizeObserver 上报，窗口内容坐标）
  handle('space:setBounds', (b) => spaceSetBounds(b))

  // UI 切入/切出空间 tab
  handle('space:setVisible', (v) => spaceSetVisible(v === true))

  // ─── Google OAuth 登录 ───

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

  // ─── 邮箱验证码登录 ───

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

  // ─── 云同步 ───

  handle('shelf:syncEgg', async (eggId) => {
    return await syncEgg(String(eggId))
  })

  handle('shelf:syncList', async () => {
    return await listCloudEggs()
  })

  handle('shelf:syncDownload', async (eggId) => {
    const id = String(eggId)
    return await downloadEgg(id, (percent, stage) => {
      sendToShelf('sync:downloadProgress', { eggId: id, percent, stage })
    })
  })

  handle('shelf:setSyncEnabled', async (v) => {
    setSyncEnabled(Boolean(v))
  })

  // ─── 自动更新 ───

  handle('shelf:checkUpdate', async () => {
    await checkForUpdatesNow()
  })

  handle('shelf:getUpdateStatus', async () => {
    return getCurrentUpdateStatus()
  })

  handle('shelf:installUpdate', async () => {
    installUpdateNow()
  })
}

export function registerWindowControls(): void {
  const win = (e: IpcMainInvokeEvent | Electron.IpcMainEvent) => BrowserWindow.fromWebContents(e.sender)!

  ipcMain.handle('win:isMaximized', e => win(e).isMaximized())
  // 置顶状态查询/切换——宿主 hover 浮钮专用，不走 egg 权限门控
  ipcMain.handle('win:isAlwaysOnTop', e => win(e).isAlwaysOnTop())
  ipcMain.on('win:setAlwaysOnTop', (e, flag) => win(e).setAlwaysOnTop(flag === true))

  ipcMain.on('win:minimize', e => win(e).minimize())
  ipcMain.on('win:maximize', e => {
    const w = win(e)
    w.isMaximized() ? w.unmaximize() : w.maximize()
  })
  ipcMain.on('win:close', e => win(e).close())
}

export function bindWindowStateEvents(webContentsId: number): void {
  const w = BrowserWindow.fromId(webContentsId)
  if (!w) return
  const emit = (maximized: boolean) => w.webContents.send('win:stateChanged', { maximized })
  w.on('maximize', () => emit(true))
  w.on('unmaximize', () => emit(false))
  emit(w.isMaximized())
}
