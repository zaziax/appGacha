/**
 * 隐藏 WebRTC 宿主窗的 preload。
 * 暴露最小命令/事件桥：主进程下发 rtc:cmd，页面执行后经 rtc:reply 应答；
 * 页面事件（open/message/close/error）经 rtc:event 上行。
 */
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('rtcBridge', {
  /** 接收主进程命令 */
  onCommand: (cb: (reqId: string, cmd: string, ...args: unknown[]) => void) => {
    ipcRenderer.on('rtc:cmd', (_e, reqId: string, cmd: string, ...args: unknown[]) => cb(reqId, cmd, ...args))
  },
  /** 命令应答 */
  reply: (reqId: string, error: string | null, result?: unknown) => {
    ipcRenderer.invoke('rtc:reply', reqId, error, result)
  },
  /** 事件上行：open/message/close/error */
  emit: (connId: string, type: string, payload?: string) => {
    ipcRenderer.send('rtc:event', connId, type, payload ?? '')
  },
  /** 页面就绪通知 */
  ready: () => {
    ipcRenderer.send('rtc:ready')
  }
})
