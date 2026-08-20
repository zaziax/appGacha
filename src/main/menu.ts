import { app, Menu } from 'electron'
import { t } from './i18n'
import { markQuitting } from './shelfWindow'

/**
 * macOS 最小原生菜单。
 *
 * setApplicationMenu(null) 在 Windows/Linux 上是移除默认菜单的常规做法，
 * 但在 macOS 上会连 Cmd+Q / Cmd+C/V/X/A 等标准快捷键一起砍掉（它们由菜单角色提供）。
 * 这里提供 App / Edit / Window 三个最小菜单，标签走主进程 i18n。
 */
export function setupMacMenu(): void {
  app.setAboutPanelOptions({ applicationName: app.name, applicationVersion: app.getVersion() })

  const template: Electron.MenuItemConstructorOptions[] = [
    {
      // macOS 系统会自动把第一个菜单替换为应用名（bundle 名），label 占位即可
      label: app.name,
      submenu: [
        { label: t('about'), role: 'about' },
        { type: 'separator' },
        { label: t('services'), role: 'services' },
        { type: 'separator' },
        { label: t('hide'), role: 'hide' },
        { label: t('hideOthers'), role: 'hideOthers' },
        { label: t('unhide'), role: 'unhide' },
        { type: 'separator' },
        // 不走 role:'quit'：需要先置 markQuitting，否则收藏柜的关窗拦截会阻止退出
        { label: t('quit'), accelerator: 'Cmd+Q', click: () => { markQuitting(); app.quit() } }
      ]
    },
    {
      label: t('edit'),
      submenu: [
        { label: t('undo'), role: 'undo' },
        { label: t('redo'), role: 'redo' },
        { type: 'separator' },
        { label: t('cut'), role: 'cut' },
        { label: t('copy'), role: 'copy' },
        { label: t('paste'), role: 'paste' },
        { label: t('selectAll'), role: 'selectAll' }
      ]
    },
    {
      label: t('window'),
      submenu: [
        { label: t('minimize'), role: 'minimize' },
        { label: t('zoom'), role: 'zoom' },
        { type: 'separator' },
        { label: t('front'), role: 'front' }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
