import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { Egg, Sparkles, Minus, Square, X, Copy, LayoutGrid, Settings } from 'lucide-react'
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
  useEffect(() => { shelf.isMaximized().then(setMaximized); shelf.onWindowState(s => setMaximized(s.maximized)) }, [])

  return (
    <div className="flex items-center h-[46px] px-3 select-none bg-cream"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
      {/* Left: Brand — drag */}
      <div className="flex items-center gap-2 pl-2" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
        <Egg className="w-5 h-5 text-brand" strokeWidth={2.5} />
        <span className="text-[14px] font-extrabold text-text tracking-wide">应用扭蛋机</span>
      </div>

      {/* Drag spacer — fills space between brand and toggle */}
      <div className="flex-1" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />

      {/* Center: View Toggle — no-drag (only the toggle itself) */}
      <div style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <div className="flex gap-1 bg-[#E8DED1] rounded-full p-1">
          <button onClick={() => onViewChange('machine')}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-extrabold transition-colors ${
              view === 'machine' ? 'bg-text text-white' : 'text-text hover:bg-[#DCD0C0]'}`}>
            <Egg className="w-3.5 h-3.5" strokeWidth={2.5} />扭蛋机
          </button>
          <button onClick={() => onViewChange('shelf')}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-extrabold transition-colors ${
              view === 'shelf' ? 'bg-text text-white' : 'text-text hover:bg-[#DCD0C0]'}`}>
            <LayoutGrid className="w-3.5 h-3.5" strokeWidth={2.5} />收藏柜
          </button>
        </div>
      </div>

      {/* Drag spacer — fills space between toggle and right controls */}
      <div className="flex-1" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />

      {/* Right controls — no-drag */}
      <div className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        {gachaRunning && (
          <span className="flex items-center gap-1 text-xs text-brand font-extrabold mr-1">
            <motion.span animate={{ rotate: 360 }} transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}>
              <Sparkles className="w-3.5 h-3.5" strokeWidth={2.5} />
            </motion.span>
            {gachaStage || '扭蛋中…'}
          </span>
        )}
        <TBtn onClick={onImport} title="导入扭蛋">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        </TBtn>
        <TBtn onClick={onSettings} title="设置"><Settings className="w-[17px] h-[17px]" strokeWidth={2.5} />
        </TBtn>
        <div className="w-[2px] h-5 bg-text/15 mx-1" />
        <WinBtn onClick={() => shelf.minimize()} title="最小化"><Minus className="w-3.5 h-3.5" strokeWidth={3} /></WinBtn>
        <WinBtn onClick={() => shelf.maximize()} title={maximized ? '还原' : '最大化'}>
          {maximized ? <Copy className="w-3 h-3" strokeWidth={3} /> : <Square className="w-3 h-3" strokeWidth={3} />}
        </WinBtn>
        <WinBtn onClick={() => shelf.close()} title="关闭" isClose><X className="w-4 h-4" strokeWidth={3} /></WinBtn>
      </div>
    </div>
  )
}

function TBtn({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  return <button onClick={onClick} title={title} className="w-9 h-9 flex items-center justify-center rounded-xl text-text hover:bg-text/8 transition-colors">{children}</button>
}

function WinBtn({ onClick, title, children, isClose }: { onClick: () => void; title: string; children: React.ReactNode; isClose?: boolean }) {
  return (
    <button onClick={onClick} title={title}
      className={`w-[38px] h-[32px] flex items-center justify-center rounded-lg transition-colors font-extrabold ${
        isClose ? 'text-text hover:text-white hover:bg-brand' : 'text-text hover:bg-text/8'}`}>{children}</button>
  )
}
