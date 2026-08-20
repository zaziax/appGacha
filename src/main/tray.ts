import { Tray, Menu, nativeImage, app } from 'electron'
import path from 'node:path'
import { showShelfWindow, markQuitting } from './shelfWindow'
import { t } from './i18n'

let tray: Tray | null = null

function trayIconPath(): string {
  // 打包后 extraResources 复制到 resources/，dev 模式直接用 assets/
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'assets', 'icon.png')
  }
  return path.join(app.getAppPath(), 'assets', 'icon.png')
}

function buildTrayMenu(): Electron.Menu {
  return Menu.buildFromTemplate([
    {
      label: t('showShelf'),
      click: () => showShelfWindow()
    },
    { type: 'separator' },
    {
      label: t('quit'),
      click: () => {
        markQuitting()
        tray?.destroy()
        tray = null
        app.quit()
      }
    }
  ])
}

export function initTray(): void {
  if (tray) return

  const icon = nativeImage.createFromPath(trayIconPath())
  const sized = icon.resize({ width: 16, height: 16 })
  if (process.platform === 'darwin') {
    // mac 菜单栏模板图：忽略颜色、按 alpha 轮廓着色，自动适配深浅色模式
    sized.setTemplateImage(true)
  }
  tray = new Tray(sized)
  tray.setToolTip(t('trayTooltip'))
  tray.setContextMenu(buildTrayMenu())
  tray.on('double-click', () => showShelfWindow())
}

/** 语言变更后重建托盘菜单（标签刷新） */
export function rebuildTrayMenu(): void {
  if (!tray) return
  tray.setToolTip(t('trayTooltip'))
  tray.setContextMenu(buildTrayMenu())
}

export function destroyTray(): void {
  if (tray) {
    tray.destroy()
    tray = null
  }
}
