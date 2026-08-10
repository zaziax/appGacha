import 'dotenv/config'
import { app, protocol, BrowserWindow } from 'electron'
import fs from 'node:fs'
import { discoverEggs, getEgg } from './eggs'
import { registerCapabilities } from './capabilities'
import { createShelfWindow, sendToShelf, isShelfWindowReady } from './shelfWindow'
import { registerShelfChannels, registerWindowControls, bindWindowStateEvents, importGachaFile } from './shelf'
import { registerWidgetControlEvents } from './widgetControls'
import { initSchedules } from './schedule'
import { dataRoot } from './paths'
import { initLogging } from './log'
import { runSmoke, runShelfSmoke, runPipelineFailSmoke, runUpgradeSmoke, runLayoutProbe } from './smoke'
import { sweepStaging } from './pipeline'
import * as net from './net/coordinator'
import { initTray, destroyTray } from './tray'
import { openEgg, getOpenWindowEggIds } from './eggWindow'
import { openEggSmart, getSpaceEggIds } from './space'
import { getAppSettings, getEggAutoStart, isSyncDisabledForEgg } from './settings'
import { syncEgg } from './sync'
import { peekGachaManifest } from './gachaPkg'
import { registerAssociations } from './assoc'
import { handleCallback } from './auth'
import { initAutoUpdater, stopAutoUpdater } from './updater'

// ── 禁止 Chromium 窗口遮挡检测：失焦/被覆盖时不停合成器，避免 WebGL canvas 白屏 ──
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion,IntensiveWakeUpThrottling')
app.commandLine.appendSwitch('disable-background-timer-throttling')

protocol.registerSchemesAsPrivileged([
  { scheme: 'egg', privileges: { standard: true, secure: true, supportFetchAPI: true } }
])

const isSmoke = process.argv.includes('--smoke')
// 布局探针：electron . --probe <蛋目录>，离屏量应用壳几何 + 截图（dist/probe-<name>.png）
const probeIdx = process.argv.indexOf('--probe')
const probeDir = probeIdx >= 0 ? process.argv[probeIdx + 1] : undefined
if (!isSmoke && !probeDir) initLogging()

// ── 单实例：双击 .gacha / appgacha:// 协议唤起转发给首实例 ──
// smoke/probe 是短命进程，不抢锁（避免被开发实例挡住）
let pendingFiles: string[] = []
/** 冷启动时 .gacha 导入冲突排队：收藏柜窗口还没建，等建完再发 IPC */
const pendingImportConflicts: Array<{ file: string; eggId: string; name: string }> = []
if (!isSmoke && !probeDir) {
  if (!app.requestSingleInstanceLock()) {
    app.quit()
  } else {
    app.on('second-instance', (_e, argv) => { void routeLaunchArgs(argv) })
    // macOS：双击 .gacha 文件触发 open-file（可能先于 ready，排队等就绪后处理）
    app.on('open-file', (e, filePath) => {
      e.preventDefault()
      if (app.isReady()) void routeLaunchArgs([filePath])
      else pendingFiles.push(filePath)
    })
  }
}

// ── 启动参数路由：appgacha://egg/<id> → 直接开蛋；appgacha://callback → OAuth 回调；.gacha 文件 → 已装则开、未装则导入后开 ──
async function routeLaunchArgs(argv: string[]): Promise<void> {
  const url = argv.find(a => a.startsWith('appgacha://'))
  if (url) {
    // OAuth 回调：appgacha://callback?code=xxx&state=yyy
    if (url.startsWith('appgacha://callback')) {
      const result = await handleCallback(url)
      if (result.ok) {
        // 通知收藏柜刷新登录状态
        const { sendToShelf } = await import('./shelfWindow')
        sendToShelf('auth:changed', { loggedIn: true })
      }
      return
    }
    const m = url.match(/^appgacha:\/\/egg\/([a-z0-9-]+)/i)
    if (m) {
      const egg = getEgg(m[1].toLowerCase())
      // 蛋在扭蛋空间里 → 聚焦空间 tab；否则独立窗口
      if (egg) openEggSmart(egg)
    }
    return
  }
  const file = argv.find(a => a.toLowerCase().endsWith('.gacha') && fs.existsSync(a) && fs.statSync(a).isFile())
  if (!file) return
  try {
    const { eggId, name } = await peekGachaManifest(file)
    const existing = getEgg(eggId)
    // 冲突：「仅应用」导出的 .gacha 仍带原 eggId，原蛋已装时弹窗询问
    if (existing) {
      if (isShelfWindowReady()) {
        sendToShelf('shelf:importConflict', { file, eggId, name })
      } else {
        pendingImportConflicts.push({ file, eggId, name })
      }
      return
    }
    const { eggId: newId } = await importGachaFile(file)
    // 导入成功→通知收藏柜刷新列表（冷启动时窗口还没建，sendToShelf 自动空转；
    // second-instance 热导入时窗口已在，UI 收到事件后重拉列表）
    sendToShelf('shelf:eggsChanged', { eggId: newId })
    const egg = getEgg(newId)
    if (egg) openEggSmart(egg)
  } catch (e) {
    console.error('[assoc] 打开 .gacha 文件失败:', (e as Error).message)
  }
}

app.whenReady().then(async () => {
  registerCapabilities()
  registerShelfChannels()
  registerWindowControls()
  registerWidgetControlEvents()
  sweepStaging()

  // P2 局域网联机：UDP 发现 + 隐藏 WebRTC 宿主窗（smoke 模式不启动，避免干扰测试）
  if (!isSmoke) net.init().catch(e => console.error('[net] init failed:', e.message))

  const eggs = discoverEggs(dataRoot('eggs'))
  console.log(`[appgacha] loaded ${eggs.length} egg(s): ${eggs.map(e => e.manifest.name).join(', ') || '(none)'}`)
  if (!isSmoke && !probeDir) initSchedules(eggs)

  // 文件关联 + 协议注册 + 启动参数路由（双击 .gacha / appgacha:// 唤起）
  if (!isSmoke && !probeDir) {
    registerAssociations()
    // 冷启动双击 .gacha：先 await 导入完成再建收藏柜窗口，
    // 避免 UI 拉列表时导入还没完、蛋不入架
    await routeLaunchArgs(process.argv)
    for (const f of pendingFiles) await routeLaunchArgs([f])
    pendingFiles = []
  }

  if (probeDir) {
    const ok = await runLayoutProbe(probeDir)
    app.exit(ok ? 0 : 1)
    return
  }

  if (isSmoke) {
    let failed = false
    for (const egg of eggs) {
      if (!(await runSmoke(egg))) failed = true
    }
    if (!(await runShelfSmoke(eggs.length))) failed = true
    if (!(await runPipelineFailSmoke())) failed = true
    if (!(await runUpgradeSmoke())) failed = true
    app.exit(failed ? 1 : 0)
    return
  }

  const shelfWin = createShelfWindow()

  // 冷启动排队中的 .gacha 导入冲突：收藏柜窗口已就绪，发送 IPC 弹窗询问
  for (const c of pendingImportConflicts) {
    sendToShelf('shelf:importConflict', c)
  }
  pendingImportConflicts.length = 0

  bindWindowStateEvents(shelfWin.webContents.id)
  initAutoUpdater()

  // P3 生命周期：托盘常驻 + 蛋自启动
  const appSettings = getAppSettings()
  if (appSettings.minimizeToTray) initTray()

  // 蛋自启动：扫描所有蛋，用户覆盖 > manifest 出厂默认
  for (const egg of eggs) {
    const manifestDefault = egg.manifest.window?.autoStart ?? false
    if (getEggAutoStart(egg.eggId, manifestDefault)) {
      openEgg(egg)
    }
  }
})

// P3 托盘常驻：关窗口 ≠ 退出，只有托盘菜单“退出”才真正 quit
app.on('window-all-closed', () => {
  if (isSmoke) return
  const { minimizeToTray } = getAppSettings()
  if (!minimizeToTray) app.quit()
  // minimizeToTray=true 时不做任何事，应用继续在托盘运行
})

app.on('before-quit', async (event) => {
  const spaceIds = getSpaceEggIds()
  const windowIds = getOpenWindowEggIds()
  const allIds = [...new Set([...spaceIds, ...windowIds])]
  const toSync = allIds.filter(id => !isSyncDisabledForEgg(id))

  if (toSync.length > 0) {
    event.preventDefault()

    // 同步进度提示窗
    const progress = new BrowserWindow({
      width: 280, height: 100,
      frame: false, transparent: true, alwaysOnTop: true, resizable: false,
      center: true, skipTaskbar: true,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    })
    progress.loadURL(`data:text/html,${encodeURIComponent(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
body{display:flex;align-items:center;justify-content:center;height:100vh;font-family:-apple-system,system-ui,sans-serif}
.card{background:#fff;border-radius:12px;padding:20px 28px;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,.15)}
.spinner{width:20px;height:20px;border:3px solid #e8dfce;border-top-color:#5c4033;border-radius:50%;animation:spin .7s linear infinite;margin:0 auto 10px}
@keyframes spin{to{transform:rotate(360deg)}}
.text{font-size:13px;color:#5c4033;font-weight:600}
</style></head><body><div class="card"><div class="spinner"></div><div class="text">正在同步 ${toSync.length} 个扭蛋…</div></div></body></html>`)}`)

    // 最多等 8 秒
    await Promise.race([
      Promise.allSettled(toSync.map(id => syncEgg(id).catch(() => {}))),
      new Promise(r => setTimeout(r, 8_000)),
    ])

    if (!progress.isDestroyed()) progress.close()
    app.exit()
    return
  }

  destroyTray(); stopAutoUpdater(); net.shutdown()
})
