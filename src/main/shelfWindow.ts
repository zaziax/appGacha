import { BrowserWindow, app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

let shelfWindow: BrowserWindow | null = null

// 收藏柜 UI 三形态：Vite dev server（热更新）> 构建产物（React）> 素颜版兜底
function loadShelfUi(win: BrowserWindow): void {
  const devUrl = process.env.APPGACHA_UI_DEV_URL
  if (devUrl) {
    win.loadURL(devUrl)
    return
  }
  const builtUi = path.join(app.getAppPath(), 'dist', 'ui', 'index.html')
  if (process.env.APPGACHA_UI !== 'legacy' && fs.existsSync(builtUi)) {
    win.loadFile(builtUi)
    return
  }
  win.loadFile(path.join(app.getAppPath(), 'src', 'renderer', 'shelf', 'index.html'))
}

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
  loadShelfUi(shelfWindow)
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
