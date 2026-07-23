import { BrowserWindow, session } from 'electron'
import path from 'node:path'
import { EggContext } from './eggs'
import { registerEggProtocol, lockdownSession } from './protocol'
import { bindWindowStateEvents } from './shelf'
import * as registry from './registry'
import { attachControls } from './widgetControls'
import { onEggClosed } from './net/coordinator'

const preparedPartitions = new Set<string>()
const openWindows = new Map<string, BrowserWindow>()

/** 窗口尺寸钳制 240~1600，防智障声明 */
const clampSize = (v: number | undefined, fallback: number): number =>
  v === undefined || !Number.isFinite(v) ? fallback : Math.min(1600, Math.max(240, Math.round(v)))

// 收藏柜点击入口：已开的蛋聚焦，未开的创建
export function openEgg(egg: EggContext): BrowserWindow {
  const existing = openWindows.get(egg.eggId)
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore()
    existing.focus()
    return existing
  }
  return createEggWindow(egg)
}

export function closeEggWindow(eggId: string): void {
  const win = openWindows.get(eggId)
  if (win && !win.isDestroyed()) win.close()
}

export function createEggWindow(egg: EggContext, opts?: { show?: boolean }): BrowserWindow {
  const partition = `persist:egg-${egg.eggId}`
  const ses = session.fromPartition(partition)
  if (!preparedPartitions.has(partition)) {
    registerEggProtocol(ses)
    lockdownSession(ses)
    preparedPartitions.add(partition)
  }

  // D11 窗口形态：manifest.window 声明 type/尺寸/置顶
  const spec = egg.manifest.window ?? {}
  const isWidget = spec.type === 'widget'

  const win = new BrowserWindow({
    width: clampSize(spec.width, 900),
    height: clampSize(spec.height, 640),
    frame: false,
    // widget：透明无边框，蛋用 CSS 自绘形状；standard：保持现有不透明行为
    transparent: isWidget,
    // 显式初始化透明背景色，让 DWM 从窗口创建起就知道这是全透明窗
    backgroundColor: isWidget ? '#00000000' : undefined,
    // widget 关闭 thickFrame：Windows 上透明窗带 WS_THICKFRAME 会在失焦时被 DWM 画出幽灵标题栏
    thickFrame: !isWidget,
    // widget 再关 resizable/hasShadow：resizable:true 会让 Windows 保留 WS_THICKFRAME（边缘缩放边框），
    // 幽灵标题栏随之复现；透明窗的阴影是不跟随 CSS 形状的矩形轮廓，一并关闭
    resizable: !isWidget,
    hasShadow: !isWidget,
    alwaysOnTop: spec.alwaysOnTop ?? false,
    show: opts?.show ?? true,
    title: isWidget ? '' : egg.manifest.name,
    autoHideMenuBar: true,
    webPreferences: {
      // R2 前提：沙箱三件套，preload 是主应用的，蛋无法替换
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, '../preload/index.js'),
      // 窗口类型传给 preload（process.argv）：widget 不注入标题栏、改注入 hover 浮钮
      additionalArguments: [`--egg-window-type=${isWidget ? 'widget' : 'standard'}`],
      partition
    }
  })

  // R2: 窗口创建时登记 webContents → 蛋，权限检查只认这张表
  const wcId = win.webContents.id
  registry.register(wcId, egg)
  openWindows.set(egg.eggId, win)
  win.on('closed', () => {
    registry.unregister(wcId)
    if (openWindows.get(egg.eggId) === win) openWindows.delete(egg.eggId)
    // P2：蛋窗口关闭 → 清理其房间（host 解散 / joiner 离开）
    onEggClosed(egg.eggId)
  })

  // R4: 蛋不能创建窗口
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  bindWindowStateEvents(win.webContents.id)

  win.loadURL(`egg://${egg.eggId}/index.html`)

  // Windows 已知 bug（electron#47440）：frame:false 透明窗失焦时 DWM 会补画矩形”幽灵标题栏”（显示窗口名）。
  // 多层加固：① 标题置空（无内容可显示）② backgroundColor 初始化显式透明
  // ③ blur 时重刷透明背景 + invalidate 强制重绘 ④ show 时补设一遍
  if (isWidget && process.platform === 'win32') {
    win.on('show', () => { if (!win.isDestroyed()) win.setBackgroundColor('#00000000') })
    win.on('blur', () => {
      if (win.isDestroyed()) return
      win.setBackgroundColor('#00000000')
      win.webContents.invalidate()   // force-paint 覆盖 DWM 幽灵矩形
    })
  }

  // D11 widget 安全出口：独立卫星控制窗（窗口外部，蛋代码不可触碰）
  if (isWidget) attachControls(win)

  return win
}
