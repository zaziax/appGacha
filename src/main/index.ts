import { app, protocol } from 'electron'
import { discoverEggs } from './eggs'
import { registerCapabilities } from './capabilities'
import { createShelfWindow } from './shelfWindow'
import { registerShelfChannels } from './shelf'
import { initSchedules } from './schedule'
import { dataRoot } from './paths'
import { runSmoke, runShelfSmoke, runPipelineFailSmoke } from './smoke'
import { sweepStaging } from './pipeline'

protocol.registerSchemesAsPrivileged([
  { scheme: 'egg', privileges: { standard: true, secure: true, supportFetchAPI: true } }
])

const isSmoke = process.argv.includes('--smoke')

app.whenReady().then(async () => {
  registerCapabilities()
  registerShelfChannels()
  sweepStaging()

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
    app.exit(failed ? 1 : 0)
    return
  }

  createShelfWindow()
})

// smoke 模式会反复开关离屏窗口，不能因窗口清零而退出
app.on('window-all-closed', () => { if (!isSmoke) app.quit() })
