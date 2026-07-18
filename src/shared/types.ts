export type Permission =
  | 'ai'
  | 'db'
  | 'storage'
  | 'fs'
  | 'notify'
  | 'schedule'
  | 'window'

export const KNOWN_PERMISSIONS: Permission[] = [
  'ai', 'db', 'storage', 'fs', 'notify', 'schedule', 'window'
]

export interface EggManifest {
  eggId: string
  name: string
  version: string
  hostApiVersion: string
  permissions: Permission[]
  wish?: string
  createdBy?: { model: string; pipelineVersion: string }
  upgrades?: { wish: string; at: string; model: string }[]
}
