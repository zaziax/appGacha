import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Plus, X, GripVertical, Egg } from 'lucide-react'
import { View } from '@react-three/drei'
import { useTranslation } from 'react-i18next'
import { shelf, EggInfo, SpaceConfig } from '../shelf'
import { CapsuleScene } from './Capsule3D'

/** SVG 原文 → data URL（与收藏柜一致） */
function iconDataUrl(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

/** 扭蛋配色（与收藏架 EggCard 同款：按 eggId 哈希散布色相） */
function eggColors(eggId: string): { cup: string; content: string } {
  let h = 0
  for (let i = 0; i < eggId.length; i++) h = ((h << 5) - h + eggId.charCodeAt(i)) | 0
  const hue = Math.round((Math.abs(h) % 24) * 137.508) % 360
  const sat = 74 + (Math.abs(h >> 8) % 14)
  const lit = 52 + (Math.abs(h >> 16) % 9)
  return {
    cup: `hsl(${hue},${sat}%,${lit}%)`,
    content: `hsl(${hue},${Math.min(sat + 6, 94)}%,${lit + 21}%)`
  }
}

interface Props {
  eggs: EggInfo[]
  onToast: (msg: string) => void
  onChanged: () => void
  /** 弹窗/面板打开时隐藏原生蛋视图，显示静态占位卡片避免内容区空白 */
  dimmed?: boolean
}

/** tab 条目几何（固定高度 + 固定间距，拖拽换序按此计算插入位） */
const TAB_H = 64
const TAB_GAP = 8
/** 按下后位移超过此阈值才进入拖拽模式，避免点击时的手部微动误触发换位 */
const DRAG_START_PX = 7

export function SpaceView({ eggs, onToast, onChanged, dimmed }: Props) {
  const { t } = useTranslation()
  const [cfg, setCfg] = useState<SpaceConfig | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)

  // ─── 拖拽排序状态 ───
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [dragY, setDragY] = useState(0)          // 指针相对列表顶部的 y
  const [dropIdx, setDropIdx] = useState<number | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  // 按下信息：未超过位移阈值前不进入拖拽态（纯点击无任何拖拽视觉）
  const downInfo = useRef<{ idx: number; startY: number } | null>(null)

  // tab 列表滚动裁切：滚出列表可视区的 tab 隐藏其 3D 蛋
  const [tabVisibleIds, setTabVisibleIds] = useState<Set<string>>(() => new Set())

  // 拉配置
  const load = useCallback(() => {
    shelf.spaceGet().then(setCfg).catch(err => onToast(err.message))
  }, [onToast])

  useEffect(() => { load() }, [load])

  // 挂载 = 进入空间 tab：通知主进程可见；卸载 = 切走 → 隐藏蛋视图
  useEffect(() => {
    shelf.spaceSetVisible(true)
    return () => { shelf.spaceSetVisible(false) }
  }, [])

  // 内容区 bounds 上报：主进程据此摆放蛋的 WebContentsView
  useEffect(() => {
    const el = contentRef.current
    if (!el) return
    const report = () => {
      const r = el.getBoundingClientRect()
      shelf.spaceSetBounds({ x: r.left, y: r.top, width: r.width, height: r.height })
    }
    const ro = new ResizeObserver(report)
    ro.observe(el)
    report()
    // 视图入场动画（translateY）会短暂偏移 rect，动画结束后补报一次确保精确
    const timer = setTimeout(report, 450)
    return () => { clearTimeout(timer); ro.disconnect() }
  }, [])

  // 选蛋弹窗打开时隐藏蛋视图（原生 WebContentsView 会盖在 DOM 弹窗之上）
  useEffect(() => {
    if (!pickerOpen) return
    shelf.spaceSetVisible(false)
    return () => { shelf.spaceSetVisible(true) }
  }, [pickerOpen])

  // 外部唤起聚焦（快捷方式/收藏柜点开已在空间的蛋）：主进程已改 active，这里刷新本地
  useEffect(() => { shelf.onSpaceFocus(() => load()) }, [load])

  // 空间里的蛋（按配置顺序，剔除列表中已不存在的）
  const spaceEggs = useMemo(() => {
    if (!cfg) return []
    return cfg.eggs
      .map(id => eggs.find(e => e.eggId === id))
      .filter((e): e is EggInfo => !!e)
  }, [cfg, eggs])

  // 当前激活的蛋（dimmed 占位卡片用）
  const activeEgg = useMemo(() => {
    if (!cfg?.active) return null
    return spaceEggs.find(e => e.eggId === cfg.active) ?? spaceEggs[0] ?? null
  }, [cfg?.active, spaceEggs])

  // tab 列表滚动可见性观察（列表内容变化时重建；IO 回调只携带变化项，需用累积 Set 增量维护）
  useEffect(() => {
    const root = listRef.current
    if (!root) return
    const vis = new Set<string>()
    const io = new IntersectionObserver(entries => {
      for (const e of entries) {
        const id = (e.target as HTMLElement).dataset.spaceEggId!
        if (e.isIntersecting) vis.add(id); else vis.delete(id)
      }
      setTabVisibleIds(new Set(vis))
    }, { root })
    root.querySelectorAll('[data-space-egg-id]').forEach(el => io.observe(el))
    return () => io.disconnect()
  }, [spaceEggs])

  const activeId = cfg?.active && spaceEggs.some(e => e.eggId === cfg.active)
    ? cfg.active
    : (spaceEggs[0]?.eggId ?? null)

  const activate = (eggId: string) => {
    if (eggId === activeId) return
    setCfg(c => c ? { ...c, active: eggId } : c)
    shelf.spaceActivate(eggId).catch(err => onToast(err.message))
  }

  const remove = (eggId: string) => {
    shelf.spaceRemove(eggId).then(setCfg).catch(err => onToast(err.message))
  }

  const add = (eggId: string) => {
    shelf.spaceAdd(eggId).then(c => { setCfg(c); setPickerOpen(false) }).catch(err => onToast(err.message))
  }

  // 可加入的蛋：标准窗型 + 未在空间中
  const candidates = useMemo(() =>
    eggs.filter(e => e.windowType !== 'widget' && !cfg?.eggs.includes(e.eggId)),
    [eggs, cfg])

  // 面板打开时隐藏蛋视图（原生 WebContentsView 会盖在 DOM 弹窗之上）
  useEffect(() => {
    if (!pickerOpen) return
    shelf.spaceSetVisible(false)
    return () => { shelf.spaceSetVisible(true) }
  }, [pickerOpen])

  // ─── 拖拽排序（按下不立即进拖拽态，位移超阈值才启动） ───
  const onTabPointerDown = (idx: number, e: React.PointerEvent) => {
    if (!listRef.current) return
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    downInfo.current = { idx, startY: e.clientY - listRef.current.getBoundingClientRect().top }
  }

  const onTabPointerMove = (e: React.PointerEvent) => {
    if (!listRef.current) return
    const y = e.clientY - listRef.current.getBoundingClientRect().top
    if (dragIdx === null) {
      // 尚未进入拖拽态：超过阈值才启动，点击微动不触发
      const down = downInfo.current
      if (!down || Math.abs(y - down.startY) <= DRAG_START_PX) return
      setDragIdx(down.idx)
      setDropIdx(down.idx)
    }
    setDragY(y)
    // 插入位：指针落在哪个条目的中线上
    const slot = Math.round((y - TAB_H / 2) / (TAB_H + TAB_GAP))
    setDropIdx(Math.max(0, Math.min(spaceEggs.length - 1, slot)))
  }

  const onTabPointerUp = (idx: number) => {
    const wasDragging = dragIdx !== null
    const from = dragIdx
    const to = dropIdx ?? idx
    downInfo.current = null
    setDragIdx(null)
    setDropIdx(null)
    if (!wasDragging) { activate(spaceEggs[idx].eggId); return }
    if (from === null || from === to || !cfg) return
    const ids = [...cfg.eggs]
    const valid = ids.filter(id => spaceEggs.some(e => e.eggId === id))
    const [moved] = valid.splice(from, 1)
    valid.splice(to, 0, moved)
    // 乐观更新 + 落盘
    setCfg({ ...cfg, eggs: valid })
    shelf.spaceReorder(valid).then(setCfg).catch(err => { onToast(err.message); load() })
  }

  return (
    <div className="h-full flex bg-cream">
      {/* ═══ 左侧 tab 栏（无分隔线，靠底色区分） ═══ */}
      <div className="w-[200px] shrink-0 flex flex-col bg-[#F1EAE0]">
        <div ref={listRef} className="flex-1 overflow-y-auto shelf-scroll p-3 relative">
          {spaceEggs.length === 0 ? (
            <div className="text-center mt-8 px-2">
              <div className="text-[13px] font-extrabold text-muted">{t('space.empty')}</div>
              <div className="text-[11px] text-muted/60 mt-1.5 leading-relaxed">{t('space.emptyHint')}</div>
            </div>
          ) : (
            spaceEggs.map((egg, idx) => {
              const isActive = egg.eggId === activeId
              const isDragging = dragIdx === idx
              const offset = isDragging
                ? dragY - TAB_H / 2 - idx * (TAB_H + TAB_GAP)
                : 0
              return (
                <div key={egg.eggId} data-space-egg-id={egg.eggId}>
                  {/* 插入指示线 */}
                  {dragIdx !== null && dropIdx === idx && dragIdx !== idx && (
                    <div className="h-[3px] rounded-full bg-brand mb-1" style={{ marginTop: idx === 0 ? 0 : -TAB_GAP }} />
                  )}
                  <div
                    className={`group flex items-center gap-1.5 rounded-xl border-[2.5px] px-1.5 cursor-pointer select-none transition-colors ${
                      isActive ? 'bg-white text-text border-text shadow-[3px_3px_0_rgba(92,64,51,0.14)]' : 'bg-transparent text-text border-transparent hover:bg-white/60 hover:border-text/20'
                    }`}
                    style={{
                      height: TAB_H,
                      marginBottom: TAB_GAP,
                      transform: isDragging ? `translateY(${offset}px)` : undefined,
                      zIndex: isDragging ? 20 : undefined,
                      position: 'relative',
                      boxShadow: isDragging ? '3px 4px 0 rgba(92,64,51,0.2)' : undefined,
                      touchAction: 'none'
                    }}
                    onPointerDown={e => onTabPointerDown(idx, e)}
                    onPointerMove={onTabPointerMove}
                    onPointerUp={() => onTabPointerUp(idx)}
                  >
                    <GripVertical className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-text/30' : 'text-text/25'}`} strokeWidth={3} />
                    {/* 3D 扭蛋（收藏架同款胶囊，由全屏 Canvas 的 View 锚定到这里；选蛋弹窗打开/滚出列表时隐藏） */}
                    {pickerOpen || !tabVisibleIds.has(egg.eggId) ? (
                      <div className="w-11 h-11 shrink-0" />
                    ) : (
                      <div className="w-11 h-11 shrink-0 pointer-events-none">
                        <View className="w-full h-full">
                          <CapsuleScene
                            cupColor={eggColors(egg.eggId).cup}
                            contentColor={eggColors(egg.eggId).content}
                            dimmed={false}
                            hovered={false}
                            phase={idx * 1.3}
                            iconUrl={egg.icon ? iconDataUrl(egg.icon) : undefined}
                          />
                        </View>
                      </div>
                    )}
                    <span className="flex-1 text-[12px] font-extrabold truncate">{egg.name}</span>
                    {/* 移出空间（点击不触发拖拽/激活） */}
                    <button
                      className={`w-5 h-5 rounded-md items-center justify-center transition-colors ${
                        isActive ? 'hover:bg-text/10 text-text/50' : 'hover:bg-text/10 text-text/40'
                      } ${dragIdx !== null ? '' : 'hidden group-hover:flex'}`}
                      title={t('space.removeTitle')}
                      onPointerDown={e => e.stopPropagation()}
                      onClick={e => { e.stopPropagation(); remove(egg.eggId) }}
                    >
                      <X className="w-3 h-3" strokeWidth={3.5} />
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* 添加按钮（z-20 + 不透明底：盖住列表滚出底部的 3D 蛋，Canvas z-10 盖不到这里） */}
        <div className="p-3 pt-1 relative z-20 bg-[#F1EAE0]">
          <button
            className="w-full flex items-center justify-center gap-1.5 rounded-xl border-[3px] border-text bg-white text-text text-xs font-extrabold py-2.5 active:translate-y-0.5 transition-all hover:bg-cream"
            style={{ boxShadow: '3px 3px 0 rgba(92,64,51,0.18)' }}
            onClick={() => setPickerOpen(true)}
          >
            <Plus className="w-4 h-4" strokeWidth={3} />{t('space.add')}
          </button>
        </div>
      </div>

      {/* ═══ 右侧内容区：圆角卡片包裹；DOM 只留内缩空位，蛋的 WebContentsView 由主进程叠在这里 ═══ */}
      <div className="flex-1 min-w-0 px-2 pt-2 pb-2">
        <div className="h-full w-full rounded-2xl border-[3px] border-text/10 bg-white p-1" style={{ boxShadow: '4px 4px 0 rgba(92,64,51,0.08)' }}>
          <div ref={contentRef} className="h-full w-full relative bg-[#FBFAF8] rounded-xl overflow-hidden">
            {/* dimmed 占位：弹窗/面板打开时蛋视图隐藏，显示 3D 扭蛋冻结画面 */}
            <AnimatePresence>
              {dimmed && activeEgg && (
                <motion.div
                  className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-5
                             bg-[#FBFAF8]/60 rounded-xl"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.25 }}
                >
                  {/* 3D 扭蛋 — 与侧边栏同款 CapsuleScene，复用全局 Canvas */}
                  <motion.div
                    className="w-36 h-36 pointer-events-none"
                    initial={{ scale: 0.5, y: 20 }}
                    animate={{ scale: 1, y: 0 }}
                    exit={{ scale: 0.5, y: -14 }}
                    transition={{ type: 'spring', stiffness: 280, damping: 16, mass: 1.0 }}
                  >
                    <View className="w-full h-full">
                      <CapsuleScene
                        cupColor={eggColors(activeEgg.eggId).cup}
                        contentColor={eggColors(activeEgg.eggId).content}
                        dimmed
                        hovered={false}
                        phase={0}
                        iconUrl={activeEgg.icon ? iconDataUrl(activeEgg.icon) : undefined}
                      />
                    </View>
                  </motion.div>
                  <motion.p
                    className="text-[15px] font-extrabold text-text"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.12, duration: 0.25 }}
                  >
                    {activeEgg.name}
                  </motion.p>
                </motion.div>
              )}
            </AnimatePresence>
            {spaceEggs.length === 0 && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 pointer-events-none">
                <div
                  className="w-[88px] h-[88px] rounded-full border-[3px] border-dashed border-text/25 flex items-center justify-center cursor-pointer hover:border-brand hover:bg-brand/[0.03] transition-colors pointer-events-auto"
                  onClick={() => setPickerOpen(true)}
                >
                  <Plus className="w-7 h-7 text-[#d4cfc8]" strokeWidth={2.5} />
                </div>
                <p className="text-[13px] text-muted font-medium">{t('space.empty')}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ═══ 选蛋面板 ═══ */}
      <AnimatePresence>
        {pickerOpen && (
          <motion.div className="fixed inset-0 bg-black/25 flex items-center justify-center z-50"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={e => { if (e.target === e.currentTarget) setPickerOpen(false) }}>
            <motion.div
              className="bg-white border-[4px] border-text rounded-2xl p-5 w-[420px] max-w-[92vw] max-h-[70vh] flex flex-col"
              style={{ boxShadow: '6px 6px 0 rgba(92,64,51,0.2)' }}
              initial={{ opacity: 0, scale: 0.9, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9, y: 20 }}
              transition={{ type: 'spring', stiffness: 250, damping: 18, mass: 0.8 }}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-[15px] font-extrabold text-text">{t('space.pickerTitle')}</h3>
                <button
                  className="w-8 h-8 rounded-xl border-[3px] border-text flex items-center justify-center text-text hover:bg-cream active:translate-y-0.5 transition-all"
                  onClick={() => setPickerOpen(false)}>
                  <X className="w-4 h-4" strokeWidth={3} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto shelf-scroll -mx-1 px-1">
                {candidates.length === 0 ? (
                  <div className="text-center text-xs text-muted font-bold py-8">{t('space.pickerEmpty')}</div>
                ) : (
                  candidates.map(egg => (
                    <button
                      key={egg.eggId}
                      className="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-cream transition-colors"
                      onClick={() => add(egg.eggId)}
                    >
                      {egg.icon ? (
                        <img src={iconDataUrl(egg.icon)} alt="" draggable={false} className="w-9 h-9 shrink-0 rounded-full bg-cream p-0.5" />
                      ) : (
                        <span className="w-9 h-9 shrink-0 rounded-full bg-cream flex items-center justify-center">
                          <Egg className="w-4 h-4 text-muted" strokeWidth={2.5} />
                        </span>
                      )}
                      <span className="flex-1 min-w-0">
                        <span className="block text-[13px] font-extrabold text-text truncate">{egg.name}</span>
                        {egg.wish && <span className="block text-[11px] text-muted truncate mt-0.5">{egg.wish}</span>}
                      </span>
                      <Plus className="w-4 h-4 text-brand shrink-0" strokeWidth={3} />
                    </button>
                  ))
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
