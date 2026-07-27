import { app, safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

export interface AiSettings {
  baseURL: string
  model: string
  apiKey: string
  /** 模型上下文窗口大小（token）。未配置时默认 128000。影响机芯上下文压缩策略。 */
  contextTokens?: number
}

interface SettingsFile {
  ai?: {
    baseURL: string
    model: string
    apiKeyEnc?: string   // safeStorage 加密后的 base64
    apiKeyPlain?: string // 系统不支持加密时的降级（提示用户知情）
    contextTokens?: number
  }
  /** 应用级设置 */
  app?: {
    /** 登录时自动启动主应用 */
    autoStartApp?: boolean
    /** 关窗口时最小化到托盘（而非退出） */
    minimizeToTray?: boolean
  }
  /** 逐蛋自启动覆盖（eggId → bool）。未列出的蛋用 manifest.window.autoStart 出厂默认值 */
  eggAutoStart?: Record<string, boolean>
}

function settingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json')
}

function readFile(): SettingsFile {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), 'utf-8'))
  } catch {
    return {}
  }
}

function writeFile(data: SettingsFile): void {
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true })
  const tmp = settingsPath() + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8')
  fs.renameSync(tmp, settingsPath())
}

export function getAiSettings(): AiSettings | null {
  const f = readFile()
  if (!f.ai?.baseURL || !f.ai?.model) return null
  let apiKey = ''
  if (f.ai.apiKeyEnc && safeStorage.isEncryptionAvailable()) {
    try {
      apiKey = safeStorage.decryptString(Buffer.from(f.ai.apiKeyEnc, 'base64'))
    } catch {
      apiKey = ''
    }
  } else if (f.ai.apiKeyPlain) {
    apiKey = f.ai.apiKeyPlain
  }
  return { baseURL: f.ai.baseURL, model: f.ai.model, apiKey, contextTokens: f.ai.contextTokens }
}

export function setAiSettings(s: AiSettings): void {
  const f = readFile()
  const baseURL = s.baseURL.trim().replace(/\/+$/, '')
  if (safeStorage.isEncryptionAvailable()) {
    f.ai = {
      baseURL,
      model: s.model.trim(),
      apiKeyEnc: safeStorage.encryptString(s.apiKey.trim()).toString('base64'),
      contextTokens: s.contextTokens
    }
  } else {
    f.ai = { baseURL, model: s.model.trim(), apiKeyPlain: s.apiKey.trim(), contextTokens: s.contextTokens }
  }
  writeFile(f)
}

// 给设置界面回显用：不吐 key 本体，只吐掩码
export function getAiSettingsMasked(): { baseURL: string; model: string; hasKey: boolean } | null {
  const s = getAiSettings()
  if (!s) return null
  return { baseURL: s.baseURL, model: s.model, hasKey: s.apiKey.length > 0 }
}

// ─── 应用级设置（P3 生命周期） ───

export interface AppSettings {
  autoStartApp: boolean
  minimizeToTray: boolean
}

export function getAppSettings(): AppSettings {
  const f = readFile()
  return {
    autoStartApp: f.app?.autoStartApp ?? false,
    minimizeToTray: f.app?.minimizeToTray ?? true  // 默认开启托盘常驻
  }
}

export function setAppSettings(s: Partial<AppSettings>): void {
  const f = readFile()
  f.app = { ...f.app, ...s }
  writeFile(f)
  // 同步系统级登录自启动
  if (s.autoStartApp !== undefined) {
    app.setLoginItemSettings({ openAtLogin: s.autoStartApp })
  }
}

// ─── 逐蛋自启动覆盖 ───

/** 获取某蛋的有效自启动状态：用户覆盖 > manifest 出厂默认 */
export function getEggAutoStart(eggId: string, manifestDefault: boolean): boolean {
  const f = readFile()
  return f.eggAutoStart?.[eggId] ?? manifestDefault
}

/** 设置某蛋的自启动覆盖 */
export function setEggAutoStart(eggId: string, enabled: boolean): void {
  const f = readFile()
  if (!f.eggAutoStart) f.eggAutoStart = {}
  f.eggAutoStart[eggId] = enabled
  writeFile(f)
}

/** 获取所有蛋的自启动覆盖表 */
export function getAllEggAutoStart(): Record<string, boolean> {
  return readFile().eggAutoStart ?? {}
}
