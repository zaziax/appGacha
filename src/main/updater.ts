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
import { markQuitting } from './shelfWindow'
import { isGachaBusy } from './pipeline'
import fs from 'node:fs'
import path from 'node:path'

// 最新已知状态（供渲染进程查询）
let currentStatus: UpdateStatus = { stage: 'idle', checked: false }
let updateCheckTimer: ReturnType<typeof setInterval> | null = null
let firstTimer: ReturnType<typeof setTimeout> | null = null
let initialized = false
let checking = false
let installingUpdate = false

export interface UpdateStatus {
  stage: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error'
  version?: string
  percent?: number
  error?: string
  checked?: boolean
  releaseNotes?: string
  releaseDate?: string
}

function notes(value: unknown): string {
  if (typeof value === 'string') return value.slice(0, 12000)
  if (Array.isArray(value)) return value.map(item => `${item.version ?? ''}\n${item.note ?? ''}`).join('\n\n').slice(0, 12000)
  return ''
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

  if (initialized) return
  initialized = true

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = false

  autoUpdater.on('checking-for-update', () => {
    logLine('[updater] checking')
    currentStatus = { stage: 'checking', checked: false }
    pushStatus(currentStatus)
  })

  autoUpdater.on('update-available', info => {
    logLine('[updater] available:', info.version)
    pushStatus({ stage: 'available', version: info.version, releaseNotes: notes(info.releaseNotes), releaseDate: info.releaseDate })
  })

  autoUpdater.on('update-not-available', () => {
    logLine('[updater] up to date')
    currentStatus = { stage: 'idle', checked: true }
    pushStatus(currentStatus)
  })

  autoUpdater.on('download-progress', ({ percent }) => {
    logLine('[updater] download:', `${Math.round(percent)}%`)
    pushStatus({ stage: 'downloading', percent: Math.round(percent) })
  })

  autoUpdater.on('update-downloaded', info => {
    logLine('[updater] downloaded:', info.version)
    pushStatus({ stage: 'downloaded', version: info.version, releaseNotes: notes(info.releaseNotes), releaseDate: info.releaseDate })
    // 不再弹原生 dialog；渲染进程监听 update:stateChanged 自行弹窗
  })

  autoUpdater.on('error', err => {
    logLine('[updater] error:', err.message)
    pushStatus({ stage: 'error', error: err.message })
  })

  // 首次延迟 10s 给启动让路；之后每 4 小时
  firstTimer = setTimeout(() => {
    firstTimer = null
    if (getAppSettings().autoUpdate) void checkForUpdatesNow()
    updateCheckTimer = setInterval(() => {
      if (getAppSettings().autoUpdate) {
        void checkForUpdatesNow()
      }
    }, 4 * 3600 * 1000)
  }, 10_000)
}

export function stopAutoUpdater(): void {
  if (firstTimer) clearTimeout(firstTimer)
  firstTimer = null
  if (updateCheckTimer) {
    clearInterval(updateCheckTimer)
    updateCheckTimer = null
  }
}

/** 手动触发检查（设置面板「检查更新」按钮调用） */
export async function checkForUpdatesNow(): Promise<void> {
  if (!app.isPackaged) {
    pushStatus({ stage: 'idle', checked: false })
    return
  }
  initAutoUpdater()
  if (checking || currentStatus.stage === 'downloading' || currentStatus.stage === 'downloaded') return
  checking = true
  try {
    await autoUpdater.checkForUpdates()
    // 事件回调自动推送状态
  } catch (e) {
    pushStatus({ stage: 'error', error: (e as Error).message })
  } finally { checking = false }
}

/** 重启安装更新 */
export function installUpdateNow(): void {
  if (currentStatus.stage !== 'downloaded') throw new Error('Update is not ready / 更新尚未下载完成')
  if (isGachaBusy()) throw new Error('Finish or cancel the current build before restarting / 请先完成或取消当前构建')
  // Only an updater-driven install creates this marker. Fresh installations
  // therefore do not get an irrelevant "what's new" modal.
  if (currentStatus.version) {
    try {
      fs.writeFileSync(path.join(app.getPath('userData'), 'release-pending.txt'), currentStatus.version.replace(/^v/, ''))
    } catch (error) {
      logLine('[updater] could not persist release marker:', (error as Error).message)
    }
  }
  markQuitting()
  installingUpdate = true
  stopAutoUpdater()
  autoUpdater.quitAndInstall()
}

/** A first quit may be paused while open eggs are flushed to disk/cloud. */
export function continueUpdateInstallAfterCleanup(): boolean {
  if (!installingUpdate) return false
  autoUpdater.quitAndInstall()
  return true
}

/** 返回当前更新状态（供渲染进程初始化查询） */
export function getCurrentUpdateStatus(): UpdateStatus {
  return currentStatus
}
