import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

/**
 * 离屏渲染收藏架同款 3D 扭蛋，输出透明背景 PNG（data URL）。
 * 用于生成桌面快捷方式图标——视觉与收藏柜中的蛋完全一致。
 *
 * 几何/材质/相机/灯光参数与 Capsule3D.tsx 的 CapsuleScene 保持同步，
 * 静态正面姿态（无动画），alpha 通道保留蛋外透明区域。
 */

/** ICO 多尺寸（与主进程 encodeIco 约定一致） */
export const ICO_SIZES = [16, 32, 48, 256]

interface RenderOpts {
  /** 下半杯颜色（与收藏架 eggColors 一致） */
  cupColor: string
  /** 无图标时内容球颜色 */
  contentColor: string
  /** 蛋图标 data URL（可选） */
  iconUrl?: string
}

/** 加载 data URL 纹理（SVG → Image → Texture） */
function loadTexture(url: string): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(
      url,
      (tex) => { tex.colorSpace = THREE.SRGBColorSpace; resolve(tex) },
      undefined,
      reject
    )
  })
}

/**
 * 渲染蛋胶囊 → 返回 size → PNG data URL 映射。
 * 渲染完即释放所有 GPU 资源与临时 canvas。
 */
export async function renderEggIconPngs(opts: RenderOpts): Promise<Record<number, string>> {
  const SIZE = 512
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  // 临时离屏挂载（visibility hidden），确保 WebGL 上下文可靠创建
  canvas.style.cssText = 'position:fixed;left:-9999px;top:-9999px;visibility:hidden;pointer-events:none'
  document.body.appendChild(canvas)

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true })
  renderer.setSize(SIZE, SIZE)
  renderer.setClearColor(0x000000, 0)
  renderer.toneMapping = THREE.ACESFilmicToneMapping  // 与 R3F Canvas 默认一致

  const scene = new THREE.Scene()
  const disposables: Array<{ dispose(): void }> = []

  // 摄影棚环境贴图（与收藏架同源——玻璃/塑料反射的来源）
  const pmrem = new THREE.PMREMGenerator(renderer)
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  disposables.push(scene.environment as THREE.Texture)
  pmrem.dispose()

  // 相机：与 CapsuleScene 一致（微微俯视，接缝自然呈现椭圆弧）
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100)
  camera.position.set(0, 0.9, 3.2)
  camera.lookAt(0, 0, 0)

  try {
    // ── 下半杯（实心塑料，DoubleSide 内壁不透明） ──
    const cupGeo = new THREE.SphereGeometry(1, 48, 24, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2)
    const cupMat = new THREE.MeshStandardMaterial({ color: opts.cupColor, roughness: 0.24, metalness: 0, envMapIntensity: 0.9, side: THREE.DoubleSide })
    scene.add(new THREE.Mesh(cupGeo, cupMat))
    disposables.push(cupGeo, cupMat)

    // ── 内容物：有图标 = 双面卡片玩具；无图标 = 亮色小球兜底 ──
    if (opts.iconUrl) {
      const iconTex = await loadTexture(opts.iconUrl)
      const planeGeo = new THREE.PlaneGeometry(1.05, 1.05)
      const iconMat = new THREE.MeshBasicMaterial({ map: iconTex, transparent: true, depthWrite: false, toneMapped: false })
      const front = new THREE.Mesh(planeGeo, iconMat)
      front.position.set(0, 0.22, 0.004)
      const back = new THREE.Mesh(planeGeo, iconMat)
      back.position.set(0, 0.22, -0.004)
      back.rotation.set(0, Math.PI, 0)
      scene.add(front, back)
      disposables.push(iconTex, planeGeo, iconMat)
    } else {
      const ballGeo = new THREE.SphereGeometry(0.56, 32, 16)
      const ballMat = new THREE.MeshStandardMaterial({ color: opts.contentColor, roughness: 0.3, metalness: 0, envMapIntensity: 0.8 })
      const ball = new THREE.Mesh(ballGeo, ballMat)
      ball.position.set(0, -0.08, 0)
      scene.add(ball)
      disposables.push(ballGeo, ballMat)
    }

    // ── 接缝环 ──
    const ringGeo = new THREE.TorusGeometry(0.985, 0.02, 12, 64)
    const ringMat = new THREE.MeshStandardMaterial({ color: opts.cupColor, roughness: 0.4, metalness: 0, envMapIntensity: 0.7 })
    const ring = new THREE.Mesh(ringGeo, ringMat)
    ring.rotation.set(Math.PI / 2, 0, 0)
    scene.add(ring)
    disposables.push(ringGeo, ringMat)

    // ── 上半透明盖（玻璃，clearcoat 映出环境柔光箱） ──
    const lidGeo = new THREE.SphereGeometry(1, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2)
    const lidMat = new THREE.MeshPhysicalMaterial({
      color: '#ffffff', transparent: true, opacity: 0.3, roughness: 0.04, metalness: 0,
      clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 1.6, depthWrite: false
    })
    scene.add(new THREE.Mesh(lidGeo, lidMat))
    disposables.push(lidGeo, lidMat)

    // ── 灯光（与 CapsuleScene 一致） ──
    scene.add(new THREE.AmbientLight(0xffffff, 0.35))
    const key = new THREE.DirectionalLight(0xffffff, 1.6)
    key.position.set(3, 5, 4)
    scene.add(key)
    const rim = new THREE.DirectionalLight('#c4ddf5', 0.5)
    rim.position.set(-3, 1, -3)
    scene.add(rim)

    renderer.render(scene, camera)

    // ── 多尺寸下采样（高质量平滑） ──
    const result: Record<number, string> = {}
    for (const size of ICO_SIZES) {
      const c = document.createElement('canvas')
      c.width = size
      c.height = size
      const ctx = c.getContext('2d')!
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(canvas, 0, 0, size, size)
      result[size] = c.toDataURL('image/png')
    }
    return result
  } finally {
    for (const d of disposables) d.dispose()
    // 显式销毁 WebGL 上下文并立即归还名额：浏览器上下文上限约 16 个，
    // dispose() 不会立刻释放，批量离屏渲染会回收掉主界面的 R3F Canvas 导致收藏架黑屏
    try { renderer.forceContextLoss() } catch { /* 部分环境不支持，忽略 */ }
    renderer.dispose()
    canvas.remove()
  }
}
