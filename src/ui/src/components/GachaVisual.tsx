import { useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import type { GachaProgress } from '../shelf'

const CANVAS_W = 240; const CANVAS_H = 320; const PAD = 14

const FLAT_COLORS = ['#ff5a5a','#ff9a4a','#f8d050','#5ac08a','#5aa8e8','#8a68e8','#f07090','#3cc8b0','#ff7eb3','#6eb5ff','#ffd866','#a0d86a']

interface Capsule { x: number; y: number; vx: number; vy: number; r: number; w: number; h: number; el: HTMLDivElement | null }

interface Props { stage: GachaProgress['stage'] | null; running: boolean }

export function GachaVisual({ stage, running }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const capsulesRef = useRef<Capsule[]>([])
  const rafRef = useRef<number>(0)

  const initCapsules = useCallback(() => {
    const container = containerRef.current; if (!container) return
    capsulesRef.current = []
    container.querySelectorAll('.phys-capsule').forEach(e => e.remove())
    const stageEl = container.querySelector('.capsule-stage') as HTMLElement; if (!stageEl) return

    for (let i = 0; i < 14; i++) {
      const w = 14 + Math.random() * 8; const h = w * 1.45; const r = Math.floor(w / 2)
      const el = document.createElement('div')
      el.className = 'phys-capsule'
      el.style.cssText = `position:absolute;width:${w}px;height:${h}px;border-radius:${r}px;background:${FLAT_COLORS[i % FLAT_COLORS.length]};border:2px solid #5C4033;pointer-events:none;z-index:2`
      stageEl.appendChild(el)
      capsulesRef.current.push({
        x: PAD + r + Math.random() * (CANVAS_W - PAD * 2 - r * 2),
        y: PAD + r + Math.random() * (CANVAS_H - PAD * 2 - r * 2),
        vx: (Math.random() - 0.5) * 4, vy: (Math.random() - 0.5) * 4, r, w, h, el
      })
    }
  }, [])
  useEffect(() => { initCapsules() }, [initCapsules])

  useEffect(() => {
    const gravity = 0.10; const friction = 0.996; const bounce = -0.25
    const step = () => {
      const caps = capsulesRef.current
      for (const c of caps) {
        c.vy += gravity; c.vx *= friction; c.vy *= friction; c.x += c.vx; c.y += c.vy
        const l = PAD + c.r, r = CANVAS_W - PAD - c.r, t = PAD + c.r, b = CANVAS_H - PAD - c.r
        if (c.x > r) { c.x = r; c.vx *= bounce }; if (c.x < l) { c.x = l; c.vx *= bounce }
        if (c.y > b) { c.y = b; c.vy *= bounce }; if (c.y < t) { c.y = t; c.vy *= bounce }
        if (Math.abs(c.vx) < 0.02) c.vx = 0; if (Math.abs(c.vy) < 0.02) c.vy = 0
      }
      for (let i = 0; i < caps.length; i++) {
        for (let j = i + 1; j < caps.length; j++) {
          const a = caps[i], b = caps[j], dx = a.x - b.x, dy = a.y - b.y, dist = Math.sqrt(dx*dx+dy*dy), minDist = a.r + b.r + 2
          if (dist < minDist && dist > 0.01) {
            const ang = Math.atan2(dy, dx), push = (minDist - dist) / 2
            a.x += Math.cos(ang) * push; a.y += Math.sin(ang) * push
            b.x -= Math.cos(ang) * push; b.y -= Math.sin(ang) * push
          }
        }
      }
      for (const c of caps) { if (c.el) c.el.style.transform = `translate(${c.x - c.r}px,${c.y - c.h/2}px)` }
      rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(rafRef.current)
  }, [])

  useEffect(() => {
    if (stage === 'clack' || stage === 'fail')
      for (const c of capsulesRef.current) { c.vx += (Math.random()-0.5)*10; c.vy += (Math.random()-0.5)*8-2 }
  }, [stage])

  useEffect(() => {
    if (stage === 'coin') {
      for (const c of capsulesRef.current) { if (c.el) c.el.style.opacity = '1' }
      const caps = capsulesRef.current
      if (caps.length > 0) { const idx = Math.floor(Math.random()*caps.length); if (caps[idx].el) caps[idx].el.style.opacity = '0.4' }
    } else { for (const c of capsulesRef.current) { if (c.el) c.el.style.opacity = '1' } }
  }, [stage])

  return (
    <div ref={containerRef} className="flex flex-col items-center gap-4 select-none">
      {/* Capsule container — GACHAGO card style: white, thick border, hard shadow */}
      <div className="relative" style={{ width: CANVAS_W, height: CANVAS_H }}>
        <div
          className="capsule-stage absolute inset-0 rounded-2xl bg-white"
          style={{ border: '4px solid #5C4033', boxShadow: '6px 6px 0 rgba(92,64,51,0.18)' }}
        />

        <AnimatePresence>
          {stage === 'clack' && (
            <motion.div className="absolute z-10"
              style={{ width:20,height:29,borderRadius:10,border:'2px solid #5C4033',background:FLAT_COLORS[0],left:CANVAS_W/2-10,top:CANVAS_H+4 }}
              initial={{ y:0,opacity:1 }} animate={{ y:[0,40,60,70],opacity:1 }} exit={{ opacity:0 }}
              transition={{ duration:0.7,times:[0,0.4,0.7,1],ease:'easeIn' }} />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {stage === 'fail' && (
            <motion.div className="absolute inset-0 rounded-2xl bg-white/50 z-20 pointer-events-none"
              initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }} />
          )}
        </AnimatePresence>
      </div>

      {/* Stage text */}
      <div className="h-6 flex items-center justify-center">
        <AnimatePresence mode="wait">
          {running && stage && (
            <motion.span key={stage} className="text-[14px] font-extrabold text-text"
              initial={{ opacity:0,y:3 }} animate={{ opacity:1,y:0 }} exit={{ opacity:0,y:-3 }} transition={{ duration:0.15 }}>
              {labelFor(stage)}
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>{stage === 'pop' && <PopParticles />}</AnimatePresence>
    </div>
  )
}

function labelFor(s: GachaProgress['stage']): string {
  switch (s) {
    case 'coin': return '投币…'; case 'crank': return '旋钮转动…'; case 'clack': return '机芯咔咔…'
    case 'pop': return '咔哒！'; case 'fail': return '这次没扭出好蛋'; default: return '扭蛋中…'
  }
}

function PopParticles() {
  const particles = Array.from({length:14},(_,i)=>{
    const a=(i/14)*Math.PI*2,d=35+Math.random()*55
    return {tx:Math.cos(a)*d,ty:Math.sin(a)*d-20,color:FLAT_COLORS[i%FLAT_COLORS.length],size:4+Math.random()*4,delay:Math.random()*0.08}
  })
  return (
    <motion.div className="absolute top-[44%] left-1/2 -translate-x-1/2 pointer-events-none z-30"
      initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}>
      {particles.map((p,i)=>(
        <motion.div key={i} className="absolute -translate-x-1/2 -translate-y-1/2"
          style={{width:p.size,height:p.size,borderRadius:p.size>5?4:2,background:p.color}}
          initial={{x:0,y:0,opacity:0,scale:0}} animate={{x:p.tx,y:p.ty,opacity:[0,1,0],scale:[0,1,0.5]}}
          transition={{duration:0.55,delay:p.delay,ease:'easeOut'}} />
      ))}
    </motion.div>
  )
}
