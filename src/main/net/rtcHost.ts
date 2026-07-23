/**
 * 隐藏 WebRTC 宿主窗。
 * 主进程是 Node，没有 RTCPeerConnection——借一个隐藏渲染进程承载 Chromium 原生 WebRTC。
 * 隐藏窗内运行"哑引擎"：只管连接/DataChannel 的创建与收发，路由决策全在 coordinator。
 */
import { BrowserWindow, app, ipcMain } from 'electron'
import path from 'node:path'

export interface RtcEvents {
  /** DataChannel 就绪 */
  onOpen: (connId: string) => void
  /** 收到对端消息 */
  onMessage: (connId: string, data: string) => void
  /** 连接断开 */
  onClose: (connId: string) => void
  /** 连接出错 */
  onError: (connId: string, error: string) => void
}

let win: BrowserWindow | null = null
let ready = false
let pendingReady: (() => void)[] = []
let events: RtcEvents | null = null
let reqSeq = 0
const pendingReqs = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()

/** 向隐藏窗发命令并等待应答（webContents.invoke 类型缺失，用 send+handle 应答模式） */
function rtcInvoke(cmd: string, ...args: unknown[]): Promise<unknown> {
  const reqId = `r${++reqSeq}`
  return new Promise((resolve, reject) => {
    pendingReqs.set(reqId, { resolve, reject })
    win!.webContents.send('rtc:cmd', reqId, cmd, ...args)
    setTimeout(() => {
      if (pendingReqs.has(reqId)) {
        pendingReqs.delete(reqId)
        reject(new Error(`rtc command timeout: ${cmd}`))
      }
    }, 10000)
  })
}

function ensureWindow(): void {
  if (win && !win.isDestroyed()) return
  ready = false
  win = new BrowserWindow({
    width: 200,
    height: 200,
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // 隐藏窗必须禁用节流，否则后台 DataChannel 事件会被延迟
      backgroundThrottling: false,
      preload: path.join(__dirname, '../../preload/rtcHost.js')
    }
  })
  win.loadFile(path.join(app.getAppPath(), 'src', 'renderer', 'rtc-host', 'index.html'))
  win.on('closed', () => { win = null; ready = false })
}

function whenReady(): Promise<void> {
  if (ready) return Promise.resolve()
  return new Promise(resolve => pendingReady.push(resolve))
}

/** 初始化隐藏窗 + 注册事件上行通道 */
export async function init(evts: RtcEvents): Promise<void> {
  events = evts
  ensureWindow()

  ipcMain.on('rtc:event', (_e, connId: string, type: string, payload: string) => {
    if (!events) return
    switch (type) {
      case 'open': events.onOpen(connId); break
      case 'message': events.onMessage(connId, payload); break
      case 'close': events.onClose(connId); break
      case 'error': events.onError(connId, payload); break
    }
  })

  ipcMain.on('rtc:ready', () => {
    ready = true
    for (const resolve of pendingReady) resolve()
    pendingReady = []
  })

  ipcMain.handle('rtc:reply', (_e, reqId: string, error: string | null, result: unknown) => {
    const pending = pendingReqs.get(reqId)
    if (!pending) return
    pendingReqs.delete(reqId)
    if (error) pending.reject(new Error(error))
    else pending.resolve(result)
  })

  await whenReady()
}

/** host 侧：创建连接 + DataChannel，生成完整 offer（non-trickle，含 ICE） */
export async function createOffer(connId: string): Promise<string> {
  await whenReady()
  return rtcInvoke('createOffer', connId) as Promise<string>
}

/** host 侧：应用 joiner 的 answer */
export async function acceptAnswer(connId: string, sdp: string): Promise<void> {
  await whenReady()
  await rtcInvoke('acceptAnswer', connId, sdp)
}

/** joiner 侧：接受 offer，生成完整 answer（non-trickle，含 ICE） */
export async function acceptOffer(connId: string, sdp: string): Promise<string> {
  await whenReady()
  return rtcInvoke('acceptOffer', connId, sdp) as Promise<string>
}

/** 通过 DataChannel 发送消息 */
export async function send(connId: string, data: string): Promise<void> {
  await whenReady()
  await rtcInvoke('send', connId, data)
}

/** 关闭指定连接 */
export async function closeConnection(connId: string): Promise<void> {
  await whenReady()
  await rtcInvoke('close', connId)
}

export function shutdown(): void {
  if (win && !win.isDestroyed()) win.destroy()
  win = null
  ready = false
  events = null
}
