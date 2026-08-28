import { app, dialog, shell, clipboard, nativeImage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { allEggs, getEgg, loadManifest, removeEgg } from '../eggs'
import { openEgg, closeEggWindow } from '../eggWindow'
import { openEggSmart, spacePurgeEgg } from '../space'
import { sendToShelf } from '../shelfWindow'
import { cancelAllForEgg, initSchedules } from '../schedule'
import { setEggCategory } from '../settings'
import { dataRoot } from '../paths'
import { packGacha } from '../gachaPkg'
import { createEggShortcut } from '../assoc'
import { writeEggIco } from '../ico'
import { hasBackup, restoreLatestBackup } from '../pipeline'
import { deleteCloudEgg } from '../sync'
import { getAccessToken } from '../auth'
import { importGachaFile, importGachaAsNew } from '../eggImport'
import { createShareCode, importShareCode } from '../share'
import { handle } from './ipc'

/** data URL → Buffer（去掉 data:image/png;base64, 前缀） */
function dataUrlToBuffer(dataUrl: string): Buffer {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  return Buffer.from(base64, 'base64')
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

export function registerEggChannels(): void {
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

  // ─── 分享码 ───
  handle('shelf:shareCreate', async (eggId) => {
    const egg = getEgg(eggId as string)
    if (!egg) throw new Error('egg not found')
    if (!getAccessToken()) throw new Error('SHARE_LOGIN_REQUIRED')
    return createShareCode(egg.eggId)
  })

  handle('shelf:shareImport', async (code) => {
    return importShareCode(code as string)
  })

  handle('shelf:copyText', (text) => {
    clipboard.writeText(String(text ?? ''))
    return { ok: true }
  })

  handle('shelf:saveShareImage', async (pngDataUrl, defaultName) => {
    const dataUrl = String(pngDataUrl ?? '')
    if (!dataUrl.startsWith('data:image/png')) throw new Error('invalid image data')
    const base = typeof defaultName === 'string' && defaultName
      ? defaultName.replace(/[<>:"/\\|?*]/g, '_')
      : 'share'
    const res = await dialog.showSaveDialog({
      title: '保存分享图',
      defaultPath: path.join(app.getPath('desktop'), `${base}.png`),
      filters: [{ name: 'PNG 图片', extensions: ['png'] }]
    })
    if (res.canceled || !res.filePath) return { saved: false }
    fs.writeFileSync(res.filePath, dataUrlToBuffer(dataUrl))
    clipboard.writeImage(nativeImage.createFromDataURL(dataUrl))
    shell.showItemInFolder(res.filePath)
    return { saved: true, dest: res.filePath }
  })
}
