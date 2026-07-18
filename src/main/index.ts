import { app, protocol } from 'electron'
import path from 'node:path'
import { discoverEggs } from './eggs'
import { registerCapabilities } from './capabilities'
import { createShelfWindow } from './shelfWindow'
import { registerShelfChannels } from './shelf'
import { initSchedules } from './schedule'
import { runSmoke, runShelfSmoke } from './smoke'

protocol.registerSchemesAsPrivileged([
  { scheme: 'egg', privileges: { standard: true, secure: true, supportFetchAPI: true } }
])

const isSmoke = process.argv.includes('--smoke')

app.whenReady().then(async () => {
  registerCapabilities()
  registerShelfChannels()

  const eggs = discoverEggs(path.join(app.getAppPath(), 'eggs'))
  console.log(`[appgacha] loaded ${eggs.length} egg(s): ${eggs.map(e => e.manifest.name).join(', ') || '(none)'}`)
  if (!isSmoke) initSchedules(eggs)

  if (isSmoke) {
    let failed = false
    for (const egg of eggs) {
      if (!(await runSmoke(egg))) failed = true
    }
    if (!(await runShelfSmoke(eggs.length))) failed = true
    app.exit(failed ? 1 : 0)
    return
  }

  createShelfWindow()
})

// smoke 模式会反复开关离屏窗口，不能因窗口清零而退出
app.on('window-all-closed', () => { if (!isSmoke) app.quit() })
