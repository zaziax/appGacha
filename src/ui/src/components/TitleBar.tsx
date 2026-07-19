import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { Egg, Sparkles, Minus, Square, X, Copy, LayoutGrid } from 'lucide-react'
import { shelf } from '../shelf'

interface Props {
  view: 'machine' | 'shelf'
  onViewChange: (v: 'machine' | 'shelf') => void
  gachaRunning: boolean
  gachaStage: string | null
  onImport: () => void
  onSettings: () => void
}

export function TitleBar({ view, onViewChange, gachaRunning, gachaStage, onImport, onSettings }: Props) {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    shelf.isMaximized().then(setMaximized)
    shelf.onWindowState(s => setMaximized(s.maximized))
  }, [])

  return (
    <div
      className="flex items-center h-[42px] px-2 select-none"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* Left: Brand */}
      <div className="flex items-center gap-2 pl-2">
        <Egg className="w-5 h-5 text-brand" strokeWidth={1.8} />
        <span className="text-[13px] font-semibold text-text tracking-wide">应用扭蛋机</span>
      </div>

      {/* Center: View Toggle */}
      <div className="flex-1 flex justify-center">
        <div
          className="flex bg-[#f2f0ec] rounded-lg p-0.5"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <TabButton
            active={view === 'machine'}
            onClick={() => onViewChange('machine')}
            icon={<Egg className="w-3.5 h-3.5" strokeWidth={1.8} />}
            label="扭蛋机"
          />
          <TabButton
            active={view === 'shelf'}
            onClick={() => onViewChange('shelf')}
            icon={<LayoutGrid className="w-3.5 h-3.5" strokeWidth={1.8} />}
            label="收藏柜"
          />
        </div>
      </div>

      {/* Right: Actions + Window Controls */}
      <div className="flex items-center gap-0.5" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        {/* Gacha status mini */}
        {gachaRunning && (
          <span className="flex items-center gap-1 text-xs text-brand font-medium mr-2">
            <motion.span
              animate={{ rotate: 360 }}
              transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
            >
              <Sparkles className="w-3.5 h-3.5" />
            </motion.span>
            {gachaStage || '扭蛋中…'}
          </span>
        )}

        {/* Import / Settings */}
        <TitleBtn onClick={onImport} title="导入扭蛋">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        </TitleBtn>
        <TitleBtn onClick={onSettings} title="设置">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </TitleBtn>

        <div className="w-px h-5 bg-[#e8e4dc] mx-1" />

        {/* Window Controls */}
        <WinBtn onClick={() => shelf.minimize()} title="最小化">
          <Minus className="w-3.5 h-3.5" strokeWidth={2.5} />
        </WinBtn>
        <WinBtn onClick={() => shelf.maximize()} title={maximized ? '还原' : '最大化'}>
          {maximized
            ? <Copy className="w-3 h-3" strokeWidth={2.5} />
            : <Square className="w-3 h-3" strokeWidth={2.5} />
          }
        </WinBtn>
        <WinBtn onClick={() => shelf.close()} title="关闭" isClose>
          <X className="w-4 h-4" strokeWidth={2.5} />
        </WinBtn>
      </div>
    </div>
  )
}

function TabButton({ active, onClick, icon, label }: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1 px-3 py-1 rounded-md text-xs font-medium transition-all ${
        active
          ? 'bg-white shadow-sm text-brand'
          : 'text-muted hover:text-text'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}

function TitleBtn({ onClick, title, children }: {
  onClick: () => void
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="w-8 h-8 flex items-center justify-center rounded-lg text-muted hover:text-text hover:bg-[#f2f0ec] transition-colors"
    >
      {children}
    </button>
  )
}

function WinBtn({ onClick, title, children, isClose }: {
  onClick: () => void
  title: string
  children: React.ReactNode
  isClose?: boolean
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`w-[38px] h-[30px] flex items-center justify-center rounded-md transition-colors ${
        isClose
          ? 'text-muted hover:text-white hover:bg-danger'
          : 'text-muted hover:text-text hover:bg-[#f2f0ec]'
      }`}
    >
      {children}
    </button>
  )
}
