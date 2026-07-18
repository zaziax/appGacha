import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { shelf, EggInfo } from './shelf'
import { getGachaState, subscribeGacha, onGachaDone, setGachaUpgrade } from './gachaStore'
import { EggCard } from './components/EggCard'
import { WishDialog } from './components/WishDialog'
import { SettingsDialog } from './components/SettingsDialog'
import { Toast, useToast } from './components/Toast'

export default function App() {
  const [eggs, setEggs] = useState<EggInfo[]>([])
  const [wishOpen, setWishOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const { toast, showToast } = useToast()
  const gacha = useSyncExternalStore(subscribeGacha, getGachaState)
  const wishOpenRef = useRef(wishOpen)
  wishOpenRef.current = wishOpen

  const refresh = useCallback(() => {
    shelf.list().then(setEggs).catch(err => showToast(err.message))
  }, [showToast])

  useEffect(refresh, [refresh])

  useEffect(() => onGachaDone(r => {
    refresh()
    if (!wishOpenRef.current) {
      showToast(r.ok
        ? (r.upgraded ? `咔哒！「${r.name}」升级完成` : `咔哒！「${r.name}」出蛋了，已入柜`)
        : (r.upgraded ? '这次升级没成，点许愿按钮看详情' : '这次没扭出好蛋，点许愿按钮看详情'))
    }
  }), [refresh, showToast])

  const openWish = (upgrade: { eggId: string; name: string } | null) => {
    if (gacha.running) {
      setWishOpen(true) // 机芯忙时打开就是进度视图
      return
    }
    if (!gacha.result) {
      // 没有待查看的结果时才切换许愿对象
      setGachaUpgrade(upgrade)
    }
    setWishOpen(true)
  }

  return (
    <>
      <header>
        <div className="brand">
          <span className="logo">◓</span>
          <h1>应用扭蛋机</h1>
        </div>
        <div className="actions">
          <button
            id="wishBtn"
            className={gacha.running ? 'primary spinning' : 'primary'}
            title="说出愿望，扭一颗应用"
            onClick={() => openWish(null)}
          >
            {gacha.running ? `◓ ${stageText(gacha.stage)}` : '许个愿 ✦'}
          </button>
          <button onClick={async () => {
            try {
              const res = await shelf.import()
              if (res.imported) { showToast(`「${res.name}」已入柜！`); refresh() }
            } catch (err) { showToast((err as Error).message) }
          }}>导入扭蛋</button>
          <button title="模型设置" onClick={() => setSettingsOpen(true)}>⚙</button>
        </div>
      </header>

      <main id="grid">
        {eggs.map(egg => (
          <EggCard
            key={egg.eggId}
            egg={egg}
            onToast={showToast}
            onChanged={refresh}
            onUpgrade={() => openWish({ eggId: egg.eggId, name: egg.name })}
          />
        ))}
      </main>

      {eggs.length === 0 && (
        <div id="emptyState">
          <div className="capsule">◓</div>
          <p>收藏柜空空如也</p>
          <p className="sub">许个愿扭一颗，或者导入别人分享的 .egg</p>
        </div>
      )}

      {wishOpen && <WishDialog onClose={() => setWishOpen(false)} onToast={showToast} />}
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} onToast={showToast} />}
      <Toast toast={toast} />
    </>
  )
}

export function stageText(stage: string | null): string {
  switch (stage) {
    case 'coin': return '投币…'
    case 'crank': return '旋钮转动…'
    case 'clack': return '机芯咔咔…'
    case 'pop': return '咔哒！'
    case 'fail': return '这次没扭出好蛋'
    default: return '扭蛋中…'
  }
}
