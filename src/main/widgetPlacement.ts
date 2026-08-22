import { BrowserWindow, Display, Rectangle, screen } from 'electron'
import { getWidgetPlacement, setWidgetPlacement, WidgetPlacement } from './settings'

const SAVE_DELAY_MS = 350

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max)

function validPlacement(value: WidgetPlacement | null): value is WidgetPlacement {
  if (!value) return false
  const a = value.workArea
  return typeof value.displayId === 'string' &&
    finite(value.x) && finite(value.y) &&
    finite(value.relativeX) && finite(value.relativeY) &&
    !!a && finite(a.x) && finite(a.y) && finite(a.width) && finite(a.height) &&
    a.width > 0 && a.height > 0
}

function sameWorkArea(a: Rectangle, b: Rectangle): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

function intersectionArea(a: Rectangle, b: Rectangle): number {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
  return width * height
}

function targetDisplay(placement: WidgetPlacement, displays: Display[]): Display {
  const exact = displays.find(display => String(display.id) === placement.displayId)
  if (exact) return exact

  // 显示器 ID 可能在驱动更新后变化；优先寻找与旧工作区重叠最多的显示器。
  let best: Display | undefined
  let bestArea = 0
  for (const display of displays) {
    const area = intersectionArea(placement.workArea, display.workArea)
    if (area > bestArea) {
      best = display
      bestArea = area
    }
  }
  return best ?? screen.getPrimaryDisplay()
}

function safeAxis(position: number, start: number, workSize: number, windowSize: number): number {
  // 极端情况下 widget 比工作区还大：贴齐工作区起点，至少保留稳定的找回入口。
  if (windowSize >= workSize) return start
  return clamp(Math.round(position), start, start + workSize - windowSize)
}

/** 在 BrowserWindow 创建前解析恢复坐标，避免窗口先出现再跳位。 */
export function resolveWidgetPosition(
  eggId: string,
  width: number,
  height: number
): { x: number; y: number } | undefined {
  const placement = getWidgetPlacement(eggId)
  if (!validPlacement(placement)) return undefined

  const displays = screen.getAllDisplays()
  if (displays.length === 0) return undefined
  const display = targetDisplay(placement, displays)
  const area = display.workArea

  let x = placement.x
  let y = placement.y
  if (!sameWorkArea(placement.workArea, area)) {
    const availableX = Math.max(0, area.width - width)
    const availableY = Math.max(0, area.height - height)
    x = area.x + clamp(placement.relativeX, 0, 1) * availableX
    y = area.y + clamp(placement.relativeY, 0, 1) * availableY
  }

  return {
    x: safeAxis(x, area.x, area.width, width),
    y: safeAxis(y, area.y, area.height, height)
  }
}

function persistPlacement(win: BrowserWindow, eggId: string): void {
  if (win.isDestroyed()) return
  const bounds = win.getBounds()
  const display = screen.getDisplayMatching(bounds)
  const area = display.workArea
  const availableX = Math.max(0, area.width - bounds.width)
  const availableY = Math.max(0, area.height - bounds.height)

  setWidgetPlacement(eggId, {
    displayId: String(display.id),
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    relativeX: availableX > 0 ? clamp((bounds.x - area.x) / availableX, 0, 1) : 0,
    relativeY: availableY > 0 ? clamp((bounds.y - area.y) / availableY, 0, 1) : 0,
    workArea: { ...area },
    scaleFactor: display.scaleFactor,
    updatedAt: Date.now()
  })
}

/**
 * 记录宿主窗口移动后的最终位置。拖动过程中只重置计时器，不进行高频磁盘写入；
 * 关闭前再同步落盘一次，确保快速拖动后立即关闭也不会丢失。
 */
export function bindWidgetPlacement(win: BrowserWindow, eggId: string): void {
  let timer: NodeJS.Timeout | undefined

  const schedule = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      persistPlacement(win, eggId)
    }, SAVE_DELAY_MS)
  }
  const flush = (): void => {
    if (timer) {
      clearTimeout(timer)
      timer = undefined
    }
    persistPlacement(win, eggId)
  }

  win.on('move', schedule)
  win.on('close', flush)
  win.on('closed', () => {
    if (timer) clearTimeout(timer)
    timer = undefined
  })
}
