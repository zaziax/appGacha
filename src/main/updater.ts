/**
 * 自动更新 — electron-updater + GitHub Releases
 *
 * 策略：启动后 10 秒首次检查，之后每 4 小时一次。
 * 检测到新版本自动后台下载，完成后通过 IPC 推送渲染进程（不再弹原生 dialog）。
 * 仅打包版生效，dev 模式跳过。受 settings.autoUpdate 控制。
 */
import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import { logLine } from './log'
import { sendToShelf } from './shelfWindow'
import { getAppSettings } from './settings'

// 最新已知状态（供渲染进程查询）
let currentStatus: UpdateStatus = { stage: 'idle' }
let updateCheckTimer: ReturnType<typeof setInterval> | null = null

export interface UpdateStatus {
  stage: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error'
  version?: string
  percent?: number
  error?: string
}

function pushStatus(patch: Partial<UpdateStatus>): void {
  currentStatus = { ...currentStatus, ...patch }
  sendToShelf('update:stateChanged', currentStatus)
}

export function initAutoUpdater(): void {
  if (!app.isPackaged) {
    logLine('[updater] dev mode — skip')
    return
  }

  if (!getAppSettings().autoUpdate) {
    logLine('[updater] auto-update disabled in settings')
    return
  }

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => {
    logLine('[updater] checking')
    pushStatus({ stage: 'checking' })
  })

  autoUpdater.on('update-available', info => {
    logLine('[updater] available:', info.version)
    pushStatus({ stage: 'available', version: info.version })
  })

  autoUpdater.on('update-not-available', () => {
    logLine('[updater] up to date')
    pushStatus({ stage: 'idle' })
  })

  autoUpdater.on('download-progress', ({ percent }) => {
    logLine('[updater] download:', `${Math.round(percent)}%`)
    pushStatus({ stage: 'downloading', percent: Math.round(percent) })
  })

  autoUpdater.on('update-downloaded', info => {
    logLine('[updater] downloaded:', info.version)
    pushStatus({ stage: 'downloaded', version: info.version })
    // 不再弹原生 dialog；渲染进程监听 update:stateChanged 自行弹窗
  })

  autoUpdater.on('error', err => {
    logLine('[updater] error:', err.message)
    pushStatus({ stage: 'error', error: err.message })
  })

  // 首次延迟 10s 给启动让路；之后每 4 小时
  setTimeout(() => {
    autoUpdater.checkForUpdates()
    updateCheckTimer = setInterval(() => {
      if (getAppSettings().autoUpdate) {
        autoUpdater.checkForUpdates()
      }
    }, 4 * 3600 * 1000)
  }, 10_000)
}

export function stopAutoUpdater(): void {
  if (updateCheckTimer) {
    clearInterval(updateCheckTimer)
    updateCheckTimer = null
  }
}

/** 手动触发检查（设置面板「检查更新」按钮调用） */
export async function checkForUpdatesNow(): Promise<void> {
  if (!app.isPackaged) {
    pushStatus({ stage: 'idle' })
    return
  }
  try {
    await autoUpdater.checkForUpdates()
    // 事件回调自动推送状态
  } catch (e) {
    pushStatus({ stage: 'error', error: (e as Error).message })
  }
}

/** 重启安装更新 */
export function installUpdateNow(): void {
  autoUpdater.quitAndInstall()
}

/** 返回当前更新状态（供渲染进程初始化查询） */
export function getCurrentUpdateStatus(): UpdateStatus {
  return currentStatus
}
