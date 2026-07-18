import { BrowserWindow, app } from 'electron'
import path from 'node:path'

let shelfWindow: BrowserWindow | null = null

export function createShelfWindow(opts?: { show?: boolean }): BrowserWindow {
  if (shelfWindow && !shelfWindow.isDestroyed()) {
    shelfWindow.focus()
    return shelfWindow
  }
  shelfWindow = new BrowserWindow({
    width: 860,
    height: 620,
    minWidth: 560,
    minHeight: 420,
    show: opts?.show ?? true,
    title: '应用扭蛋机',
    autoHideMenuBar: true,
    backgroundColor: '#f6f5f2',
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, '../preload/shelf.js')
    }
  })
  shelfWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  shelfWindow.on('closed', () => { shelfWindow = null })
  shelfWindow.loadFile(path.join(app.getAppPath(), 'src', 'renderer', 'shelf', 'index.html'))
  // 开发期默认带上 DevTools，便于定位渲染层问题
  if (!app.isPackaged && (opts?.show ?? true)) {
    shelfWindow.webContents.openDevTools({ mode: 'detach' })
  }
  return shelfWindow
}

export function isShelfSender(webContentsId: number): boolean {
  return !!shelfWindow && !shelfWindow.isDestroyed() && shelfWindow.webContents.id === webContentsId
}

export function sendToShelf(channel: string, payload: unknown): void {
  if (shelfWindow && !shelfWindow.isDestroyed()) shelfWindow.webContents.send(channel, payload)
}
