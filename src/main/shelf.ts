import { dialog, ipcMain, net, shell, IpcMainInvokeEvent, Notification, BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { allEggs, getEgg, loadManifest, registerEgg, removeEgg } from './eggs'
import { openEgg, closeEggWindow } from './eggWindow'
import { isShelfSender, sendToShelf } from './shelfWindow'
import { cancelAllForEgg, initSchedules } from './schedule'
import { getAiSettings, getAiSettingsMasked, setAiSettings } from './settings'
import { dataRoot } from './paths'
import { copyDir } from './fsutil'
import { logLine } from './log'
import { runGacha, runUpgrade, isGachaBusy, hasBackup, restoreLatestBackup } from './pipeline'

// ---- 许愿引导 AI ----

const WISH_GUIDE_SYSTEM = `你是「应用扭蛋机」的许愿引导助手。用户想让你帮他做一个小应用（称为"蛋"）。
你的任务：根据用户的愿望描述，提出 2~3 个关键问题来明确需求细节。

规则：
- 每个问题必须提供 2~4 个预设选项（简短词组），选项要覆盖常见选择
- 问题应聚焦于：核心功能范围、交互方式、数据需求等实质性细节
- 不要问视觉风格/配色相关问题（后续有专门步骤处理）
- 问题数量：第一轮 2~3 个；如果用户回答后仍有重大模糊点，第二轮最多再问 1~2 个
- 如果用户的描述已经足够清晰（功能明确、无重大歧义），直接返回 done:true

严格输出 JSON，格式：
{"done":false,"questions":[{"text":"问题文本","options":["选项1","选项2","选项3"]}]}
或
{"done":true,"questions":[]}

不要输出任何 JSON 以外的文字。`

interface WishQuestion { text: string; options: string[] }
interface WishChatResult { done: boolean; questions: WishQuestion[] }

async function wishChatAi(messages: { role: string; content: string }[]): Promise<WishChatResult> {
  const cfg = getAiSettings()
  if (!cfg || !cfg.apiKey) throw new Error('尚未配置模型，请先在设置里填写 API')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30_000)
  try {
    const res = await net.fetch(`${cfg.baseURL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
        messages: [{ role: 'system', content: WISH_GUIDE_SYSTEM }, ...messages],
        response_format: { type: 'json_object' },
        temperature: 0.3,
        max_tokens: 800
      }),
      signal: controller.signal
    })
    if (!res.ok) {
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
    return parsed
  } catch (e) {
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
  return allEggs().filter(e => !e.ephemeral).map(e => ({
    eggId: e.eggId,
    name: e.manifest.name,
    version: e.manifest.version,
    wish: e.manifest.wish ?? '',
    permissions: e.manifest.permissions,
    folder: path.basename(e.dir),
    hasBackup: hasBackup(e.eggId)
  }))
}

function uniqueFolder(root: string, baseName: string): string {
  let dir = path.join(root, `${baseName}.egg`)
  let i = 2
  while (fs.existsSync(dir)) dir = path.join(root, `${baseName}-${i++}.egg`)
  return dir
}

// 扭蛋/升级共用：进度落日志再转发收藏柜（闪退时 app.log 里能看到最后一步）
function reportProgress(p: { stage: string; detail?: string }): void {
  logLine('[gacha]', p.stage, p.detail ?? '')
  sendToShelf('gacha:progress', p)
}

// 扭蛋/升级共用的收尾：done 事件带 upgraded 标记，后台挂起时发系统通知
function launchGacha(run: Promise<{ ok: boolean; name?: string; error?: string }>, upgraded: boolean): void {
  void run.then(result => {
    logLine('[gacha] done', result)
    sendToShelf('gacha:done', { ...result, upgraded })
    if (Notification.isSupported()) {
      new Notification(result.ok
        ? upgraded
          ? { title: '咔哒！升级完成 ◓', body: `「${result.name}」焕然一新，数据完好` }
          : { title: '咔哒！出蛋了 ◓', body: `「${result.name}」已放进你的收藏柜` }
        : { title: upgraded ? '这次升级没成…' : '这次没扭出好蛋…', body: (result.error ?? '').slice(0, 120) }
      ).show()
    }
  }).catch(e => {
    // 兜底：管线意外 reject 时也必须通知前端，否则 running 永远为 true
    const error = (e as Error).message ?? '机芯意外故障'
    logLine('[gacha] unexpected error', error)
    sendToShelf('gacha:done', { ok: false, error, upgraded })
  })
}

export function registerShelfChannels(): void {
  handle('shelf:list', () => listEggs())

  handle('shelf:open', (eggId) => {
    const egg = getEgg(eggId as string)
    if (!egg) throw new Error('egg not found')
    openEgg(egg)
  })

  handle('shelf:import', async () => {
    const res = await dialog.showOpenDialog({
      title: '选择一个 .egg 文件夹',
      properties: ['openDirectory']
    })
    if (res.canceled || res.filePaths.length === 0) return { imported: false }
    const src = res.filePaths[0]
    const manifest = loadManifest(src) // 校验不通过会抛错给前端
    if (getEgg(manifest.eggId)) throw new Error(`「${manifest.name}」已在收藏柜里（eggId 相同）`)
    const dest = uniqueFolder(eggsRoot(), manifest.name)
    copyDir(src, dest)
    const ctx = registerEgg(dest)
    initSchedules([ctx]) // 蛋若随身带着提醒，落地即生效
    return { imported: true, name: manifest.name }
  })

  handle('shelf:export', async (eggId) => {
    const egg = getEgg(eggId as string)
    if (!egg) throw new Error('egg not found')
    const res = await dialog.showOpenDialog({
      title: '选择导出位置',
      properties: ['openDirectory', 'createDirectory']
    })
    if (res.canceled || res.filePaths.length === 0) return { exported: false }
    const dest = uniqueFolder(res.filePaths[0], egg.manifest.name)
    copyDir(egg.dir, dest)
    shell.showItemInFolder(dest)
    return { exported: true, dest }
  })

  handle('shelf:trash', async (eggId) => {
    const egg = getEgg(eggId as string)
    if (!egg) throw new Error('egg not found')
    closeEggWindow(egg.eggId)
    cancelAllForEgg(egg.eggId) // 拆掉它的所有定时提醒
    await shell.trashItem(egg.dir) // 进回收站，可反悔
    removeEgg(egg.eggId)
  })

  handle('shelf:wish', async (wish) => {
    if (isGachaBusy()) throw new Error('机芯正忙，请等上一颗蛋出来')
    // 不 await：扭蛋过程通过 gacha:progress 事件流式上报，完成事件里带结果
    launchGacha(runGacha(String(wish ?? ''), reportProgress), false)
    return { started: true }
  })

  handle('shelf:upgrade', async (eggId, wish) => {
    if (isGachaBusy()) throw new Error('机芯正忙，请等上一颗蛋出来')
    launchGacha(runUpgrade(String(eggId), String(wish ?? ''), reportProgress), true)
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

  handle('shelf:wishChat', async (messages) => {
    const msgs = messages as { role: string; content: string }[]
    if (!Array.isArray(msgs) || msgs.length === 0) throw new Error('messages 不能为空')
    return wishChatAi(msgs)
  })

  handle('shelf:getAiSettings', () => getAiSettingsMasked())

  handle('shelf:saveAiSettings', (s) => {
    const v = s as { baseURL?: string; model?: string; apiKey?: string }
    if (!v?.baseURL?.trim() || !v?.model?.trim()) throw new Error('baseURL 和 model 不能为空')
    const current = getAiSettings()
    // key 留空视为沿用已保存的 key
    const apiKey = v.apiKey?.trim() || current?.apiKey || ''
    if (!apiKey) throw new Error('API Key 不能为空')
    setAiSettings({ baseURL: v.baseURL, model: v.model, apiKey })
  })

  handle('shelf:testAi', async () => {
    const cfg = getAiSettings()
    if (!cfg || !cfg.apiKey) throw new Error('尚未保存配置')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 20_000)
    try {
      const res = await net.fetch(`${cfg.baseURL}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify({
          model: cfg.model,
          messages: [{ role: 'user', content: '回复"pong"两个字，不要多余内容' }],
          max_tokens: 10
        }),
        signal: controller.signal
      })
      if (!res.ok) {
        const text = (await res.text().catch(() => '')).slice(0, 200)
        throw new Error(`HTTP ${res.status}: ${text}`)
      }
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
      return { reply: data.choices?.[0]?.message?.content ?? '(空响应)' }
    } finally {
      clearTimeout(timer)
    }
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
