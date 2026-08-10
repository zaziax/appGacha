import { useRef, useEffect, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { ChevronDown } from 'lucide-react'
import type { GachaProgress } from '../shelf'
import { sfx } from '../sound'

/* ================================================================
   立式方形扭蛋机 —— 塔式机身：方形玻璃橱窗 + 小旋钮 + 投币口 + 取蛋口。
   旋钮克制为一个简单的圆钮，不加多余装饰。
   ================================================================ */

interface Props {
  stage: GachaProgress['stage'] | null
  running: boolean
  /** AI 完成生成——旋钮邀请转动，用户亲手开蛋 */
  resultReady: boolean
  /** 开蛋仪式（棘轮→落蛋→开壳）完成后回调 */
  onReveal: () => void
}

// 高饱和扭蛋壳配色
const BALL_COLORS = ['#E52521', '#049CD8', '#43B047', '#FBD000', '#FF8C00', '#9B59B6', '#FF69B4']
const OUTLINE = '#4A3B32'
const BALL_RADIUS = 13
const GRAVITY = 0.15
const FRICTION = 0.98
const BOUNCE = 0.6
const BALL_COUNT = 18

export function GachaVisual({ stage, running, resultReady, onReveal }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number>(0)
  const agitatedRef = useRef(false)
  const knobRef = useRef<HTMLDivElement>(null)
  const knobAngle = useRef(0)
  const crankInterval = useRef<number>(0)
  const [coinIn, setCoinIn] = useState(false)
  const [dropping, setDropping] = useState(false)
  const [cracking, setCracking] = useState(false)
  const [revealing, setRevealing] = useState(false)
  const timers = useRef<number[]>([])

  const later = (fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms))
  }

  // ---- 物理引擎 ----
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    const ctx = canvas.getContext('2d')!
    ctx.scale(dpr, dpr)
    const W = rect.width; const H = rect.height

    const balls: Ball[] = []
    for (let i = 0; i < BALL_COUNT; i++) balls.push(new Ball(W, H))

    const step = () => {
      ctx.clearRect(0, 0, W, H)
      for (const b of balls) b.update(W, H, agitatedRef.current)
      resolveCollisions(balls)
      for (const b of balls) b.draw(ctx)
      rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(rafRef.current)
  }, [])

  // ---- 管线阶段 → 机器反应 ----
  useEffect(() => {
    if (stage === 'coin') {
      sfx.coin()
      setCoinIn(true)
      later(() => setCoinIn(false), 600)
    }
    if (stage === 'crank') {
      agitatedRef.current = true
      sfx.crank()
      spinKnob(360 + Math.random() * 180)
      // 长时间生成期间，旋钮持续缓慢转动——"机器在干活"
      clearInterval(crankInterval.current)
      crankInterval.current = window.setInterval(() => spinKnob(120), 2200)
    }
    if (stage === 'clack') {
      agitatedRef.current = false
      clearInterval(crankInterval.current)
      sfx.drop()
      setDropping(true)
    }
    if (stage === 'pop' || stage === 'fail') {
      agitatedRef.current = false
      clearInterval(crankInterval.current)
      setDropping(false)
    }
  }, [stage])

  // ---- 清理 ----
  useEffect(() => () => {
    timers.current.forEach(clearTimeout)
    clearInterval(crankInterval.current)
  }, [])

  const spinKnob = (deg: number) => {
    knobAngle.current += deg
    if (knobRef.current) {
      knobRef.current.style.transform = `rotate(${knobAngle.current}deg)`
    }
  }

  // ---- 开蛋仪式：棘轮 → 落蛋 → 开壳 ----
  const handleKnob = useCallback(() => {
    if (running || revealing) return

    if (resultReady) {
      setRevealing(true)
      agitatedRef.current = true
      sfx.crank()
      spinKnob(360 + Math.random() * 180)

      later(() => {
        agitatedRef.current = false
        sfx.drop()
        setDropping(true)

        later(() => {
          sfx.crack()
          setCracking(true)

          later(() => {
            setDropping(false)
            setCracking(false)
            setRevealing(false)
            onReveal()
          }, 500)
        }, 750)
      }, 950)
    } else {
      // 闲置时拧一下——给点物理回应
      sfx.tick()
      spinKnob(90)
      agitatedRef.current = true
      later(() => { agitatedRef.current = false }, 400)
    }
  }, [running, revealing, resultReady, onReveal])

  return (
    <div className="flex flex-col items-center select-none gap-2.5">
      {/* ======== 机器整体（hover 微倾） ======== */}
      <motion.div
        whileHover={running ? undefined : { rotateY: 3, rotateX: -2, y: -5 }}
        transition={{ type: 'spring', stiffness: 180, damping: 14 }}
        style={{ transformPerspective: 1000 }}
        className="relative"
      >
        <div className="relative" style={{ width: 300, height: 448 }}>

          {/* ======== 地面阴影 ======== */}
          <div className="absolute left-1/2 -translate-x-1/2 top-[426px] w-[210px] h-[14px] rounded-[50%] bg-text/15 blur-[3px]" />

          {/* ======== 小短腿 ======== */}
          <div className="absolute top-[400px] left-[64px] w-[34px] h-[24px] rounded-b-[9px] border-4 border-t-0 border-text"
            style={{ background: 'linear-gradient(180deg, #A82F29, #8A2620)' }} />
          <div className="absolute top-[400px] right-[64px] w-[34px] h-[24px] rounded-b-[9px] border-4 border-t-0 border-text"
            style={{ background: 'linear-gradient(180deg, #A82F29, #8A2620)' }} />

          {/* ======== 塔式机身 ======== */}
          <div className="absolute inset-x-[50px] top-[20px] h-[384px] rounded-[18px] border-[5px] border-text z-10 overflow-hidden"
            style={{
              background: 'linear-gradient(165deg, #F07068 0%, #E8564E 30%, #D0433B 75%, #B93830 100%)',
              boxShadow: [
                'inset 10px 6px 0 rgba(255,255,255,0.16)',
                'inset -12px -8px 0 rgba(0,0,0,0.10)',
                '8px 12px 0 rgba(74,59,50,0.12)'
              ].join(', ')
            }} />

          {/* ======== 方形玻璃橱窗 ======== */}
          <div className="absolute left-[64px] right-[64px] top-[36px] h-[176px] rounded-[12px] border-[5px] border-text overflow-hidden z-20"
            style={{
              background: 'linear-gradient(180deg, rgba(224,242,255,0.96) 0%, rgba(255,255,255,0.90) 55%, rgba(236,246,255,0.94) 100%)',
              boxShadow: 'inset 0 -10px 16px rgba(92,64,51,0.08), inset 8px 8px 14px rgba(255,255,255,0.7)'
            }}>
            <canvas ref={canvasRef} className="w-full h-full block" />
            {/* 玻璃高光 */}
            <div className="absolute top-[12px] left-[14px] w-[30px] h-[100px] rounded-[18px] pointer-events-none rotate-[18deg]"
              style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.85), rgba(255,255,255,0.05))' }} />
            <div className="absolute top-[24px] right-[20px] w-[11px] h-[44px] rounded-[8px] pointer-events-none rotate-[-14deg]"
              style={{ background: 'rgba(255,255,255,0.55)' }} />
          </div>

          {/* ======== 金属饰条（橱窗与控制区分界） ======== */}
          <div className="absolute top-[206px] inset-x-[44px] h-[14px] rounded-[7px] border-[3.5px] border-text z-30 flex items-center justify-between px-[10px]"
            style={{
              background: 'linear-gradient(180deg, #FFE9A8, #F5C84C 55%, #E0A82E)',
              boxShadow: 'inset 0 2px 0 rgba(255,255,255,0.4), 0 2px 0 rgba(74,59,50,0.10)'
            }}>
            <Bolt /><Bolt />
          </div>

          {/* ======== 投币面板 ======== */}
          <div className="absolute right-[66px] top-[238px] w-[32px] h-[50px] rounded-[9px] border-4 border-text z-20 flex items-center justify-center"
            style={{
              background: 'linear-gradient(180deg, #FFD86B, #F0B429)',
              boxShadow: 'inset 0 3px 0 rgba(255,255,255,0.35), 2px 3px 0 rgba(74,59,50,0.12)'
            }}>
            <div className="w-[4.5px] h-[22px] rounded-full bg-text/85" style={{ boxShadow: 'inset 0 2px 3px rgba(0,0,0,0.5)' }} />
            {/* 硬币投入动画 */}
            <AnimatePresence>
              {coinIn && (
                <motion.div
                  className="absolute -top-1 left-1/2 w-[20px] h-[20px] rounded-full border-[3px] border-text z-10"
                  style={{ background: 'radial-gradient(circle at 35% 30%, #FFE88A, #F0A830 70%, #C07D10)' }}
                  initial={{ x: '-50%', y: -32, opacity: 1, scaleY: 1 }}
                  animate={{ x: '-50%', y: [-32, 5, 9], scaleY: [1, 1, 0.15], opacity: [1, 1, 0] }}
                  transition={{ duration: 0.55, times: [0, 0.7, 1], ease: 'easeIn' }}
                  exit={{ opacity: 0 }}
                />
              )}
            </AnimatePresence>
          </div>

          {/* ======== 简单旋钮（小圆钮 + 一字握把） ======== */}
          <div className="absolute left-[84px] top-[230px] z-20">
            {/* 邀请摆动（结果就绪时） */}
            <motion.div
              animate={resultReady && !revealing ? { rotate: [0, -10, 10, -6, 6, 0] } : { rotate: 0 }}
              transition={{ duration: 1.1, repeat: resultReady ? Infinity : 0, repeatDelay: 1, ease: 'easeInOut' }}
            >
              <div
                className={`relative w-[72px] h-[72px] rounded-full border-[4.5px] border-text cursor-pointer flex items-center justify-center transition-shadow ${resultReady ? 'ring-4 ring-amber-300/70' : ''}`}
                style={{
                  background: 'radial-gradient(circle at 40% 32%, #FFFFFF, #F2EAE0 82%)',
                  boxShadow: resultReady
                    ? 'inset 0 -5px 0 rgba(92,64,51,0.08), 3px 4px 0 rgba(0,0,0,0.10), 0 0 24px rgba(255,180,50,0.55)'
                    : 'inset 0 -5px 0 rgba(92,64,51,0.08), 3px 4px 0 rgba(0,0,0,0.10)'
                }}
                onClick={handleKnob}
              >
                {/* 旋转体：一字握把 + 中心盖（程序化旋转） */}
                <div ref={knobRef} className="absolute inset-0 flex items-center justify-center"
                  style={{ transition: 'transform 0.9s cubic-bezier(0.22, 1.2, 0.36, 1)' }}>
                  <div className="absolute w-[50px] h-[13px] rounded-full border-[3px] border-text"
                    style={{ background: 'linear-gradient(180deg, #6FB1F5, #4A90E8 55%, #3573C9)', boxShadow: 'inset 0 -2.5px 0 rgba(0,0,0,0.14)' }} />
                  <div className="w-[24px] h-[24px] rounded-full border-[3px] border-text z-[2] flex items-center justify-center"
                    style={{ background: 'radial-gradient(circle at 36% 30%, #F5837C, #E8564E 62%, #C93B34)', boxShadow: 'inset -2px -2px 0 rgba(0,0,0,0.12)' }}>
                    <div className="w-[6px] h-[6px] rounded-full bg-white/45" />
                  </div>
                </div>
              </div>
            </motion.div>
          </div>

          {/* ======== 取蛋口 ======== */}
          <div className="absolute left-1/2 -translate-x-1/2 top-[325px] w-[112px] h-[54px] rounded-[12px_12px_28px_28px] border-[5px] border-text z-20"
            style={{
              background: 'linear-gradient(180deg, #241C17, #3A2E27)',
              boxShadow: 'inset 0 10px 16px rgba(0,0,0,0.55), 0 2px 0 rgba(255,255,255,0.10)',
              perspective: '220px'
            }}>
            {/* 橡皮挡片（落蛋时被顶开） */}
            <motion.div className="absolute top-[2px] left-[6px] w-[44px] h-[14px] rounded-b-[12px] origin-top"
              style={{ background: '#1A1410' }}
              animate={dropping && !cracking ? { rotateX: 65 } : { rotateX: 0 }}
              transition={{ duration: 0.25 }} />
            <motion.div className="absolute top-[2px] right-[6px] w-[44px] h-[14px] rounded-b-[12px] origin-top"
              style={{ background: '#1A1410' }}
              animate={dropping && !cracking ? { rotateX: 65 } : { rotateX: 0 }}
              transition={{ duration: 0.25 }} />
            {/* 落下的扭蛋 */}
            <AnimatePresence>
              {dropping && (
                <motion.div className="absolute left-1/2 bottom-[4px] z-20" style={{ x: '-50%' }}
                  initial={{ y: -78, scale: 0.55, opacity: 1 }}
                  animate={cracking
                    ? { y: 0, scale: 1, opacity: 1 }
                    : { y: [-78, 0, -15, 0, -5, 0], scale: [0.55, 1.1, 0.95, 1.04, 0.99, 1], opacity: 1 }
                  }
                  transition={cracking
                    ? { duration: 0.1 }
                    : { duration: 0.72, times: [0, 0.38, 0.56, 0.72, 0.86, 1], ease: 'easeOut' }
                  }
                  exit={{ opacity: 0, scale: 0.6, transition: { duration: 0.25 } }}
                >
                  <Capsule cracking={cracking} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* ======== 结果就绪：橱窗周围微光 ======== */}
          {resultReady && !revealing && (
            <>
              <Sparkle x={40} y={40} size={15} delay={0} />
              <Sparkle x={246} y={34} size={12} delay={0.6} />
              <Sparkle x={30} y={150} size={10} delay={1.1} />
              <Sparkle x={256} y={146} size={13} delay={1.5} />
            </>
          )}
        </div>
      </motion.div>

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
          {resultReady ? '转动旋钮，亲手开蛋' : revealing ? '扭蛋出来了…' : running ? '机芯正在打造愿望…' : '拧一下旋钮试试'}
        </p>
      </div>
    </div>
  )
}

/* ================================================================
   小部件：铆钉 / 闪光
   ================================================================ */

function Bolt() {
  return (
    <div className="w-[8px] h-[8px] rounded-full border-2 border-text"
      style={{ background: 'radial-gradient(circle at 36% 30%, #FFF3D6, #E8C86A 70%, #C89B3C)', boxShadow: 'inset -1.5px -1.5px 0 rgba(0,0,0,0.15)' }} />
  )
}

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

/* ================================================================
   扭蛋壳 —— CSS 双半球（与收藏柜 Capsule3D 同设计语言）
   ================================================================ */
function Capsule({ cracking }: { cracking: boolean }) {
  return (
    <div className="relative w-[54px] h-[54px]">
      {/* 上半壳（透明白） */}
      <motion.div
        className="absolute inset-x-0 top-0 h-[28px] rounded-t-full border-[3.5px] border-b-0 border-text overflow-hidden"
        style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.97), rgba(238,243,255,0.8))' }}
        animate={cracking ? { y: -24, rotate: -16, opacity: 0 } : { y: 0, rotate: 0, opacity: 1 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
      >
        <div className="absolute top-[5px] left-[9px] w-[11px] h-[15px] rounded-full bg-white/75 rotate-[22deg]" />
      </motion.div>
      {/* 下半壳（琥珀金） */}
      <motion.div
        className="absolute inset-x-0 bottom-0 h-[28px] rounded-b-full border-[3.5px] border-t-0 border-text"
        style={{ background: 'linear-gradient(180deg, #FFD700, #F0B429 60%, #D49B1E)' }}
        animate={cracking ? { y: 15, opacity: 0 } : { y: 0, opacity: 1 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
      />
      {/* 接缝环 */}
      {!cracking && (
        <div className="absolute top-1/2 -translate-y-1/2 inset-x-[1px] h-[5px] rounded-full bg-text/70" />
      )}
    </div>
  )
}

/* ================================================================
   Canvas 物理 —— 双色素球（白顶+彩底+接缝线），碰撞
   ================================================================ */

class Ball {
  x: number; y: number; r: number
  vx: number; vy: number
  color: string

  constructor(W: number, H: number) {
    this.r = BALL_RADIUS
    this.x = Math.random() * (W - this.r * 2) + this.r
    this.y = Math.random() * (H * 0.6) + this.r
    this.vx = (Math.random() - 0.5) * 2
    this.vy = (Math.random() - 0.5) * 2
    this.color = BALL_COLORS[Math.floor(Math.random() * BALL_COLORS.length)]
  }

  update(W: number, H: number, agitated: boolean) {
    this.vy += GRAVITY
    this.vx *= FRICTION
    this.vy *= FRICTION
    this.x += this.vx
    this.y += this.vy

    if (this.x - this.r < 0) { this.x = this.r; this.vx *= -BOUNCE }
    if (this.x + this.r > W) { this.x = W - this.r; this.vx *= -BOUNCE }
    if (this.y - this.r < 0) { this.y = this.r; this.vy *= -BOUNCE }
    if (this.y + this.r > H) { this.y = H - this.r; this.vy *= -BOUNCE }

    if (agitated) {
      this.vx += (Math.random() - 0.5) * 3
      this.vy += (Math.random() - 0.5) * 3
    }
  }

  draw(ctx: CanvasRenderingContext2D) {
    const { x, y, r } = this
    // 下半（彩色）
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI)
    ctx.fillStyle = this.color
    ctx.fill()
    // 上半（白）
    ctx.beginPath()
    ctx.arc(x, y, r, Math.PI, Math.PI * 2)
    ctx.fillStyle = '#FDFBF7'
    ctx.fill()
    // 接缝线
    ctx.beginPath()
    ctx.moveTo(x - r, y)
    ctx.lineTo(x + r, y)
    ctx.strokeStyle = OUTLINE
    ctx.lineWidth = 2
    ctx.stroke()
    // 外描边
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.lineWidth = 2.5
    ctx.strokeStyle = OUTLINE
    ctx.stroke()
    // 高光点
    ctx.beginPath()
    ctx.arc(x - r * 0.32, y - r * 0.36, r * 0.22, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(255,255,255,0.9)'
    ctx.fill()
  }
}

function resolveCollisions(balls: Ball[]) {
  for (let i = 0; i < balls.length; i++) {
    for (let j = i + 1; j < balls.length; j++) {
      const a = balls[i], b = balls[j]
      const dx = b.x - a.x, dy = b.y - a.y
      const dist = Math.sqrt(dx * dx + dy * dy)
      const minDist = a.r + b.r
      if (dist < minDist) {
        const angle = Math.atan2(dy, dx)
        const overlap = minDist - dist
        const moveX = Math.cos(angle) * overlap * 0.5
        const moveY = Math.sin(angle) * overlap * 0.5
        a.x -= moveX; a.y -= moveY
        b.x += moveX; b.y += moveY
        const tvx = a.vx, tvy = a.vy
        a.vx = b.vx * BOUNCE; a.vy = b.vy * BOUNCE
        b.vx = tvx * BOUNCE; b.vy = tvy * BOUNCE
      }
    }
  }
}
