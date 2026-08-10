import { useEffect, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { PerspectiveCamera } from '@react-three/drei'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

/**
 * 模块级共享环境贴图：单 Canvas 只有一个 renderer，
 * 所有蛋的 View 复用同一张 PMREM 摄影棚贴图（只生成一次）。
 * 之前用 drei Environment+Lightformer 在多 View 下不可靠，换成手动 PMREM。
 */
/** 每个 renderer 一张独立环境贴图——支持多 Canvas（详情弹窗等） */
const envCache = new WeakMap<THREE.WebGLRenderer, THREE.Texture>()
function getStudioEnv(gl: THREE.WebGLRenderer): THREE.Texture {
  if (!envCache.has(gl)) {
    const pmrem = new THREE.PMREMGenerator(gl)
    envCache.set(gl, pmrem.fromScene(new RoomEnvironment(), 0.04).texture)
    pmrem.dispose()
  }
  return envCache.get(gl)!
}

interface Props {
  cupColor: string
  contentColor: string
  dimmed?: boolean
  hovered?: boolean
  /** 随机相位——让每颗蛋的浮动节奏不同步 */
  phase?: number
  /** 蛋图标 data URL——有则替代内容球，成为胶囊内的 3D 玩具 */
  iconUrl?: string
}

/**
 * 真实 3D 扭蛋：
 * - 下半杯：不透明彩色塑料半球
 * - 上半盖：透明玻璃半球（clearcoat 高光）
 * - 接缝：细圆环
 * - 内容物：蛋图标双面卡片（有图标时）或亮色小球（兜底），沉在杯内（几何遮挡 = 层级永远正确）
 * - 悬浮呼吸 + hover 摇摆 + 图标左右摆动（胶囊不自转，图标始终朝向用户）
 */
export function CapsuleScene({ cupColor, contentColor, dimmed, hovered, phase = 0, iconUrl }: Props) {
  const group = useRef<THREE.Group>(null)
  const iconRef = useRef<THREE.Group>(null)
  const gl = useThree(s => s.gl)
  const scene = useThree(s => s.scene)

  // 图标纹理：SVG data URL 光栅化为纹理（异步，加载完自动出现）
  const [iconTex, setIconTex] = useState<THREE.Texture | null>(null)
  useEffect(() => {
    if (!iconUrl) { setIconTex(null); return }
    let disposed = false
    let loaded: THREE.Texture | null = null
    new THREE.TextureLoader().load(iconUrl, (tex) => {
      if (disposed) { tex.dispose(); return }
      tex.colorSpace = THREE.SRGBColorSpace
      loaded = tex
      setIconTex(tex)
    })
    return () => { disposed = true; loaded?.dispose(); setIconTex(null) }
  }, [iconUrl])

  // 闲置微动作状态：隔几秒随机触发一次短促小动作，打破节拍器式的均匀悬浮
  const gesture = useRef({
    nextAt: 1.5 + Math.random() * 4,  // 首次触发时间错开，避免所有蛋同步做动作
    start: -10,
    type: 0                            // 0=小跳 1=摇晃 2=点头
  })

  // 给当前 View 的 scene 装上摄影棚环境（玻璃/塑料的反射来源）
  useEffect(() => {
    scene.environment = getStudioEnv(gl)
    return () => { scene.environment = null }
  }, [gl, scene])

  useFrame((state, delta) => {
    const g = group.current
    if (!g) return
    const t = state.clock.elapsedTime

    // ── 闲置微动作：小跳 / 摇晃 / 点头，随机触发（"生物感"的关键） ──
    const gs = gesture.current
    if (!dimmed && t > gs.nextAt) {
      gs.start = t
      gs.type = Math.floor(Math.random() * 3)
      gs.nextAt = t + 3.5 + Math.random() * 5
    }
    const gp = (t - gs.start) / 0.6          // 手势进度 0~1
    let gY = 0, gTiltZ = 0, gTiltX = 0, stretch = 0
    if (!dimmed && gp >= 0 && gp < 1) {
      if (gs.type === 0) {
        gY = Math.sin(gp * Math.PI) * 0.13           // 小跳：抛物线蹦跳
        stretch = Math.sin(gp * Math.PI)              // 空中拉伸（squash & stretch）
      } else if (gs.type === 1) {
        gTiltZ = Math.sin(gp * Math.PI * 4) * 0.1 * (1 - gp)  // 摇晃：衰减左右摆
      } else {
        gTiltX = Math.sin(gp * Math.PI) * 0.16       // 点头：快速前倾回正
      }
    }

    // 悬浮呼吸 + 小跳偏移
    g.position.y = Math.sin(t * 1.6 + phase) * 0.045 + gY
    // hover 摇摆（z 轴微倾）+ 摇晃叠加
    const targetTilt = hovered ? Math.sin(t * 9) * 0.07 : 0
    g.rotation.z = THREE.MathUtils.lerp(g.rotation.z, targetTilt + gTiltZ, Math.min(1, delta * 10))
    g.rotation.x = THREE.MathUtils.lerp(g.rotation.x, gTiltX, Math.min(1, delta * 12))
    // 跳跃拉伸：纵向拉长、横向压扁
    g.scale.y = 1 + stretch * 0.09
    g.scale.x = 1 - stretch * 0.05
    g.scale.z = 1 - stretch * 0.05

    // 内容物独立浮动：胶囊不自转（球对称转了也看不出），图标始终朝向用户、只做左右摆动
    const icon = iconRef.current
    if (icon) {
      icon.position.y = 0.22 + Math.sin(t * 1.3 + phase * 2.1) * 0.05
      icon.rotation.y = Math.sin(t * 0.9 + phase * 3.7) * 0.35  // 左右摆动 ±约 20°（玩具感）
      icon.rotation.z = Math.sin(t * 0.9 + phase * 3.7) * 0.07
    }

    // dimmed 透明度渐变
    const factor = dimmed ? 0.35 : 1
    g.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      if (mesh.isMesh) {
        const mat = mesh.material as THREE.MeshStandardMaterial
        if (mat.userData.baseOpacity === undefined) {
          mat.userData.baseOpacity = mat.opacity
          mat.transparent = true
        }
        const target = (mat.userData.baseOpacity as number) * factor
        mat.opacity = THREE.MathUtils.lerp(mat.opacity, target, Math.min(1, delta * 8))
      }
    })
  })

  return (
    <>
      {/* 每个 View 独立相机：微微俯视 = 接缝自然呈现椭圆弧 */}
      <PerspectiveCamera makeDefault position={[0, 0.9, 3.2]} fov={38} onUpdate={(cam) => cam.lookAt(0, 0, 0)} />
      <group ref={group}>
        {/* 下半杯（实心塑料）——低粗糙度 + 环境反射 = 光泽玩具感，DoubleSide 内壁不透明 */}
        <mesh>
          <sphereGeometry args={[1, 48, 24, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2]} />
          <meshStandardMaterial color={cupColor} roughness={0.24} metalness={0} envMapIntensity={0.9} side={THREE.DoubleSide} />
        </mesh>
        {/* 内容物：有图标 = 双面卡片玩具（随球旋转，透过玻璃盖可见）；无图标 = 亮色小球兜底 */}
        {iconTex ? (
          <group ref={iconRef} position={[0, 0.22, 0]}>
            <mesh position={[0, 0, 0.004]}>
              <planeGeometry args={[1.05, 1.05]} />
              <meshBasicMaterial map={iconTex} transparent depthWrite={false} toneMapped={false} />
            </mesh>
            {/* 背面：绕 Y 旋转 180°，从后面看图标也是正的 */}
            <mesh position={[0, 0, -0.004]} rotation={[0, Math.PI, 0]}>
              <planeGeometry args={[1.05, 1.05]} />
              <meshBasicMaterial map={iconTex} transparent depthWrite={false} toneMapped={false} />
            </mesh>
          </group>
        ) : (
          <mesh position={[0, -0.08, 0]}>
            <sphereGeometry args={[0.56, 32, 16]} />
            <meshStandardMaterial color={contentColor} roughness={0.3} metalness={0} envMapIntensity={0.8} />
          </mesh>
        )}
        {/* 接缝环 */}
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.985, 0.02, 12, 64]} />
          <meshStandardMaterial color={cupColor} roughness={0.4} metalness={0} envMapIntensity={0.7} />
        </mesh>
        {/* 上半透明盖（玻璃）——clearcoat 映出环境柔光箱 */}
        <mesh>
          <sphereGeometry args={[1, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2]} />
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

      {/* 灯光（不随组旋转）：环境贴图提供基础照明，方向光负责明暗对比 */}
      <ambientLight intensity={0.35} />
      <directionalLight position={[3, 5, 4]} intensity={1.6} />
      <directionalLight position={[-3, 1, -3]} intensity={0.5} color="#c4ddf5" />
    </>
  )
}
