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
})

// smoke 模式会反复开关离屏窗口，不能因窗口清零而退出
app.on('window-all-closed', () => { if (!isSmoke) app.quit() })

app.on('before-quit', () => { net.shutdown() })
