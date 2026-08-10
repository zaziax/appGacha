import { useEffect, useRef, useState } from 'react'
import { LogOut } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface Props {
  onResolve: (action: 'tray' | 'quit', remember: boolean) => void
  onCancel: () => void
}

/** 关闭询问弹窗（GACHAGO 风格）：最小化到托盘 / 直接退出 / 取消，可记住选择 */
export function ClosePromptDialog({ onResolve, onCancel }: Props) {
  const { t } = useTranslation()
  const [remember, setRemember] = useState(false)
  const primaryRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    primaryRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div className="fixed inset-0 flex items-center justify-center z-[110]"
      onClick={e => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="bg-white border-[4px] border-text rounded-2xl p-6 w-[400px] max-w-[92vw] animate-[popIn_.18s_ease-out] pointer-events-auto"
        style={{ boxShadow: '6px 6px 0 rgba(92,64,51,0.2)' }}>
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl border-[3px] border-text bg-cream flex items-center justify-center shrink-0"
            style={{ boxShadow: '2px 2px 0 rgba(92,64,51,0.15)' }}>
            <LogOut className="w-5 h-5 text-brand" strokeWidth={2.5} />
          </div>
          <div className="min-w-0">
            <h3 className="text-[15px] font-extrabold text-text leading-snug">{t('closePrompt.title')}</h3>
            <p className="text-[13px] font-semibold text-muted mt-1 leading-relaxed">
              {t('closePrompt.body')}
            </p>
          </div>
        </div>
        <label className="flex items-center gap-2 mt-4 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={remember}
            onChange={e => setRemember(e.target.checked)}
            className="w-4 h-4 cursor-pointer"
            style={{ accentColor: 'var(--color-brand, #e8843c)' }}
          />
          <span className="text-[12px] font-semibold text-muted">{t('closePrompt.remember')}</span>
        </label>
        <div className="flex justify-end gap-2.5 mt-5">
          <button onClick={onCancel}
            className="px-4 py-2.5 rounded-xl border-[3px] border-text bg-white text-text text-[13px] font-extrabold hover:bg-cream active:translate-y-0.5 transition-all"
            style={{ boxShadow: '2px 2px 0 rgba(92,64,51,0.15)' }}>
            {t('closePrompt.cancel')}
          </button>
          <button onClick={() => onResolve('quit', remember)}
            className="px-4 py-2.5 rounded-xl border-[3px] border-text bg-cream text-text text-[13px] font-extrabold hover:bg-red-50 hover:text-red-600 active:translate-y-0.5 transition-all"
            style={{ boxShadow: '2px 2px 0 rgba(92,64,51,0.15)' }}>
            {t('closePrompt.quit')}
          </button>
          <button ref={primaryRef} onClick={() => onResolve('tray', remember)}
            className="px-4 py-2.5 rounded-xl border-[3px] border-text bg-brand hover:bg-brand-hover text-white text-[13px] font-extrabold active:translate-y-0.5 transition-all"
            style={{ boxShadow: '2px 2px 0 rgba(92,64,51,0.2)' }}>
            {t('closePrompt.tray')}
          </button>
        </div>
      </div>
    </div>
  )
}
