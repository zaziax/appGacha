import { Tray, Menu, nativeImage, app } from 'electron'
import { showShelfWindow } from './shelfWindow'

let tray: Tray | null = null

/** 16×16 简约扭蛋机图标（橙色圆 + 白槽），后续可替换为设计稿 .ico/.png */
function createTrayIcon(): Electron.NativeImage {
  // 16x16 RGBA 手绘：橙色圆形底 + 白色横槽
  const size = 16
  const canvas = Buffer.alloc(size * size * 4, 0)
  const cx = 7.5, cy = 7.5, r = 7
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx, dy = y - cy
      const dist = Math.sqrt(dx * dx + dy * dy)
      const idx = (y * size + x) * 4
      if (dist <= r) {
        // 橙色底 #FF8C42
        canvas[idx] = 0xFF
        canvas[idx + 1] = 0x8C
        canvas[idx + 2] = 0x42
        canvas[idx + 3] = 0xFF
        // 白色横槽（y=7~8, x=3~12）
        if (y >= 7 && y <= 8 && x >= 3 && x <= 12) {
          canvas[idx] = 0xFF
          canvas[idx + 1] = 0xFF
          canvas[idx + 2] = 0xFF
        }
      }
    }
  }
  return nativeImage.createFromBuffer(canvas, { width: size, height: size })
}

export function initTray(): void {
  if (tray) return

  tray = new Tray(createTrayIcon())
  tray.setToolTip('appGacha 扭蛋机')

  const menu = Menu.buildFromTemplate([
    {
      label: '显示收藏柜',
      click: () => showShelfWindow()
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        tray?.destroy()
        tray = null
        app.quit()
      }
    }
  ])
  tray.setContextMenu(menu)

  // 双击托盘图标 = 显示主窗口
  tray.on('double-click', () => showShelfWindow())
}

export function destroyTray(): void {
  if (tray) {
    tray.destroy()
    tray = null
  }
}
