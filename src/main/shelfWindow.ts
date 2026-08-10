import { BrowserWindow, app, shell } from 'electron'
import path from 'node:path'
import { getAppSettings, setAppSettings } from './settings'
import { initTray } from './tray'
import { attachSpaceHost } from './space'
import { t } from './i18n'

let shelfWindow: BrowserWindow | null = null
// 真退出标志：托盘菜单"退出"/询问框选"直接退出"时置位，关闭拦截不再询问
let quitting = false
export function markQuitting(): void { quitting = true }

// 收藏柜 UI 加载：Vite dev server（热更新）> 构建产物（React）
function loadShelfUi(win: BrowserWindow): void {
  const devUrl = process.env.APPGACHA_UI_DEV_URL
  if (devUrl) {
    win.loadURL(devUrl)
    return
  }
  const builtUi = path.join(app.getAppPath(), 'dist', 'ui', 'index.html')
  win.loadFile(builtUi)
}

export function createShelfWindow(opts?: { show?: boolean }): BrowserWindow {
  if (shelfWindow && !shelfWindow.isDestroyed()) {
    shelfWindow.show()
    shelfWindow.focus()
    return shelfWindow
  }
  const isMac = process.platform === 'darwin'
  shelfWindow = new BrowserWindow({
    width: 860,
    height: 620,
    minWidth: 560,
    minHeight: 420,
    frame: false,                                 // 无边框：自定义 TitleBar 提供拖拽 + 窗口控件
    ...(isMac ? {
      titleBarStyle: 'hidden' as const,
      trafficLightPosition: { x: 14, y: 16 },   // 46px 标题栏垂直居中
    } : {}),
    show: opts?.show ?? true,
    title: t('windowTitle'),
    autoHideMenuBar: true,
    backgroundColor: '#f6f5f2',
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, '../preload/shelf.js')
    }
  })
  // 外链用系统浏览器打开，其余新窗口请求拒绝
  shelfWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) shell.openExternal(url)
    return { action: 'deny' }
  })

  // 关闭拦截：未明确过关闭行为时先询问「最小化到托盘 / 直接退出」（Windows 惯例）
  // macOS 上不拦截——用户期望窗口关闭后应用留在 Dock，Cmd+Q 退出
  shelfWindow.on('close', (e) => {
    if (quitting) return
    if (process.platform === 'darwin') return   // macOS 走标准 Dock 行为
    const s = getAppSettings()
    if (s.closeActionKnown) {
      // 已记住选择：常驻则隐藏窗口（保留状态），否则正常关闭走 window-all-closed 退出
      if (s.minimizeToTray) {
        e.preventDefault()
        initTray()   // 保底：托盘必须存在，否则用户找不回窗口
        shelfWindow?.hide()
      }
      return
    }
    e.preventDefault()   // 必须同步拦截，询问交给收藏柜 UI 的项目风格弹窗
    shelfWindow?.webContents.send('shelf:closePrompt')
  })
  shelfWindow.on('closed', () => { shelfWindow = null })
  // 扭蛋空间：登记宿主窗口，蛋视图叠加在本窗口 contentView 上
  attachSpaceHost(shelfWindow)
  loadShelfUi(shelfWindow)
  // 开发期默认带上 DevTools，便于定位渲染层问题
  if (!app.isPackaged && (opts?.show ?? true)) {
    shelfWindow.webContents.openDevTools({ mode: 'detach' })
  }
  return shelfWindow
}

/** 收藏柜 UI 的关闭询问弹窗回传：执行用户选择（remember=true 时写回设置，以后不再询问） */
export function executeCloseAction(action: 'tray' | 'quit', remember: boolean): void {
  if (remember) setAppSettings({ minimizeToTray: action === 'tray', closeActionKnown: true })
  if (action === 'tray') {
    initTray()   // 保底：托盘必须存在，否则用户找不回窗口
    shelfWindow?.hide()
  } else {
    markQuitting()
    app.quit()
  }
}

export function isShelfWindowReady(): boolean {
  return !!shelfWindow && !shelfWindow.isDestroyed()
}

export function isShelfSender(webContentsId: number): boolean {
  return !!shelfWindow && !shelfWindow.isDestroyed() && shelfWindow.webContents.id === webContentsId
}

export function sendToShelf(channel: string, payload: unknown): void {
  if (shelfWindow && !shelfWindow.isDestroyed()) shelfWindow.webContents.send(channel, payload)
}

/** 托盘菜单/双击调用：显示收藏柜（已隐藏则恢复，已销毁则重建） */
export function showShelfWindow(): void {
  if (shelfWindow && !shelfWindow.isDestroyed()) {
    shelfWindow.show()
    shelfWindow.focus()
  } else {
    createShelfWindow()
  }
}

/** 收藏柜是否存活（未销毁） */
export function isShelfAlive(): boolean {
  return !!shelfWindow && !shelfWindow.isDestroyed()
}
