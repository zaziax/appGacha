import { ipcMain, IpcMainInvokeEvent } from 'electron'
import { isShelfSender } from '../shelfWindow'

type ShelfHandler = (...args: unknown[]) => unknown

// 收藏柜通道只认收藏柜窗口，蛋窗口调不动
export function handle(channel: string, fn: ShelfHandler): void {
  ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    try {
      if (!isShelfSender(event.sender.id)) throw new Error('caller is not the shelf window')
      return { ok: true, value: await fn(...args) }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })
}
