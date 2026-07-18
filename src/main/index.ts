import { app, protocol } from 'electron'
import path from 'node:path'
import { discoverEggs } from './eggs'
import { createEggWindow } from './eggWindow'
import { registerCapabilities } from './capabilities'
import { runSmoke } from './smoke'

protocol.registerSchemesAsPrivileged([
  { scheme: 'egg', privileges: { standard: true, secure: true, supportFetchAPI: true } }
])

const isSmoke = process.argv.includes('--smoke')

app.whenReady().then(async () => {
  registerCapabilities()

  const eggs = discoverEggs(path.join(app.getAppPath(), 'eggs'))
  if (eggs.length === 0) {
    console.log('[appgacha] no eggs found in ./eggs')
    if (isSmoke) app.exit(1)
    return
  }
  console.log(`[appgacha] loaded ${eggs.length} egg(s): ${eggs.map(e => e.manifest.name).join(', ')}`)

  if (isSmoke) {
    let failed = false
    for (const egg of eggs) {
      const ok = await runSmoke(egg)
      if (!ok) failed = true
    }
    app.exit(failed ? 1 : 0)
    return
  }

  for (const egg of eggs) createEggWindow(egg)
})

app.on('window-all-closed', () => app.quit())
