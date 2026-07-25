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
