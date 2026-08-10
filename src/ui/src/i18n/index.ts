import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import zh from './locales/zh.json'
import type { IpcText } from '../shelf'

export type LangPref = 'auto' | 'en' | 'zh'
const LANG_KEY = 'appgacha-lang'

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
