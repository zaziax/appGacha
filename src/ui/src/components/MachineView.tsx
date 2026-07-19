import { useState, useSyncExternalStore } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Sparkles } from 'lucide-react'
import { shelf, GachaProgress } from '../shelf'
import { getGachaState, subscribeGacha, beginGacha, clearGachaResult, dismissResult } from '../gachaStore'

const SPRING_GENTLE = { type: 'spring' as const, stiffness: 100, damping: 18, mass: 1 }
const SPRING_BOUNCE = { type: 'spring' as const, stiffness: 180, damping: 14, mass: 0.8 }
const SPRING_POP = { type: 'spring' as const, stiffness: 200, damping: 10, mass: 0.6 }

function stageLabel(s: GachaProgress['stage']): string {
  switch (s) {
    case 'coin': return '投币…'
    case 'crank': return '旋钮转动…'
    case 'clack': return '机芯咔咔…'
    case 'pop': return '咔哒！'
    case 'fail': return '这次没扭出好蛋'
    default: return '扭蛋中…'
  }
}

interface Props {
  onToast: (msg: string) => void
  onEggCreated: () => void
}

export function MachineView({ onToast, onEggCreated }: Props) {
  const gacha = useSyncExternalStore(subscribeGacha, getGachaState)
  const [text, setText] = useState('')

  const isIdle = !gacha.running && !gacha.result

  const submitWish = async () => {
    const wish = text.trim()
    if (wish.length < 2) return
    try {
      if (gacha.upgrade) {
        await shelf.upgrade(gacha.upgrade.eggId, wish)
      } else {
        await shelf.wish(wish)
      }
      beginGacha(gacha.upgrade)
      setText('')
      onEggCreated()
    } catch (err) {
      onToast((err as Error).message)
    }
  }

  const closeResult = () => {
    clearGachaResult()
    onEggCreated()
  }

  return (
    <div className="max-w-lg mx-auto px-6 py-8 flex flex-col items-center gap-6 select-none">
      {/* ---- Machine SVG ---- */}
      <MachineIllustration stage={gacha.running ? gacha.stage : null} />

      {/* ---- Idle: Wish Form ---- */}
      <AnimatePresence mode="wait">
        {isIdle && (
          <motion.div
            key="form"
            className="w-full flex flex-col gap-3"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={SPRING_GENTLE}
          >
            <h2 className="text-lg font-semibold text-center text-text tracking-wide">
              {gacha.upgrade
                ? `给「${gacha.upgrade.name}」许愿升级`
                : '许个愿，扭一颗应用'}
            </h2>
            <p className="text-xs text-muted text-center leading-relaxed">
              {gacha.upgrade
                ? '说出想改进的地方，机芯会在原有功能和数据的基础上改造它。升级前会自动整蛋备份。'
                : '说出你想要的小应用，机芯会为你扭一颗出来。数据、提醒、AI 它都会自带。'}
            </p>
            <textarea
              rows={4}
              autoFocus
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder={gacha.upgrade
                ? '例如：加一个夜间模式，并统计每天的使用次数'
                : '例如：我想要一个番茄钟，25 分钟专注 + 5 分钟休息，结束时提醒我，并统计每天完成了几个番茄'}
              className="w-full p-3 border border-[#ddd9d2] rounded-xl text-sm leading-relaxed resize-y outline-none focus:border-brand transition-colors font-[system-ui,'Microsoft_YaHei',sans-serif]"
            />
            <div className="flex gap-2 justify-end">
              {gacha.upgrade && (
                <button
                  className="px-4 py-2 text-sm text-muted hover:text-text transition-colors"
                  onClick={() => { clearGachaResult(); setText('') }}
                >
                  取消升级
                </button>
              )}
              <button
                onClick={submitWish}
                className="flex items-center gap-2 px-6 py-2.5 bg-brand text-white rounded-xl font-medium text-sm hover:bg-brand-hover active:scale-95 transition-all"
              >
                <Sparkles className="w-4 h-4" />
                投币，开扭！
              </button>
            </div>
          </motion.div>
        )}

        {/* ---- Running: Progress ---- */}
        {gacha.running && (
          <motion.div
            key="progress"
            className="flex flex-col items-center gap-2"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={SPRING_GENTLE}
          >
            <p className="text-lg font-semibold text-text tracking-widest">
              {stageLabel(gacha.stage)}
            </p>
            {gacha.detail && (
              <p className="text-sm text-muted text-center max-w-xs">
                {gacha.detail}
              </p>
            )}
          </motion.div>
        )}

        {/* ---- Result ---- */}
        {gacha.result && (
          <motion.div
            key="result"
            className="w-full bg-white rounded-2xl p-5 shadow-lg border border-[#eceae5]"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={SPRING_BOUNCE}
          >
            <h2 className="text-lg font-semibold text-center mb-2">
              {gacha.result.ok
                ? (gacha.result.upgraded
                    ? <>咔哒！「{gacha.result.name}」升级完成</>
                    : <>咔哒！「{gacha.result.name}」出蛋了</>)
                : (gacha.result.upgraded ? '这次升级没成…' : '这次没扭出好蛋…')}
            </h2>
            <p className="text-sm text-muted text-center mb-4">
              {gacha.result.ok
                ? (gacha.result.upgraded
                    ? '数据完好，代码焕然一新（不满意可在蛋卡片上还原）'
                    : '已放进你的收藏柜，切到收藏柜看看')
                : `${gacha.result.error ?? ''}${gacha.result.upgraded ? '（蛋还是原来的样子，没有被动过）' : ''}`}
            </p>
            <div className="flex gap-2 justify-center">
              {gacha.result.ok && gacha.result.eggId && (
                <button
                  onClick={() => {
                    shelf.open(gacha.result!.eggId!).catch(err => onToast(err.message))
                    closeResult()
                  }}
                  className="px-5 py-2 bg-brand text-white rounded-xl text-sm font-medium hover:bg-brand-hover active:scale-95 transition-all"
                >
                  打开看看
                </button>
              )}
              {!gacha.result.ok && (
                <button
                  onClick={dismissResult}
                  className="px-5 py-2 bg-brand text-white rounded-xl text-sm font-medium hover:bg-brand-hover active:scale-95 transition-all"
                >
                  再来一发
                </button>
              )}
              <button
                onClick={closeResult}
                className="px-5 py-2 border border-[#ddd9d2] rounded-xl text-sm text-muted hover:text-text active:scale-95 transition-all"
              >
                好的
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ---- SVG Machine Illustration ---- */
function MachineIllustration({ stage }: { stage: GachaProgress['stage'] | null }) {
  return (
    <motion.div
      className="w-[280px]"
      animate={stage === 'fail' ? { filter: 'grayscale(0.6) brightness(0.7)' } : { filter: 'grayscale(0) brightness(1)' }}
      transition={{ duration: 0.6 }}
    >
      <svg viewBox="0 0 320 430" className="w-full h-auto block" style={{ filter: 'drop-shadow(0 8px 24px rgba(0,0,0,0.15))' }}>
        <defs>
          <linearGradient id="bodyGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#fef9f0" />
            <stop offset="100%" stopColor="#f0e2cc" />
          </linearGradient>
          <linearGradient id="domeGlass" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(255,255,255,0.45)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0.08)" />
          </linearGradient>
          <linearGradient id="woodGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#c8a870" />
            <stop offset="100%" stopColor="#a08050" />
          </linearGradient>
          <linearGradient id="metalGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#e8d8b0" />
            <stop offset="100%" stopColor="#c8b080" />
          </linearGradient>
          <radialGradient id="domeGlow" cx="0.5" cy="0.35" r="0.5">
            <stop offset="0%" stopColor="rgba(255,255,255,0.5)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0)" />
          </radialGradient>
        </defs>

        {/* ---- 底座 ---- */}
        <rect x="55" y="340" width="210" height="16" rx="8" fill="url(#woodGrad)" />
        <rect x="70" y="356" width="44" height="10" rx="5" fill="#a08050" />
        <rect x="206" y="356" width="44" height="10" rx="5" fill="#a08050" />

        {/* ---- 机身 ---- */}
        <rect x="70" y="90" width="180" height="252" rx="26" fill="url(#bodyGrad)" stroke="#d4c5a0" strokeWidth="2" />

        {/* ---- 面板 ---- */}
        <rect x="84" y="200" width="152" height="110" rx="14" fill="rgba(255,255,255,0.25)" stroke="#e8d8c0" strokeWidth="1" />
        <circle cx="160" cy="240" r="30" fill="rgba(255,255,255,0.3)" stroke="#d4c5a0" strokeWidth="1.5" />
        <circle cx="160" cy="240" r="18" fill="rgba(255,255,255,0.2)" stroke="#ddd0b8" strokeWidth="1" />

        {/* ---- 投币口 ---- */}
        <rect x="146" y="76" width="28" height="10" rx="5" fill="#3a3030" />
        <rect x="150" y="72" width="20" height="5" rx="2.5" fill="#5a4a3a" />

        {/* ---- 穹顶环 ---- */}
        <ellipse cx="160" cy="90" rx="74" ry="14" fill="url(#metalGrad)" stroke="#c8b080" strokeWidth="1.5" />

        {/* ---- 玻璃穹顶 ---- */}
        <ellipse cx="160" cy="48" rx="74" ry="48" fill="url(#domeGlass)" stroke="#d4c5a0" strokeWidth="2" />
        <ellipse cx="155" cy="35" rx="40" ry="22" fill="url(#domeGlow)" />

        {/* ---- 穹顶内胶囊 ---- */}
        {[[125, 38], [150, 28], [180, 32], [140, 55], [170, 50], [195, 48]].map(([cx, cy], i) => (
          <g key={i}>
            <rect x={cx - 8} y={cy - 5} width={16} height={10} rx={5} fill={
              ['#ff9a4a', '#5ac08a', '#5aa8e8', '#f07090', '#f8d050', '#ff9a4a'][i]
            } opacity={0.55} />
            <rect x={cx - 6} y={cy - 4} width={12} height={4} rx={2} fill="rgba(255,255,255,0.3)" />
          </g>
        ))}

        {/* ---- 出货口 ---- */}
        <path d="M 122 342 L 116 365 Q 160 382 204 365 L 198 342 Z" fill="#3a3030" />
        <path d="M 126 342 L 194 342" stroke="#2a2020" strokeWidth="1.5" />

        {/* ---- 旋钮 ---- */}
        <circle cx="250" cy="210" r="18" fill="url(#metalGrad)" stroke="#c8b080" strokeWidth="2" />
        <circle cx="250" cy="210" r="10" fill="#d4c0a0" stroke="#b89870" strokeWidth="1.5" />
        <motion.g
          animate={stage === 'crank' ? { rotate: 360 } : { rotate: 0 }}
          transition={stage === 'crank' ? { duration: 1.6, repeat: Infinity, ease: 'linear' } : { duration: 0.3 }}
          style={{ originX: '250px', originY: '210px' }}
        >
          <line x1="250" y1="210" x2="268" y2="194" stroke="#b89870" strokeWidth="5" strokeLinecap="round" />
          <circle cx="270" cy="192" r="7" fill="#e07030" stroke="#c05820" strokeWidth="1.5" />
        </motion.g>

        {/* ---- 牌匾 ---- */}
        <text x="160" y="186" textAnchor="middle" fill="#c8a870" fontSize="12" fontWeight="600" fontFamily="system-ui, sans-serif" letterSpacing="6">应用扭蛋</text>
      </svg>

      {/* ---- Animated capsule overlay ---- */}
      <AnimatePresence mode="wait">
        {stage === 'coin' && (
          <motion.div key="coin" className="absolute inset-0 pointer-events-none"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div className="absolute left-1/2 -translate-x-1/2 w-[38px] h-[52px] rounded-[50%]"
              style={{
                background: 'linear-gradient(160deg, #ff9a4a 0%, #e07030 50%, #c05820 100%)',
                boxShadow: '0 4px 16px rgba(224,112,48,0.45), inset 0 -4px 8px rgba(0,0,0,0.15), inset 0 4px 8px rgba(255,255,255,0.35)'
              }}
              initial={{ top: -60 }}
              animate={{ top: [-40, 60, 72] }}
              transition={{ duration: 1.2, times: [0, 0.5, 1], ease: 'easeIn' }}
            />
          </motion.div>
        )}
        {stage === 'crank' && (
          <motion.div key="crank" className="absolute inset-0 pointer-events-none"
            initial={{ opacity: 0 }} animate={{ opacity: 0.8 }} exit={{ opacity: 0 }}>
            <motion.div className="absolute left-1/2 -translate-x-1/2 top-[62px] w-[38px] h-[52px] rounded-[50%]"
              style={{
                background: 'linear-gradient(160deg, #ff9a4a 0%, #e07030 50%, #c05820 100%)',
                boxShadow: '0 4px 16px rgba(224,112,48,0.45), inset 0 -4px 8px rgba(0,0,0,0.15), inset 0 4px 8px rgba(255,255,255,0.35)'
              }}
              animate={{ x: [-8, 10, -6, 8, -4, 4, 0], y: [-4, 2, -3, 1, -1, 0, 0], rotate: [-12, 8, -6, 10, -4, 2, 0] }}
              transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
            />
          </motion.div>
        )}
        {stage === 'clack' && (
          <motion.div key="clack" className="absolute inset-0 pointer-events-none"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div className="absolute left-1/2 -translate-x-1/2 w-[38px] h-[52px] rounded-[50%]"
              style={{
                background: 'linear-gradient(160deg, #ff9a4a 0%, #e07030 50%, #c05820 100%)',
                boxShadow: '0 4px 16px rgba(224,112,48,0.45)'
              }}
              initial={{ top: 200, opacity: 0 }}
              animate={{ top: [200, 310, 340, 355], opacity: 1, rotate: [0, 180, 360, 540] }}
              transition={{ duration: 1.0, times: [0, 0.5, 0.75, 1], ease: 'easeIn' }}
            />
          </motion.div>
        )}
        {stage === 'pop' && <PopCelebration key="pop" />}
        {stage === 'fail' && (
          <motion.div key="fail" className="absolute inset-0 pointer-events-none"
            initial={{ opacity: 0 }} animate={{ opacity: 0.5 }} exit={{ opacity: 0 }}>
            <motion.div className="absolute left-1/2 -translate-x-1/2 top-1/2 -mt-[26px] w-[38px] h-[52px] rounded-[50%]"
              style={{
                background: 'linear-gradient(160deg, #c0b8b0 0%, #a09890 50%, #888078 100%)',
                boxShadow: '0 4px 12px rgba(0,0,0,0.2)'
              }}
              animate={{ x: [-4, 4, -3, 2, 0] }}
              transition={{ duration: 0.5, ease: 'easeInOut' }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

/** pop 粒子爆发 */
function PopCelebration() {
  const dots = Array.from({ length: 16 }, (_, i) => {
    const angle = (i / 16) * Math.PI * 2
    const dist = 60 + Math.random() * 80
    const colors = ['#e8843c', '#f0c040', '#5ac08a', '#5aa8e8', '#f07090', '#f8d050', '#8ac8f0', '#ffb870']
    return {
      tx: Math.cos(angle) * dist,
      ty: Math.sin(angle) * dist - 20,
      color: colors[i % colors.length],
      size: 4 + Math.random() * 6,
      delay: Math.random() * 0.15
    }
  })

  return (
    <motion.div
      key="pop"
      className="absolute inset-0 pointer-events-none"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div className="absolute left-1/2 -translate-x-1/2 top-1/2 -mt-[26px] w-[38px] h-[52px] rounded-[50%]"
        style={{
          background: 'linear-gradient(160deg, #ff9a4a 0%, #e07030 50%, #c05820 100%)',
          boxShadow: '0 0 30px rgba(255,180,80,0.7), 0 8px 24px rgba(224,112,48,0.5)'
        }}
        initial={{ scale: 1 }}
        animate={{ scale: [1, 1.3, 0] }}
        transition={{ duration: 0.8, times: [0, 0.3, 0.6], ease: 'easeOut' }}
      />
      {dots.map((d, i) => (
        <motion.div
          key={i}
          className="absolute left-1/2 top-1/2"
          style={{
            width: d.size, height: d.size,
            borderRadius: d.size > 5 ? '50%' : 2,
            background: d.color,
            '--tx': `${d.tx}px`, '--ty': `${d.ty}px`
          } as React.CSSProperties}
          initial={{ x: 0, y: 0, opacity: 0, scale: 0 }}
          animate={{ x: d.tx, y: d.ty, opacity: [0, 1, 0], scale: [0, 1.2, 0.8] }}
          transition={{ duration: 0.8, delay: d.delay, ease: 'easeOut' }}
        />
      ))}
    </motion.div>
  )
}
