import { useRef, useEffect, useState, useMemo } from 'react'
import { PerspectiveCamera } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { motion } from 'motion/react'
import { sfx } from '../sound'

/* ================================================================
   扭蛋机共享 3D 模块：橱窗球体物理 + 全屏开奖仪式
   由 GachaMachineV5（当前生产版）引用
   ================================================================ */

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
