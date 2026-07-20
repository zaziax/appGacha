import { useRef, useEffect, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import type { GachaProgress } from '../shelf'

/* ================================================================
   GACHAGO! Pro 物理拟真扭蛋机 — ported from reference.
   CSS machine shell + canvas physics + knob crank + chute drop.
   ================================================================ */

interface Props {
  stage: GachaProgress['stage'] | null
  running: boolean
  /** AI finished generating — knob pulses, user needs to turn it to reveal result */
  resultReady: boolean
  /** Called after crank→clack→drop animation completes */
  onReveal: () => void
}

// Ball physics colors
const BALL_COLORS = ['#FFD700', '#6DA3F0', '#50C878', '#E06C68', '#FFA500', '#C78DE0']
const BALL_RADIUS = 14
const GRAVITY = 0.15
const FRICTION = 0.98
const BOUNCE = 0.6
const BALL_COUNT = 18

export function GachaVisual({ stage, running, resultReady, onReveal }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const ballsRef = useRef<Ball[]>([])
  const rafRef = useRef<number>(0)
  const agitatedRef = useRef(false)
  const knobRef = useRef<HTMLDivElement>(null)
  const knobAngle = useRef(0)
  const [dropping, setDropping] = useState(false)
  const [revealing, setRevealing] = useState(false)
  const revealTimer = useRef<number>(0)

  // ---- Physics engine init ----
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

    // Init balls spread across top 60% of container
    const balls: Ball[] = []
    for (let i = 0; i < BALL_COUNT; i++) {
      balls.push(new Ball(W, H))
    }
    ballsRef.current = balls

    const step = () => {
      ctx.clearRect(0, 0, W, H)
      for (const b of balls) {
        b.update(W, H, agitatedRef.current)
      }
      resolveCollisions(balls)
      for (const b of balls) {
        b.draw(ctx)
      }
      rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)

    return () => cancelAnimationFrame(rafRef.current)
  }, [])

  // ---- Stage effects ----
  useEffect(() => {
    if (stage === 'crank') {
      // Rotate knob + agitate balls
      agitatedRef.current = true
      if (knobRef.current) {
        knobAngle.current += 360 + Math.random() * 180
        knobRef.current.style.transform = `rotate(${knobAngle.current}deg)`
      }
    }
    if (stage === 'clack') {
      // Stop agitation, drop capsule
      agitatedRef.current = false
      setDropping(true)
      setTimeout(() => setDropping(false), 800)
    }
    if (stage === 'pop' || stage === 'fail') {
      agitatedRef.current = false
      setDropping(false)
    }
  }, [stage])

  // ---- Cleanup reveal timer on unmount ----
  useEffect(() => { return () => clearTimeout(revealTimer.current) }, [])

  // ---- Knob click: if result ready → play reveal sequence ----
  const handleKnob = useCallback(() => {
    if (running || revealing) return

    if (resultReady) {
      // Play the ritual reveal sequence
      setRevealing(true)
      agitatedRef.current = true

      // Step 1: Crank — spin knob + agitate balls (1s)
      if (knobRef.current) {
        knobAngle.current += 360 + Math.random() * 180
        knobRef.current.style.transform = `rotate(${knobAngle.current}deg)`
      }
      revealTimer.current = window.setTimeout(() => {
        // Step 2: Clack — stop agitation, drop capsule
        agitatedRef.current = false
        setDropping(true)

        revealTimer.current = window.setTimeout(() => {
          // Step 3: Pop — call reveal callback
          setDropping(false)
          setRevealing(false)
          onReveal()
        }, 800)
      }, 1000)
    } else {
      // Idle — just a little wiggle
      if (knobRef.current) {
        knobAngle.current += 60
        knobRef.current.style.transform = `rotate(${knobAngle.current}deg)`
      }
    }
  }, [running, revealing, resultReady, onReveal])

  return (
    <div className="flex flex-col items-center select-none gap-2">
      {/* ======== Machine Shell ======== */}
      <div className="relative" style={{ width: 280, height: 420 }}>
        {/* Machine body */}
        <div className="absolute inset-0 rounded-[50px_50px_30px_30px] border-[5px] border-text overflow-hidden"
          style={{
            background: 'linear-gradient(135deg, #E06C68 0%, #C5524E 100%)',
            boxShadow: 'inset -10px -10px 0 rgba(0,0,0,0.10), 10px 15px 0 rgba(74,59,50,0.15)'
          }}>
        </div>

        {/* ======== Glass container + Canvas ======== */}
        <div className="absolute top-[30px] left-1/2 -translate-x-1/2 w-[220px] h-[200px] rounded-[50%_50%_15%_15%] border-[5px] border-text overflow-hidden"
          style={{
            background: 'rgba(255,255,255,0.85)',
            boxShadow: 'inset 5px 5px 15px rgba(0,0,0,0.05)'
          }}>
          <canvas ref={canvasRef} className="w-full h-full block" />
          {/* Glass reflection */}
          <div className="absolute top-[20px] right-[30px] w-[40px] h-[80px] rounded-[20px] pointer-events-none rotate-[-20deg]"
            style={{ background: 'rgba(255,255,255,0.4)' }} />
        </div>

        {/* ======== Mechanism area ======== */}
        <div className="absolute inset-x-0 bottom-[15px] flex flex-col items-center gap-[20px]">
          {/* Knob — pulses when result is ready */}
          <div className={`relative w-[110px] h-[110px] rounded-full border-[5px] border-text bg-white cursor-pointer flex items-center justify-center ${resultReady ? 'animate-pulse' : ''}`}
            style={{ boxShadow: resultReady ? '4px 4px 0 rgba(0,0,0,0.10), 0 0 20px rgba(255,180,50,0.5)' : '4px 4px 0 rgba(0,0,0,0.10)' }}
            onClick={handleKnob}>
            {/* Spinner (rotates) */}
            <div ref={knobRef} className="absolute inset-0 flex items-center justify-center"
              style={{ transition: 'transform 0.8s cubic-bezier(0.25, 1, 0.5, 1)' }}>
              {/* Handle bar */}
              <div className="absolute w-[20px] h-[84px] rounded-[12px] border-[3.5px] border-text"
                style={{ background: '#6DA3F0', boxShadow: 'inset -3px 0 0 rgba(0,0,0,0.10)' }} />
              {/* Handle center */}
              <div className="w-[40px] h-[40px] rounded-full border-[3.5px] border-text z-[2]"
                style={{ background: '#E06C68', boxShadow: 'inset -3px -3px 0 rgba(0,0,0,0.10)' }} />
            </div>
          </div>

          {/* Chute */}
          <div
            className="relative w-[120px] h-[65px] rounded-[10px_10px_32px_32px] border-[5px] border-text overflow-visible"
            style={{
              background: '#3D302A',
              boxShadow: 'inset 0 8px 16px rgba(0,0,0,0.45)'
            }}>
            {/* Drop capsule */}
            <AnimatePresence>
              {dropping && (
                <motion.div
                  className="absolute left-1/2 w-[52px] h-[52px] rounded-full border-[3.5px] border-text flex items-center justify-center text-xl z-20"
                  style={{
                    background: 'radial-gradient(circle at 35% 35%, #fff 10%, #FFD700 60%, #D4AF37 100%)',
                    boxShadow: '0 4px 8px rgba(0,0,0,0.2)'
                  }}
                  initial={{ top: -70, x: '-50%', scale: 0.5, opacity: 1 }}
                  animate={{ top: [25, 15, 20], x: '-50%', scale: [1.1, 0.95, 1], opacity: 1 }}
                  exit={{ top: -70, x: '-50%', scale: 0, opacity: 0 }}
                  transition={{ duration: 0.7, times: [0.4, 0.6, 1], ease: 'easeOut' }}
                >
                  <span role="img" aria-label="capsule">🥚</span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Hint */}
      <p className="text-xs font-bold text-muted/60">
        {resultReady ? '👆 扭一下，开蛋！' : revealing ? '扭蛋中…' : running ? '机芯工作中…' : '👆 旋钮转动出蛋'}
      </p>
    </div>
  )
}

/* ================================================================
   Canvas physics — Ball class + collision
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
    ctx.beginPath()
    ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2)
    ctx.fillStyle = this.color
    ctx.fill()
    ctx.lineWidth = 2.5
    ctx.strokeStyle = '#4A3B32'
    ctx.stroke()
    // Highlight
    ctx.beginPath()
    ctx.arc(this.x - this.r * 0.3, this.y - this.r * 0.3, this.r * 0.25, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(255,255,255,0.6)'
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
