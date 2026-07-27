export interface EggInfo {
  eggId: string
  name: string
  version: string
  wish: string
  permissions: string[]
  folder: string
  hasBackup: boolean
}

export interface GachaActivity {
  type: 'think' | 'tool' | 'write' | 'check' | 'retry' | 'error'
  text: string
  /** 同 id 的条目原地替换（流式思考实时更新） */
  id?: string
}

export interface GachaProgress {
  stage: 'coin' | 'crank' | 'clack' | 'pop' | 'fail'
  detail?: string
  activity?: GachaActivity
}

export interface GachaResult {
  ok: boolean
  eggId?: string
  name?: string
  error?: string
  upgraded?: boolean
}

export interface AiSettingsMasked {
  baseURL: string
  model: string
  hasKey: boolean
}

export interface WindowState { maximized: boolean }

export interface WishQuestion { text: string; options: string[] }
export interface WishChatResult { done: boolean; questions: WishQuestion[] }

export interface AppSettings {
  autoStartApp: boolean
  minimizeToTray: boolean
}

export interface ShelfBridge {
  list(): Promise<EggInfo[]>
  open(eggId: string): Promise<void>
  import(): Promise<{ imported: boolean; name?: string }>
  export(eggId: string): Promise<{ exported: boolean; dest?: string }>
  trash(eggId: string): Promise<void>
  rollback(eggId: string): Promise<{ name: string }>
  wish(text: string): Promise<{ started: boolean }>
  upgrade(eggId: string, text: string): Promise<{ started: boolean }>
  wishChat(messages: { role: string; content: string }[]): Promise<WishChatResult>
  getAiSettings(): Promise<AiSettingsMasked | null>
  saveAiSettings(s: { baseURL: string; model: string; apiKey: string }): Promise<void>
  testAi(): Promise<{ reply: string }>
  getAppSettings(): Promise<AppSettings>
  setAppSettings(s: { autoStartApp?: boolean; minimizeToTray?: boolean }): Promise<void>
  getEggAutoStart(eggId: string): Promise<boolean>
  setEggAutoStart(eggId: string, enabled: boolean): Promise<void>
  onGachaProgress(cb: (p: GachaProgress) => void): void
  onGachaDone(cb: (r: GachaResult) => void): void
  minimize(): void
  maximize(): void
  close(): void
  isMaximized(): Promise<boolean>
  onWindowState(cb: (s: WindowState) => void): void
}

declare global {
  interface Window {
    shelf: ShelfBridge
  }
}

export const shelf = window.shelf
