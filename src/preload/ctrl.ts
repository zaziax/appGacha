/**
 * widget 卫星控制窗的 preload。只暴露七个窄动作给页面（window.ctrl）：
 * pin / close / onPinState / enter / leave / dragStart / dragEnd。
 * 页面脚本无 require、无 Node，控制窗与蛋窗口同样满足沙箱三件套。
 */
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('ctrl', {
  pin: () => ipcRenderer.send('ctrl:pin'),
  close: () => ipcRenderer.send('ctrl:close'),
  /** 注册置顶状态回调（contextBridge 代理是快照式，用函数注册式而非属性赋值式） */
  onPinState: (cb: (onTop: boolean) => void) => {
    ipcRenderer.on('ctrl:pinState', (_e, onTop: boolean) => cb(onTop))
  },
  enter: () => ipcRenderer.send('ctrl:enter'),
  leave: () => ipcRenderer.send('ctrl:leave'),
  dragStart: () => ipcRenderer.send('ctrl:dragStart'),
  dragEnd: () => ipcRenderer.send('ctrl:dragEnd')
})
