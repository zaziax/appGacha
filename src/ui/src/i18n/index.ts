import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import zh from './locales/zh.json'
import type { IpcText } from '../shelf'
import { parseErrorCode, ErrorCode } from '../../../shared/types'

export type LangPref = 'auto' | 'en' | 'zh'
const LANG_KEY = 'appgacha-lang'

/** 错误码 → i18n key 映射（与 locales/zh.json 和 en.json 的 err.* 节对应） */
const ERR_I18N_MAP: Partial<Record<string, string>> = {
  [ErrorCode.CATEGORY_NAME_EMPTY]: 'err.categoryNameEmpty',
  [ErrorCode.CATEGORY_NOT_FOUND]: 'err.categoryNotFound',
  [ErrorCode.BUSY]: 'err.busy',
  [ErrorCode.WISH_TOO_SHORT]: 'err.wishTooShort',
  [ErrorCode.AI_NOT_CONFIGURED]: 'err.aiNotConfigured',
  [ErrorCode.INSUFFICIENT_CREDITS]: 'err.insufficientCredits',
  [ErrorCode.PROXY_UNAVAILABLE]: 'err.proxyUnavailable',
  [ErrorCode.TIMEOUT]: 'err.timeout',
  [ErrorCode.TOKEN_BUDGET]: 'err.tokenBudget',
  [ErrorCode.HTTP]: 'err.http',
  [ErrorCode.RETRIES_EXHAUSTED]: 'err.retriesExhausted',
  [ErrorCode.CHECKS_FAILED]: 'err.checksFailed',
  [ErrorCode.MAX_TURNS]: 'err.maxTurns',
  [ErrorCode.MIGRATE_FAILED]: 'err.migrateFailed',
  [ErrorCode.UNEXPECTED]: 'err.unexpected',
  [ErrorCode.SYNC_PRO_REQUIRED]: 'err.syncProRequired',
}

/**
 * 翻译主进程发来的错误消息：
 * - 带 `[ERR_XXX]` 前缀 → 查 i18n 映射表翻译
 * - 纯字符串 → 原样返回
 * - 对象 {key, params} → t(key, params)
 */
export function formatAppError(
  t: (key: string, params?: Record<string, unknown>) => string,
  msg: string | IpcText | null | undefined
): string {
  if (!msg) return ''
  if (typeof msg !== 'string') return t(msg.key, msg.params)
  const { code, message: raw } = parseErrorCode(msg)
  if (!code) return raw
  const i18nKey = ERR_I18N_MAP[code]
  return i18nKey ? t(i18nKey) : raw
}

/** 系统语言检测：中文系统 → zh，其余一律 en（面向海外市场，英文兖底） */
export function detectLanguage(): 'en' | 'zh' {
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

/** 读取用户语言偏好（设置面板持久化），未设置则跟随系统 */
export function getLangPref(): LangPref {
  const v = localStorage.getItem(LANG_KEY)
  return v === 'en' || v === 'zh' ? v : 'auto'
}

export function setLangPref(pref: LangPref): void {
  if (pref === 'auto') localStorage.removeItem(LANG_KEY)
  else localStorage.setItem(LANG_KEY, pref)
  i18n.changeLanguage(pref === 'auto' ? detectLanguage() : pref)
}

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    zh: { translation: zh }
  },
  lng: getLangPref() === 'auto' ? detectLanguage() : getLangPref(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false }
})

export default i18n

/**
 * 翻译主进程发来的 IpcText：
 * 键对象 → t(key, params)；裸字符串（AI 原始输出/技术诊断）→ 原样返回。
 */
export function tr(
  t: (key: string, params?: Record<string, unknown>) => string,
  msg: IpcText | null | undefined
): string {
  if (!msg) return ''
  return typeof msg === 'string' ? msg : t(msg.key, msg.params)
}
