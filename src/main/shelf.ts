import { app, dialog, ipcMain, net, shell, IpcMainInvokeEvent } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { allEggs, getEgg, loadManifest, registerEgg, removeEgg } from './eggs'
import { openEgg, closeEggWindow } from './eggWindow'
import { isShelfSender } from './shelfWindow'
import { cancelAllForEgg, initSchedules } from './schedule'
import { getAiSettings, getAiSettingsMasked, setAiSettings } from './settings'

export function eggsRoot(): string {
  return path.join(app.getAppPath(), 'eggs')
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
  return allEggs().map(e => ({
    eggId: e.eggId,
    name: e.manifest.name,
    version: e.manifest.version,
    wish: e.manifest.wish ?? '',
    permissions: e.manifest.permissions,
    folder: path.basename(e.dir)
  }))
}

function uniqueFolder(root: string, baseName: string): string {
  let dir = path.join(root, `${baseName}.egg`)
  let i = 2
  while (fs.existsSync(dir)) dir = path.join(root, `${baseName}-${i++}.egg`)
  return dir
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
    fs.cpSync(src, dest, { recursive: true })
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
    fs.cpSync(egg.dir, dest, { recursive: true })
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
