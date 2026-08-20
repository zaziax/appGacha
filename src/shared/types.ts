/**
 * 主进程 → 渲染进程的错误码。
 * 主进程抛错时用 `[CODE]` 前缀，渲染端用 `formatError()` 剥离前缀并翻译。
 */
export const ErrorCode = {
  CATEGORY_NAME_EMPTY: 'ERR_CATEGORY_NAME_EMPTY',
  CATEGORY_NOT_FOUND: 'ERR_CATEGORY_NOT_FOUND',
  BUSY: 'ERR_BUSY',
  WISH_TOO_SHORT: 'ERR_WISH_TOO_SHORT',
  AI_NOT_CONFIGURED: 'ERR_AI_NOT_CONFIGURED',
  INSUFFICIENT_CREDITS: 'ERR_INSUFFICIENT_CREDITS',
  PROXY_UNAVAILABLE: 'ERR_PROXY_UNAVAILABLE',
  TIMEOUT: 'ERR_TIMEOUT',
  TOKEN_BUDGET: 'ERR_TOKEN_BUDGET',
  HTTP: 'ERR_HTTP',
  RETRIES_EXHAUSTED: 'ERR_RETRIES_EXHAUSTED',
  CHECKS_FAILED: 'ERR_CHECKS_FAILED',
  MAX_TURNS: 'ERR_MAX_TURNS',
  MIGRATE_FAILED: 'ERR_MIGRATE_FAILED',
  UNEXPECTED: 'ERR_UNEXPECTED',
  /** 同步需要 Pro 套餐 */
  SYNC_PRO_REQUIRED: 'ERR_SYNC_PRO_REQUIRED',
} as const

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode]

/** 带错误码格式：`[ERR_XXX] 人类可读消息` */
const ERR_RE = /^\[(ERR_[A-Z_]+)\]\s*/

/** 从消息里提取错误码，返回 {code, message}；无错误码时 code 为 null */
export function parseErrorCode(msg: string): { code: ErrorCode | null; message: string } {
  const m = msg.match(ERR_RE)
  if (!m) return { code: null, message: msg }
  return { code: m[1] as ErrorCode, message: msg.slice(m[0].length) }
}

/** 主进程抛错：传入错误码 + 默认消息（中文），返回 `[CODE] 消息` 格式 */
export function makeError(code: ErrorCode, fallbackMsg: string): string {
  return `[${code}] ${fallbackMsg}`
}

export type Permission =
  | 'ai'
  | 'db'
  | 'storage'
  | 'fs'
  | 'zip'
  | 'notify'
  | 'schedule'
  | 'window'
  | 'network'

export const KNOWN_PERMISSIONS: Permission[] = [
  'ai', 'db', 'storage', 'fs', 'zip', 'notify', 'schedule', 'window', 'network'
]

export interface EggWindowSpec {
  /** standard=带标题栏常规窗口；widget=透明无边框悬浮组件（蛋用 CSS 自绘形状） */
  type?: 'standard' | 'widget'
  /** 初始宽高（standard 240~1600；widget 96~1600） */
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
