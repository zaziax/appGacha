import { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { ChevronDown } from 'lucide-react'
import type { GachaProgress } from '../shelf'
import { sfx } from '../sound'

/* ================================================================
   愿望胶囊 —— 与"扭蛋机"不同的交互隐喻（A/B 对比用，勿覆盖 GachaVisual）。

   扭蛋机 = "操作一台机器"（投币→拧旋钮→机器吐出），写实、机械。
   愿望胶囊 = "孵化一颗有生命的蛋"：画面中央只有一颗大胶囊，
   透过半透明上壳能看到"愿望光球"在里面逐渐凝聚；
   就绪后轻点胶囊，上壳弹飞、下壳沉落、光球迸发，亲手把它打开。

   焦点从"机器"转移到"你的愿望本身"——更情感化、更任天堂。
   Props 接口与 GachaVisual 完全一致，可在 MachineView 中直接替换对比。
   ================================================================ */

interface Props {
  stage: GachaProgress['stage'] | null
  running: boolean
  /** AI 完成生成——胶囊邀请轻点，用户亲手开启 */
  resultReady: boolean
  /** 开启仪式（摇晃→开壳→迸发）完成后回调 */
  onReveal: () => void
}

const OUTLINE = '#4A3B32'
const CAPSULE = 158            // 胶囊直径

export function GachaCapsule({ stage, running, resultReady, onReveal }: Props) {
  const [revealing, setRevealing] = useState(false)
  const [opened, setOpened] = useState(false)      // 开壳瞬间
  const [burst, setBurst] = useState(false)        // 光球迸发
  const timers = useRef<number[]>([])
  const later = (fn: () => void, ms: number) => { timers.current.push(window.setTimeout(fn, ms)) }

  useEffect(() => () => { timers.current.forEach(clearTimeout) }, [])

  // ---- 管线阶段 → 音效（视觉由 running/stage 驱动） ----
  useEffect(() => {
    if (stage === 'coin') sfx.coin()
    if (stage === 'crank') sfx.crank()
    if (stage === 'clack') sfx.drop()
  }, [stage])

  // ---- 开启仪式：摇晃 → 开壳 → 迸发 ----
  const handleTap = useCallback(() => {
    if (running || revealing) return

    if (resultReady) {
      setRevealing(true)
      sfx.crank()

      later(() => {
        sfx.crack()
        setOpened(true)

        later(() => {
          sfx.taDa()
          setBurst(true)

          later(() => {
            setRevealing(false)
            setOpened(false)
            setBurst(false)
            onReveal()
          }, 560)
        }, 380)
      }, 500)
    } else {
      // 闲置时点一下——给点回应
      sfx.tick()
    }
  }, [running, revealing, resultReady, onReveal])

  // 胶囊内核动画：生成中摇晃、开启前剧烈抖动、其余静止
  const innerAnim = revealing && !opened
    ? { x: [0, -7, 7, -5, 5, -3, 3, 0], rotate: [0, -5, 5, -4, 4, 0], transition: { duration: 0.45, repeat: Infinity, ease: 'easeInOut' as const } }
    : running && !revealing
      ? { rotate: [0, -3.5, 3.5, -2.5, 2.5, 0], y: [0, -3, 0, -2, 0], transition: { duration: 0.9, repeat: Infinity, ease: 'easeInOut' as const } }
      : { rotate: 0, x: 0, y: 0, transition: { duration: 0.3 } }

  const orbAlive = running || resultReady

  return (
    <div className="flex flex-col items-center justify-center select-none h-full w-full">
      {/* ======== 舞台 ======== */}
      <div className="relative" style={{ width: 250, height: 250 }}>

        {/* 背景光晕（愿望的能量场） */}
        <motion.div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full pointer-events-none"
          style={{ width: 216, height: 216, background: 'radial-gradient(circle, rgba(255,214,90,0.30) 0%, rgba(255,214,90,0) 70%)' }}
          animate={orbAlive ? { scale: [1, 1.12, 1], opacity: [0.65, 1, 0.65] } : { scale: 1, opacity: 0.35 }}
          transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
        />

        {/* 环绕能量点（生成中——"愿望正在注入"） */}
        <AnimatePresence>
          {running && !revealing && (
            <motion.div
              className="absolute left-1/2 top-1/2 w-0 h-0"
              initial={{ opacity: 0 }} animate={{ opacity: 1, rotate: 360 }} exit={{ opacity: 0 }}
              transition={{ rotate: { duration: 2.6, repeat: Infinity, ease: 'linear' }, opacity: { duration: 0.3 } }}
            >
              {[0, 120, 240].map(deg => (
                <div key={deg} className="absolute -left-[5px] -top-[5px] w-2.5 h-2.5 rounded-full"
                  style={{ background: '#FBD000', transform: `rotate(${deg}deg) translateX(100px)`, boxShadow: '0 0 10px rgba(251,208,0,0.9)' }} />
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {/* 地面阴影（随浮动呼吸） */}
        <motion.div
          className="absolute left-1/2 -translate-x-1/2 rounded-[50%] bg-text/15 blur-[3px] pointer-events-none"
          style={{ bottom: 16, width: 112, height: 16 }}
          animate={{ scaleX: [1, 0.86, 1], opacity: [0.8, 0.55, 0.8] }}
          transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
        />

        {/* ======== 胶囊（浮动层 → 交互层 → 内核） ======== */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          {/* 浮动呼吸 */}
          <motion.div
            animate={{ y: [0, -8, 0] }}
            transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
          >
            {/* 交互层 */}
            <motion.div
              className="relative cursor-pointer"
              style={{ width: CAPSULE, height: CAPSULE }}
              onClick={handleTap}
              whileHover={!running && !revealing ? { scale: 1.05 } : undefined}
              whileTap={!running && !revealing ? { scale: 0.95 } : undefined}
              transition={{ type: 'spring', stiffness: 300, damping: 18 }}
            >
              {/* 内核（摇晃/抖动的主体） */}
              <motion.div className="relative w-full h-full" animate={innerAnim}>

                {/* 愿望光球（透过上壳可见——"愿望正在成形"） */}
                <motion.div
                  className="absolute rounded-full pointer-events-none"
                  style={{
                    width: 88, height: 88, left: '50%', top: '46%', x: '-50%', y: '-50%',
                    background: 'radial-gradient(circle, #FFF6D6 0%, #FFD75E 42%, rgba(255,180,40,0) 72%)',
                    filter: 'blur(2px)', zIndex: 20,
                  }}
                  animate={burst
                    ? { scale: 2.8, opacity: 0 }
                    : orbAlive
                      ? { scale: [0.85, 1.14, 0.85], opacity: [0.75, 1, 0.75] }
                      : { scale: 0.55, opacity: 0.3 }}
                  transition={burst
                    ? { duration: 0.5, ease: 'easeOut' }
                    : orbAlive ? { duration: 1.5, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.4 }}
                />

                {/* 上半壳（透明白——光球从这里透出来） */}
                <motion.div
                  className="absolute inset-x-0 top-0 rounded-t-full overflow-hidden"
                  style={{
                    height: CAPSULE / 2, zIndex: 30,
                    background: 'linear-gradient(180deg, rgba(255,255,255,0.96), rgba(233,241,255,0.55))',
                    border: `4px solid ${OUTLINE}`, borderBottom: 'none',
                    boxShadow: 'inset 7px 7px 14px rgba(255,255,255,0.85)',
                  }}
                  animate={opened ? { y: -74, rotate: -22, opacity: 0 } : { y: 0, rotate: 0, opacity: 1 }}
                  transition={{ duration: 0.42, ease: [0.22, 1.2, 0.36, 1] }}
                >
                  <div className="absolute top-3.5 left-4 w-6 h-10 rounded-full bg-white/80 rotate-[24deg]" />
                </motion.div>

                {/* 下半壳（琥珀金） */}
                <motion.div
                  className="absolute inset-x-0 bottom-0 rounded-b-full"
                  style={{
                    height: CAPSULE / 2, zIndex: 10,
                    background: 'linear-gradient(180deg, #FFD75E, #F0B429 55%, #D49B1E)',
                    border: `4px solid ${OUTLINE}`, borderTop: 'none',
                    boxShadow: 'inset -7px -9px 0 rgba(0,0,0,0.10)',
                  }}
                  animate={opened ? { y: 48, opacity: 0 } : { y: 0, opacity: 1 }}
                  transition={{ duration: 0.42, ease: 'easeOut' }}
                />

                {/* 接缝环 */}
                {!opened && (
                  <div className="absolute top-1/2 -translate-y-1/2 inset-x-[3px] h-[7px] rounded-full pointer-events-none"
                    style={{ background: `${OUTLINE}`, opacity: 0.72, zIndex: 40 }} />
                )}
              </motion.div>
            </motion.div>
          </motion.div>
        </div>

        {/* 就绪微光（环绕胶囊的金色四角星） */}
        {resultReady && !revealing && (
          <>
            <Sparkle x={28} y={52} size={15} delay={0} />
            <Sparkle x={206} y={44} size={12} delay={0.5} />
            <Sparkle x={20} y={168} size={10} delay={1} />
            <Sparkle x={214} y={160} size={13} delay={1.4} />
          </>
        )}

        {/* 迸发粒子 */}
        <AnimatePresence>{burst && <SparkleBurst />}</AnimatePresence>
      </div>

      {/* ======== 游戏提示 ======== */}
      <div className="flex flex-col items-center gap-0.5 h-[34px] justify-end">
        <AnimatePresence>
          {resultReady && !revealing && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1, y: [0, 4, 0] }} exit={{ opacity: 0 }}
              transition={{ y: { repeat: Infinity, duration: 0.65, ease: 'easeInOut' } }}>
              <ChevronDown className="w-4 h-4 text-brand" strokeWidth={3.5} />
            </motion.div>
          )}
        </AnimatePresence>
        <p className={`text-xs font-extrabold tracking-wide transition-colors ${resultReady ? 'text-brand' : 'text-muted/60'}`}>
          {resultReady ? '轻点胶囊，亲手开启' : revealing ? '愿望迸发中…' : running ? '愿望正在成形…' : '胶囊在等待一个愿望'}
        </p>
      </div>
    </div>
  )
}

/* ================================================================
   小部件：四角微光 / 迸发粒子
   ================================================================ */

function Sparkle({ x, y, size, delay }: { x: number; y: number; size: number; delay: number }) {
  return (
    <motion.div className="absolute pointer-events-none z-40" style={{ left: x, top: y, width: size, height: size }}
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: [0, 1.2, 0], opacity: [0, 1, 0], rotate: [0, 90] }}
      transition={{ duration: 1.3, delay, repeat: Infinity, repeatDelay: 0.7, ease: 'easeInOut' }}>
      <div className="w-full h-full" style={{
        clipPath: 'polygon(50% 0%, 62% 38%, 100% 50%, 62% 62%, 50% 100%, 38% 62%, 0% 50%, 38% 38%)',
        background: 'linear-gradient(135deg, #FFFBEA, #FBD000)'
      }} />
    </motion.div>
  )
}

/** 开壳瞬间的环形粒子迸发 */
function SparkleBurst() {
  const parts = useMemo(() => Array.from({ length: 12 }, (_, i) => ({
    angle: (i / 12) * Math.PI * 2,
    dist: 62 + Math.random() * 42,
    size: 6 + Math.random() * 8,
    delay: Math.random() * 0.08,
    gold: i % 2 === 0,
  })), [])

  return (
    <div className="absolute left-1/2 top-1/2 pointer-events-none z-50">
      {parts.map((p, i) => (
        <motion.div key={i} className="absolute rounded-full"
          style={{ width: p.size, height: p.size, left: 0, top: 0, background: p.gold ? '#FBD000' : '#FF8C00', boxShadow: '0 0 8px rgba(251,208,0,0.7)' }}
          initial={{ x: 0, y: 0, scale: 1, opacity: 1 }}
          animate={{ x: Math.cos(p.angle) * p.dist, y: Math.sin(p.angle) * p.dist, scale: 0, opacity: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.6, delay: p.delay, ease: 'easeOut' }}
        />
      ))}
    </div>
  )
}
