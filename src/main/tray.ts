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

/** 仅「退出」的托盘菜单：mac 右键弹出 / Windows 右键自动显示 */
function buildQuitMenu(): Electron.Menu {
  return Menu.buildFromTemplate([
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
  if (process.platform === 'darwin') {
    // macOS：不设常驻菜单 → 单击直接显示收藏柜；右键弹「退出」菜单
    tray.on('click', () => showShelfWindow())
    tray.on('right-click', () => tray?.popUpContextMenu(buildQuitMenu()))
  } else {
    // Windows/Linux：左键单击显示收藏柜，右键自动弹出「退出」菜单
    tray.setContextMenu(buildQuitMenu())
    tray.on('click', () => showShelfWindow())
  }
}

/** 语言变更后重建托盘菜单（退出标签刷新） */
export function rebuildTrayMenu(): void {
  if (!tray) return
  tray.setToolTip(t('trayTooltip'))
  // macOS 的退出菜单是右键临时弹出、无常驻菜单可刷；Windows 的右键菜单重建
  if (process.platform !== 'darwin') tray.setContextMenu(buildQuitMenu())
}

export function destroyTray(): void {
  if (tray) {
    tray.destroy()
    tray = null
  }
}
