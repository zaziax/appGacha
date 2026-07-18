export interface EggInfo {
  eggId: string
  name: string
  version: string
  wish: string
  permissions: string[]
  folder: string
  hasBackup: boolean
}

export interface GachaProgress {
  stage: 'coin' | 'crank' | 'clack' | 'pop' | 'fail'
  detail?: string
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

export interface ShelfBridge {
  list(): Promise<EggInfo[]>
  open(eggId: string): Promise<void>
  import(): Promise<{ imported: boolean; name?: string }>
  export(eggId: string): Promise<{ exported: boolean; dest?: string }>
  trash(eggId: string): Promise<void>
  rollback(eggId: string): Promise<{ name: string }>
  wish(text: string): Promise<{ started: boolean }>
  upgrade(eggId: string, text: string): Promise<{ started: boolean }>
  getAiSettings(): Promise<AiSettingsMasked | null>
  saveAiSettings(s: { baseURL: string; model: string; apiKey: string }): Promise<void>
  testAi(): Promise<{ reply: string }>
  onGachaProgress(cb: (p: GachaProgress) => void): void
  onGachaDone(cb: (r: GachaResult) => void): void
}

declare global {
  interface Window {
    shelf: ShelfBridge
  }
}

export const shelf = window.shelf
