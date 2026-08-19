import { listCloudEggs, syncEgg, downloadEgg, deleteCloudEgg, setSyncEnabled } from '../sync'
import { sendToShelf } from '../shelfWindow'
import { handle } from './ipc'

export function registerSyncChannels(): void {
  handle('shelf:syncEgg', async (eggId) => {
    return await syncEgg(String(eggId))
  })

  handle('shelf:syncList', async () => {
    return await listCloudEggs()
  })

  handle('shelf:syncDeleteCloud', async (eggId) => {
    return await deleteCloudEgg(String(eggId))
  })

  handle('shelf:syncDownload', async (eggId) => {
    const id = String(eggId)
    return await downloadEgg(id, (percent, stage) => {
      sendToShelf('sync:downloadProgress', { eggId: id, percent, stage })
    })
  })

  handle('shelf:setSyncEnabled', async (v) => {
    setSyncEnabled(Boolean(v))
  })
}
