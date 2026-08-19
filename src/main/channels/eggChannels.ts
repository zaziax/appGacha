import { app, dialog, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { allEggs, getEgg, loadManifest, registerEgg, removeEgg } from '../eggs'
import { openEgg, closeEggWindow } from '../eggWindow'
import { openEggSmart, spacePurgeEgg } from '../space'
import { sendToShelf } from '../shelfWindow'
import { cancelAllForEgg, initSchedules } from '../schedule'
import { setEggCategory } from '../settings'
import { dataRoot } from '../paths'
import { copyDir } from '../fsutil'
import { packGacha, unpackGacha } from '../gachaPkg'
import { createEggShortcut } from '../assoc'
import { writeEggIco } from '../ico'
import { hasBackup, restoreLatestBackup } from '../pipeline'
import { deleteCloudEgg } from '../sync'
import { handle } from './ipc'

function eggsRoot(): string {
  return dataRoot('eggs')
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
async function importGachaAsNew(gachaFile: string): Promise<{ name: string; eggId: string }> {
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
}
