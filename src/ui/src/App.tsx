import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { shelf, EggInfo } from './shelf'
import { getGachaState, subscribeGacha, onGachaDone, setGachaUpgrade } from './gachaStore'
import { TitleBar } from './components/TitleBar'
import { MachineView } from './components/MachineView'
import { EggCard } from './components/EggCard'
import { SettingsDialog } from './components/SettingsDialog'
import { Toast, useToast } from './components/Toast'

type View = 'machine' | 'shelf'

export default function App() {
  const [eggs, setEggs] = useState<EggInfo[]>([])
  const [view, setView] = useState<View>('machine')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const { toast, showToast } = useToast()
  const gacha = useSyncExternalStore(subscribeGacha, getGachaState)

  const refresh = useCallback(() => {
    shelf.list().then(setEggs).catch(err => showToast(err.message))
  }, [showToast])

  useEffect(refresh, [refresh])

  useEffect(() => onGachaDone(r => {
    refresh()
    showToast(r.ok
      ? (r.upgraded ? `咔哒！「${r.name}」升级完成` : `咔哒！「${r.name}」出蛋了，已入柜`)
      : (r.upgraded ? '这次升级没成，点许愿按钮看详情' : '这次没扭出好蛋，点许愿按钮看详情'))
  }), [refresh, showToast])

  const handleUpgrade = (eggId: string, name: string) => {
    setGachaUpgrade({ eggId, name })
    setView('machine')
  }

  const handleImport = async () => {
    try {
      const res = await shelf.import()
      if (res.imported) { showToast(`「${res.name}」已入柜！`); refresh() }
    } catch (err) { showToast((err as Error).message) }
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-cream">
      {/* Custom Title Bar */}
      <TitleBar
        view={view}
        onViewChange={setView}
        gachaRunning={gacha.running}
        gachaStage={gacha.running ? '扭蛋中…' : null}
        onImport={handleImport}
        onSettings={() => setSettingsOpen(true)}
      />

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        <AnimatePresence mode="wait">
          {view === 'machine' ? (
            <motion.div
              key="machine"
              className="h-full"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ type: 'spring', stiffness: 200, damping: 20, mass: 0.8 }}
            >
              <MachineView onToast={showToast} onEggCreated={refresh} />
            </motion.div>
          ) : (
            <motion.div
              key="shelf"
              className="h-full overflow-auto p-6"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ type: 'spring', stiffness: 200, damping: 20, mass: 0.8 }}
            >
              <div className="grid grid-cols-[repeat(auto-fill,minmax(156px,1fr))] gap-4 p-5 min-h-[200px]">
                  {eggs.length > 0 ? (
                    eggs.map(egg => (
                      <EggCard
                        key={egg.eggId}
                        egg={egg}
                        onToast={showToast}
                        onChanged={refresh}
                        onUpgrade={() => handleUpgrade(egg.eggId, egg.name)}
                      />
                    ))
                  ) : (
                    <div className="col-span-full flex flex-col items-center justify-center min-h-[240px] gap-3">
                      <div
                        onClick={() => setView('machine')}
                        className="w-[56px] h-[80px] rounded-[28px] border-[3px] border-dashed border-text/30 flex items-center justify-center cursor-pointer hover:border-brand hover:bg-brand/[0.03] transition-colors select-none group"
                        title="许个愿，扭一颗蛋"
                      >
                        <div className="text-3xl text-[#d4cfc8] group-hover:text-brand transition-colors">?</div>
                      </div>
                      <div className="text-center">
                        <p className="text-[13px] text-muted font-medium">收藏柜空空如也</p>
                        <p className="text-xs text-muted/60 mt-1">许个愿扭一颗，或者导入别人分享的 .egg</p>
                      </div>
                    </div>
                  )}
                </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Resize handles for frameless window */}
      <ResizeHandles />

      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} onToast={showToast} />}
      <Toast toast={toast} />
    </div>
  )
}

/** Thin resize borders for frameless window edges */
function ResizeHandles() {
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
