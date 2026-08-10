/**
 * 自动更新 — electron-updater + GitHub Releases
 *
 * 策略：启动后 10 秒首次检查，之后每 4 小时一次。
 * 检测到新版本自动后台下载，完成后通知用户重启安装。
 * 仅打包版生效，dev 模式跳过。
 */
import { app, dialog } from 'electron'
import { autoUpdater } from 'electron-updater'
import { logLine } from './log'

let updateCheckTimer: ReturnType<typeof setInterval> | null = null

export function initAutoUpdater(): void {
  if (!app.isPackaged) return

  // GitHub Releases 分发，发布时 electron-builder 自动上传 latest.yml
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => {
    logLine('[updater] checking')
  })

  autoUpdater.on('update-available', info => {
    logLine('[updater] available:', info.version)
  })

  autoUpdater.on('update-not-available', () => {
    logLine('[updater] up to date')
  })

  autoUpdater.on('download-progress', ({ percent }) => {
    logLine('[updater] download:', `${Math.round(percent)}%`)
  })

  autoUpdater.on('update-downloaded', info => {
    logLine('[updater] downloaded:', info.version)
    dialog
      .showMessageBox({
        type: 'info',
        title: '新版本已就绪',
        message: `AppGacha ${info.version} 已下载完成。`,
        detail: '立即重启并安装更新？',
        buttons: ['重启安装', '稍后提醒'],
        defaultId: 0,
      })
      .then(({ response }) => {
        if (response === 0) {
          autoUpdater.quitAndInstall()
        }
      })
  })

  autoUpdater.on('error', err => {
    logLine('[updater] error:', err.message)
  })

  // 首次延迟 10s，给启动让路；之后每 4 小时
  setTimeout(() => {
    autoUpdater.checkForUpdates()
    updateCheckTimer = setInterval(() => autoUpdater.checkForUpdates(), 4 * 3600 * 1000)
  }, 10_000)
}

export function stopAutoUpdater(): void {
  if (updateCheckTimer) {
    clearInterval(updateCheckTimer)
    updateCheckTimer = null
  }
}
