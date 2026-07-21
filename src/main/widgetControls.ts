import { BrowserWindow, ipcMain, screen } from 'electron'

/**
 * D11 widget 安全出口：独立卫星控制窗。
 * 控制窗是一个独立的宿主小窗口，悬浮在 widget 窗口外部上方——
 * 不在蛋的 DOM 里，蛋代码完全无法触碰/移除/遮挡，天然免疫篡改。
 * 提供：握把拖动（移动 widget）、置顶开关、关闭。
 */

const CTRL_W = 100
const CTRL_H = 36

// widget.id → 卫星窗；卫星窗.id → widget
const ctrlByWidget = new Map<number, BrowserWindow>()
const widgetByCtrl = new Map<number, BrowserWindow>()
// 隐藏倒计时（widget.id → timer）
const hideTimers = new Map<number, NodeJS.Timeout>()

// 拖拽会话（widget.id → 状态）。握把按下后由主进程轮询光标位置直接搬移 widget，
// 不用卫星窗原生拖动——无框窗原生拖动在 Win11 会触发 Aero Snap 放大、且增量换算会漂移
interface DragSession {
  timer: NodeJS.Timeout
  startCursor: [number, number]
  startWidget: [number, number]
  size: [number, number]         // 拖拽开始时锁定的 widget 尺寸，配合 setBounds 防 DPI 放大 bug
}
const dragSessions = new Map<number, DragSession>()

const CTRL_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
  .pill {
    box-sizing: border-box; width: 100%; height: 100%;
    display: flex; align-items: center; gap: 2px; padding: 4px;
    background: rgba(30,30,36,.88); backdrop-filter: blur(8px);
    border-radius: 99px; user-select: none;
    font-family: system-ui, "Microsoft YaHei", sans-serif;
  }
  .grip {
    flex: 1; height: 100%; display: flex; align-items: center; justify-content: center;
    color: rgba(255,255,255,.45); cursor: grab; touch-action: none;
  }
  .grip.dragging { cursor: grabbing; color: rgba(255,255,255,.85); }
  .pill button {
    -webkit-app-region: no-drag;
    width: 26px; height: 26px; flex: none; border: none; background: none;
    border-radius: 99px; cursor: pointer; display: flex; align-items: center; justify-content: center;
    color: rgba(255,255,255,.75); padding: 0; transition: background .15s, color .15s;
  }
  .pill button:hover { background: rgba(255,255,255,.16); color: #fff; }
  .pill button.pinned { color: #e8843c; }
  .pill button.close:hover { background: #c0574f; color: #fff; }
  svg { width: 14px; height: 14px; display: block; }
</style>
</head>
<body>
<div class="pill">
  <div class="grip" id="grip" title="拖动移动"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="9" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="18" r="1"/></svg></div>
  <button id="pin" title="置顶"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1z"/></svg></button>
  <button id="close" class="close" title="关闭"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg></button>
</div>
<script>
  const { ipcRenderer } = require('electron')
  document.getElementById('pin').addEventListener('click', () => ipcRenderer.send('ctrl:pin'))
  document.getElementById('close').addEventListener('click', () => ipcRenderer.send('ctrl:close'))
  ipcRenderer.on('ctrl:pinState', (_e, onTop) => document.getElementById('pin').classList.toggle('pinned', !!onTop))
  document.documentElement.addEventListener('mouseenter', () => ipcRenderer.send('ctrl:enter'))
  document.documentElement.addEventListener('mouseleave', () => ipcRenderer.send('ctrl:leave'))
  // 握把自定义拖动：pointerdown 上报开始（指针捕获保证松手事件不丢），pointerup 上报结束
  const grip = document.getElementById('grip')
  grip.addEventListener('pointerdown', e => {
    e.preventDefault()
    grip.setPointerCapture(e.pointerId)
    grip.classList.add('dragging')
    ipcRenderer.send('ctrl:dragStart')
  })
  const endDrag = e => {
    if (!grip.classList.contains('dragging')) return
    grip.classList.remove('dragging')
    if (grip.hasPointerCapture(e.pointerId)) grip.releasePointerCapture(e.pointerId)
    ipcRenderer.send('ctrl:dragEnd')
  }
  grip.addEventListener('pointerup', endDrag)
  grip.addEventListener('pointercancel', endDrag)
</script>
</body>
</html>`

export function registerWidgetControlEvents(): void {
  // widget 侧：鼠标进入/离开（preload 上报）
  ipcMain.on('widget:hover', e => {
    const widget = BrowserWindow.fromWebContents(e.sender)
    if (widget) showControl(widget)
  })
  ipcMain.on('widget:leave', e => {
    const widget = BrowserWindow.fromWebContents(e.sender)
    if (widget) scheduleHide(widget.id)
  })
  // 卫星窗侧：鼠标进入/离开（保持可见以便点击）
  ipcMain.on('ctrl:enter', e => {
    const ctrl = BrowserWindow.fromWebContents(e.sender)
    const widget = ctrl ? widgetByCtrl.get(ctrl.id) : undefined
    if (widget) cancelHide(widget.id)
  })
  ipcMain.on('ctrl:leave', e => {
    const ctrl = BrowserWindow.fromWebContents(e.sender)
    const widget = ctrl ? widgetByCtrl.get(ctrl.id) : undefined
    if (widget) scheduleHide(widget.id)
  })
  // 置顶开关：直接操作 widget，不受蛋权限门控
  ipcMain.on('ctrl:pin', e => {
    const ctrl = BrowserWindow.fromWebContents(e.sender)
    const widget = ctrl ? widgetByCtrl.get(ctrl.id) : undefined
    if (!widget || widget.isDestroyed()) return
    const onTop = !widget.isAlwaysOnTop()
    widget.setAlwaysOnTop(onTop)
    ctrl!.webContents.send('ctrl:pinState', onTop)
  })
  ipcMain.on('ctrl:close', e => {
    const ctrl = BrowserWindow.fromWebContents(e.sender)
    const widget = ctrl ? widgetByCtrl.get(ctrl.id) : undefined
    if (widget && !widget.isDestroyed()) widget.close()
  })
  // 握把拖动：开始/结束（实际搬移由 startDrag 的轮询完成）
  ipcMain.on('ctrl:dragStart', e => {
    const ctrl = BrowserWindow.fromWebContents(e.sender)
    const widget = ctrl ? widgetByCtrl.get(ctrl.id) : undefined
    if (ctrl && widget && !widget.isDestroyed()) startDrag(widget, ctrl)
  })
  ipcMain.on('ctrl:dragEnd', e => {
    const ctrl = BrowserWindow.fromWebContents(e.sender)
    const widget = ctrl ? widgetByCtrl.get(ctrl.id) : undefined
    if (widget) endDrag(widget.id)
  })
}

export function attachControls(widget: BrowserWindow): void {
  const ctrl = new BrowserWindow({
    width: CTRL_W,
    height: CTRL_H,
    frame: false,
    transparent: true,
    thickFrame: false,      // 同样是透明窗，防幽灵标题栏
    hasShadow: false,       // 透明窗阴影是矩形轮廓，一并关闭
    alwaysOnTop: true,
    skipTaskbar: true,      // 不出现在任务栏
    resizable: false,
    focusable: false,       // 不抢 widget 焦点
    show: false,
    webPreferences: {
      // 纯宿主 UI，不运行任何蛋代码，可放开 nodeIntegration
      nodeIntegration: true,
      contextIsolation: false
    }
  })
  ctrlByWidget.set(widget.id, ctrl)
  widgetByCtrl.set(ctrl.id, widget)

  void ctrl.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(CTRL_HTML))

  // 同步初始置顶状态
  ctrl.webContents.once('did-finish-load', () => {
    if (!widget.isDestroyed() && !ctrl.isDestroyed()) {
      ctrl.webContents.send('ctrl:pinState', widget.isAlwaysOnTop())
    }
  })

  // widget 被激活（如点击蛋内容）会升到置顶带最上方，可能盖住翻转进窗内的卫星窗 → 重新置顶
  widget.on('focus', () => { if (!ctrl.isDestroyed() && ctrl.isVisible()) ctrl.moveTop() })
  // widget 失焦/最小化时收起卫星窗，避免悬浮在其它应用上方
  widget.on('blur', () => scheduleHide(widget.id))
  widget.on('minimize', () => { cancelHide(widget.id); if (!ctrl.isDestroyed()) ctrl.hide() })

  widget.on('closed', () => {
    endDrag(widget.id)
    cancelHide(widget.id)
    ctrlByWidget.delete(widget.id)
    if (!ctrl.isDestroyed()) ctrl.destroy()
  })
  ctrl.on('closed', () => {
    const w = widgetByCtrl.get(ctrl.id)
    if (w) endDrag(w.id)
    widgetByCtrl.delete(ctrl.id)
  })
}

/** 浮现卫星窗：定位到 widget 右上角外部（顶部空间不足则翻转到内侧） */
function showControl(widget: BrowserWindow): void {
  if (dragSessions.has(widget.id)) return   // 拖动中不重定位，避免卫星窗跳位
  cancelHide(widget.id)
  const ctrl = ctrlByWidget.get(widget.id)
  if (!ctrl || ctrl.isDestroyed() || widget.isDestroyed()) return

  const [wx, wy] = widget.getPosition()
  const [ww] = widget.getSize()
  const workArea = screen.getDisplayMatching(widget.getBounds()).workArea
  let cy = wy - CTRL_H - 8
  if (cy < workArea.y) cy = wy + 8          // 顶到屏幕最上方 → 翻转到窗口内顶部
  const cx = wx + ww - CTRL_W

  ctrl.setBounds({ x: cx, y: cy, width: CTRL_W, height: CTRL_H })
  ctrl.moveTop()              // 翻转到 widget 内顶部时会与 widget 重叠，确保卫星窗层级在 widget 之上
  ctrl.showInactive()
}

function scheduleHide(widgetId: number): void {
  if (dragSessions.has(widgetId)) return    // 拖动中不隐藏
  cancelHide(widgetId)
  const t = setTimeout(() => {
    hideTimers.delete(widgetId)
    const ctrl = ctrlByWidget.get(widgetId)
    if (ctrl && !ctrl.isDestroyed()) ctrl.hide()
  }, 350)
  hideTimers.set(widgetId, t)
}

function cancelHide(widgetId: number): void {
  const t = hideTimers.get(widgetId)
  if (t) { clearTimeout(t); hideTimers.delete(widgetId) }
}

/** 开始拖动：记录光标/窗口基准，主进程 16ms 轮询光标位置，widget 精确跟随光标，卫星窗保持相对偏移 */
function startDrag(widget: BrowserWindow, ctrl: BrowserWindow): void {
  endDrag(widget.id)                        // 清理可能残留的上一会话
  cancelHide(widget.id)
  const cur = screen.getCursorScreenPoint()
  const [wx, wy] = widget.getPosition()
  const [ww, wh] = widget.getSize()         // 拖拽开始时锁定尺寸，全程不变
  const session: DragSession = {
    startCursor: [cur.x, cur.y],
    startWidget: [wx, wy],
    size: [ww, wh],
    timer: setInterval(() => {
      if (widget.isDestroyed() || ctrl.isDestroyed()) { endDrag(widget.id); return }
      const p = screen.getCursorScreenPoint()
      let nx = session.startWidget[0] + p.x - session.startCursor[0]
      let ny = session.startWidget[1] + p.y - session.startCursor[1]
      // 屏幕边缘钳制：不拖出显示器工作区（窗口比工作区还大时不钳制，避免死锁）
      const workArea = screen.getDisplayMatching(widget.getBounds()).workArea
      const maxX = workArea.x + workArea.width - session.size[0]
      const maxY = workArea.y + workArea.height - session.size[1]
      if (maxX >= workArea.x) nx = Math.min(Math.max(nx, workArea.x), maxX)
      if (maxY >= workArea.y) ny = Math.min(Math.max(ny, workArea.y), maxY)
      // 坐标没变就不搬，减少高频 setBounds 调用
      const [curX, curY] = widget.getPosition()
      if (nx !== curX || ny !== curY) {
        // Electron 远古 bug：Windows「缩放与布局」≠100% 时 setPosition 会让窗口尺寸跟随放大（吹气球）。
        // 主流解法：改用 setBounds 把宽高一起传入锁死，位置移动的同时尺寸保持不变。
        widget.setBounds({ x: nx, y: ny, width: session.size[0], height: session.size[1] })
        // 卫星窗与 showControl 同规则定位：默认 widget 上方，顶部空间不足翻转到窗口内顶部，
        // 避免拖到屏幕顶部时卫星窗被带出画面（一旦被带出，hover 事件链路难以再把它唤回）
        let ctrlY = ny - CTRL_H - 8
        if (ctrlY < workArea.y) ctrlY = ny + 8
        ctrl.setBounds({ x: nx + session.size[0] - CTRL_W, y: ctrlY, width: CTRL_W, height: CTRL_H })
        ctrl.moveTop()        // 翻转进窗内时与 widget 重叠，保持卫星窗层级在 widget 之上
      }
    }, 16)
  }
  dragSessions.set(widget.id, session)
}

function endDrag(widgetId: number): void {
  const s = dragSessions.get(widgetId)
  if (s) { clearInterval(s.timer); dragSessions.delete(widgetId) }
}
