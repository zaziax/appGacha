import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Canvas } from '@react-three/fiber'
import { View as DreiView } from '@react-three/drei'
import { useTranslation } from 'react-i18next'
import { shelf, EggInfo, CategoryData, AuthStatus, SyncStatus, CloudEggInfo, UpdateStatus, DownloadProgress } from './shelf'
import { tr } from './i18n'
import { getGachaState, subscribeGacha, onGachaDone, setGachaUpgrade } from './gachaStore'
import { TitleBar } from './components/TitleBar'
import { MachineView } from './components/MachineView'
import { SpaceView } from './components/SpaceView'
import { EggCard } from './components/EggCard'
import { CloudEggCard } from './components/CloudEggCard'
import { SettingsDialog } from './components/SettingsDialog'
import { ClosePromptDialog } from './components/ClosePromptDialog'
import { UpdateDialog } from './components/UpdateDialog'
import { ConfirmDialog } from './components/ConfirmDialog'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ShelfToolbar, SortMode } from './components/ShelfToolbar'
import { Toast, useToast } from './components/Toast'
import { sfx, setSoundEnabled } from './sound'

type View = 'machine' | 'shelf' | 'space'

/** 能力筛选 chip 的固定显示顺序 */
const PERM_ORDER = ['ai', 'db', 'storage', 'fs', 'notify', 'schedule', 'window', 'network']

export default function App() {
  const { t } = useTranslation()
  const [eggs, setEggs] = useState<EggInfo[]>([])
  const [view, setView] = useState<View>('machine')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [closePromptOpen, setClosePromptOpen] = useState(false)
  const [loginOpen, setLoginOpen] = useState(false)
  const [userPanelOpen, setUserPanelOpen] = useState(false)
  const [selectedEgg, setSelectedEgg] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{ id: string; name: string } | null>(null)
  const [importConflict, setImportConflict] = useState<{ file: string; eggId: string; name: string } | null>(null)
  const { toast, showToast } = useToast()
  const [syncStatuses, setSyncStatuses] = useState<Record<string, SyncStatus>>({})
  const [cloudOnlyEggs, setCloudOnlyEggs] = useState<CloudEggInfo[]>([])
  const [downloadQueue, setDownloadQueue] = useState<string[]>([])
  const [activeDownload, setActiveDownload] = useState<string | null>(null)
  const [downloadProgress, setDownloadProgress] = useState<Record<string, number>>({})
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ stage: 'idle' })
  const [showUpdateDialog, setShowUpdateDialog] = useState(false)
  const [hasSyncAccess, setHasSyncAccess] = useState(false)
  const [auth, setAuth] = useState<AuthStatus>({ loggedIn: false })
  const gacha = useSyncExternalStore(subscribeGacha, getGachaState)

  // ─── 搜索 / 筛选 / 排序 ───
  const [query, setQuery] = useState('')
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [activePerm, setActivePerm] = useState<string | null>(null)
  const [sort, setSort] = useState<SortMode>('newest')
  const [catData, setCatData] = useState<CategoryData>({ categories: [], assignments: {} })

  const refresh = useCallback(() => {
    shelf.list().then(setEggs).catch(err => showToast(err.message))
  }, [showToast])

  useEffect(refresh, [refresh])

  // 登录状态 + 云同步权限判定
  useEffect(() => {
    const checkAuth = () => {
      shelf.authStatus().then(s => {
        setAuth(s)
        // 登录后拉取套餐信息，判断是否有云同步权限
        if (s.loggedIn) {
          shelf.billingSummary().then(b => {
            const enabled = (b.plan?.storage_quota_bytes ?? 0) > 0
            setHasSyncAccess(enabled)
            shelf.setSyncEnabled(enabled)
          }).catch((err) => { console.error('[App] billingSummary failed:', (err as Error).message); setHasSyncAccess(false); shelf.setSyncEnabled(false) })
        } else {
          setHasSyncAccess(false)
          shelf.setSyncEnabled(false)
        }
      }).catch((err) => { console.error('[App] authStatus failed:', (err as Error).message) })
    }
    checkAuth()
    shelf.onAuthChanged(() => checkAuth())
  }, [])

  // 拉取云端蛋列表 → 推算每个蛋的同步状态 + 云端独有蛋（仅 Pro 用户）
  const refreshSyncStatuses = useCallback(() => {
    if (!hasSyncAccess) { setCloudOnlyEggs([]); return }
    shelf.syncList().then(cloudEggs => {
      const localIds = new Set(eggs.map(e => e.eggId))
      // 云端独有：在云端但不在本地的蛋
      const cloudOnly = cloudEggs.filter(c => !localIds.has(c.egg_id))
      setCloudOnlyEggs(cloudOnly)
      // 同步状态：本地蛋是否在云端
      const cloudSet = new Set(cloudEggs.map(e => e.egg_id))
      setSyncStatuses(prev => {
        const next: Record<string, SyncStatus> = {}
        for (const egg of eggs) {
          // 正在同步中的保持 syncing，不覆盖
          if (prev[egg.eggId] === 'syncing') {
            next[egg.eggId] = 'syncing'
          } else {
            next[egg.eggId] = cloudSet.has(egg.eggId) ? 'synced' : 'local'
          }
        }
        return next
      })
    }).catch((err) => { console.error('[App] syncList failed:', (err as Error).message) })
  }, [hasSyncAccess, eggs])

  useEffect(() => { refreshSyncStatuses() }, [refreshSyncStatuses])

  useEffect(() => { shelf.getCategories().then(setCatData).catch((err) => { console.error('[App] getCategories failed:', (err as Error).message) }) }, [])

  // 启动时应用音效开关持久化状态
  useEffect(() => { shelf.getAppSettings().then(s => setSoundEnabled(s.soundEnabled)).catch((err) => { console.error('[App] getAppSettings failed:', (err as Error).message) }) }, [])

  useEffect(() => onGachaDone(r => {
    refresh()
    if (r.ok) sfx.taDa()  // 出蛋/升级成功：ta-da 庆祝音
    showToast(r.ok
      ? (r.upgraded ? t('app.eggUpgraded', { name: r.name }) : t('app.eggCreated', { name: r.name }))
      : (r.upgraded ? t('app.upgradeFailed') : t('app.eggFailed')))
    // 系统通知：窗口在后台时才发（渲染端发，跟随 UI 语言）
    if (!document.hasFocus() && 'Notification' in window && Notification.permission !== 'denied') {
      new Notification(
        r.ok
          ? (r.upgraded ? t('notify.upgradedTitle') : t('notify.createdTitle'))
          : (r.upgraded ? t('notify.failedUpgradedTitle') : t('notify.failedTitle')),
        { body: r.ok
            ? (r.upgraded ? t('notify.upgradedBody', { name: r.name }) : t('notify.createdBody', { name: r.name }))
            : tr(t, r.error).slice(0, 120) }
      )
    }
  }), [refresh, showToast, t])

  // 蛋柜变动（双击 .gacha 热导入等）：主进程推送后重拉列表，新蛋即时上架
  useEffect(() => { shelf.onEggsChanged(() => refresh()) }, [refresh])

  // 平台通道扣费可见化：构建结算完成后提示“本次消耗 X 积分，剩余 Y”
  useEffect(() => shelf.onBillingSettled(p => {
    showToast(t('app.creditsSpent', { spent: p.spent, balance: p.balance }))
  }), [showToast, t])

  // 外部唤起聚焦空间（快捷方式/收藏柜点开已在空间的蛋）：切到空间视图
  useEffect(() => { shelf.onSpaceFocus(() => setView('space')) }, [])

  // .gacha 导入冲突弹窗（双击/导入的 .gacha 与已有蛋 eggId 相同）
  useEffect(() => { shelf.onImportConflict(p => setImportConflict(p)) }, [])

  // 全屏弹窗（设置/关闭确认/登录）打开时隐藏空间蛋视图：原生 WebContentsView 会盖在所有 DOM 弹窗之上
  const viewRef = useRef(view)
  viewRef.current = view
  const modalOpen = settingsOpen || closePromptOpen || loginOpen || userPanelOpen
  useEffect(() => {
    if (!modalOpen) return
    shelf.spaceSetVisible(false)
    return () => { shelf.spaceSetVisible(viewRef.current === 'space') }
  }, [modalOpen])

  // ─── 下载队列处理器（串行） ───
  useEffect(() => {
    if (activeDownload) return // 正忙
    if (downloadQueue.length === 0) return // 无事可做
    const [next, ...rest] = downloadQueue
    setDownloadQueue(rest)
    setActiveDownload(next)
    setDownloadProgress(prev => ({ ...prev, [next]: 0 }))
    shelf.syncDownload(next).then(result => {
      showToast(t('shelf.eggDownloaded', { name: result.name }))
      refresh()
    }).catch(err => {
      const msg = (err as Error).message
      showToast(t('shelf.downloadFailed', { msg: msg === 'SYNC_PRO_REQUIRED' ? t('shelf.syncNeedPro') : msg }))
    }).finally(() => {
      setActiveDownload(null)
      setDownloadProgress(prev => { const n = { ...prev }; delete n[next]; return n })
    })
  }, [activeDownload, downloadQueue])

  // ─── 下载进度监听 ───
  useEffect(() => shelf.onDownloadProgress((p: DownloadProgress) => {
    setDownloadProgress(prev => ({ ...prev, [p.eggId]: p.percent }))
  }), [])

  // ─── 更新状态监听 ───
  useEffect(() => {
    shelf.getUpdateStatus().then(setUpdateStatus).catch((err) => { console.error('[App] getUpdateStatus failed:', (err as Error).message) })
    shelf.onUpdateStateChanged(s => {
      setUpdateStatus(s as UpdateStatus)
      if ((s as UpdateStatus).stage === 'downloaded') setShowUpdateDialog(true)
    })
  }, [])

  // 关闭拦截后由主进程推送询问，这里弹出项目风格弹窗，回传用户选择
  useEffect(() => shelf.onClosePrompt(() => setClosePromptOpen(true)), [])

  const handleUpgrade = (eggId: string, name: string) => {
    setGachaUpgrade({ eggId, name })
    setView('machine')
  }

  const handleImport = async () => {
    try {
      const res = await shelf.import()
      if (res.imported) { showToast(t('app.imported', { name: res.name })); refresh() }
    } catch (err) { showToast((err as Error).message) }
  }

  // ─── 单蛋云同步 ───
  const handleSyncEgg = async (eggId: string) => {
    setSyncStatuses(prev => ({ ...prev, [eggId]: 'syncing' }))
    try {
      const result = await shelf.syncEgg(eggId)
      if (result.action === 'downloaded') refresh()
      const actionText = result.action === 'uploaded' ? t('shelf.syncUploaded')
        : result.action === 'downloaded' ? t('shelf.syncDownloaded')
        : result.action === 'skipped' ? t('shelf.syncSkipped')
        : result.error ?? result.action
      showToast(t('shelf.syncEggDone', { name: eggs.find(e => e.eggId === eggId)?.name ?? eggId, action: actionText }))
      // 更新云状态：直接切换到终态，refreshSyncStatuses 的 syncing 保护会阻止它覆盖
      if (result.action !== 'error') {
        setSyncStatuses(prev => ({ ...prev, [eggId]: 'synced' }))
      } else {
        setSyncStatuses(prev => ({ ...prev, [eggId]: 'error' }))
      }
    } catch (err) {
      const msg = (err as Error).message
      showToast(msg === 'SYNC_PRO_REQUIRED' ? t('shelf.syncNeedPro') : msg)
      setSyncStatuses(prev => ({ ...prev, [eggId]: 'error' }))
    }
  }

  // ─── 云端蛋下载（队列模式：已排队/下载中的忽略） ───
  const handleDownloadCloudEgg = (eggId: string) => {
    if (activeDownload === eggId || downloadQueue.includes(eggId)) return
    setDownloadQueue(prev => [...prev, eggId])
  }

  // ─── 云端蛋删除 ───
  const handleDeleteCloudEgg = async (eggId: string, name: string) => {
    try {
      const ok = await shelf.syncDeleteCloud(eggId)
      if (ok) {
        setCloudOnlyEggs(prev => prev.filter(c => c.egg_id !== eggId))
        showToast(t('shelf.cloudDeleted', { name }))
      } else {
        showToast(t('shelf.cloudDeleteFailed', { name }))
      }
    } catch (err) {
      showToast((err as Error).message)
    }
  }

  // ─── 分类操作（乐观更新，失败提示不阻断） ───
  const createCategory = (name: string) => {
    shelf.saveCategory({ name }).then(cat => {
      setCatData(d => ({ ...d, categories: [...d.categories, cat] }))
    }).catch(err => showToast((err as Error).message))
  }
  const renameCategory = (id: string, name: string) => {
    shelf.saveCategory({ id, name }).then(cat => {
      setCatData(d => ({ ...d, categories: d.categories.map(c => c.id === id ? cat : c) }))
    }).catch(err => showToast((err as Error).message))
  }
  const deleteCategory = (id: string) => {
    const cat = catData.categories.find(c => c.id === id)
    if (!cat) return
    setConfirm({ id: cat.id, name: cat.name })
  }
  const confirmDeleteCategory = () => {
    if (!confirm) return
    const cid = confirm.id
    shelf.deleteCategory(cid).then(() => {
      setCatData(d => ({
        categories: d.categories.filter(c => c.id !== cid),
        assignments: Object.fromEntries(Object.entries(d.assignments).filter(([, catId]) => catId !== cid))
      }))
      setActiveCategory(cur => cur === cid ? null : cur)
      setConfirm(null)
    }).catch(err => showToast((err as Error).message))
  }
  const setEggCategory = (eggId: string, categoryId: string | null) => {
    shelf.setEggCategory(eggId, categoryId).then(() => {
      setCatData(d => {
        const assignments = { ...d.assignments }
        if (categoryId === null) delete assignments[eggId]
        else assignments[eggId] = categoryId
        return { ...d, assignments }
      })
    }).catch(err => showToast((err as Error).message))
  }

  // ─── 筛选 + 排序 ───
  const availablePerms = useMemo(
    () => PERM_ORDER.filter(perm => eggs.some(e => e.permissions.includes(perm))),
    [eggs]
  )

  const filteredEggs = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = eggs
    if (q) list = list.filter(e => e.name.toLowerCase().includes(q) || e.wish.toLowerCase().includes(q))
    if (activeCategory) list = list.filter(e => catData.assignments[e.eggId] === activeCategory)
    if (activePerm) list = list.filter(e => e.permissions.includes(activePerm))
    return [...list].sort(sort === 'name'
      ? (a, b) => a.name.localeCompare(b.name, 'zh')
      : (a, b) => b.createdAt - a.createdAt)
  }, [eggs, query, activeCategory, activePerm, sort, catData])

  // 云端蛋仅受搜索关键词影响，不参与分类/权限/排序筛选
  const filteredCloudEggs = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return cloudOnlyEggs
    return cloudOnlyEggs.filter(c => c.egg_name.toLowerCase().includes(q))
  }, [cloudOnlyEggs, query])

  const clearFilters = () => { setQuery(''); setActiveCategory(null); setActivePerm(null) }

  return (
    <ErrorBoundary>
      <div className="h-screen flex flex-col overflow-hidden bg-cream">
        {/* Custom Title Bar */}
        <TitleBar
        view={view}
        onViewChange={setView}
        gachaRunning={gacha.running}
        gachaStage={gacha.running ? t('app.gachaRunning') : null}
        onImport={handleImport}
        onSettings={() => setSettingsOpen(true)}
        onLoginOpenChange={setLoginOpen}
        onUserPanelOpenChange={setUserPanelOpen}
      />

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        <AnimatePresence mode="wait">
          {view === 'machine' ? (
            <motion.div
              key="machine"
              className="h-full"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0, transition: { type: 'spring', stiffness: 200, damping: 20, mass: 0.8 } }}
              exit={{ opacity: 0, transition: { duration: 0.15, ease: 'easeOut' } }}
            >
              <MachineView onToast={showToast} onEggCreated={refresh} />
            </motion.div>
          ) : view === 'space' ? (
            <motion.div
              key="space"
              className="h-full"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0, transition: { type: 'spring', stiffness: 200, damping: 20, mass: 0.8 } }}
              exit={{ opacity: 0, transition: { duration: 0.15, ease: 'easeOut' } }}
            >
              <SpaceView eggs={eggs} onToast={showToast} onChanged={refresh} dimmed={modalOpen} />
            </motion.div>
          ) : (
            <motion.div
              key="shelf"
              className="h-full flex flex-col"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ type: 'spring', stiffness: 200, damping: 20, mass: 0.8 }}
            >
              <ShelfToolbar
                query={query}
                onQuery={setQuery}
                categories={catData.categories}
                activeCategory={activeCategory}
                onCategory={setActiveCategory}
                onCreateCategory={createCategory}
                onRenameCategory={renameCategory}
                onDeleteCategory={deleteCategory}
                availablePerms={availablePerms}
                activePerm={activePerm}
                onPerm={setActivePerm}
                sort={sort}
                onSort={setSort}
                resultCount={filteredEggs.length}
                totalCount={eggs.length}
              />
              <div
                className="flex-1 overflow-auto shelf-scroll p-6"
                onClick={() => setSelectedEgg(null)}
              >
                <div className="grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-x-4 gap-y-7 px-6 py-8 min-h-[200px]">
                  {/* 全空：本地和云端都没有蛋 */}
                  {eggs.length === 0 && cloudOnlyEggs.length === 0 ? (
                    <div className="col-span-full flex flex-col items-center justify-center min-h-[240px] gap-3">
                      {/* 空架引导：虚线球体 */}
                      <div
                        onClick={(e) => { e.stopPropagation(); setView('machine') }}
                        className="w-[88px] h-[88px] rounded-full border-[3px] border-dashed border-text/25 flex items-center justify-center cursor-pointer hover:border-brand hover:bg-brand/[0.03] transition-colors select-none group"
                        title={t('app.wishTooltip')}
                      >
                        <div className="text-3xl text-[#d4cfc8] group-hover:text-brand transition-colors">?</div>
                      </div>
                      <div className="text-center">
                        <p className="text-[13px] text-muted font-medium">{t('app.emptyTitle')}</p>
                        <p className="text-xs text-muted/60 mt-1">{t('app.emptyHint')}</p>
                      </div>
                    </div>
                  ) : filteredEggs.length === 0 && filteredCloudEggs.length === 0 ? (
                    /* 筛选后全空 */
                    <div className="col-span-full flex flex-col items-center justify-center min-h-[240px] gap-3">
                      <p className="text-[13px] text-muted font-medium">{t('app.noMatch')}</p>
                      <button
                        onClick={(e) => { e.stopPropagation(); clearFilters() }}
                        className="text-xs text-muted underline underline-offset-2 hover:text-brand transition-colors"
                      >
                        {t('app.clearFilters')}
                      </button>
                    </div>
                  ) : (
                    <>
                      {/* 本地蛋 */}
                      {filteredEggs.map(egg => (
                        <EggCard
                          key={egg.eggId}
                          egg={egg}
                          selected={selectedEgg === egg.eggId}
                          dimmed={selectedEgg !== null && selectedEgg !== egg.eggId}
                          onSelect={setSelectedEgg}
                          onToast={showToast}
                          onChanged={refresh}
                          onUpgrade={() => handleUpgrade(egg.eggId, egg.name)}
                          categories={catData.categories}
                          categoryId={catData.assignments[egg.eggId] ?? null}
                          onSetCategory={setEggCategory}
                          {...(hasSyncAccess ? {
                            syncStatus: syncStatuses[egg.eggId] ?? 'local' as SyncStatus,
                            onSyncEgg: handleSyncEgg,
                          } : {})}
                        />
                      ))}
                      {/* 分隔：云端未下载 */}
                      {filteredCloudEggs.length > 0 && (
                        <div className="col-span-full flex items-center gap-3 mt-2 mb-1 first:mt-0">
                          <div className="flex-1 h-px bg-text/10" />
                          <span className="text-[11px] font-semibold text-muted/50 whitespace-nowrap">{t('shelf.cloudOnly')}</span>
                          <div className="flex-1 h-px bg-text/10" />
                        </div>
                      )}
                      {filteredCloudEggs.map(ce => {
                        const qIdx = ce.egg_id === activeDownload ? 0
                          : downloadQueue.indexOf(ce.egg_id)
                        const qPos = qIdx >= 0 ? qIdx : -1
                        return (
                          <CloudEggCard
                            key={ce.egg_id}
                            egg={ce}
                            queuePosition={qPos}
                            progress={qPos === 0 ? (downloadProgress[ce.egg_id] ?? 0) : undefined}
                            onDownload={() => handleDownloadCloudEgg(ce.egg_id)}
                            onDelete={() => handleDeleteCloudEgg(ce.egg_id, ce.egg_name)}
                          />
                        )
                      })}
                    </>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Resize handles for frameless window */}
      <ResizeHandles />

      {/* 3D 视口：单 Canvas 覆盖全屏，每颗蛋用自己的 View 锚定 DOM 位置 */}
      <Canvas
        style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 10 }}
        gl={{ antialias: true, alpha: true }}
        dpr={[1, 2]}
      >
        <DreiView.Port />
      </Canvas>

      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} onToast={showToast} />}
      {confirm && (
        <ConfirmDialog
          title={t('app.deleteCategoryTitle', { name: confirm.name })}
          message={t('app.deleteCategoryConfirm', { name: confirm.name })}
          danger
          onConfirm={confirmDeleteCategory}
          onCancel={() => setConfirm(null)}
        />
      )}
      {importConflict && (
        <ConfirmDialog
          title={t('app.importConflictTitle')}
          message={t('app.importConflictMsg', { name: importConflict.name })}
          confirmText={t('app.importConflictImport')}
          cancelText={t('app.importConflictOpen')}
          onConfirm={() => {
            shelf.resolveImportConflict(importConflict.file, importConflict.eggId, 'import')
            setImportConflict(null)
          }}
          onCancel={() => {
            shelf.resolveImportConflict(importConflict.file, importConflict.eggId, 'open')
            setImportConflict(null)
          }}
        />
      )}
      {showUpdateDialog && updateStatus.stage === 'downloaded' && (
        <UpdateDialog
          version={updateStatus.version ?? ''}
          onInstall={() => { shelf.installUpdate(); setShowUpdateDialog(false) }}
          onDismiss={() => setShowUpdateDialog(false)}
        />
      )}
      {closePromptOpen && (
        <ClosePromptDialog
          onCancel={() => setClosePromptOpen(false)}
          onResolve={async (action, remember) => {
            setClosePromptOpen(false)
            await shelf.resolveCloseAction(action, remember)
          }}
        />
      )}
      <Toast toast={toast} />
      </div>
    </ErrorBoundary>
  )
}

/** Thin resize borders for frameless window edges */
function ResizeHandles() {
  // macOS 的 NSWindow 原生支持边缘缩放，CSS resize handles 会与之冲突
  if (typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || '')) return null

  const style = (cursor: string, top?: number, bottom?: number, left?: number, right?: number): React.CSSProperties => ({
    position: 'fixed',
    zIndex: 9999,
    cursor,
    top, bottom, left, right
  })
  return (
    <>
      {/* top edge is the title bar drag region — no extra resize handle needed */}
      <div style={style('s-resize', undefined, 0, 0, 0)} className="h-1" />       {/* bottom */}
      <div style={style('e-resize', 0, 0, undefined, 0)} className="w-1" />        {/* right */}
      <div style={style('w-resize', 0, 0, 0, undefined)} className="w-1" />        {/* left */}
      <div style={style('se-resize', undefined, 0, undefined, 0)} className="w-2 h-2" /> {/* bottom-right */}
      <div style={style('sw-resize', undefined, 0, 0)} className="w-2 h-2" />      {/* bottom-left */}
    </>
  )
}
