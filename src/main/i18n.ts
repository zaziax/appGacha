/**
 * 主进程最小化 i18n（托盘菜单 + 窗口标题）
 *
 * 主进程不能直接用 react-i18next，这里维护一份精简副本。
 * 语言设置持久化在 settings.json → app.lang，由渲染进程通过 IPC 同步。
 */

import { app } from 'electron'
import { readFile } from './settings'

type Lang = 'en' | 'zh'

const msgs = {
  trayTooltip: { en: 'AppGacha', zh: 'AppGacha 扭蛋机' },
  showShelf: { en: 'Show Shelf', zh: '显示收藏柜' },
  quit: { en: 'Quit', zh: '退出' },
  windowTitle: { en: 'AppGacha', zh: '应用扭蛋机' },
}

export function getLang(): Lang {
  const saved = readFile().app?.lang as Lang | undefined
  if (saved === 'zh' || saved === 'en') return saved
  // 未设置时跟随系统语言（中文系统 → zh，其余 → en）
  return app.getLocale().toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

export function t(key: keyof typeof msgs): string {
  return msgs[key][getLang()]
}
