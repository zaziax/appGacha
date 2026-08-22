import { app, safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { makeError, ErrorCode } from '../shared/types'

export interface AiSettings {
  baseURL: string
  model: string
  apiKey: string
  /** 模型上下文窗口大小（token）。未配置时默认 128000。影响机芯上下文压缩策略。 */
  contextTokens?: number
  /** 预设平台 id（deepseek/openai/qwen/kimi/zhipu/ollama/custom） */
  providerId?: string
}

interface ProviderKeyStore {
  enc?: string    // safeStorage 加密后的 base64
  plain?: string  // 系统不支持加密时的降级
}

interface SettingsFile {
  ai?: {
    baseURL: string
    model: string
    apiKeyEnc?: string   // safeStorage 加密后的 base64
    apiKeyPlain?: string // 系统不支持加密时的降级（提示用户知情）
    contextTokens?: number
    providerId?: string
  }
  /** 每个平台独立存储的 API Key（providerId → 加密 key） */
  aiKeys?: Record<string, ProviderKeyStore>
  /** 应用级设置 */
  app?: {
    /** 登录时自动启动主应用 */
    autoStartApp?: boolean
    /** 关窗口时最小化到托盘（而非退出） */
    minimizeToTray?: boolean
    /** 用户是否已明确选择过关闭行为（询问框”记住选择”或设置面板改动后置 true） */
    closeActionKnown?: boolean
    /** 界面音效开关（默认开） */
    soundEnabled?: boolean
    /** UI 语言（en / zh），默认跟随系统 */
    lang?: 'en' | 'zh'
    /** 自动检查更新（默认开） */
    autoUpdate?: boolean
  }
  /** 逐蛋自启动覆盖（eggId → bool）。未列出的蛋用 manifest.window.autoStart 出厂默认值 */
  eggAutoStart?: Record<string, boolean>
  /** 逐蛋云同步禁用（eggId → bool）。true = 不同步此蛋 */
  syncDisabled?: Record<string, boolean>
  /** 用户自定义分类 */
  categories?: { id: string; name: string }[]
  /** 蛋的分类归属（eggId → categoryId），未列出 = 未分类 */
  eggCategory?: Record<string, string>
  /** 扭蛋空间配置：有序蛋列表 + 上次激活项 */
  space?: { eggs: string[]; active?: string }
  /** widget 在本机各显示器上的宿主位置（设备相关，不参与蛋内容同步） */
  widgetPlacements?: Record<string, WidgetPlacement>
}

/** widget 的本机位置快照。相对坐标用于分辨率、任务栏和缩放变化后的安全恢复。 */
export interface WidgetPlacement {
  displayId: string
  x: number
  y: number
  width: number
  height: number
  relativeX: number
  relativeY: number
  workArea: { x: number; y: number; width: number; height: number }
  scaleFactor: number
  updatedAt: number
}

function settingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json')
}

export function readFile(): SettingsFile {
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
  // AppGacha 平台通道：无需 baseURL/model/Key，选中即用（实际调用时要求已登录）
  if (f.ai?.providerId === 'appgacha') {
    return { baseURL: '', model: '', apiKey: '', providerId: 'appgacha', contextTokens: f.ai.contextTokens }
  }
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
  return { baseURL: f.ai.baseURL, model: f.ai.model, apiKey, contextTokens: f.ai.contextTokens, providerId: f.ai.providerId }
}

export function setAiSettings(s: AiSettings): void {
  const f = readFile()
  const baseURL = s.baseURL.trim().replace(/\/+$/, '')
  const key = s.apiKey.trim()
  const pid = s.providerId || 'custom'
  if (safeStorage.isEncryptionAvailable()) {
    f.ai = {
      baseURL,
      model: s.model.trim(),
      apiKeyEnc: safeStorage.encryptString(key).toString('base64'),
      contextTokens: s.contextTokens,
      providerId: pid
    }
    // 同步写入平台独立 Key 存储
    if (key) {
      if (!f.aiKeys) f.aiKeys = {}
      f.aiKeys[pid] = { enc: safeStorage.encryptString(key).toString('base64') }
    }
  } else {
    f.ai = { baseURL, model: s.model.trim(), apiKeyPlain: key, contextTokens: s.contextTokens, providerId: pid }
    if (key) {
      if (!f.aiKeys) f.aiKeys = {}
      f.aiKeys[pid] = { plain: key }
    }
  }
  writeFile(f)
}

// 给设置界面回显用：不吐 key 本体，只吐掩码
export function getAiSettingsMasked(): { baseURL: string; model: string; hasKey: boolean; providerId?: string; contextTokens?: number } | null {
  const s = getAiSettings()
  if (!s) return null
  return { baseURL: s.baseURL, model: s.model, hasKey: s.apiKey.length > 0, providerId: s.providerId, contextTokens: s.contextTokens }
}

/** 查询某平台是否已保存过 Key（UI 用于 placeholder 提示） */
export function hasProviderKey(providerId: string): boolean {
  const ks = readFile().aiKeys?.[providerId]
  return !!(ks?.enc || ks?.plain)
}

/** 解密某平台的已存 Key（主进程内部用，测试连接时 fallback） */
export function getProviderKey(providerId: string): string {
  const ks = readFile().aiKeys?.[providerId]
  if (!ks) return ''
  if (ks.enc && safeStorage.isEncryptionAvailable()) {
    try { return safeStorage.decryptString(Buffer.from(ks.enc, 'base64')) } catch { return '' }
  }
  return ks.plain ?? ''
}

/** 清除某平台的已存 Key；若当前活跃配置属于该平台则同步清空 */
export function clearProviderKey(providerId: string): void {
  const f = readFile()
  if (f.aiKeys?.[providerId]) {
    delete f.aiKeys[providerId]
    if (f.ai?.providerId === providerId) {
      delete f.ai.apiKeyEnc
      delete f.ai.apiKeyPlain
    }
    writeFile(f)
  }
}

// ─── 应用级设置（P3 生命周期） ───

export interface AppSettings {
  autoStartApp: boolean
  minimizeToTray: boolean
  /** 用户是否已明确选择过关闭行为（关闭时询问框的”记住选择”或设置面板改动后置 true） */
  closeActionKnown?: boolean
  /** 界面音效（默认开） */
  soundEnabled: boolean
  /** 自动检查更新（默认开） */
  autoUpdate: boolean
  /** 应用版本号（只读，由 getAppSettings 填入） */
  version?: string
}

export function getAppSettings(): AppSettings {
  const f = readFile()
  return {
    autoStartApp: f.app?.autoStartApp ?? false,
    minimizeToTray: f.app?.minimizeToTray ?? (process.platform !== 'darwin'),  // Windows 默认托盘；macOS 默认 Dock
    closeActionKnown: f.app?.closeActionKnown ?? false,
    soundEnabled: f.app?.soundEnabled ?? true,
    autoUpdate: f.app?.autoUpdate ?? true,
    version: app.getVersion()
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

/** 持久化 UI 语言设置（供主进程 i18n 读取） */
export function setLang(lang: 'en' | 'zh'): void {
  const f = readFile()
  f.app = { ...f.app, lang }
  writeFile(f)
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

/** 获取禁用了云同步的蛋 ID 集合 */
export function getSyncDisabledEggs(): Set<string> {
  const d = readFile().syncDisabled ?? {}
  return new Set(Object.entries(d).filter(([, v]) => v).map(([k]) => k))
}

/** 设置某蛋的云同步禁用状态 */
export function setSyncDisabledForEgg(eggId: string, disabled: boolean): void {
  const f = readFile()
  if (!f.syncDisabled) f.syncDisabled = {}
  f.syncDisabled[eggId] = disabled
  writeFile(f)
}

/** 查询某蛋是否禁用了云同步 */
export function isSyncDisabledForEgg(eggId: string): boolean {
  return readFile().syncDisabled?.[eggId] === true
}

// ─── 用户自定义分类 ───

export interface EggCategory { id: string; name: string }

export function getCategories(): EggCategory[] {
  return readFile().categories ?? []
}

/** 新建（无 id）或重命名（有 id）分类，返回落盘后的分类 */
export function saveCategory(c: { id?: string; name: string }): EggCategory {
  const f = readFile()
  if (!f.categories) f.categories = []
  const name = c.name.trim()
  if (!name) throw new Error(makeError(ErrorCode.CATEGORY_NAME_EMPTY, '分类名不能为空'))
  if (c.id) {
    const existing = f.categories.find(x => x.id === c.id)
    if (!existing) throw new Error(makeError(ErrorCode.CATEGORY_NOT_FOUND, '分类不存在'))
    existing.name = name
    writeFile(f)
    return existing
  }
  const cat: EggCategory = {
    id: `cat_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    name
  }
  f.categories.push(cat)
  writeFile(f)
  return cat
}

/** 删除分类并清掉其下所有蛋的归属 */
export function deleteCategory(id: string): void {
  const f = readFile()
  f.categories = (f.categories ?? []).filter(c => c.id !== id)
  if (f.eggCategory) {
    for (const [eggId, catId] of Object.entries(f.eggCategory)) {
      if (catId === id) delete f.eggCategory[eggId]
    }
  }
  writeFile(f)
}

export function getEggCategoryMap(): Record<string, string> {
  return readFile().eggCategory ?? {}
}

/** 设置某蛋的分类归属；categoryId 为 null = 移出分类 */
export function setEggCategory(eggId: string, categoryId: string | null): void {
  const f = readFile()
  if (!f.eggCategory) f.eggCategory = {}
  if (categoryId === null) delete f.eggCategory[eggId]
  else f.eggCategory[eggId] = categoryId
  writeFile(f)
}

// ─── 扭蛋空间配置 ───

export interface SpaceConfig {
  /** 有序蛋列表（顺序即 tab 顺序） */
  eggs: string[]
  /** 上次激活的蛋 */
  active: string | null
}

export function getSpaceConfig(): SpaceConfig {
  const f = readFile()
  return { eggs: f.space?.eggs ?? [], active: f.space?.active ?? null }
}

export function setSpaceConfig(c: SpaceConfig): void {
  const f = readFile()
  f.space = { eggs: c.eggs, active: c.active ?? undefined }
  writeFile(f)
}

// ─── widget 本机位置 ───

export function getWidgetPlacement(eggId: string): WidgetPlacement | null {
  return readFile().widgetPlacements?.[eggId] ?? null
}

export function setWidgetPlacement(eggId: string, placement: WidgetPlacement): void {
  const f = readFile()
  if (!f.widgetPlacements) f.widgetPlacements = {}
  f.widgetPlacements[eggId] = placement
  writeFile(f)
}
