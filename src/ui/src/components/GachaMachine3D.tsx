import { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import { PerspectiveCamera } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { motion, AnimatePresence } from 'motion/react'
import { ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { GachaProgress } from '../shelf'
import { sfx } from '../sound'

/* ================================================================
   混合版扭蛋机 —— 第四版（A/B/C/D 对比用）。

   机身完全沿用用户认可的 CSS 立式塔机（GachaVisual），
   只把玻璃橱窗里的 2D canvas 球换成收藏柜同款 3D 扭蛋：
   PBR 材质 + 摄影棚环境光，在橱窗盒体内真实翻滚。

   层级方案（关键）：
   - 橱窗内嵌独立小 Canvas（absolute inset-0），3D 球直接渲染其中。
     不用 drei View 的全屏 canvas + scissor 追踪——其 rect 追踪在
     overflow-hidden + border + 入场动画的嵌套下不稳定，会导致球随机消失
   - 玻璃深梅底色、厚边框保留 CSS（canvas 透明，球渲染在底色之上、边框之内）
   - 玻璃高光为 3D 场景内的一块渐变透明平面（摆在球前面）
   ================================================================ */

interface Props {
  stage: GachaProgress['stage'] | null
  running: boolean
  /** AI 完成生成——旋钮邀请转动，用户亲手开蛋 */
  resultReady: boolean
  /** 开蛋仪式（棘轮→落蛋→开壳）完成后回调 */
  onReveal: () => void
}

// 扭蛋壳配色（高饱和糖果色，冷底上颗颗分明）
const BALL_COLORS = ['#E8453C', '#1E9FE0', '#3DBE4E', '#FFC21A', '#FF8A2B', '#9462D6', '#F55D9C']

// 橱窗 3D 盒体与球参数
const BOX_W = 2.0, BOX_H = 2.0, BOX_D = 0.9
const BALL_R = 0.24
const BALL_COUNT = 9
const GRAVITY = -7.5
const REST = 0.45
const AGIT = 62
/** 光灵内壁反弹半径（壳内留余量） */
const WISP_BOUND = BALL_R * 0.7
/** 光灵拖尾节数 */
const TRAIL_LEN = 5
/** 光灵反射计算临时向量（避免每帧分配） */
const tmpN = new THREE.Vector3()

/** 环境贴图按渲染器缓存：独立 Canvas 每次挂载是新渲染器，旧 texture 跨渲染器无效，WeakMap 自动失效重建 */
const envCache = new WeakMap<THREE.WebGLRenderer, THREE.Texture>()
function getEnv(gl: THREE.WebGLRenderer): THREE.Texture {
  let tex = envCache.get(gl)
  if (!tex) {
    const pmrem = new THREE.PMREMGenerator(gl)
    tex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    pmrem.dispose()
    envCache.set(gl, tex)
  }
  return tex
}

export function GachaMachine3D({ stage, running, resultReady, onReveal }: Props) {
  const { t } = useTranslation()
  const agitatedRef = useRef(false)
  const knobRef = useRef<HTMLDivElement>(null)
  const knobAngle = useRef(0)
  const crankInterval = useRef<number>(0)
  const [coinIn, setCoinIn] = useState(false)
  const [dropping, setDropping] = useState(false)
  const [cracking, setCracking] = useState(false)
  const [revealing, setRevealing] = useState(false)
  const [ceremony, setCeremony] = useState(false)
  const timers = useRef<number[]>([])

  const later = (fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms))
  }

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

      // 机芯转动 → 全屏开奖仪式（3D 扭蛋落下 · 摇晃 · 裂壳 · 光灵迸发）
      later(() => {
        agitatedRef.current = false
        setCeremony(true)
      }, 950)
    } else {
      sfx.tick()
      spinKnob(90)
      agitatedRef.current = true
      later(() => { agitatedRef.current = false }, 400)
    }
  }, [running, revealing, resultReady, onReveal])

  return (
    <div className="flex flex-col items-center select-none gap-2.5">
      {/* ======== 机器整体（橱窗为独立 Canvas，机身 hover 位移不再影响 3D 内容） ======== */}
      <div className="relative">
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

          {/* ======== 方形玻璃橱窗（3D 扭蛋） ======== */}
          <div className="absolute left-[64px] right-[64px] top-[36px] h-[176px] rounded-[12px] border-[5px] border-text overflow-hidden z-20"
            style={{
              background: 'radial-gradient(ellipse at 50% 18%, #dfe9f4ff 0%, #c3def9ff 42%, #98c4edff 78%, #72aae2ff 100%)',
              boxShadow: 'inset 0 -14px 24px rgba(60,90,130,0.12), inset 0 8px 14px rgba(255,255,255,0.5)'
            }}>
            <Canvas
              style={{ position: 'absolute', inset: 0 }}
              gl={{ antialias: true, alpha: true }}
              dpr={[1, 2]}
            >
              <ShowcaseBalls agitatedRef={agitatedRef} resultReady={resultReady} />
            </Canvas>
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

          {/* ======== 旋钮（立体球形把手） ======== */}
          <div className="absolute left-[84px] top-[230px] z-20">
            <motion.div
              animate={resultReady && !revealing ? { rotate: [0, -10, 10, -6, 6, 0] } : { rotate: 0 }}
              transition={{ duration: 1.1, repeat: resultReady ? Infinity : 0, repeatDelay: 1, ease: 'easeInOut' }}
            >
              {/* 底座凹盘 */}
              <div
                className={`relative w-[72px] h-[72px] rounded-full cursor-pointer flex items-center justify-center ${resultReady ? 'ring-4 ring-amber-300/70' : ''}`}
                style={{
                  background: 'radial-gradient(circle at 50% 42%, #5E4433, #3B2C22 72%)',
                  boxShadow: 'inset 0 3px 8px rgba(0,0,0,0.55), inset 0 -2px 4px rgba(255,255,255,0.08), 0 2px 0 rgba(255,255,255,0.15)',
                  border: '3.5px solid #4A3B32'
                }}
                onClick={handleKnob}
              >
                {/* 球型把手（径向渐变 = 凸面立体感） */}
                <div ref={knobRef} className="w-[48px] h-[48px] rounded-full relative"
                  style={{
                    transition: 'transform 0.9s cubic-bezier(0.22, 1.2, 0.36, 1)',
                    background: 'radial-gradient(circle at 36% 28%, #FF9D96, #E8564E 42%, #B93830 74%, #8A2620)',
                    boxShadow: '0 5px 10px rgba(0,0,0,0.4), inset 0 -4px 8px rgba(0,0,0,0.25), inset 0 3px 6px rgba(255,255,255,0.3)'
                  }}>
                  {/* 高光 */}
                  <div className="absolute top-[7px] left-[10px] w-[14px] h-[9px] rounded-full bg-white/55" style={{ transform: 'rotate(-25deg)' }} />
                  {/* 旋转指示槽 */}
                  <div className="absolute top-[4px] left-1/2 -translate-x-1/2 w-[5px] h-[13px] rounded-full bg-black/20" />
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
            <motion.div className="absolute top-[2px] left-[6px] w-[44px] h-[14px] rounded-b-[12px] origin-top"
              style={{ background: '#1A1410' }}
              animate={dropping && !cracking ? { rotateX: 65 } : { rotateX: 0 }}
              transition={{ duration: 0.25 }} />
            <motion.div className="absolute top-[2px] right-[6px] w-[44px] h-[14px] rounded-b-[12px] origin-top"
              style={{ background: '#1A1410' }}
              animate={dropping && !cracking ? { rotateX: 65 } : { rotateX: 0 }}
              transition={{ duration: 0.25 }} />
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
          {resultReady ? t('machine.resultReady') : revealing ? t('machine.revealing') : running ? t('machine.running') : t('machine.idle')}
        </p>
      </div>

      {/* ======== 全屏开奖仪式 ======== */}
      <AnimatePresence>
        {ceremony && (
          <RevealCeremony onDone={() => {
            setCeremony(false)
            setDropping(false)
            setCracking(false)
            setRevealing(false)
            onReveal()
          }} />
        )}
      </AnimatePresence>
    </div>
  )
}

/* ================================================================
   橱窗 3D 场景：双色扭蛋在盒体内翻滚（PBR + 环境光 + 玻璃高光面）
   ================================================================ */

interface Ball3D {
  pos: THREE.Vector3
  vel: THREE.Vector3
  spinY: number
  color: string
  /** 光灵自发光色（壳色提亮） */
  glow: string
  /** 光脉冲相位（每颗错开） */
  phase: number
  /** 光灵位置（壳内局部坐标） */
  wispPos: THREE.Vector3
  /** 光灵速度（内壁反弹用） */
  wispVel: THREE.Vector3
  /** 光灵拖尾位置历史 */
  trail: THREE.Vector3[]
}

export function ShowcaseBalls({ agitatedRef, resultReady, count = BALL_COUNT }: { agitatedRef: React.MutableRefObject<boolean>, resultReady: boolean, count?: number }) {
  const gl = useThree(s => s.gl)
  const scene = useThree(s => s.scene)
  const ballRefs = useRef<(THREE.Group | null)[]>([])
  const wispGroupRefs = useRef<(THREE.Group | null)[]>([])
  const wispGlowRefs = useRef<(THREE.Sprite | null)[]>([])
  const trailRefs = useRef<(THREE.Sprite | null)[][]>([])
  const frameCt = useRef(0)

  useEffect(() => {
    scene.environment = getEnv(gl)
    return () => { scene.environment = null }
  }, [gl, scene])

  /** 共享光晕纹理：径向渐变（白心→透明），spriteMaterial.color 为每颗蛋着色 */
  const glowTex = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = 128; c.height = 128
    const x = c.getContext('2d')!
    const g = x.createRadialGradient(64, 64, 0, 64, 64, 64)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(0.22, 'rgba(255,255,255,0.85)')
    g.addColorStop(0.55, 'rgba(255,255,255,0.28)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    x.fillStyle = g
    x.fillRect(0, 0, 128, 128)
    return new THREE.CanvasTexture(c)
  }, [])

  const balls = useMemo<Ball3D[]>(() => Array.from({ length: count }, (_, i) => {
    const color = BALL_COLORS[i % BALL_COLORS.length]
    return {
      pos: new THREE.Vector3((Math.random() - 0.5) * 1.3, (Math.random() - 0.5) * 1.3, (Math.random() - 0.5) * 0.4),
      vel: new THREE.Vector3((Math.random() - 0.5) * 1.6, (Math.random() - 0.5) * 1.6, (Math.random() - 0.5) * 0.8),
      spinY: (Math.random() - 0.5) * 0.6,
      color,
      glow: '#' + new THREE.Color(color).offsetHSL(0, -0.05, 0.42).getHexString(),
      phase: Math.random() * Math.PI * 2,
      wispPos: new THREE.Vector3((Math.random() - 0.5) * BALL_R, (Math.random() - 0.5) * BALL_R, (Math.random() - 0.5) * BALL_R * 0.5),
      wispVel: new THREE.Vector3((Math.random() - 0.5) * 1.4, (Math.random() - 0.5) * 1.4, (Math.random() - 0.5) * 1.4),
      trail: Array.from({ length: TRAIL_LEN }, () => new THREE.Vector3()),
    }
  }), [count])

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05)
    const t = state.clock.elapsedTime
    const W2 = BOX_W / 2 - BALL_R, H2 = BOX_H / 2 - BALL_R, D2 = BOX_D / 2 - BALL_R

    // 物理：重力 + 搅动 + 盒壁碰撞
    for (const b of balls) {
      b.vel.y += GRAVITY * dt
      if (agitatedRef.current) {
        b.vel.x += (Math.random() - 0.5) * AGIT * dt
        b.vel.y += (Math.random() - 0.5) * AGIT * 1.35 * dt
        b.vel.z += (Math.random() - 0.5) * AGIT * dt
      }
      b.vel.multiplyScalar(0.999)
      b.pos.addScaledVector(b.vel, dt)

      if (b.pos.x < -W2) { b.pos.x = -W2; b.vel.x = Math.abs(b.vel.x) * REST }
      if (b.pos.x > W2) { b.pos.x = W2; b.vel.x = -Math.abs(b.vel.x) * REST }
      if (b.pos.y < -H2) { b.pos.y = -H2; b.vel.y = Math.abs(b.vel.y) * REST; b.vel.x *= 0.985; b.vel.z *= 0.985 }
      if (b.pos.y > H2) { b.pos.y = H2; b.vel.y = -Math.abs(b.vel.y) * REST }
      if (b.pos.z < -D2) { b.pos.z = -D2; b.vel.z = Math.abs(b.vel.z) * REST }
      if (b.pos.z > D2) { b.pos.z = D2; b.vel.z = -Math.abs(b.vel.z) * REST }
    }

    // 球间碰撞（位置分离 + 法向冲量）
    const n = new THREE.Vector3()
    for (let i = 0; i < balls.length; i++) {
      for (let j = i + 1; j < balls.length; j++) {
        const a = balls[i], c = balls[j]
        n.subVectors(c.pos, a.pos)
        const dist = n.length()
        const min = BALL_R * 2
        if (dist < min && dist > 1e-6) {
          n.divideScalar(dist)
          const overlap = (min - dist) * 0.5
          a.pos.addScaledVector(n, -overlap)
          c.pos.addScaledVector(n, overlap)
          const rv = n.dot(new THREE.Vector3().subVectors(c.vel, a.vel))
          if (rv < 0) {
            const imp = -(1 + REST * 0.5) * rv * 0.5
            a.vel.addScaledVector(n, -imp)
            c.vel.addScaledVector(n, imp)
          }
        }
      }
    }

    // 应用到网格（滚动旋转由速度驱动）+ 光灵蹦跳 + 拖尾 + 光晕呼吸
    frameCt.current++
    balls.forEach((b, i) => {
      const m = ballRefs.current[i]
      if (m) {
        m.position.copy(b.pos)
        m.rotation.x += b.vel.z * 1.6 * dt
        m.rotation.z -= b.vel.x * 1.6 * dt
        m.rotation.y += b.spinY * dt
      }
    
      // ── 光灵慢舞：随机游走 + 内壁反射（局部坐标，跟随蛋壳翻滚） ──
      const sp = b.wispPos, sv = b.wispVel
      sv.x += (Math.random() - 0.5) * 2.2 * dt
      sv.y += (Math.random() - 0.5) * 2.2 * dt
      sv.z += (Math.random() - 0.5) * 2.2 * dt
      const spd = sv.length()
      const sMin = resultReady ? 0.5 : 0.26, sMax = resultReady ? 1.15 : 0.72
      if (spd > sMax) sv.multiplyScalar(sMax / spd)
      else if (spd < sMin && spd > 1e-4) sv.multiplyScalar(sMin / spd)
      sp.addScaledVector(sv, dt)
      const d = sp.length()
      if (d > WISP_BOUND) {                    // 撞到壳内壁 → 镜面反射
        tmpN.copy(sp).divideScalar(d)
        sp.copy(tmpN).multiplyScalar(WISP_BOUND)
        const dot = sv.dot(tmpN)
        if (dot > 0) sv.addScaledVector(tmpN, -2 * dot)
      }
      const wg = wispGroupRefs.current[i]
      if (wg) wg.position.copy(sp)
    
      // 拖尾采样：每 3 帧记录一次位置历史
      if (frameCt.current % 3 === 0) {
        b.trail.unshift(sp.clone())
        b.trail.pop()
      }
      for (let k = 0; k < TRAIL_LEN; k++) {
        const ts = trailRefs.current[i]?.[k]
        if (ts) {
          ts.position.copy(b.trail[k])
          const f = 1 - (k + 1) / (TRAIL_LEN + 1)
          ts.material.opacity = 0.5 * f
          ts.scale.setScalar(BALL_R * (0.6 * f + 0.12))
        }
      }
    
      // 光晕呼吸：结果就绪时更大更亮（任天堂式"呼之欲出"）
      const gs = wispGlowRefs.current[i]
      if (gs) {
        const pulse = Math.sin(t * (resultReady ? 5 : 2.6) + b.phase) * 0.5 + 0.5
        gs.scale.setScalar(BALL_R * (resultReady ? 1.35 : 1.0) * (0.75 + pulse * 0.45))
      }
    })
  })

  return (
    <>
      <PerspectiveCamera makeDefault position={[0, 0, 3]} fov={38} />

      {balls.map((b, i) => (
        <group key={i} ref={el => { ballRefs.current[i] = el }}>
          {/* 下杯（收藏架同款实心塑料，DoubleSide 让内壁不透明） */}
          <mesh>
            <sphereGeometry args={[BALL_R, 48, 24, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2]} />
            <meshStandardMaterial color={b.color} roughness={0.24} metalness={0} envMapIntensity={0.9} side={THREE.DoubleSide} />
          </mesh>
          {/* 愿望光灵：壳内蹦跳的小精灵（高亮核心 + 加色混合光晕 + 拖尾） */}
          <group ref={el => { wispGroupRefs.current[i] = el }}>
            <mesh>
              <sphereGeometry args={[BALL_R * 0.09, 12, 10]} />
              <meshBasicMaterial color="#FFFEF2" />
            </mesh>
            <sprite ref={el => { wispGlowRefs.current[i] = el }} scale={BALL_R}>
              <spriteMaterial
                map={glowTex}
                color={b.glow}
                transparent
                opacity={0.9}
                blending={THREE.AdditiveBlending}
                depthWrite={false}
              />
            </sprite>
            {/* 拖尾光点（渐隐渐小，由 useFrame 驱动位置） */}
            {Array.from({ length: TRAIL_LEN }, (_, k) => (
              <sprite key={k} ref={el => { (trailRefs.current[i] ??= [])[k] = el }} renderOrder={2}>
                <spriteMaterial
                  map={glowTex}
                  color={b.glow}
                  transparent
                  opacity={0.4}
                  blending={THREE.AdditiveBlending}
                  depthWrite={false}
                />
              </sprite>
            ))}
          </group>
          {/* 接缝环（收藏架同款：随杯色） */}
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[BALL_R * 0.985, BALL_R * 0.02, 12, 64]} />
            <meshStandardMaterial color={b.color} roughness={0.4} metalness={0} envMapIntensity={0.7} />
          </mesh>
          {/* 上半（收藏架同款透明盖） */}
          <mesh>
            <sphereGeometry args={[BALL_R, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshPhysicalMaterial
              color="#ffffff"
              transparent
              opacity={0.3}
              roughness={0.04}
              metalness={0}
              clearcoat={1}
              clearcoatRoughness={0.06}
              envMapIntensity={1.6}
              depthWrite={false}
            />
          </mesh>
        </group>
      ))}

      {/* 灯光（对标收藏柜：强主光 + 冷色轮廓光，拉开明暗对比） */}
      <ambientLight intensity={0.35} />
      <directionalLight position={[3, 5, 4]} intensity={1.45} />
      <directionalLight position={[-3, 1, -3]} intensity={0.55} color="#c4ddf5" />
      <pointLight position={[0, -1.2, 1.5]} intensity={0.4} color="#ffe8c4" />
    </>
  )
}

/** 玻璃高光：canvas 渐变纹理透明平面，位于球体前方 */
function GlassHighlights() {
  const tex = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = 256; c.height = 256
    const x = c.getContext('2d')!
    const streak = (cx: number, w: number, alpha: number, rot: number) => {
      x.save()
      x.translate(cx, 128)
      x.rotate(rot)
      const g = x.createLinearGradient(-w / 2, 0, w / 2, 0)
      g.addColorStop(0, 'rgba(255,255,255,0)')
      g.addColorStop(0.5, `rgba(255,255,255,${alpha})`)
      g.addColorStop(1, 'rgba(255,255,255,0)')
      x.fillStyle = g
      x.fillRect(-w / 2, -190, w, 380)
      x.restore()
    }
    streak(72, 44, 0.5, -0.32)
    streak(182, 18, 0.38, -0.32)
    return new THREE.CanvasTexture(c)
  }, [])

  return (
    <mesh position={[0, 0, BOX_D / 2 + 0.15]}>
      <planeGeometry args={[BOX_W, BOX_H]} />
      <meshBasicMaterial map={tex} transparent depthWrite={false} />
    </mesh>
  )
}

/* ================================================================
   小部件：铆钉 / 闪光 / 扭蛋壳（与 GachaVisual 同款）
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

function Capsule({ cracking }: { cracking: boolean }) {
  return (
    <div className="relative w-[54px] h-[54px]">
      <motion.div
        className="absolute inset-x-0 top-0 h-[28px] rounded-t-full border-[3.5px] border-b-0 border-text overflow-hidden"
        style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.97), rgba(238,243,255,0.8))' }}
        animate={cracking ? { y: -24, rotate: -16, opacity: 0 } : { y: 0, rotate: 0, opacity: 1 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
      >
        <div className="absolute top-[5px] left-[9px] w-[11px] h-[15px] rounded-full bg-white/75 rotate-[22deg]" />
      </motion.div>
      <motion.div
        className="absolute inset-x-0 bottom-0 h-[28px] rounded-b-full border-[3.5px] border-t-0 border-text"
        style={{ background: 'linear-gradient(180deg, #FFD700, #F0B429 60%, #D49B1E)' }}
        animate={cracking ? { y: 15, opacity: 0 } : { y: 0, opacity: 1 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
      />
      {!cracking && (
        <div className="absolute top-1/2 -translate-y-1/2 inset-x-[1px] h-[5px] rounded-full bg-text/70" />
      )}
    </div>
  )
}

/* ================================================================
   全屏开奖仪式：3D 扭蛋落下 → 弹跳 → 摇晃蓄力 → 裂壳 · 光灵迸发
   ================================================================ */

export function RevealCeremony({ onDone, icon }: { onDone: () => void; icon?: string }) {
  const color = useMemo(() => BALL_COLORS[Math.floor(Math.random() * BALL_COLORS.length)], [])
  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'radial-gradient(ellipse at 50% 40%, #FFFEF9 0%, #FFF6E6 40%, #FAE9CC 75%, #F2DDBA 100%)' }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.4 } }}
      transition={{ duration: 0.25 }}
    >
      <Canvas gl={{ antialias: true, alpha: true }} dpr={[1, 2]}>
        <RevealScene color={color} icon={icon} onDone={onDone} />
      </Canvas>
    </motion.div>
  )
}

function RevealScene({ color, icon, onDone }: { color: string; icon?: string; onDone: () => void }) {
  const R = 0.6
  const FLOOR = -1.3
  const gl = useThree(s => s.gl)
  const scene = useThree(s => s.scene)
  const glow = useMemo(() => '#' + new THREE.Color(color).offsetHSL(0, -0.05, 0.42), [color])

  // 摄影棚环境贴图（与收藏架同源——玻璃/塑料反射的来源）
  useEffect(() => {
    scene.environment = getEnv(gl)
    return () => { scene.environment = null }
  }, [gl, scene])

  const glowTex = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = 128; c.height = 128
    const x = c.getContext('2d')!
    const g = x.createRadialGradient(64, 64, 0, 64, 64, 64)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(0.22, 'rgba(255,255,255,0.85)')
    g.addColorStop(0.55, 'rgba(255,255,255,0.28)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    x.fillStyle = g
    x.fillRect(0, 0, 128, 128)
    return new THREE.CanvasTexture(c)
  }, [])

  // 蛋图标纹理（裂壳时爆出的主角；SVG data URL 光栅化，加载失败则退化为纯光灵）
  const iconUrl = useMemo(() => icon ? `data:image/svg+xml,${encodeURIComponent(icon)}` : null, [icon])
  const [iconTex, setIconTex] = useState<THREE.Texture | null>(null)
  useEffect(() => {
    if (!iconUrl) { setIconTex(null); return }
    let disposed = false
    let loaded: THREE.Texture | null = null
    new THREE.TextureLoader().load(iconUrl, tex => {
      if (disposed) { tex.dispose(); return }
      tex.colorSpace = THREE.SRGBColorSpace
      loaded = tex
      setIconTex(tex)
    })
    return () => { disposed = true; loaded?.dispose(); setIconTex(null) }
  }, [iconUrl])

  // 裂壳爆发物：壳碎片(0-7) · 火花(8-19) · 金色星屑(20-25)
  const particles = useMemo(() => Array.from({ length: 26 }, (_, i) => {
    const isShell = i < 8, isSpark = i < 20
    return {
      dir: new THREE.Vector3(
        Math.random() - 0.5,
        isShell ? Math.random() * 0.5 + 0.1 : Math.random() * 0.8 - 0.15,
        Math.random() - 0.5
      ).normalize(),
      speed: isShell ? 1.5 + Math.random() * 1.6 : isSpark ? 2.4 + Math.random() * 2.4 : 0.9 + Math.random() * 1.1,
      size: isShell ? 0.07 + Math.random() * 0.05 : isSpark ? 0.035 : 0.028,
      color: isShell ? color : isSpark ? '#FFF3D6' : '#FFD76B',
      spin: (Math.random() - 0.5) * 10,
    }
  }), [color])

  const shakeRef = useRef<THREE.Group>(null)
  const capsuleRef = useRef<THREE.Group>(null)
  const topRef = useRef<THREE.Group>(null)
  const bottomRef = useRef<THREE.Group>(null)
  const wispRef = useRef<THREE.Group>(null)
  const wispGlowRef = useRef<THREE.Sprite>(null)
  const iconBurstRef = useRef<THREE.Group>(null)
  const iconGlowRef = useRef<THREE.Sprite>(null)
  const rvTrailRefs = useRef<(THREE.Sprite | null)[]>([])
  const wispPos = useRef(new THREE.Vector3(0, -0.1, 0))
  const wispVel = useRef(new THREE.Vector3(0.3, 0.4, 0.2))
  const frameCt = useRef(0)
  const rvTrail = useMemo(() => Array.from({ length: TRAIL_LEN }, () => new THREE.Vector3()), [])
  const flashRef = useRef<THREE.PointLight>(null)
  const camRef = useRef<THREE.PerspectiveCamera>(null)
  const ringRef = useRef<THREE.Mesh>(null)
  const shadowRef = useRef<THREE.Mesh>(null)
  const pRefs = useRef<(THREE.Mesh | null)[]>([])
  const pMats = useRef<(THREE.MeshBasicMaterial | null)[]>([])
  const phase = useRef(0)   // 0掉落 1摇晃 2裂开
  const t0 = useRef(0)
  const vy = useRef(0)
  const bounces = useRef(0)
  const shake = useRef(0)
  const done = useRef(false)

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05)
    const t = state.clock.elapsedTime
    const cap = capsuleRef.current
    if (!cap || done.current) return

    // 落地震屏（场景微抖，相机不动）
    if (shake.current > 0.002 && shakeRef.current) {
      shake.current *= 0.88
      shakeRef.current.position.set(
        (Math.random() - 0.5) * shake.current,
        (Math.random() - 0.5) * shake.current * 0.7,
        0
      )
    } else if (shakeRef.current) {
      shakeRef.current.position.set(0, 0, 0)
    }

    // ── 愿望精灵慢舞：随机游走 + 内壁反射（同扭蛋机橱窗版本） ──
    frameCt.current++
    if (wispRef.current && phase.current < 2) {
      const sp = wispPos.current, sv = wispVel.current
      sv.x += (Math.random() - 0.5) * 2.2 * dt
      sv.y += (Math.random() - 0.5) * 2.2 * dt
      sv.z += (Math.random() - 0.5) * 2.2 * dt
      const spd = sv.length()
      if (spd > 0.85) sv.multiplyScalar(0.85 / spd)
      else if (spd < 0.3 && spd > 1e-4) sv.multiplyScalar(0.3 / spd)
      sp.addScaledVector(sv, dt)
      const BOUND = R * 0.62
      const d = sp.length()
      if (d > BOUND) {
        tmpN.copy(sp).divideScalar(d)
        sp.copy(tmpN).multiplyScalar(BOUND)
        const dot = sv.dot(tmpN)
        if (dot > 0) sv.addScaledVector(tmpN, -2 * dot)
      }
      wispRef.current.position.copy(sp)
      // 光晕呼吸
      if (wispGlowRef.current) {
        const pulse = Math.sin(t * 3.2) * 0.5 + 0.5
        wispGlowRef.current.scale.setScalar(R * 0.9 * (0.7 + pulse * 0.4))
      }
      // 拖尾：每 3 帧采样，渐隐渐小
      if (frameCt.current % 3 === 0) {
        rvTrail.unshift(sp.clone())
        rvTrail.pop()
      }
      for (let k = 0; k < TRAIL_LEN; k++) {
        const ts = rvTrailRefs.current[k]
        if (ts) {
          ts.position.copy(rvTrail[k])
          const f = 1 - (k + 1) / (TRAIL_LEN + 1)
          ;(ts.material as THREE.SpriteMaterial).opacity = 0.5 * f
          ts.scale.setScalar(R * (0.5 * f + 0.12))
        }
      }
    }

    if (phase.current === 0) {
      // ── 掉落 + 弹跳（squash & stretch：任天堂式落地挤压） ──
      vy.current -= 13 * dt
      cap.position.y += vy.current * dt
      const sq = Math.max(-0.32, Math.min(0.2, -vy.current * 0.022))  // 下落拉伸
      cap.scale.set(1 - sq * 0.55, 1 + sq, 1 - sq * 0.55)
      if (cap.position.y <= FLOOR) {
        cap.position.y = FLOOR
        if (Math.abs(vy.current) > 1.4) {
          const impact = Math.min(Math.abs(vy.current) / 9, 1)
          cap.scale.set(1 + impact * 0.3, 1 - impact * 0.34, 1 + impact * 0.3)  // 落地压扁
          vy.current = -vy.current * 0.36
          bounces.current++
          sfx.drop()
          if (bounces.current === 1) shake.current = 0.12
        } else {
          phase.current = 1
          t0.current = t
        }
      }
      cap.rotation.z = Math.sin(t * 2.2) * 0.05
    } else if (phase.current === 1) {
      // ── 摇晃蓄力（越摇越剧烈）+ 回弹形变 ──
      cap.scale.set(1, 1, 1)
      const p = Math.min((t - t0.current) / 1.15, 1)
      cap.rotation.z = Math.sin(p * 20) * 0.05 + Math.sin(p * 33) * 0.13 * p * p
      if (p >= 1) { phase.current = 2; t0.current = t; sfx.crack(); sfx.taDa(); shake.current = 0.1 }
    } else {
      // ── 裂壳：上盖飞离 · 光灵迸发 · 碎片四散 ──
      const p = (t - t0.current) / 1.4
      // 镜头冲击：裂壳瞬间推近（fov 收窄 = zoom punch）
      if (camRef.current) {
        const zf = Math.min(p / 0.35, 1)
        camRef.current.fov = 40 - 4.5 * (1 - (1 - zf) ** 2)
        camRef.current.updateProjectionMatrix()
      }
      // 金色光环从裂缝处扩散
      if (ringRef.current) {
        const rp = Math.min(p / 0.55, 1)
        ringRef.current.scale.setScalar(0.3 + rp * 3.6)
        ;(ringRef.current.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - rp)
      }
      const eo = 1 - (1 - Math.min(p * 1.4, 1)) ** 2  // easeOut 蓄力释放
      if (topRef.current) {
        topRef.current.position.y = eo * 2.6
        topRef.current.position.x = -eo * 0.4
        topRef.current.rotation.x = eo * 2.4
        topRef.current.rotation.z = eo * 1.1
        topRef.current.traverse(o => { if ((o as THREE.Mesh).material) ((o as THREE.Mesh).material as THREE.Material).opacity = Math.max(0, 1 - p * 1.5) })
      }
      if (bottomRef.current) {
        const bp = Math.max(0, p - 0.08)  // 微微延迟坠落，更有重量感
        bottomRef.current.position.y = -bp * bp * 2.2
        bottomRef.current.rotation.z = bp * 0.5
        bottomRef.current.traverse(o => { if ((o as THREE.Mesh).material) ((o as THREE.Mesh).material as THREE.Material).opacity = Math.max(0, 1 - p * 1.3) })
      }
      if (wispRef.current) {
        wispRef.current.position.y += 0.55 * dt  // 精灵缓缓上浮
        const pulse = 1 + Math.sin(p * 14) * 0.07 * Math.max(0, 1 - p)  // 余韵脉动
        const bloom = (1 + 2.8 * (1 - Math.exp(-p * 3.5))) * pulse
        wispRef.current.scale.setScalar(bloom)
        wispRef.current.traverse(o => { const m = (o as THREE.Mesh).material; if (m) (m as THREE.Material).opacity = p < 0.45 ? 1 : Math.max(0, 1 - (p - 0.45) * 1.5) })
      }
      // 图标爆出：裂壳瞬间从壳内弹出 · 回弹放大 · 上浮到胶囊上方停住（控制在相机可视范围内，不顶出画面）
      if (iconBurstRef.current && iconTex) {
        const ip = Math.min(Math.max(p - 0.06, 0) / 0.6, 1)
        const c1 = 1.70158, c3 = c1 + 1  // easeOutBack：超出再回弹的"啵"感
        const pop = 1 + c3 * Math.pow(ip - 1, 3) + c1 * Math.pow(ip - 1, 2)
        const rise = 1 - Math.pow(1 - ip, 3)
        iconBurstRef.current.position.y = FLOOR + 0.15 + rise * 0.5  // -1.15 → -0.65，停在胶囊上方、画面中上部
        iconBurstRef.current.scale.setScalar(Math.max(0.001, pop * 1.05))
        iconBurstRef.current.rotation.z = Math.sin(t * 1.6) * 0.05 * ip
        if (iconGlowRef.current) {
          const gm = iconGlowRef.current.material as THREE.SpriteMaterial
          gm.opacity = ip * 0.85
          iconGlowRef.current.scale.setScalar(1.8 + Math.sin(t * 2.6) * 0.15 * ip)
        }
      }
      if (flashRef.current) {
        flashRef.current.intensity = p < 0.22 ? 14 * (1 - p / 0.22) : 0  // 裂壳瞬间强闪光
      }
      particles.forEach((pt, i) => {
        const m = pRefs.current[i]
        if (m) {
          const pp = Math.min(Math.max(0, p - i * 0.006) * 1.25, 1)  // 错峰迸发（任天堂式节奏）
          m.position.copy(pt.dir).multiplyScalar(pt.speed * (i < 8 ? (pp * pp * 0.4 + pp * 0.6) : pp))
          m.position.y += i >= 20
            ? 1.1 * pp - 0.5 * pp * pp + Math.sin(pp * 9 + i) * 0.06   // 星屑：上浮 + 摇摆
            : -3.0 * pp * pp                                            // 碎片/火花：抛物线下坠
          m.rotation.x += pt.spin * dt
          m.rotation.z += pt.spin * 0.7 * dt
          const mat = pMats.current[i]
          if (mat) mat.opacity = Math.max(0, 1 - Math.max(0, p - 0.45) * 1.8)
        }
      })
      if (p >= 1.15 && !done.current) { done.current = true; onDone() }
    }

    // 地面软阴影随高度变化
    if (shadowRef.current) {
      const h = Math.max(0, cap.position.y - FLOOR)
      const s = Math.max(0.35, 1.15 - h * 0.22)
      shadowRef.current.scale.setScalar(s)
      ;(shadowRef.current.material as THREE.MeshBasicMaterial).opacity = 0.15 * s
    }
  })

  return (
    <>
      {/* 相机：微微俯视（同收藏架视角），瞄准球心下方 → 扭蛋居于画面中上部 */}
      <PerspectiveCamera ref={camRef} makeDefault position={[0, -0.4, 5.2]} fov={40} onUpdate={c => c.lookAt(0, -1.1, 0)} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[3, 5, 4]} intensity={1.6} />
      <directionalLight position={[-3, 1, -3]} intensity={0.5} color="#c4ddf5" />
      <pointLight ref={flashRef} position={[0, -0.9, 1.2]} intensity={0} color="#FFF3D6" distance={9} />

      <group ref={shakeRef}>
        {/* 裂壳光环（金色，加色混合，从裂缝处水平扩散） */}
        <mesh ref={ringRef} position={[0, FLOOR + 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={0.3}>
          <torusGeometry args={[R * 1.1, 0.028, 8, 64]} />
          <meshBasicMaterial color="#FFD76B" transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} />
        </mesh>
        <group ref={capsuleRef} position={[0, 4.5, 0]}>
          {/* 下杯 + 接缝环（收藏架同款：实心塑料，接缝随杯色） */}
          <group ref={bottomRef}>
            <mesh>
              <sphereGeometry args={[R, 48, 24, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2]} />
              <meshStandardMaterial color={color} roughness={0.24} metalness={0} envMapIntensity={0.9} transparent side={THREE.DoubleSide} />
            </mesh>
            <mesh rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[R * 0.985, R * 0.02, 12, 64]} />
              <meshStandardMaterial color={color} roughness={0.4} metalness={0} envMapIntensity={0.7} transparent />
            </mesh>
          </group>
          {/* 愿望精灵：同扭蛋机版本——壳内蹦跳 + 拖尾（裂壳时迸发） */}
          <group ref={wispRef} position={[0, -0.05, 0]}>
            <mesh>
              <sphereGeometry args={[R * 0.09, 12, 10]} />
              <meshBasicMaterial color="#FFFEF2" transparent />
            </mesh>
            <sprite ref={wispGlowRef} scale={R * 0.9}>
              <spriteMaterial map={glowTex} color={glow} transparent opacity={0.9} blending={THREE.AdditiveBlending} depthWrite={false} />
            </sprite>
            {/* 拖尾光点（渐隐渐小，由 useFrame 驱动） */}
            {Array.from({ length: TRAIL_LEN }, (_, k) => (
              <sprite key={k} ref={el => { rvTrailRefs.current[k] = el }} renderOrder={2}>
                <spriteMaterial map={glowTex} color={glow} transparent opacity={0.4} blending={THREE.AdditiveBlending} depthWrite={false} />
              </sprite>
            ))}
          </group>
          {/* 上透明盖（收藏架同款玻璃） */}
          <group ref={topRef}>
            <mesh>
              <sphereGeometry args={[R, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2]} />
              <meshPhysicalMaterial color="#ffffff" transparent opacity={0.3} roughness={0.04} clearcoat={1} clearcoatRoughness={0.06} envMapIntensity={1.6} depthWrite={false} />
            </mesh>
          </group>
          {/* 裂壳粒子 */}
          {particles.map((pt, i) => (
            <mesh key={i} ref={el => { pRefs.current[i] = el }}>
              {i < 8
                ? <boxGeometry args={[pt.size, pt.size * 0.55, pt.size * 0.3]} />
                : <sphereGeometry args={[pt.size, 8, 8]} />}
              <meshBasicMaterial ref={el => { pMats.current[i] = el }} color={pt.color} transparent opacity={0} blending={i >= 8 ? THREE.AdditiveBlending : THREE.NormalBlending} depthWrite={i < 8} />
            </mesh>
          ))}
        </group>

        {/* 地面软阴影 */}
        <mesh ref={shadowRef} position={[0, FLOOR - 0.45, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.9, 32]} />
          <meshBasicMaterial color="#5C4033" transparent opacity={0.15} depthWrite={false} />
        </mesh>

        {/* 图标爆出（裂壳时从壳内弹出，回弹放大 + 上浮；无图标/纹理未就绪时不渲染） */}
        {iconTex && (
          <group ref={iconBurstRef} position={[0, FLOOR + 0.15, 0]} scale={0.001}>
            <sprite ref={iconGlowRef} scale={1.8} renderOrder={2}>
              <spriteMaterial map={glowTex} color={glow} transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} />
            </sprite>
            <mesh position={[0, 0, 0.004]} renderOrder={3}>
              <planeGeometry args={[1.05, 1.05]} />
              <meshBasicMaterial map={iconTex} transparent depthWrite={false} toneMapped={false} />
            </mesh>
            <mesh position={[0, 0, -0.004]} rotation={[0, Math.PI, 0]} renderOrder={3}>
              <planeGeometry args={[1.05, 1.05]} />
              <meshBasicMaterial map={iconTex} transparent depthWrite={false} toneMapped={false} />
            </mesh>
          </group>
        )}
      </group>
    </>
  )
}
