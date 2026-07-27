import { app, protocol } from 'electron'
import { discoverEggs } from './eggs'
import { registerCapabilities } from './capabilities'
import { createShelfWindow } from './shelfWindow'
import { registerShelfChannels, registerWindowControls, bindWindowStateEvents } from './shelf'
import { registerWidgetControlEvents } from './widgetControls'
import { initSchedules } from './schedule'
import { dataRoot } from './paths'
import { initLogging } from './log'
import { runSmoke, runShelfSmoke, runPipelineFailSmoke, runUpgradeSmoke } from './smoke'
import { sweepStaging } from './pipeline'
import * as net from './net/coordinator'
import { initTray, destroyTray } from './tray'
import { openEgg } from './eggWindow'
import { getAppSettings, getEggAutoStart } from './settings'

protocol.registerSchemesAsPrivileged([
  { scheme: 'egg', privileges: { standard: true, secure: true, supportFetchAPI: true } }
])

const isSmoke = process.argv.includes('--smoke')
if (!isSmoke) initLogging()

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
  if (!isSmoke) initSchedules(eggs)

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
  bindWindowStateEvents(shelfWin.webContents.id)

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

app.on('before-quit', () => { destroyTray(); net.shutdown() })
