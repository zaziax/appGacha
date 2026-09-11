import { checkForUpdatesNow, installUpdateNow, getCurrentUpdateStatus } from '../updater'
import { handle } from './ipc'
import { app, shell } from 'electron'
import { isShelfVisible } from '../shelfWindow'
import fs from 'node:fs'
import path from 'node:path'
import { getTelemetryEnabled, setTelemetryEnabled, TELEMETRY_EFFECTIVE } from '../telemetry'

const seenPath = () => path.join(app.getPath('userData'), 'release-seen.txt')
const pendingPath = () => path.join(app.getPath('userData'), 'release-pending.txt')
const metricsNoticePath = () => path.join(app.getPath('userData'), 'usage-statistics-notice.txt')

export function registerUpdateChannels(): void {
  handle('shelf:productInfo', () => {
    let eligible = false
    let seen = true
    try { eligible = fs.readFileSync(pendingPath(), 'utf8').trim() === app.getVersion() } catch { /* fresh install */ }
    if (eligible) {
      try { seen = fs.readFileSync(seenPath(), 'utf8').trim() === app.getVersion() } catch { seen = false }
    }
    let metricsNoticeSeen = false
    try { metricsNoticeSeen = fs.readFileSync(metricsNoticePath(), 'utf8').trim() === '1' } catch { /* first run */ }
    return { version: app.getVersion(), seen, telemetryEnabled: getTelemetryEnabled(), metricsNoticeSeen, effective: TELEMETRY_EFFECTIVE,
      visible: isShelfVisible() }
  })
  handle('shelf:acknowledgeVersion', () => {
    fs.writeFileSync(seenPath(), app.getVersion())
    try { fs.unlinkSync(pendingPath()) } catch { /* already absent */ }
  })
  handle('shelf:setTelemetryEnabled', enabled => setTelemetryEnabled(enabled === true))
  handle('shelf:acknowledgeTelemetryNotice', () => { fs.writeFileSync(metricsNoticePath(), '1') })
  handle('shelf:openPrivacy', () => shell.openExternal('https://appgacha.com/privacy'))
  handle('shelf:checkUpdate', async () => {
    await checkForUpdatesNow()
  })

  handle('shelf:getUpdateStatus', async () => {
    return getCurrentUpdateStatus()
  })

  handle('shelf:installUpdate', async () => {
    installUpdateNow()
  })
}
