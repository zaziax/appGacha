import { BrowserWindow, session } from 'electron'
import path from 'node:path'
import { EggContext } from './eggs'
import { registerEggProtocol, lockdownSession } from './protocol'
import * as registry from './registry'

const preparedPartitions = new Set<string>()

export function createEggWindow(egg: EggContext, opts?: { show?: boolean }): BrowserWindow {
  const partition = `persist:egg-${egg.eggId}`
  const ses = session.fromPartition(partition)
  if (!preparedPartitions.has(partition)) {
    registerEggProtocol(ses)
    lockdownSession(ses)
    preparedPartitions.add(partition)
  }

  const win = new BrowserWindow({
    width: 900,
    height: 640,
    show: opts?.show ?? true,
    title: egg.manifest.name,
    autoHideMenuBar: true,
    webPreferences: {
      // R2 前提：沙箱三件套，preload 是主应用的，蛋无法替换
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, '../preload/index.js'),
      partition
    }
  })

  // R2: 窗口创建时登记 webContents → 蛋，权限检查只认这张表
  const wcId = win.webContents.id
  registry.register(wcId, egg)
  win.on('closed', () => registry.unregister(wcId))

  // R4: 蛋不能创建窗口
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  win.loadURL(`egg://${egg.eggId}/index.html`)
  return win
}
