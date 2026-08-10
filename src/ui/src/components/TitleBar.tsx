import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Egg, Sparkles, Minus, Square, X, Copy, LayoutGrid, Settings, User, PanelLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { shelf, AuthStatus } from '../shelf'
import { UserPanel } from './UserPanel'
import { LoginDialog } from './LoginDialog'

interface Props {
  view: 'machine' | 'shelf' | 'space'
  onViewChange: (v: 'machine' | 'shelf' | 'space') => void
  gachaRunning: boolean
  gachaStage: string | null
  onImport: () => void
  onSettings: () => void
  /** 登录弹窗开关变化上报（App 统一处理空间蛋视图避让） */
  onLoginOpenChange?: (open: boolean) => void
  /** 用户面板开关变化上报（App 统一处理空间蛋视图避让） */
  onUserPanelOpenChange?: (open: boolean) => void
}

const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || '')

export function TitleBar({ view, onViewChange, gachaRunning, gachaStage, onImport, onSettings, onLoginOpenChange, onUserPanelOpenChange }: Props) {
  const { t } = useTranslation()
  const [maximized, setMaximized] = useState(false)
  const [auth, setAuth] = useState<AuthStatus>({ loggedIn: false })
  const [userPanelOpen, setUserPanelOpen] = useState(false)
  const [loginOpen, setLoginOpen] = useState(false)

  useEffect(() => { onLoginOpenChange?.(loginOpen) }, [loginOpen, onLoginOpenChange])
  useEffect(() => { onUserPanelOpenChange?.(userPanelOpen) }, [userPanelOpen, onUserPanelOpenChange])

  useEffect(() => { shelf.isMaximized().then(setMaximized); shelf.onWindowState(s => setMaximized(s.maximized)) }, [])

  // 登录状态
  useEffect(() => {
    shelf.authStatus().then(setAuth).catch(() => {})
    shelf.onAuthChanged((s) => {
      shelf.authStatus().then(setAuth).catch(() => {})
      // 外部登录完成（Google OAuth deep link 回来）→ 自动关闭登录弹窗
      if (s.loggedIn) setLoginOpen(false)
    })
  }, [])

  const handleAuth = async () => {
    if (auth.loggedIn) {
      setUserPanelOpen(v => !v)
    } else {
      setLoginOpen(true)
    }
  }

  const handleLoginSuccess = () => {
    setLoginOpen(false)
    shelf.authStatus().then(setAuth).catch(() => {})
  }

  const handleLogout = async () => {
    setUserPanelOpen(false)
    await shelf.authLogout()
    setAuth({ loggedIn: false })
  }

  return (
    <div className="flex items-center h-[46px] px-3 select-none bg-cream relative z-[100]"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
      {/* Left: Brand — macOS 留出交通灯空间 */}
      <div className={`flex items-center gap-2 ${isMac ? 'pl-[74px]' : 'pl-2'}`} style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
        <img src="./icon.png" className="w-5 h-5" alt="" />
        <span className="text-[14px] font-extrabold text-text tracking-wide">{t('titleBar.appName')}</span>
      </div>

      {/* Drag spacer — fills space between brand and toggle */}
      <div className="flex-1" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />

      {/* Center: View Toggle — no-drag (only the toggle itself) */}
      <div style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <div className="flex gap-1 bg-[#E8DED1] rounded-full p-1">
          <button onClick={() => onViewChange('machine')}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-extrabold transition-colors ${
              view === 'machine' ? 'bg-text text-white' : 'text-text hover:bg-[#DCD0C0]'}`}>
            <Egg className="w-3.5 h-3.5" strokeWidth={2.5} />{t('titleBar.machine')}
          </button>
          <button onClick={() => onViewChange('shelf')}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-extrabold transition-colors ${
              view === 'shelf' ? 'bg-text text-white' : 'text-text hover:bg-[#DCD0C0]'}`}>
            <LayoutGrid className="w-3.5 h-3.5" strokeWidth={2.5} />{t('titleBar.shelf')}
          </button>
          <button onClick={() => onViewChange('space')}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-extrabold transition-colors ${
              view === 'space' ? 'bg-text text-white' : 'text-text hover:bg-[#DCD0C0]'}`}>
            <PanelLeft className="w-3.5 h-3.5" strokeWidth={2.5} />{t('titleBar.space')}
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
            {gachaStage || t('titleBar.gaching')}
          </span>
        )}
        <TBtn onClick={onImport} title={t('titleBar.import')}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        </TBtn>
        <TBtn onClick={onSettings} title={t('titleBar.settings')}><Settings className="w-[17px] h-[17px]" strokeWidth={2.5} />
        </TBtn>
        {/* 登录 / 用户 */}
        <button onClick={handleAuth}
          title={auth.loggedIn ? `${auth.user?.email} — ${t('titleBar.logout')}` : t('titleBar.login')}
          className={`flex items-center gap-1.5 px-2.5 h-9 rounded-xl text-xs font-bold transition-colors ${
            auth.loggedIn
              ? 'text-emerald-600 hover:bg-emerald-600/8'
              : 'text-text hover:bg-text/8'}`}>
          {auth.loggedIn ? (
            <>
              <span className="w-5 h-5 rounded-full bg-emerald-500 text-white flex items-center justify-center text-[10px] font-extrabold">
                {auth.user?.name?.[0]?.toUpperCase() ?? 'U'}
              </span>
              <span className="max-w-[64px] truncate">{auth.user?.name?.split(' ')[0]}</span>
            </>
          ) : (
            <><User className="w-4 h-4" strokeWidth={2.5} />{t('titleBar.login')}</>
          )}
        </button>
        {/* 用户面板下拉 */}
        <AnimatePresence>
          {userPanelOpen && auth.loggedIn && (
            <UserPanel onClose={() => setUserPanelOpen(false)} onLogout={handleLogout} />
          )}
        </AnimatePresence>
        {/* Windows 窗口控件：macOS 用原生交通灯代替 */}
        {!isMac && (
          <>
            <div className="w-[2px] h-5 bg-text/15 mx-1" />
            <WinBtn onClick={() => shelf.minimize()} title={t('titleBar.minimize')}><Minus className="w-3.5 h-3.5" strokeWidth={3} /></WinBtn>
            <WinBtn onClick={() => shelf.maximize()} title={maximized ? t('titleBar.restore') : t('titleBar.maximize')}>
              {maximized ? <Copy className="w-3 h-3" strokeWidth={3} /> : <Square className="w-3 h-3" strokeWidth={3} />}
            </WinBtn>
            <WinBtn onClick={() => shelf.close()} title={t('titleBar.close')} isClose><X className="w-4 h-4" strokeWidth={3} /></WinBtn>
          </>
        )}
      </div>

      {/* 登录对话框 */}
      <LoginDialog open={loginOpen} onClose={() => setLoginOpen(false)} onSuccess={handleLoginSuccess} />
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
