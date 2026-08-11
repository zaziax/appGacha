import { useRef, useState } from 'react'
import { Download, Trash2 } from 'lucide-react'
import { View } from '@react-three/drei'
import { useTranslation } from 'react-i18next'
import type { CloudEggInfo } from '../shelf'
import { CapsuleScene } from './Capsule3D'

interface Props {
  egg: CloudEggInfo
  /** -1 = idle, 0 = active downloading, >0 = position in queue */
  queuePosition: number
  /** 0-100, only meaningful when queuePosition === 0 */
  progress?: number
  onDownload: () => void
  onDelete?: () => void
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
export function CloudEggCard({ egg, queuePosition, progress, onDownload, onDelete }: Props) {
  const { t } = useTranslation()
  const sphereRef = useRef<HTMLDivElement>(null)
  const [hovered, setHovered] = useState(false)
  const { cup: c, content: cc } = eggColors(egg.egg_id)
  const phase = (egg.egg_id.charCodeAt(0) + egg.egg_id.length * 7) % 6.28

  const dateText = egg.updated_at
    ? new Date(egg.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : ''

  const hasIcon = !!(egg.icon && egg.icon.trim().startsWith('<'))

  const isActive = queuePosition >= 0  // 下载中或排队中 → 始终可见

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
        className="relative cursor-pointer"
        style={{ width: SPHERE, height: SPHERE, filter: 'grayscale(1) brightness(0.7)' }}
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

        {/* 下载遮罩覆盖层：下载/排队中始终可见，idle 时 hover 浮现 */}
        <button
          onClick={(e) => { e.stopPropagation(); onDownload() }}
          className={`absolute inset-0 rounded-full flex items-center justify-center transition-all duration-200 cursor-pointer z-10 ${
            isActive ? 'opacity-100 scale-100' : 'opacity-0 group-hover:opacity-100 group-hover:scale-100 scale-90'
          }`}
          title={t('shelf.downloadEgg')}
          aria-label={t('shelf.downloadEgg')}
        >
          {queuePosition === 0 ? (
            /* 下载中：白底 + 红色进度环 + 深色数字 */
            <div className="w-full h-full rounded-full flex items-center justify-center"
              style={{ background: 'rgba(255,255,255,0.85)', border: '3px solid #5C4033', boxShadow: '2px 2px 0 rgba(92,64,51,0.25)' }}>
              <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 88 88">
                <circle cx="44" cy="44" r="37" fill="none" stroke="#E8DED1" strokeWidth="5" />
                <circle cx="44" cy="44" r="37" fill="none" stroke="#D9534F" strokeWidth="5"
                  strokeDasharray={`${2 * Math.PI * 37}`}
                  strokeDashoffset={`${2 * Math.PI * 37 * (1 - (progress ?? 0) / 100)}`}
                  strokeLinecap="round" />
              </svg>
              <span className="text-[15px] font-extrabold text-[#5C4033] z-10">{(progress ?? 0)}%</span>
            </div>
          ) : queuePosition > 0 ? (
            /* 排队中：白底 + 红色序号 */
            <div className="w-full h-full rounded-full flex items-center justify-center"
              style={{ background: 'rgba(255,255,255,0.9)', border: '3px solid #5C4033', boxShadow: '2px 2px 0 rgba(92,64,51,0.25)' }}>
              <span className="text-[15px] font-extrabold text-[#D9534F]">#{queuePosition}</span>
            </div>
          ) : (
            /* idle：hover 时出现下载按钮 */
            <div className="w-full h-full rounded-full flex items-center justify-center"
              style={{ background: 'rgba(255,255,255,0.8)', border: '3px solid #5C4033', boxShadow: '2px 2px 0 rgba(92,64,51,0.2)' }}>
              <Download size={28} className="text-[#D9534F]" strokeWidth={3} />
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

      {/* 云端删除按钮：hover 时浮现 */}
      {onDelete && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-white border-2 border-red-200 text-red-400
            hover:bg-red-50 hover:border-red-400 hover:text-red-600 active:scale-90 transition-all
            opacity-0 group-hover:opacity-100 flex items-center justify-center z-20"
          title="从云端删除"
          aria-label="从云端删除"
          style={{ boxShadow: '1px 1px 0 rgba(92,64,51,0.12)' }}
        >
          <Trash2 className="w-3 h-3" strokeWidth={2.5} />
        </button>
      )}
    </div>
  )
}
