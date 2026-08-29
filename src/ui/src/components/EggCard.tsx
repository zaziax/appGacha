import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { View } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { X, Play, ArrowUpCircle, Share2, Power, Info, Trash2, Monitor, PanelLeft, Cloud, CloudCheck, CloudAlert, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { EggInfo, shelf, type EggCategory, type SyncStatus } from '../shelf'
import { ConfirmDialog } from './ConfirmDialog'
import { ExportDialog } from './ExportDialog'
import { ShareDialog } from './ShareDialog'
import { CapsuleScene } from './Capsule3D'
import { renderEggIconPngs } from '../eggIconRender'
import { sfx } from '../sound'

const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || '')

/** 扭蛋配色：杯体色 + 内容物色（同色相更亮，形成对比） */
function eggColors(eggId: string): { cup: string; content: string } {
  let h = 0
  for (let i = 0; i < eggId.length; i++) h = ((h << 5) - h + eggId.charCodeAt(i)) | 0
  // 黄金角散布色相——相邻蛋颜色差异明显
  const hue = Math.round((Math.abs(h) % 24) * 137.508) % 360
  const sat = 74 + (Math.abs(h >> 8) % 14)   // 74~88%
  const lit = 52 + (Math.abs(h >> 16) % 9)   // 52~61%
  return {
    cup: `hsl(${hue},${sat}%,${lit}%)`,
    content: `hsl(${hue},${Math.min(sat + 6, 94)}%,${lit + 21}%)`  // 亮一档，像玩具
  }
}

/** SVG 原文 → data URL（img 渲染，沙箱化不执行脚本） */
function iconDataUrl(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

/** 环形菜单按钮定义 */
interface MenuAction {
  icon: React.ReactNode
  label: string
  danger?: boolean
  active?: boolean
  onClick: () => void
}

interface Props {
  egg: EggInfo
  selected: boolean
  dimmed: boolean
  onSelect: (id: string | null) => void
  onToast: (msg: string) => void
  onChanged: () => void
  onUpgrade: () => void
  /** 请求打开应用内登录框（不跳浏览器） */
  onRequestLogin: () => void
  /** 全部分类 + 本蛋归属 + 设置回调 */
  categories: EggCategory[]
  categoryId: string | null
  onSetCategory: (eggId: string, categoryId: string | null) => void
  /** 云同步（仅 Pro 用户传入，未传不渲染图标） */
  syncStatus?: SyncStatus
  onSyncEgg?: (eggId: string) => void
}

const SPHERE = 88          // 球体直径
const MENU_RADIUS = 82     // 环形菜单半径
const BTN = 40             // 菜单按钮直径

/** 弹簧过冲曲线 —— 任天堂味 */
const springPop = { type: 'spring' as const, stiffness: 380, damping: 18, mass: 0.7 }

export function EggCard({ egg, selected, dimmed, onSelect, onToast, onChanged, onUpgrade, onRequestLogin, categories, categoryId, onSetCategory, syncStatus, onSyncEgg }: Props) {
  const { t } = useTranslation()
  const [detailOpen, setDetailOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [confirmState, setConfirmState] = useState<null | { title: string; message: string; confirmText: string; danger: boolean; action: () => Promise<void> }>(null)
  const [autoStart, setAutoStart] = useState(false)
  const [syncDisabled, setSyncDisabled] = useState(false)
  const [menuCenter, setMenuCenter] = useState<{ x: number; y: number } | null>(null)
  const [hovered, setHovered] = useState(false)
  const [hoveredAction, setHoveredAction] = useState<string | null>(null)
  const sphereRef = useRef<HTMLDivElement>(null)
  const { cup: c, content: cc } = eggColors(egg.eggId)
  const phase = (egg.eggId.charCodeAt(0) + egg.eggId.length * 7) % 6.28  // 浮动去同步
  const openEgg = () => shelf.open(egg.eggId).catch(err => onToast(err.message))

  // 云同步禁用状态：始终加载（卡片上的云图标需要）
  useEffect(() => {
    shelf.getSyncDisabled(egg.eggId).then(setSyncDisabled).catch(() => {})
  }, [egg.eggId])

  useEffect(() => {
    if (selected) {
      shelf.getEggAutoStart(egg.eggId).then(setAutoStart).catch(() => {})
    }
  }, [selected, egg.eggId])

  // 选中时计算球心视口坐标（fixed 定位菜单，免疫滚动容器裁切）
  useEffect(() => {
    if (selected && sphereRef.current) {
      const r = sphereRef.current.getBoundingClientRect()
      setMenuCenter({ x: r.left + r.width / 2, y: r.top + r.height / 2 })
    } else {
      setMenuCenter(null)
    }
  }, [selected])

  // Esc 收起菜单
  useEffect(() => {
    if (!selected) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onSelect(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected, onSelect])

  // 菜单关闭时清空侧边标签 hover 状态，避免下次打开时残留
  useEffect(() => {
    if (!selected) setHoveredAction(null)
  }, [selected])

  // 滚动时自动关闭菜单（fixed 定位不跟随滚动，必须收起）
  useEffect(() => {
    if (!selected) return
    const onScroll = () => onSelect(null)
    window.addEventListener('scroll', onScroll, true) // capture：捕获容器级滚动
    return () => window.removeEventListener('scroll', onScroll, true)
  }, [selected, onSelect])

  const actions: MenuAction[] = [
    { icon: <Play className="w-[16px] h-[16px]" strokeWidth={2.8} />, label: t('eggCard.open'), onClick: () => { onSelect(null); openEgg() } },
    { icon: <ArrowUpCircle className="w-[16px] h-[16px]" strokeWidth={2.8} />, label: t('eggCard.upgrade'), onClick: () => { onSelect(null); onUpgrade() } },
    {
      icon: <Share2 className="w-[16px] h-[16px]" strokeWidth={2.8} />, label: t('eggCard.exportShare'),
      onClick: () => { onSelect(null); setExportOpen(true) }
    },
    // 桌面快捷方式仅 Windows 支持（.lnk + .ico），macOS 隐藏入口
    ...(isMac ? [] : [{
      icon: <Monitor className="w-[16px] h-[16px]" strokeWidth={2.8} />, label: t('eggCard.shortcut'),
      onClick: async () => {
        // 离屏渲染收藏架同款 3D 蛋（透明背景）→ 传给主进程编码 ICO
        let iconPngs: Record<number, string> | undefined
        try { iconPngs = await renderEggIconPngs({ cupColor: c, contentColor: cc, iconUrl: egg.icon ? iconDataUrl(egg.icon) : undefined }) }
        catch { iconPngs = undefined }
        try { await shelf.shortcut(egg.eggId, iconPngs); onToast(t('eggCard.shortcutCreated', { name: egg.name })) }
        catch (err) { onToast((err as Error).message) }
      }
    }] as MenuAction[]),
    // 钉到扭蛋空间：widget 是桌面悬浮物，与工作台语义冲突，不提供入口
    ...(egg.windowType !== 'widget' ? [{
      icon: <PanelLeft className="w-[16px] h-[16px]" strokeWidth={2.8} />, label: t('eggCard.pinToSpace'),
      onClick: async () => {
        onSelect(null)
        try { await shelf.spaceAdd(egg.eggId); onToast(t('eggCard.pinnedToSpace', { name: egg.name })) }
        catch (err) { onToast((err as Error).message) }
      }
    }] : []),
    {
      icon: <Power className="w-[16px] h-[16px]" strokeWidth={2.8} />, label: t('eggCard.autoStart'), active: autoStart,
      onClick: async () => {
        const v = !autoStart
        setAutoStart(v)
        await shelf.setEggAutoStart(egg.eggId, v)
        onToast(v ? t('eggCard.autoStartOn', { name: egg.name }) : t('eggCard.autoStartOff', { name: egg.name }))
      }
    },
    { icon: <Info className="w-[16px] h-[16px]" strokeWidth={2.8} />, label: t('eggCard.details'), onClick: () => { setDetailOpen(true); onSelect(null) } },
    {
      icon: <Trash2 className="w-[16px] h-[16px]" strokeWidth={2.8} />, label: t('eggCard.delete'), danger: true,
      onClick: () => setConfirmState({
        title: t('eggCard.trashTitle'),
        message: t('eggCard.trashMsg', { name: egg.name }),
        confirmText: t('eggCard.delete'), danger: true,
        action: async () => { await shelf.trash(egg.eggId); onToast(t('eggCard.trashed', { name: egg.name })); onChanged(); onSelect(null) }
      })
    }
  ]

  return (
    <>
      {/* ═══ 球体单元 ═══ */}
      <div
        className={`relative flex flex-col items-center select-none transition-all duration-300 ${dimmed ? 'opacity-40 scale-[0.82]' : ''}`}
        style={{ zIndex: selected ? 50 : 1 }}
      >
        {/* 落影（搁板感） */}
        <div
          className="absolute bottom-[26px] left-1/2 -translate-x-1/2 rounded-[50%] bg-text/15 blur-[3px] transition-all duration-300"
          style={{ width: selected ? 64 : 52, height: selected ? 13 : 10 }}
        />

        {/* 3D 扭蛋（真实几何：遮挡/透视/玻璃全自动正确） */}
        <div ref={sphereRef} className="group relative">
          <motion.div
            className="relative cursor-pointer"
            style={{ width: SPHERE, height: SPHERE }}
            animate={selected ? { scale: 1.18, y: -6 } : { scale: 1, y: 0 }}
            whileTap={selected ? undefined : { scale: 0.92 }}
            transition={springPop}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onClick={(e) => {
              e.stopPropagation()
              if (selected) { sfx.blip(); onSelect(null) }
              else { sfx.pop(); sfx.whoosh(); onSelect(egg.eggId) }
            }}
            onDoubleClick={(e) => { e.stopPropagation(); sfx.pop(); openEgg() }}
          >
            <View className="w-full h-full">
              <CapsuleScene
                cupColor={c}
                contentColor={cc}
                dimmed={dimmed}
                hovered={hovered && !selected}
                phase={phase}
                iconUrl={egg.icon ? iconDataUrl(egg.icon) : undefined}
              />
            </View>
          </motion.div>

          {/* 云同步状态图标：仅 Pro 用户且未禁用此蛋，hover 时显示，syncing/error 始终可见 */}
          {syncStatus && !syncDisabled && (
          <div
            className={`absolute -top-0.5 -right-0.5 w-[22px] h-[22px] rounded-full bg-white/90 flex items-center justify-center cursor-pointer shadow-sm border border-[#e8dfce] hover:scale-110 transition-all z-20 ${
              syncStatus === 'syncing' || syncStatus === 'error' ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
            }`}
            style={{ boxShadow: '0 1px 3px rgba(92,64,51,0.12)' }}
            onClick={(e) => { e.stopPropagation(); onSyncEgg?.(egg.eggId) }}
            title={
              syncStatus === 'synced' ? t('shelf.syncedEgg', { name: egg.name })
              : syncStatus === 'syncing' ? t('shelf.syncing')
              : syncStatus === 'error' ? t('shelf.syncError')
              : t('shelf.syncEgg')
            }
          >
            {syncStatus === 'syncing' ? (
              <Loader2 className="w-[14px] h-[14px] text-[#8a7f70] animate-spin" strokeWidth={2.8} />
            ) : syncStatus === 'synced' ? (
              <CloudCheck className="w-[14px] h-[14px] text-emerald-500" strokeWidth={2.8} />
            ) : syncStatus === 'error' ? (
              <CloudAlert className="w-[14px] h-[14px] text-red-400" strokeWidth={2.8} />
            ) : (
              <Cloud className="w-[14px] h-[14px] text-[#b3a794]" strokeWidth={2.8} />
            )}
          </div>
          )}
        </div>

        {/* 名字 */}
        <div className={`mt-1.5 text-[12px] font-extrabold text-text max-w-[96px] truncate text-center transition-opacity ${selected ? 'opacity-0' : ''}`}>
          {egg.name}
        </div>
      </div>

      {/* ═══ 环形操作轮（fixed 视口级定位，不被滚动容器裁切） ═══ */}
      <AnimatePresence>
        {selected && menuCenter && (
          <div
            className="fixed z-[80]"
            style={{ left: menuCenter.x, top: menuCenter.y, width: 0, height: 0 }}
            onClick={(e) => e.stopPropagation()}
          >
            {actions.map((a, i) => {
              const angle = (-90 + i * (360 / actions.length)) * Math.PI / 180
              const x = Math.cos(angle) * MENU_RADIUS
              const y = Math.sin(angle) * MENU_RADIUS
              const isHovered = hoveredAction === a.label
              // 标签沿径向外弹：上方按钮标签在上、右侧在右，不遮挡球体
              const tipX = Math.cos(angle) * (MENU_RADIUS + 42)
              const tipY = Math.sin(angle) * (MENU_RADIUS + 42)
              return (
                <div key={a.label}>
                  <motion.button
                    className="absolute rounded-full flex items-center justify-center border-[2.5px] border-text/70 cursor-pointer"
                    style={{
                      width: BTN, height: BTN,
                      marginLeft: -BTN / 2, marginTop: -BTN / 2,
                      background: a.danger ? '#FEE2E2' : a.active ? '#D1FAE5' : '#fff',
                      color: a.danger ? '#DC2626' : a.active ? '#059669' : '#5C4033',
                      boxShadow: '2px 3px 0 rgba(92,64,51,0.15)'
                    }}
                    initial={{ x: 0, y: 0, scale: 0.3, opacity: 0 }}
                    animate={{ x, y, scale: 1, opacity: 1 }}
                    exit={{ x: 0, y: 0, scale: 0.3, opacity: 0 }}
                    transition={{ ...springPop, delay: i * 0.035 }}
                    whileHover={{ scale: 1.22, rotate: -6 }}
                    whileTap={{ scale: 0.88 }}
                    onMouseEnter={() => { sfx.tick(); setHoveredAction(a.label) }}
                    onMouseLeave={() => setHoveredAction(null)}
                    onClick={(e) => { e.stopPropagation(); sfx.pop(); a.onClick() }}
                  >
                    {a.icon}
                  </motion.button>

                  {/* 侧边名称标签 */}
                  <AnimatePresence>
                    {isHovered && (
                      <motion.div
                        className="absolute left-0 top-0 pointer-events-none z-10"
                        initial={{ x: tipX, y: tipY, scale: 0.6, opacity: 0 }}
                        animate={{ x: tipX, y: tipY, scale: 1, opacity: 1 }}
                        exit={{ x: tipX, y: tipY, scale: 0.6, opacity: 0 }}
                        transition={{ type: 'spring', stiffness: 520, damping: 24 }}
                      >
                        <div className="-translate-x-1/2 -translate-y-1/2 whitespace-nowrap px-2.5 py-1 rounded-lg bg-text text-white text-[11px] font-extrabold shadow-md">
                          {a.label}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )
            })}
          </div>
        )}
      </AnimatePresence>

      {/* ═══ 详情弹窗（保留原有完整功能） ═══ */}
      <AnimatePresence>
        {detailOpen && (
          <motion.div className="fixed inset-0 bg-black/25 flex items-center justify-center z-50"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={e => { if (e.target === e.currentTarget) setDetailOpen(false) }}>
            <motion.div
              className="bg-white border-[4px] border-text rounded-2xl p-6 w-[380px] max-w-[92vw] max-h-[85vh] overflow-y-auto relative"
              style={{ boxShadow: '6px 6px 0 rgba(92,64,51,0.2)' }}
              initial={{ opacity: 0, scale: 0.9, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9, y: 20 }}
              transition={{ type: 'spring', stiffness: 250, damping: 18, mass: 0.8 }}>
              <button
                className="absolute top-3 right-4 w-8 h-8 rounded-xl border-[3px] border-text flex items-center justify-center text-text hover:bg-cream active:translate-y-0.5 transition-all font-extrabold z-10"
                style={{ boxShadow: '2px 2px 0 rgba(92,64,51,0.15)' }}
                onClick={() => setDetailOpen(false)}>
                <X className="w-4 h-4" strokeWidth={3} />
              </button>

              {/* 3D 扭蛋预览 */}
              <div className="w-20 h-20 mx-auto mb-3">
                <Canvas gl={{ antialias: true, alpha: true }} dpr={[1, 2]}>
                  <CapsuleScene cupColor={c} contentColor={cc} dimmed={false} hovered={false} phase={0} iconUrl={egg.icon ? iconDataUrl(egg.icon) : undefined} />
                </Canvas>
              </div>

              <h3 className="text-lg font-extrabold text-center text-text">{egg.name}</h3>
              <div className="text-xs font-bold text-muted text-center mb-4">v{egg.version} · {egg.folder}</div>

              {egg.permissions.length > 0 && (
                <div className="flex gap-1.5 flex-wrap mb-4">
                  {egg.permissions.map(p => (
                    <span key={p} className="text-[11px] font-extrabold text-muted border-[2.5px] border-text rounded-full px-2.5 py-0.5">{p}</span>
                  ))}
                </div>
              )}

              {/* 分类归属 */}
              <div className="mb-4">
                <div className="text-[11px] font-extrabold text-muted mb-1.5">{t('eggCard.category')}</div>
                <div className="flex gap-1.5 flex-wrap">
                  <button
                    onClick={() => onSetCategory(egg.eggId, null)}
                    className={`text-[11px] font-extrabold rounded-full px-2.5 py-0.5 border-[2.5px] border-text transition-colors ${categoryId === null ? 'bg-text text-white' : 'bg-white text-muted hover:bg-cream'}`}
                  >
                    {t('eggCard.uncategorized')}
                  </button>
                  {categories.map(cat => (
                    <button
                      key={cat.id}
                      onClick={() => onSetCategory(egg.eggId, cat.id)}
                      className={`text-[11px] font-extrabold rounded-full px-2.5 py-0.5 border-[2.5px] border-text transition-colors ${categoryId === cat.id ? 'bg-text text-white' : 'bg-white text-muted hover:bg-cream'}`}
                    >
                      {cat.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* 开机自启动开关 */}
              <label className="flex items-center gap-2 cursor-pointer select-none mb-4">
                <div
                  className={`w-10 h-6 rounded-full border-[2.5px] border-text relative transition-colors ${autoStart ? 'bg-emerald-400' : 'bg-gray-200'}`}
                  onClick={async () => {
                    const v = !autoStart
                    setAutoStart(v)
                    await shelf.setEggAutoStart(egg.eggId, v)
                    onToast(v ? t('eggCard.autoStartOn', { name: egg.name }) : t('eggCard.autoStartOff', { name: egg.name }))
                  }}
                >
                  <div className={`absolute top-[2px] w-4 h-4 rounded-full bg-white border-2 border-text transition-all ${autoStart ? 'left-[20px]' : 'left-[2px]'}`} />
                </div>
                <span className="text-xs font-extrabold text-text">{t('eggCard.launchAtLogin')}</span>
              </label>

              {/* 云端同步开关 */}
              <label className="flex items-center gap-2 cursor-pointer select-none mb-4">
                <div
                  className={`w-10 h-6 rounded-full border-[2.5px] border-text relative transition-colors ${syncDisabled ? 'bg-gray-200' : 'bg-sky-400'}`}
                  onClick={async () => {
                    const v = !syncDisabled
                    setSyncDisabled(v)
                    await shelf.setSyncDisabled(egg.eggId, v)
                    onToast(v ? t('eggCard.syncDisabled') : t('eggCard.syncEnabled'))
                  }}
                >
                  <div className={`absolute top-[2px] w-4 h-4 rounded-full bg-white border-2 border-text transition-all ${syncDisabled ? 'left-[2px]' : 'left-[20px]'}`} />
                </div>
                <span className="text-xs font-extrabold text-text">{t('eggCard.cloudSync')}</span>
              </label>

              <div className="flex gap-2 flex-wrap pt-2">
                <Btn primary onClick={() => { openEgg(); setDetailOpen(false) }}>{t('eggCard.open')}</Btn>
                <Btn onClick={() => { onUpgrade(); setDetailOpen(false) }}>{t('eggCard.upgrade')}</Btn>
                <Btn onClick={() => { setDetailOpen(false); setExportOpen(true) }}>{t('eggCard.export')}</Btn>
                <Btn danger onClick={() => setConfirmState({
                  title: t('eggCard.trashTitle'),
                  message: t('eggCard.trashMsg', { name: egg.name }),
                  confirmText: t('eggCard.delete'), danger: true,
                  action: async () => { await shelf.trash(egg.eggId); onToast(t('eggCard.trashed', { name: egg.name })); onChanged(); setDetailOpen(false) }
                })}>{t('eggCard.delete')}</Btn>
                {egg.hasBackup && (
                  <Btn onClick={() => setConfirmState({
                    title: t('eggCard.restoreBackupTitle'),
                    message: t('eggCard.restoreBackupMsg', { name: egg.name }),
                    confirmText: t('eggCard.restoreBtn'), danger: false,
                    action: async () => { const res = await shelf.rollback(egg.eggId); onToast(t('eggCard.restored', { name: res.name })); onChanged(); setDetailOpen(false) }
                  })}>{t('eggCard.restoreBtn')}</Btn>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {confirmState && (
        <ConfirmDialog
          title={confirmState.title}
          message={confirmState.message}
          confirmText={confirmState.confirmText}
          danger={confirmState.danger}
          onConfirm={async () => {
            setConfirmState(null)
            try { await confirmState.action() }
            catch (err) { onToast((err as Error).message) }
          }}
          onCancel={() => setConfirmState(null)}
        />
      )}

      {exportOpen && (
        <ExportDialog
          name={egg.name}
          onCancel={() => setExportOpen(false)}
          onChoose={async (includeData) => {
            setExportOpen(false)
            try { const res = await shelf.export(egg.eggId, includeData); if (res.exported) onToast(t('eggCard.exported', { name: egg.name })) }
            catch (err) { onToast((err as Error).message) }
          }}
          onShare={() => { setExportOpen(false); setShareOpen(true) }}
        />
      )}

      {shareOpen && (
        <ShareDialog
          egg={egg}
          cupColor={c}
          contentColor={cc}
          onToast={onToast}
          onClose={() => setShareOpen(false)}
          onRequestLogin={onRequestLogin}
        />
      )}
    </>
  )
}

function Btn({ children, primary, danger, onClick }: {
  children: React.ReactNode; primary?: boolean; danger?: boolean; onClick: () => void
}) {
  return (
    <button onClick={onClick}
      className="px-3.5 py-2 rounded-xl text-xs font-extrabold active:translate-y-0.5 transition-all border-[3px] border-text"
      style={{
        background: primary ? '#D9534F' : '#fff',
        color: primary ? '#fff' : danger ? '#D9534F' : '#5C4033',
        boxShadow: '3px 3px 0 rgba(92,64,51,0.18)'
      }}>
      {children}
    </button>
  )
}
