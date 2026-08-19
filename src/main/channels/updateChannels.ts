import { checkForUpdatesNow, installUpdateNow, getCurrentUpdateStatus } from '../updater'
import { handle } from './ipc'

export function registerUpdateChannels(): void {
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
