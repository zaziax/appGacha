export interface EggInfo {
  eggId: string
  name: string
  version: string
  wish: string
  permissions: string[]
  folder: string
  hasBackup: boolean
  /** 入柜时间（目录 birthtime，用于排序） */
  createdAt: number
  /** 蛋图标 SVG 原文（无图标时为空串） */
  icon?: string
  /** 窗口形态：widget 禁止进扭蛋空间 */
  windowType?: 'widget' | 'standard'
}

/** 扭蛋空间配置 */
export interface SpaceConfig {
  /** 有序蛋列表（顺序即 tab 顺序） */
  eggs: string[]
  /** 上次激活的蛋 */
  active: string | null
}

export interface EggCategory { id: string; name: string }
export interface CategoryData {
  categories: EggCategory[]
  /** eggId → categoryId，未出现 = 未分类 */
  assignments: Record<string, string>
}

export interface CloudEggInfo {
  egg_id: string
  egg_name: string
  icon?: string | null  // SVG 原文（蛋的应用图标）
  version: number
  size_bytes: number | null
  updated_at: string | null
}

export interface SyncEggResult {
  eggId: string
  action: 'uploaded' | 'downloaded' | 'skipped' | 'error'
  error?: string
}

export type SyncStatus = 'local' | 'synced' | 'syncing' | 'error'

/**
 * 主进程发来的文案载体：i18n 键 + 插值参数（渲染端用 tr() 翻译），
 * 或裸字符串（AI 原始输出、技术性错误诊断，原样展示）。与主进程 fcDriver.ts 的同名类型镜像。
 */
export type IpcText = { key: string; params?: Record<string, string | number> } | string

export interface GachaActivity {
  type: 'think' | 'tool' | 'write' | 'check' | 'retry' | 'error'
  text: IpcText
  /** 同 id 的条目原地替换（流式思考实时更新） */
  id?: string
}

export interface GachaProgress {
  stage: 'coin' | 'crank' | 'clack' | 'pop' | 'fail' | 'cancelled'
  detail?: IpcText
  activity?: GachaActivity
  /** 进度量化：当前回合/总回合 + 当前轮次/总轮次 */
  metrics?: { turn: number; maxTurns: number; round: number; maxRounds: number }
}

export interface GachaResult {
  ok: boolean
  eggId?: string
  name?: string
  error?: IpcText
  upgraded?: boolean
  /** 蛋图标 SVG 原文——开蛋仪式爆出用（缺失时为空串） */
  icon?: string
}

export interface AiSettingsMasked {
  baseURL: string
  model: string
  hasKey: boolean
  providerId?: string
  contextTokens?: number
}

export interface WindowState { maximized: boolean }

export interface WishQuestion { text: string; options: string[] }
export interface WishChatResult { done: boolean; questions: WishQuestion[]; styleNote?: string }

export interface AppSettings {
  autoStartApp: boolean
  minimizeToTray: boolean
  /** 界面音效（默认开） */
  soundEnabled: boolean
  /** 自动检查更新（默认开） */
  autoUpdate: boolean
  /** 应用版本号（只读） */
  version?: string
}

export interface DownloadProgress {
  eggId: string
  percent: number
  stage: 'downloading' | 'installing' | 'done'
  error?: string
}

export interface UpdateStatus {
  stage: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error'
  version?: string
  percent?: number
  error?: string
}

export interface AuthStatus {
  loggedIn: boolean
  user?: { id: string; email: string; name: string; avatar_url: string | null }
}

export interface UserProfile {
  id: string
  email: string
  name: string
  avatar_url: string | null
  created_at: string | null
  subscriptions: { plan: string; status: string; expires_at: string | null }[]
}

/** 计费总览（后端 GET /billing/summary）：订阅 + 积分余额 + 套餐配额 + 云存储用量 */
export interface BillingSummary {
  subscription: { plan: string; status: string; provider?: string; expires_at: string | null }
  credits: { balance: number }
  plan: {
    plan_id: string
    display_name: string
    storage_quota_bytes: number
    storage_used: number
    monthly_credits: number
  } | null
}

/** 积分流水条目（后端 GET /billing/credits） */
export interface CreditTx {
  id: string
  delta: number
  balance_after: number
  reason: string
  ref_id: string | null
  created_at: string | null
}

/** 断点续建：主进程发来的待续建构建信息 */
export interface PendingBuild {
  eggId: string
  wish: string
  turns: number
  rounds: number
  errorKey: string
  isUpgrade: boolean
  realEggId: string
  upgradeName: string
  createdAt: string
}

export interface ShelfBridge {
  list(): Promise<EggInfo[]>
  open(eggId: string): Promise<void>
  import(): Promise<{ imported: boolean; name?: string }>
  export(eggId: string, includeData: boolean): Promise<{ exported: boolean; dest?: string }>
  shortcut(eggId: string, iconPngs?: Record<number, string>): Promise<{ created: boolean; path?: string }>
  trash(eggId: string): Promise<void>
  rollback(eggId: string): Promise<{ name: string }>
  wish(text: string, lang: string): Promise<{ started: boolean }>
  upgrade(eggId: string, text: string, lang: string): Promise<{ started: boolean }>
  /** 取消正在进行的扭蛋/升级生成 */
  cancelGacha(): Promise<void>
  /** 断点续建：查询是否有待续建的构建（返回 null 表示没有） */
  getPendingBuild(): Promise<PendingBuild | null>
  /** 断点续建：从指定断点继续构建 */
  resumeBuild(eggId: string): Promise<{ started: boolean }>
  /** 断点续建：放弃断点，清理 staging 目录 */
  abandonBuild(eggId: string): Promise<{ ok: boolean }>
  wishChat(messages: { role: string; content: string }[], context?: { upgradeEggId?: string }): Promise<WishChatResult>
  wishSuggest(lang: string): Promise<{ suggestions: string[] }>
  getAiSettings(): Promise<AiSettingsMasked | null>
  saveAiSettings(s: { baseURL: string; model: string; apiKey: string; providerId?: string; contextTokens?: number; noKey?: boolean }): Promise<void>
  fetchModels(p?: { baseURL?: string; apiKey?: string; providerId?: string }): Promise<{ models: string[] }>
  hasProviderKey(providerId: string): Promise<{ hasKey: boolean }>
  clearProviderKey(providerId: string): Promise<{ ok: boolean }>
  getAppSettings(): Promise<AppSettings>
  setAppSettings(s: { autoStartApp?: boolean; minimizeToTray?: boolean; soundEnabled?: boolean; autoUpdate?: boolean }): Promise<void>
  setLang(lang: 'en' | 'zh'): Promise<void>
  getEggAutoStart(eggId: string): Promise<boolean>
  setEggAutoStart(eggId: string, enabled: boolean): Promise<void>
  getSyncDisabled(eggId: string): Promise<boolean>
  setSyncDisabled(eggId: string, disabled: boolean): Promise<void>
  getCategories(): Promise<CategoryData>
  saveCategory(c: { id?: string; name: string }): Promise<EggCategory>
  deleteCategory(id: string): Promise<void>
  setEggCategory(eggId: string, categoryId: string | null): Promise<void>
  // ─── 扭蛋空间（GachaSpace）───
  spaceGet(): Promise<SpaceConfig>
  spaceAdd(eggId: string): Promise<SpaceConfig>
  spaceRemove(eggId: string): Promise<SpaceConfig>
  spaceConfigure(config: { eggs: string[]; active?: string | null }): Promise<SpaceConfig>
  spaceReorder(ids: string[]): Promise<SpaceConfig>
  spaceActivate(eggId: string): Promise<void>
  spaceSetBounds(b: { x: number; y: number; width: number; height: number }): Promise<void>
  spaceSetVisible(v: boolean): Promise<void>
  /** 外部唤起聚焦空间：切到空间视图 */
  onSpaceFocus(cb: (p: { eggId: string }) => void): void
  // ─── Google OAuth ───
  authStatus(): Promise<AuthStatus>
  authLogin(): Promise<{ ok: boolean; error?: string }>
  authLogout(): Promise<void>
  authProfile(): Promise<UserProfile>
  billingSummary(): Promise<BillingSummary>
  billingCredits(): Promise<{ balance: number; txs: CreditTx[] }>
  openPricing(): Promise<{ ok: boolean }>
  openAccount(): Promise<{ ok: boolean }>
  /** 创建 Waffo 支付会话并打开收银台（type: 'subscription' | 'credits'） */
  checkout(type: string, packId?: string): Promise<{ ok: boolean; error?: string }>
  serverHealth(): Promise<{ ok: boolean }>
  // ─── 邮箱验证码登录 ───
  sendCode(email: string): Promise<{ ok: boolean }>
  verifyCode(email: string, code: string): Promise<{ ok: boolean; hasPassword?: boolean }>
  // ─── 密码登录 ───
  loginPassword(email: string, password: string): Promise<{ ok: boolean }>
  setPassword(password: string, oldPassword?: string): Promise<{ ok: boolean }>
  resetPassword(email: string, code: string, newPassword: string): Promise<{ ok: boolean }>
  // ─── 云同步 ───
  syncEgg(eggId: string): Promise<SyncEggResult>
  syncList(): Promise<CloudEggInfo[]>
  syncDownload(eggId: string): Promise<{ name: string; eggId: string }>
  syncDeleteCloud(eggId: string): Promise<boolean>
  setSyncEnabled(v: boolean): Promise<void>
  onAuthChanged(cb: (s: { loggedIn: boolean }) => void): void
  onGachaProgress(cb: (p: GachaProgress) => void): void
  onGachaDone(cb: (r: GachaResult) => void): void
  /** 平台通道构建完成后的积分结算通知（本次消耗 + 剩余余额） */
  onBillingSettled(cb: (p: { spent: number; balance: number }) => void): void
  /** 下载进度推送 */
  onDownloadProgress(cb: (p: DownloadProgress) => void): void
  /** 蛋柜变动（双击 .gacha 热导入等）：重拉列表 */
  onEggsChanged(cb: () => void): void
  /** .gacha 导入冲突：主进程推送后 UI 弹窗询问 */
  onImportConflict(cb: (p: { file: string; eggId: string; name: string }) => void): void
  /** 导入冲突回传选择：open=打开现有，import=导入为新副本 */
  resolveImportConflict(file: string, eggId: string, action: 'open' | 'import'): Promise<void>
  onClosePrompt(cb: () => void): void
  resolveCloseAction(action: 'tray' | 'quit', remember: boolean): Promise<void>
  minimize(): void
  maximize(): void
  close(): void
  isMaximized(): Promise<boolean>
  onWindowState(cb: (s: WindowState) => void): void
  // ─── 自动更新 ───
  checkUpdate(): Promise<void>
  getUpdateStatus(): Promise<UpdateStatus>
  installUpdate(): Promise<void>
  onUpdateStateChanged(cb: (s: UpdateStatus) => void): void
}

declare global {
  interface Window {
    shelf: ShelfBridge
  }
}

export const shelf = window.shelf
