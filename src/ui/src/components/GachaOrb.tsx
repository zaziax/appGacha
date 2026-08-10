import { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import { View, PerspectiveCamera } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { motion, AnimatePresence } from 'motion/react'
import { ChevronDown } from 'lucide-react'
import type { GachaProgress } from '../shelf'
import { sfx } from '../sound'

/* ================================================================
   3D 愿望光球 —— 第三版（A/B/C 对比用，勿覆盖 GachaVisual / GachaCapsule）。

   直接复用收藏柜的同款 3D 扭蛋（PBR 材质 + 摄影棚环境光），
   再叠加"光效"：内核愿望光球自发光、内置点光源从壳内透出、
   环绕能量粒子、冷色轮廓光、开壳瞬间的闪光迸发。

   与收藏柜共享同一个全屏 Canvas（drei View 锚定），不新建渲染器。
   Canvas 是 pointerEvents:none，点击由 DOM 透明层接住。
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

/** 模块级共享环境贴图（与收藏柜同一渲染器，只生成一次） */
let envTex: THREE.Texture | null = null
function getEnv(gl: THREE.WebGLRenderer): THREE.Texture {
  if (!envTex) {
    const pmrem = new THREE.PMREMGenerator(gl)
    envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    pmrem.dispose()
  }
  return envTex
}

export function GachaOrb({ stage, running, resultReady, onReveal }: Props) {
  const [revealing, setRevealing] = useState(false)
  const [opened, setOpened] = useState(false)      // 开壳瞬间
  const [burst, setBurst] = useState(false)        // 光球迸发
  const timers = useRef<number[]>([])
  const later = (fn: () => void, ms: number) => { timers.current.push(window.setTimeout(fn, ms)) }

  useEffect(() => () => { timers.current.forEach(clearTimeout) }, [])

  // ---- 管线阶段 → 音效 ----
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
      sfx.tick()
    }
  }, [running, revealing, resultReady, onReveal])

  return (
    <div className="flex flex-col items-center justify-center select-none h-full w-full">
      {/* ======== 3D 视口 ======== */}
      <div className="relative flex-1 w-full min-h-0">
        <View className="w-full h-full">
          <WishOrbScene running={running} resultReady={resultReady} revealing={revealing} opened={opened} burst={burst} />
        </View>

        {/* DOM 点击层（Canvas 不拦截事件，用透明圆接住"轻点胶囊"） */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-[62%] aspect-square rounded-full cursor-pointer pointer-events-auto" onClick={handleTap} />
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
          {resultReady ? '轻点胶囊，亲手开启' : revealing ? '愿望迸发中…' : running ? '愿望正在成形…' : '胶囊在等待一个愿望'}
        </p>
      </div>
    </div>
  )
}

/* ================================================================
   3D 场景：PBR 扭蛋 + 自发光内核 + 点光源 + 环绕粒子 + 轮廓光
   ================================================================ */

function WishOrbScene({ running, resultReady, revealing, opened, burst }: {
  running: boolean; resultReady: boolean; revealing: boolean; opened: boolean; burst: boolean
}) {
  const group = useRef<THREE.Group>(null)
  const orb = useRef<THREE.Mesh>(null)
  const orbLight = useRef<THREE.PointLight>(null)
  const topLid = useRef<THREE.Group>(null)
  const bottomCup = useRef<THREE.Mesh>(null)
  const flash = useRef<THREE.Mesh>(null)
  const gl = useThree(s => s.gl)
  const scene = useThree(s => s.scene)

  // 给当前 View 的 scene 装上摄影棚环境（与收藏柜同款反射）
  useEffect(() => {
    scene.environment = getEnv(gl)
    return () => { scene.environment = null }
  }, [gl, scene])

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime
    const g = group.current
    if (!g) return
    const k = Math.min(1, delta * 7)

    // 悬浮呼吸 + 缓慢自转（生成时转得快——"在干活"）
    g.position.y = Math.sin(t * 1.4) * 0.06
    g.rotation.y += delta * (running ? 0.9 : 0.4)

    // 生成中：轻微摇晃
    if (running && !revealing) {
      g.rotation.z = Math.sin(t * 7) * 0.05
      g.rotation.x = Math.sin(t * 5.7) * 0.04
    } else if (!revealing) {
      g.rotation.z = THREE.MathUtils.lerp(g.rotation.z, 0, k)
      g.rotation.x = THREE.MathUtils.lerp(g.rotation.x, 0, k)
    }

    // 开壳前：剧烈抖动
    if (revealing && !opened) {
      g.position.x = Math.sin(t * 55) * 0.05
      g.rotation.z = Math.sin(t * 42) * 0.09
    } else if (!revealing) {
      g.position.x = THREE.MathUtils.lerp(g.position.x, 0, k)
    }

    // ── 愿望光球：自发光脉冲（内核活着的证据） ──
    const alive = running || resultReady
    const pulse = alive ? Math.sin(t * (running ? 5 : 2.6)) * 0.5 + 0.5 : 0
    const orbMesh = orb.current
    if (orbMesh) {
      const m = orbMesh.material as THREE.MeshStandardMaterial
      const base = resultReady ? 1.7 : running ? 1.1 : 0.35
      m.emissiveIntensity = base + pulse * (resultReady ? 1.3 : 0.8)
      if (burst) {
        orbMesh.scale.setScalar(THREE.MathUtils.lerp(orbMesh.scale.x, 3.0, Math.min(1, delta * 9)))
        m.transparent = true
        m.opacity = THREE.MathUtils.lerp(m.opacity, 0, Math.min(1, delta * 6))
      } else if (!opened) {
        const s = (resultReady ? 1.06 : running ? 0.95 : 0.68) + pulse * 0.12
        orbMesh.scale.setScalar(THREE.MathUtils.lerp(orbMesh.scale.x, s, k))
        m.transparent = true
        m.opacity = THREE.MathUtils.lerp(m.opacity, 1, k)
      }
    }
    // 内置点光源：光从壳内透出来
    if (orbLight.current) orbLight.current.intensity = (alive ? 1.3 : 0.35) + pulse * 2.4

    // ── 开壳：上壳弹飞 + 下壳沉落 ──
    if (topLid.current) {
      topLid.current.position.y = THREE.MathUtils.lerp(topLid.current.position.y, opened ? 1.5 : 0, k)
      topLid.current.rotation.z = THREE.MathUtils.lerp(topLid.current.rotation.z, opened ? -0.7 : 0, k)
      topLid.current.traverse(o => {
        const mm = (o as THREE.Mesh).material as THREE.MeshPhysicalMaterial | undefined
        if (mm && mm.opacity !== undefined) mm.opacity = THREE.MathUtils.lerp(mm.opacity, opened ? 0 : 0.28, k)
      })
    }
    if (bottomCup.current) {
      bottomCup.current.position.y = THREE.MathUtils.lerp(bottomCup.current.position.y, opened ? -1.15 : 0, k)
      const m = bottomCup.current.material as THREE.MeshStandardMaterial
      m.transparent = true
      m.opacity = THREE.MathUtils.lerp(m.opacity, opened ? 0 : 1, k)
    }

    // ── 迸发闪光（加色混合的光球炸开） ──
    if (flash.current) {
      const m = flash.current.material as THREE.MeshBasicMaterial
      if (burst) {
        flash.current.scale.setScalar(THREE.MathUtils.lerp(flash.current.scale.x, 2.6, Math.min(1, delta * 10)))
        m.opacity = THREE.MathUtils.lerp(m.opacity, 0, Math.min(1, delta * 5))
      } else {
        flash.current.scale.setScalar(0.001)
        m.opacity = 0.9
      }
    }
  })

  return (
    <>
      <PerspectiveCamera makeDefault position={[0, 0.55, 3.6]} fov={40} onUpdate={c => c.lookAt(0, 0, 0)} />

      <group ref={group}>
        {/* 下半壳（琥珀金塑料） */}
        <mesh ref={bottomCup}>
          <sphereGeometry args={[1, 48, 24, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2]} />
          <meshStandardMaterial color="#F0B429" roughness={0.22} metalness={0.08} envMapIntensity={1} />
        </mesh>

        {/* 内核愿望光球（自发光，透过上壳可见） */}
        <mesh ref={orb} position={[0, 0.02, 0]}>
          <sphereGeometry args={[0.55, 32, 16]} />
          <meshStandardMaterial color="#FFE88A" emissive="#FFB432" emissiveIntensity={0.35} roughness={0.25} transparent />
        </mesh>

        {/* 接缝环 */}
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.985, 0.02, 12, 64]} />
          <meshStandardMaterial color="#C89B3C" roughness={0.3} metalness={0.5} envMapIntensity={0.9} />
        </mesh>

        {/* 上半透明壳（玻璃，clearcoat 映出环境柔光） */}
        <group ref={topLid}>
          <mesh>
            <sphereGeometry args={[1, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshPhysicalMaterial color="#ffffff" transparent opacity={0.28} roughness={0.04} metalness={0}
              clearcoat={1} clearcoatRoughness={0.06} envMapIntensity={1.6} depthWrite={false} />
          </mesh>
        </group>

        {/* 内置点光源（光球把壳从内照亮） */}
        <pointLight ref={orbLight} position={[0, 0.25, 0]} color="#FFD75E" intensity={0.5} distance={5} decay={2} />

        {/* 迸发闪光球（加色混合） */}
        <mesh ref={flash} scale={0.001}>
          <sphereGeometry args={[1, 24, 12]} />
          <meshBasicMaterial color="#FFE9A8" transparent opacity={0.9} depthWrite={false} blending={THREE.AdditiveBlending} />
        </mesh>
      </group>

      {/* 环绕能量粒子 */}
      <OrbParticles active={running || resultReady} />

      {/* 灯光：环境贴图打底 + 主光对比 + 冷色轮廓光 */}
      <ambientLight intensity={0.35} />
      <directionalLight position={[3, 5, 4]} intensity={1.4} />
      <directionalLight position={[-3, 2, -4]} intensity={0.8} color="#8FB7E8" />
    </>
  )
}

/** 环绕胶囊的能量粒子（生成/就绪时点亮并加速） */
function OrbParticles({ active, count = 26 }: { active: boolean; count?: number }) {
  const ref = useRef<THREE.Group>(null)
  const parts = useMemo(() => Array.from({ length: count }, () => ({
    radius: 1.35 + Math.random() * 1.0,
    speed: (0.25 + Math.random() * 0.6) * (Math.random() > 0.5 ? 1 : -1),
    phase: Math.random() * Math.PI * 2,
    y: (Math.random() - 0.5) * 1.7,
    size: 0.022 + Math.random() * 0.04,
  })), [count])

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime
    const g = ref.current
    if (!g) return
    g.children.forEach((child, i) => {
      const p = parts[i]
      const a = t * p.speed + p.phase
      child.position.set(Math.cos(a) * p.radius, p.y + Math.sin(t * 1.3 + p.phase) * 0.18, Math.sin(a) * p.radius)
      const m = (child as THREE.Mesh).material as THREE.MeshStandardMaterial
      m.opacity = THREE.MathUtils.lerp(m.opacity, active ? 0.95 : 0.16, Math.min(1, delta * 4))
      child.scale.setScalar(p.size * (active ? 1 + Math.sin(t * 2.6 + p.phase) * 0.35 : 1))
    })
  })

  return (
    <group ref={ref}>
      {parts.map((p, i) => (
        <mesh key={i} scale={p.size}>
          <sphereGeometry args={[1, 8, 8]} />
          <meshStandardMaterial color="#FFD75E" emissive="#FBD000" emissiveIntensity={2.2} transparent opacity={0.16} depthWrite={false} />
        </mesh>
      ))}
    </group>
  )
}
