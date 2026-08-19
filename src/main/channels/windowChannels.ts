import { ipcMain, BrowserWindow, IpcMainInvokeEvent } from 'electron'

export function registerWindowControls(): void {
  const win = (e: IpcMainInvokeEvent | Electron.IpcMainEvent) => BrowserWindow.fromWebContents(e.sender)!

  ipcMain.handle('win:isMaximized', e => win(e).isMaximized())
  // 置顶状态查询/切换——宿主 hover 浮钮专用，不走 egg 权限门控
  ipcMain.handle('win:isAlwaysOnTop', e => win(e).isAlwaysOnTop())
  ipcMain.on('win:setAlwaysOnTop', (e, flag) => win(e).setAlwaysOnTop(flag === true))

  ipcMain.on('win:minimize', e => win(e).minimize())
  ipcMain.on('win:maximize', e => {
    const w = win(e)
    w.isMaximized() ? w.unmaximize() : w.maximize()
  })
  ipcMain.on('win:close', e => win(e).close())
}

export function bindWindowStateEvents(webContentsId: number): void {
  const w = BrowserWindow.fromId(webContentsId)
  if (!w) return
  const emit = (maximized: boolean) => w.webContents.send('win:stateChanged', { maximized })
  w.on('maximize', () => emit(true))
  w.on('unmaximize', () => emit(false))
  emit(w.isMaximized())
}
