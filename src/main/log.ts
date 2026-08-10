import { app, crashReporter } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { dataRoot } from './paths'

let logFile = ''

export function logLine(...parts: unknown[]): void {
  const line = `[${new Date().toISOString()}] ${parts.map(p =>
    typeof p === 'string' ? p : JSON.stringify(p)).join(' ')}\n`
  try { fs.appendFileSync(logFile, line, 'utf-8') } catch { /* 日志尽力而为 */ }
  try { process.stdout.write(line) } catch { /* 终端不可用时静默 */ }
}

// 闪退难定位的根因：主进程异常没有出口。全部落盘到 app.log，原生崩溃留 minidump。
export function initLogging(): void {
  logFile = dataRoot('app.log')
  try { if (fs.existsSync(logFile) && fs.statSync(logFile).size > 5 * 1024 * 1024) fs.rmSync(logFile) } catch { /* 忽略 */ }
  // 写入 UTF-8 BOM，确保 Windows 工具（Get-Content、记事本等）按 UTF-8 解码，中文不乱码
  if (!fs.existsSync(logFile)) {
    try { fs.writeFileSync(logFile, '﻿', 'utf-8') } catch { /* 尽力而为 */ }
  }

  // 原生层崩溃（C++/native 模块）只有 minidump 能留证据
  crashReporter.start({ submitURL: '', uploadToServer: false })

  logLine('===== app start =====', `electron=${process.versions.electron}`, `crashDumps=${app.getPath('crashDumps')}`)

  for (const method of ['log', 'warn', 'error'] as const) {
    console[method] = (...args: unknown[]) => {
      // logLine 会同时写文件和终端，不用再调 original 避免重复
      logLine(`console.${method}:`, ...args)
    }
  }

  process.on('uncaughtException', e => {
    logLine('uncaughtException:', e.stack ?? e.message)
  })
  process.on('unhandledRejection', reason => {
    logLine('unhandledRejection:', reason instanceof Error ? reason.stack ?? reason.message : String(reason))
  })
  app.on('render-process-gone', (_e, wc, details) => {
    logLine('render-process-gone:', { url: wc.getURL(), ...details })
  })
  app.on('child-process-gone', (_e, details) => {
    logLine('child-process-gone:', details)
  })
  app.on('before-quit', () => logLine('before-quit'))
  process.on('exit', code => logLine('process exit', code))
}

export function logPath(): string {
  return logFile
}
