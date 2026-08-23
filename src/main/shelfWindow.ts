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

// 关闭询问兜底：渲染进程无响应（白屏/崩溃）时，超时自动退出，避免窗口永远关不掉
let closePromptTimer: ReturnType<typeof setTimeout> | null = null
function clearClosePromptTimer(): void {
  if (closePromptTimer) { clearTimeout(closePromptTimer); closePromptTimer = null }
}

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
    show: false,   // 首次绘制就绪后再显示，杜绝冷启动「先白屏、后加载」（见下方 ready-to-show）
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

  // 首次绘制就绪后再显示；加超时兜底，防止 ready-to-show 因 GPU 异常永不触发、窗口凭空消失
  const shouldShow = opts?.show ?? true
  const showFallback = setTimeout(() => {
    if (shouldShow && shelfWindow && !shelfWindow.isDestroyed() && !shelfWindow.isVisible()) {
      shelfWindow.show()
    }
  }, 3000)
  shelfWindow.once('ready-to-show', () => {
    clearTimeout(showFallback)
    if (shouldShow) shelfWindow?.show()
  })

  // 关闭拦截：未明确过关闭行为时先询问「最小化到托盘 / 直接退出」（Windows 惯例）
  // macOS 上不拦截——用户期望窗口关闭后应用留在 Dock，Cmd+Q 退出
  shelfWindow.on('close', (e) => {
    if (quitting) return
    if (process.platform === 'darwin') return   // macOS 走标准 Dock 行为
    const behavior = getAppSettings().closeBehavior
    if (behavior === 'ask') {
      // 未明确过关闭行为：询问「缩到托盘 / 直接退出」
      e.preventDefault()   // 必须同步拦截，询问交给收藏柜 UI 的项目风格弹窗
      // 兜底：10 秒内没收到用户选择（渲染进程白屏/崩溃、无监听），直接退出，别让窗口卡死
      clearClosePromptTimer()
      closePromptTimer = setTimeout(() => {
        closePromptTimer = null
        console.warn('[shelf] close prompt unanswered — falling back to quit')
        markQuitting()
        app.quit()
      }, 10_000)
      shelfWindow?.webContents.send('shelf:closePrompt')
      return
    }
    if (behavior === 'tray') {
      // 常驻：隐藏窗口（保留状态）。不能依赖 window-all-closed——联机模块的隐藏
      // WebRTC 宿主窗一直存在，会让「所有窗口已关闭」永不触发，导致直接关闭后进程仍赖在后台。
      e.preventDefault()
      // 保底：托盘创建失败就退出，绝不「藏窗口 + 无托盘」把用户困死
      if (!initTray()) { markQuitting(); app.quit(); return }
      shelfWindow?.hide()
      return
    }
    // quit：显式退出（同上，不能依赖 window-all-closed）
    markQuitting()
    app.quit()
  })
  shelfWindow.on('closed', () => { shelfWindow = null; clearClosePromptTimer() })
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
  clearClosePromptTimer()
  if (remember) setAppSettings({ closeBehavior: action === 'tray' ? 'tray' : 'quit' })
  if (action === 'tray') {
    // 保底：托盘创建失败就退出，绝不「藏窗口 + 无托盘」把用户困死
    if (!initTray()) { markQuitting(); app.quit(); return }
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
