import { useRef, useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { View } from '@react-three/drei'
import { useTranslation } from 'react-i18next'
import type { CloudEggInfo } from '../shelf'
import { CapsuleScene } from './Capsule3D'

interface Props {
  egg: CloudEggInfo
  downloading: boolean
  onDownload: () => void
}

/** 扭蛋配色：杯体色 + 内容物色（同 EggCard 算法，保证视觉一致） */
function eggColors(eggId: string): { cup: string; content: string } {
  let h = 0
  for (let i = 0; i < eggId.length; i++) h = ((h << 5) - h + eggId.charCodeAt(i)) | 0
  const hue = Math.round((Math.abs(h) % 24) * 137.508) % 360
  const sat = 74 + (Math.abs(h >> 8) % 14)
  const lit = 52 + (Math.abs(h >> 16) % 9)
  return {
    cup: `hsl(${hue},${sat}%,${lit}%)`,
    content: `hsl(${hue},${Math.min(sat + 6, 94)}%,${lit + 21}%)`
  }
}

/** SVG 原文 → data URL（img 渲染，沙箱化不执行脚本） */
function iconDataUrl(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

/** bytes → 人类可读（KB/MB） */
function fmtSize(bytes: number | null): string {
  if (bytes == null) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const SPHERE = 88

/**
 * 云端未下载蛋卡片 —— 同款 3D 扭蛋球体 + 灰度滤镜 + 下载遮罩。
 * 对应游戏库中"未安装"状态，视觉上像一个褪色的蛋等着被点亮。
 */
export function CloudEggCard({ egg, downloading, onDownload }: Props) {
  const { t } = useTranslation()
  const sphereRef = useRef<HTMLDivElement>(null)
  const [hovered, setHovered] = useState(false)
  const { cup: c, content: cc } = eggColors(egg.egg_id)
  const phase = (egg.egg_id.charCodeAt(0) + egg.egg_id.length * 7) % 6.28

  const dateText = egg.updated_at
    ? new Date(egg.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : ''

  const hasIcon = !!(egg.icon && egg.icon.trim().startsWith('<'))

  return (
    <div className="relative flex flex-col items-center select-none group">
      {/* 落影（搁板感，比正常蛋更淡） */}
      <div
        className="absolute bottom-[26px] left-1/2 -translate-x-1/2 rounded-[50%] bg-text/8 blur-[3px]"
        style={{ width: 52, height: 10 }}
      />

      {/* 3D 扭蛋球体（灰度滤镜：褪色但保留立体感） */}
      <div
        ref={sphereRef}
        className="relative cursor-pointer grayscale"
        style={{ width: SPHERE, height: SPHERE, filter: 'grayscale(1) brightness(0.75)' }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <View className="w-full h-full">
          <CapsuleScene
            cupColor={c}
            contentColor={cc}
            dimmed={true}
            hovered={false}
            phase={phase}
            iconUrl={hasIcon ? iconDataUrl(egg.icon!) : undefined}
          />
        </View>

        {/* 下载遮罩覆盖层：hover 时浮现，点击触发下载 */}
        <button
          onClick={(e) => { e.stopPropagation(); onDownload() }}
          className="absolute inset-0 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer z-10"
          title={t('shelf.downloadEgg')}
          aria-label={t('shelf.downloadEgg')}
        >
          {downloading ? (
            <div className="w-full h-full rounded-full bg-black/20 flex items-center justify-center">
              <Loader2 size={28} className="animate-spin text-white" />
            </div>
          ) : (
            <div className="w-full h-full rounded-full bg-black/15 flex items-center justify-center">
              <Download size={26} className="text-white drop-shadow-md" />
            </div>
          )}
        </button>
      </div>

      {/* 蛋名称 */}
      <span className="mt-1.5 text-[12px] font-extrabold text-text/50 max-w-[96px] truncate text-center leading-tight">
        {egg.egg_name}
      </span>

      {/* 大小 + 日期 */}
      {(egg.size_bytes || dateText) && (
        <span className="text-[10px] text-muted/40 -mt-1 text-center leading-tight">
          {[fmtSize(egg.size_bytes), dateText].filter(Boolean).join(' · ')}
        </span>
      )}
    </div>
  )
}
