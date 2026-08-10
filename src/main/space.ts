import { BrowserWindow, WebContentsView } from 'electron'
import path from 'node:path'
import { EggContext, getEgg } from './eggs'
import { prepareEggSession, openEgg } from './eggWindow'
import { syncEgg } from './sync'
import * as registry from './registry'
import { getSpaceConfig, setSpaceConfig, SpaceConfig } from './settings'
import { onEggClosed } from './net/coordinator'

// 不直接 import shelfWindow：避免 space ↔ shelfWindow 循环依赖。
// openEggSmart / focusEggInSpace 只在 IPC/启动路由时（模块全部加载完毕后）被调，延迟 require 安全。

/* ================================================================
   扭蛋空间（GachaSpace）：收藏柜窗口的第三个工作台视图。
   用户自选一组标准窗蛋，左侧 tab 切换，右侧内容区直接跑蛋。

   实现：每颗蛋一个 WebContentsView（独立 partition，与独立窗口
   同一套隔离/权限/桥接），叠加在收藏柜窗口 contentView 的右侧
   内容区上。UI 报告内容区 bounds，主进程据此摆放激活的 view。

   规则：
   - widget 类型蛋禁入（桌面悬浮物与工作台语义冲突）
   - 配置持久化在 settings.json 的 space 段
   - 视图懒创建（激活时才建），从空间移除时销毁
   ================================================================ */

export interface SpaceBounds { x: number; y: number; width: number; height: number }

const views = new Map<string, WebContentsView>()

/** 获取当前空间内已加载的蛋 ID 列表 */
export function getSpaceEggIds(): string[] { return [...views.keys()] }

let hostWin: BrowserWindow | null = null
let bounds: SpaceBounds | null = null   // UI 报告的右侧内容区（窗口内容坐标）
let uiVisible = false                    // UI 当前是否处于空间 tab
let hostVisible = true                   // 宿主窗口可见且未最小化
let activeId: string | null = null

// 聚焦事件回调：由 shelf.ts 注册（sendToShelf），避免本模块直依 shelfWindow
type FocusListener = (eggId: string) => void
let focusListener: FocusListener | null = null
export function onSpaceFocusEvent(fn: FocusListener): void { focusListener = fn }

/** widget 禁入判定（主进程兜底） */
function isWidgetEgg(egg: EggContext): boolean {
  return egg.manifest.window?.type === 'widget'
}

/** 清洗配置：剔除已删除 / 已变 widget 的蛋 */
function sanitize(ids: string[]): string[] {
  const out: string[] = []
  for (const id of ids) {
    if (out.includes(id)) continue
    const egg = getEgg(id)
    if (egg && !isWidgetEgg(egg)) out.push(id)
  }
  return out
}

export function getSpace(): SpaceConfig {
  const cfg = getSpaceConfig()
  const eggs = sanitize(cfg.eggs)
  const active = cfg.active && eggs.includes(cfg.active) ? cfg.active : (eggs[0] ?? null)
  return { eggs, active }
}

function save(cfg: SpaceConfig): void {
  setSpaceConfig(cfg)
}

/** 某蛋是否已配置进空间（收藏柜打开路由用） */
export function isEggInSpace(eggId: string): boolean {
  return getSpace().eggs.includes(eggId)
}

// ─── view 生命周期 ───

function createView(egg: EggContext): WebContentsView {
  const partition = prepareEggSession(egg)
  const view = new WebContentsView({
    webPreferences: {
      // 与独立蛋窗口同一套沙箱三件套，preload 是主应用的
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, '../preload/index.js'),
      // space 类型：preload 不注入独立窗标题栏（宿主已有 chrome）
      additionalArguments: ['--egg-window-type=space'],
      partition
    }
  })
  const wc = view.webContents
  // R2: 登记 webContents → 蛋，权限检查只认这张表
  registry.register(wc.id, egg)
  wc.on('destroyed', () => {
    registry.unregister(wc.id)
    // 与独立窗口关闭同语义：清理联机房间
    onEggClosed(egg.eggId)
    // 不在 destroy 时同步——切 tab 等场景下太频繁。
    // 空间蛋的同步入口：createView（会话开始）+ 用户手动点云图标。
  })
  // R4: 蛋不能创建窗口
  wc.setWindowOpenHandler(() => ({ action: 'deny' }))
  // 后台同步：拉取最新 + 补推上次未完成的推送
  syncEgg(egg.eggId).catch(() => {})
  wc.loadURL(`egg://${egg.eggId}/index.html`)
  return view
}

function destroyView(eggId: string): void {
  const v = views.get(eggId)
  if (!v) return
  views.delete(eggId)
  if (hostWin && !hostWin.isDestroyed()) {
    const cv = hostWin.contentView
    if (cv.children.includes(v)) cv.removeChildView(v)
  }
  ;(v.webContents as { destroy?: () => void }).destroy?.()
}

/** 摆放当前激活 view；任何状态变化（bounds/可见性/激活项）都走这里 */
function applyActive(): void {
  if (!hostWin || hostWin.isDestroyed()) return
  const cv = hostWin.contentView
  // 先撤下所有空间 view（不销毁，保活）
  for (const v of views.values()) {
    if (cv.children.includes(v)) cv.removeChildView(v)
  }
  const shouldShow = uiVisible && hostVisible && bounds && bounds.width > 40 && bounds.height > 40
  if (!shouldShow || !activeId) return
  const egg = getEgg(activeId)
  if (!egg || isWidgetEgg(egg)) return
  let view = views.get(activeId)
  if (!view) {
    view = createView(egg)
    views.set(activeId, view)
  }
  view.setBounds({
    x: Math.round(bounds!.x),
    y: Math.round(bounds!.y),
    width: Math.round(bounds!.width),
    height: Math.round(bounds!.height)
  })
  cv.addChildView(view)
}

// ─── 宿主窗口接线 ───

/** 收藏柜窗口创建后调用：登记宿主 + 同步最小化/隐藏状态 */
export function attachSpaceHost(win: BrowserWindow): void {
  hostWin = win
  win.on('minimize', () => { hostVisible = false; applyActive() })
  win.on('restore', () => { hostVisible = true; applyActive() })
  win.on('hide', () => { hostVisible = false; applyActive() })
  win.on('show', () => { hostVisible = true; applyActive() })
  win.on('closed', () => {
    for (const eggId of [...views.keys()]) destroyView(eggId)
    hostWin = null
  })
}

// ─── 对外操作（IPC 处理器调用） ───

export function spaceAdd(eggId: string): SpaceConfig {
  const egg = getEgg(eggId)
  if (!egg) throw new Error('egg not found')
  if (isWidgetEgg(egg)) throw new Error('widget 类型的蛋不能加入扭蛋空间')
  const cfg = getSpace()
  if (!cfg.eggs.includes(eggId)) cfg.eggs.push(eggId)
  if (!cfg.active) cfg.active = eggId
  save(cfg)
  return cfg
}

export function spaceRemove(eggId: string): SpaceConfig {
  destroyView(eggId)
  const cfg = getSpace()
  cfg.eggs = cfg.eggs.filter(id => id !== eggId)
  if (cfg.active === eggId) {
    cfg.active = cfg.eggs[0] ?? null
    activeId = cfg.active
  }
  save(cfg)
  applyActive()
  return cfg
}

/** 拖拽排序：UI 提交完整有序列表 */
export function spaceReorder(ids: unknown): SpaceConfig {
  if (!Array.isArray(ids)) throw new Error('invalid order')
  const cfg = getSpace()
  const next = sanitize(ids.filter((x): x is string => typeof x === 'string'))
  // 只接受已有成员的排列，防止借排序夹带加蛋
  if (next.length !== cfg.eggs.length || !next.every(id => cfg.eggs.includes(id))) {
    throw new Error('order mismatch')
  }
  cfg.eggs = next
  save(cfg)
  return cfg
}

export function spaceActivate(eggId: string): void {
  const cfg = getSpace()
  if (!cfg.eggs.includes(eggId)) throw new Error('egg not in space')
  cfg.active = eggId
  activeId = eggId
  save(cfg)
  applyActive()
}

export function spaceSetBounds(b: unknown): void {
  const o = b as Partial<SpaceBounds> | undefined
  if (!o || [o.x, o.y, o.width, o.height].some(v => typeof v !== 'number' || !Number.isFinite(v))) return
  bounds = { x: o.x!, y: o.y!, width: o.width!, height: o.height! }
  applyActive()
}

export function spaceSetVisible(v: boolean): void {
  uiVisible = v === true
  // 切回空间 tab 时确保激活项与配置一致
  if (uiVisible && !activeId) activeId = getSpace().active
  applyActive()
}

/** 外部唤起（收藏柜点击 / appgacha:// 快捷方式）：蛋在空间里 → 聚焦空间 tab */
export function focusEggInSpace(eggId: string): void {
  const cfg = getSpace()
  if (!cfg.eggs.includes(eggId)) return
  cfg.active = eggId
  activeId = eggId
  save(cfg)
  applyActive()
  // UI 可能停在其它顶级 tab：推送事件让它切到空间视图
  focusListener?.(eggId)
}

/** 智能打开：蛋在空间 → 聚焦空间 tab；否则独立窗口 */
export function openEggSmart(egg: EggContext): void {
  if (!isWidgetEgg(egg) && isEggInSpace(egg.eggId)) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { showShelfWindow } = require('./shelfWindow') as typeof import('./shelfWindow')
    showShelfWindow()
    focusEggInSpace(egg.eggId)
    return
  }
  openEgg(egg)
}

/** 蛋被删除时清理空间配置与视图（trash 钩子） */
export function spacePurgeEgg(eggId: string): void {
  destroyView(eggId)
  const raw = getSpaceConfig()
  if (!raw.eggs.includes(eggId)) return
  const cfg = getSpace()
  cfg.eggs = cfg.eggs.filter(id => id !== eggId)
  if (cfg.active === eggId) cfg.active = cfg.eggs[0] ?? null
  if (activeId === eggId) activeId = cfg.active
  save(cfg)
  applyActive()
}
