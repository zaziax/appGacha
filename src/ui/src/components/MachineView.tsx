import { useState, useRef, useEffect, useSyncExternalStore } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Sparkles, Egg } from 'lucide-react'
import { shelf, GachaProgress, GachaResult } from '../shelf'
import { getGachaState, subscribeGacha, beginGacha, clearGachaResult, dismissResult } from '../gachaStore'
import { GachaVisual } from './GachaVisual'

const SPRING = { type: 'spring' as const, stiffness: 200, damping: 20, mass: 0.8 }

const STYLE_CARDS = [
  { label: '番茄钟', prompt: '我想要一个番茄钟，25分钟专注+5分钟休息，结束时提醒我，并统计每天完成了几个番茄' },
  { label: '每日记账', prompt: '我想要一个每日记账本，能分类记录支出，按月统计，支持导出' },
  { label: '待办清单', prompt: '我想要一个待办清单，支持拖拽排序、设置到期时间和提醒' },
  { label: '每日诗词', prompt: '我想要一个每日诗词推荐，每天随机展示一首古诗，附带注释和赏析' },
]

interface Props { onToast: (msg: string) => void; onEggCreated: () => void }

export function MachineView({ onToast, onEggCreated }: Props) {
  const gacha = useSyncExternalStore(subscribeGacha, getGachaState)
  const [text, setText] = useState('')
  const [lastWish, setLastWish] = useState('')
  const [revealed, setRevealed] = useState(true)
  const msgEnd = useRef<HTMLDivElement>(null)
  const hasActivity = gacha.running || (gacha.result && revealed)
  const resultReady = !!(gacha.result && !revealed && !gacha.running)

  // When gacha completes, defer reveal
  useEffect(() => {
    if (gacha.result && !gacha.running) setRevealed(false)
  }, [gacha.result, gacha.running])

  useEffect(() => { msgEnd.current?.scrollIntoView({ behavior: 'smooth' }) }, [gacha.stage])

  const submitWish = async () => {
    const wish = text.trim(); if (wish.length < 2) return
    setLastWish(wish); setText('')
    try {
      if (gacha.upgrade) await shelf.upgrade(gacha.upgrade.eggId, wish)
      else await shelf.wish(wish)
      beginGacha(gacha.upgrade); onEggCreated()
    } catch (err) { onToast((err as Error).message) }
  }

  return (
    <div className="flex h-full">
      {/* Left: Gacha Visual — cream bg */}
      <div className="w-[38%] min-w-[280px] max-w-[340px] flex items-center justify-center overflow-hidden bg-cream">
        <GachaVisual stage={gacha.running ? gacha.stage : null} running={gacha.running} resultReady={resultReady} onReveal={() => setRevealed(true)} />
      </div>

      {/* Subtle panel separator */}
      <div className="w-px bg-[#D8CCBB]" />

      {/* Right: Chat — cream bg, fits the app */}
      <div className="flex-1 flex flex-col min-w-0 bg-cream">
        {/* Header — no border, clean */}
        <div className="flex items-center gap-3 px-6 py-4">
          <Egg className="w-5 h-5 text-brand" strokeWidth={2.5} />
          <div className="flex-1 min-w-0">
            <p className="text-[14px] font-extrabold text-text">应用扭蛋助手</p>
            <p className="text-[12px] font-bold text-muted">
              {gacha.running ? '正在扭蛋…' : resultReady ? '请扭动旋钮…' : gacha.result ? '扭蛋完成' : '在线'}
            </p>
          </div>
          <span className={`w-3 h-3 rounded-full border-[3px] border-text ${gacha.running ? 'bg-brand' : resultReady ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'}`} />
        </div>

        {/* Messages — scrollable, no borders */}
        <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-3 chat-scroll">
          <AnimatePresence>
            {gacha.upgrade && (
              <motion.div className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-blue-50 border-[3px] border-text text-[12px] font-extrabold text-blue-700"
                style={{ boxShadow: '3px 3px 0 rgba(91,141,239,0.2)' }}
                initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                <Sparkles className="w-3.5 h-3.5 shrink-0" strokeWidth={2.5} />
                <span className="flex-1 truncate">正在升级「{gacha.upgrade.name}」</span>
                <button className="underline shrink-0 font-extrabold" onClick={() => { clearGachaResult(); setLastWish('') }}>取消</button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Welcome */}
          <AnimatePresence>
            {!hasActivity && !lastWish && (
              <motion.div key="welcome" className="flex flex-col gap-4" {...fadeIn}>
                {/* AI greeting — clean text, no bubble border */}
                <div className="flex gap-3">
                  <Egg className="w-5 h-5 text-brand mt-0.5 shrink-0" strokeWidth={2.5} />
                  <div className="max-w-[85%]">
                    <p className="text-[14px] leading-relaxed font-extrabold text-text">你好！告诉我你想要什么应用，我来帮你扭一颗蛋 🥚</p>
                    <p className="text-[13px] text-muted mt-2 leading-relaxed font-bold">每颗蛋都是一个自带数据、提醒和 AI 能力的小应用。试试下面的例子，或者自己描述一个。</p>
                  </div>
                </div>
                {/* Style suggestion cards — bordered card-like objects */}
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {STYLE_CARDS.map(c => (
                    <button key={c.label} onClick={() => setText(c.prompt)}
                      className="shrink-0 px-4 py-3 rounded-2xl border-[3px] border-text bg-white hover:bg-cream transition-colors text-left"
                      style={{ boxShadow: '4px 4px 0 rgba(92,64,51,0.15)' }}>
                      <p className="text-[14px] font-extrabold text-text">{c.label}</p>
                      <p className="text-[12px] font-bold text-muted mt-1 line-clamp-2 max-w-[180px] leading-relaxed">{c.prompt}</p>
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* User message — bordered bubble (it's a standalone object) */}
          <AnimatePresence>
            {lastWish && (
              <motion.div key="user-msg" className="flex justify-end" {...fadeIn}>
                <div className="bg-brand text-white rounded-2xl rounded-tr-md px-4 py-3 max-w-[80%] border-[3px] border-text"
                  style={{ boxShadow: '4px 4px 0 rgba(92,64,51,0.2)' }}>
                  <p className="text-[14px] leading-relaxed font-extrabold">{lastWish}</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Progress — clean AI response, no border */}
          <AnimatePresence>
            {gacha.running && (
              <motion.div key="progress" className="flex gap-3" {...fadeIn}>
                <Egg className="w-5 h-5 text-brand mt-0.5 shrink-0" strokeWidth={2.5} />
                <div className="max-w-[85%]">
                  <div className="flex items-center gap-2">
                    <motion.span animate={{ rotate: 360 }} transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}>
                      <Sparkles className="w-4 h-4 text-brand" strokeWidth={2.5} />
                    </motion.span>
                    <span className="text-[14px] font-extrabold text-text">{progressLabel(gacha.stage)}</span>
                  </div>
                  {gacha.detail && <p className="text-[13px] text-muted mt-1 font-bold">{gacha.detail}</p>}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Result card — only shown after user turns knob */}
          <AnimatePresence>
            {gacha.result && revealed && (
              <motion.div key="result" className="flex gap-3" {...fadeIn}>
                <Egg className="w-5 h-5 text-brand mt-0.5 shrink-0" strokeWidth={2.5} />
                <ResultCard result={gacha.result}
                  onOpen={() => { if (gacha.result?.eggId) shelf.open(gacha.result.eggId).catch(err => onToast(err.message)); clearGachaResult(); setLastWish(''); setRevealed(true); onEggCreated() }}
                  onRetry={() => { dismissResult(); setLastWish(''); setRevealed(true) }}
                  onClose={() => { clearGachaResult(); setLastWish(''); setRevealed(true); onEggCreated() }} />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Result ready prompt — tells user to turn the knob */}
          <AnimatePresence>
            {resultReady && (
              <motion.div key="ready-hint" className="flex gap-3" {...fadeIn}>
                <Egg className="w-5 h-5 text-brand mt-0.5 shrink-0" strokeWidth={2.5} />
                <div className="bg-cream rounded-2xl rounded-tl-md px-4 py-3 max-w-[85%]">
                  <p className="text-[14px] font-extrabold text-text">蛋扭好了！</p>
                  <p className="text-[13px] font-bold text-muted mt-1">转动左侧扭蛋机的旋钮，看看扭出了什么 🎉</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div ref={msgEnd} />
        </div>

        {/* Input area — no top border, bg difference separates it */}
        <div className="px-5 py-4 bg-cream">
          <div className="flex gap-3 items-end">
            <textarea rows={2} value={text} onChange={e => setText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!gacha.running) submitWish() } }}
              placeholder={gacha.upgrade ? '说说想改进什么…（Enter 发送）' : '描述你想要的应用…（Enter 发送）'}
              disabled={gacha.running}
              className="flex-1 resize-none rounded-2xl px-4 py-3 text-[14px] leading-relaxed outline-none bg-white font-bold placeholder:text-muted/40 disabled:opacity-50"
              style={{ boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.04)' }} />
            <button onClick={submitWish} disabled={gacha.running || text.trim().length < 2}
              className="shrink-0 flex items-center gap-2 px-5 py-3 bg-brand text-white rounded-2xl font-extrabold text-[14px] hover:bg-brand-hover active:translate-y-0.5 transition-all disabled:opacity-40 border-[3px] border-text"
              style={{ boxShadow: '4px 4px 0 rgba(92,64,51,0.2)' }}>
              <Sparkles className="w-4 h-4" strokeWidth={2.5} />
              <span>投币，开扭！</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// Result card — bordered card object
function ResultCard({ result, onOpen, onRetry, onClose }: {
  result: GachaResult; onOpen: () => void; onRetry: () => void; onClose: () => void
}) {
  const ok = result.ok
  return (
    <div className="bg-white rounded-2xl rounded-tl-md max-w-[90%] overflow-hidden border-[4px] border-text"
      style={{ boxShadow: '5px 5px 0 rgba(92,64,51,0.18)', borderLeft: ok ? '6px solid #5ac08a' : '6px solid #f0c040' }}>
      <div className="px-5 py-4">
        <p className="text-[15px] font-extrabold text-text">
          {ok ? (result.upgraded ? `咔哒！「${result.name}」升级完成` : `咔哒！「${result.name}」出蛋了`)
              : (result.upgraded ? '这次升级没成…' : '这次没扭出好蛋…')}
        </p>
        <p className="text-[13px] font-bold text-muted mt-1.5">
          {ok ? (result.upgraded ? '数据完好，代码焕然一新' : '已放进你的收藏柜')
              : `${result.error ?? ''}${result.upgraded ? '（蛋还是原来的样子）' : ''}`}
        </p>
      </div>
      <div className="flex gap-2 px-5 py-3">
        {ok && result.eggId && <Btn primary onClick={onOpen}>打开看看</Btn>}
        {!ok && <Btn primary onClick={onRetry}>再来一发</Btn>}
        <Btn onClick={onClose}>好的</Btn>
      </div>
    </div>
  )
}

function Btn({ children, primary, onClick }: { children: React.ReactNode; primary?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="px-4 py-2 rounded-xl text-[13px] font-extrabold active:translate-y-0.5 transition-all border-[3px] border-text"
      style={{
        background: primary ? '#D9534F' : '#fff',
        color: primary ? '#fff' : '#5C4033',
        boxShadow: '3px 3px 0 rgba(92,64,51,0.18)'
      }}>
      {children}
    </button>
  )
}

function progressLabel(s: GachaProgress['stage'] | null): string {
  switch (s) {
    case 'coin': return '投币成功，正在机芯内搜索…'
    case 'crank': return '旋钮转动，机芯正在构思…'
    case 'clack': return '机芯咔咔作响，代码正在生成…'
    case 'pop': return '咔哒！蛋已扭好'
    case 'fail': return '这次没扭出好蛋'
    default: return '扭蛋中…'
  }
}

const fadeIn = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
  transition: SPRING
}
