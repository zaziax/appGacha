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

export interface EggWindowSpec {
  /** standard=带标题栏常规窗口；widget=透明无边框悬浮组件（蛋用 CSS 自绘形状） */
  type?: 'standard' | 'widget'
  /** 初始宽高（钳制 240~1600） */
  width?: number
  height?: number
  alwaysOnTop?: boolean
  /** 出厂默认的自启动意愿（用户可在收藏柜逐蛋覆盖） */
  autoStart?: boolean
}

export interface EggManifest {
  eggId: string
  name: string
  version: string
  hostApiVersion: string
  permissions: Permission[]
  window?: EggWindowSpec
  wish?: string
  createdBy?: { model: string; pipelineVersion: string }
  upgrades?: { wish: string; at: string; model: string }[]
}
