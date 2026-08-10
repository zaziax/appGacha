import { app, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import { eggIcoPath } from './ico'

/**
 * 注册 appgacha:// 协议 + .gacha 文件关联。
 * Windows 走 HKCU 注册表（免管理员），启动时幂等写入。
 */
export function registerAssociations(): void {
  if (app.isPackaged) {
    if (!app.isDefaultProtocolClient('appgacha')) {
      app.setAsDefaultProtocolClient('appgacha')
    }
  } else {
    // 开发模式：每次启动都重新注册（路径可能变动）
    app.setAsDefaultProtocolClient('appgacha', process.execPath, [app.getAppPath()])
  }
  if (process.platform === 'win32') registerWindowsFileAssoc()
}

function registerWindowsFileAssoc(): void {
  const exe = process.execPath
  // 开发态：electron.exe 需要带上应用路径；打包后直接是应用 exe
  const openCmd = app.isPackaged
    ? `"${exe}" "%1"`
    : `"${exe}" "${app.getAppPath()}" "%1"`
  try {
    execFileSync('reg', ['add', 'HKCU\\Software\\Classes\\.gacha', '/ve', '/t', 'REG_SZ', '/d', 'AppGacha.EggFile', '/f'], { windowsHide: true })
    execFileSync('reg', ['add', 'HKCU\\Software\\Classes\\AppGacha.EggFile', '/ve', '/t', 'REG_SZ', '/d', '扭蛋应用', '/f'], { windowsHide: true })
    execFileSync('reg', ['add', 'HKCU\\Software\\Classes\\AppGacha.EggFile\\shell\\open\\command', '/ve', '/t', 'REG_SZ', '/d', openCmd, '/f'], { windowsHide: true })
  } catch (e) {
    console.error('[assoc] 注册表写入失败:', (e as Error).message)
  }
}

/**
 * 为蛋创建桌面快捷方式（.lnk），双击通过 appgacha://egg/<eggId> 唤起。
 * 图标优先使用蛋专属图标（渲染进程离屏渲染产出的 icon.ico），无则回退到 exe。
 *
 * Windows：临时 .ps1 文件 + PowerShell 执行，利用 WSH COM 创建快捷方式。
 * 注意：.ps1 必须带 UTF-8 BOM，否则 PowerShell 无法正确读取中文路径。
 * 非 Windows：回退到 Electron shell.writeShortcutLink（icon 参数受限，仅 exe）。
 */
export function createEggShortcut(name: string, eggId: string, eggDir: string): string {
  // macOS 不支持 .lnk 快捷方式——UI 层已隐藏入口，此处是后端兜底
  if (process.platform === 'darwin') {
    throw new Error('Desktop shortcuts are not supported on macOS')
  }

  const desktop = app.getPath('desktop')
  const lnk = path.join(desktop, `${name}.lnk`)
  const exe = process.execPath
  const url = `appgacha://egg/${eggId}`
  const args = app.isPackaged ? url : `"${app.getAppPath()}" ${url}`
  const icon = eggIcoPath(eggDir) ?? exe

  if (process.platform !== 'win32') {
    const ok = shell.writeShortcutLink(lnk, { target: exe, args, icon: exe })
    if (!ok) throw new Error('创建快捷方式失败')
    return lnk
  }

  const esc = (s: string) => s.replace(/'/g, "''")
  const psScript = [
    `$wsh = New-Object -ComObject WScript.Shell`,
    `$sc = $wsh.CreateShortcut('${esc(lnk)}')`,
    `$sc.TargetPath = '${esc(exe)}'`,
    `$sc.Arguments = '${esc(args)}'`,
    `$sc.IconLocation = '${esc(icon)}'`,
    `$sc.Save()`,
  ].join('\n')

  const tmpPs1 = path.join(os.tmpdir(), `gacha-shortcut-${Date.now()}.ps1`)
  try {
    // UTF-8 BOM 确保 PowerShell 正确识别中文路径
    const BOM = Buffer.from([0xEF, 0xBB, 0xBF])
    fs.writeFileSync(tmpPs1, Buffer.concat([BOM, Buffer.from(psScript, 'utf-8')]))
    execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tmpPs1], {
      windowsHide: true,
      timeout: 10000,
    })
  } finally {
    fs.rmSync(tmpPs1, { force: true })
  }
  return lnk
}
