import { useEffect, useRef } from 'react'
import { AlertTriangle } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface Props {
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/** GACHAGO 风格确认弹窗，替代原生 confirm() */
export function ConfirmDialog({ title, message, confirmText, cancelText, danger = false, onConfirm, onCancel }: Props) {
  const { t } = useTranslation()
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    confirmRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div className="fixed inset-0 bg-black/25 flex items-center justify-center z-[110]"
      onClick={e => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="bg-white border-[4px] border-text rounded-2xl p-6 w-[380px] max-w-[92vw] animate-[popIn_.18s_ease-out]"
        style={{ boxShadow: '6px 6px 0 rgba(92,64,51,0.2)' }}>
        <div className="flex items-start gap-3">
          <div className={`w-10 h-10 rounded-xl border-[3px] border-text flex items-center justify-center shrink-0 ${danger ? 'bg-red-100' : 'bg-cream'}`}
            style={{ boxShadow: '2px 2px 0 rgba(92,64,51,0.15)' }}>
            <AlertTriangle className={`w-5 h-5 ${danger ? 'text-red-600' : 'text-brand'}`} strokeWidth={2.5} />
          </div>
          <div className="min-w-0">
            <h3 className="text-[15px] font-extrabold text-text leading-snug">{title}</h3>
            <p className="text-[13px] font-semibold text-muted mt-1 leading-relaxed">{message}</p>
          </div>
        </div>
        <div className="flex justify-end gap-2.5 mt-5">
          <button onClick={onCancel}
            className="px-4 py-2.5 rounded-xl border-[3px] border-text bg-white text-text text-[13px] font-extrabold hover:bg-cream active:translate-y-0.5 transition-all"
            style={{ boxShadow: '2px 2px 0 rgba(92,64,51,0.15)' }}>
            {cancelText ?? t('confirm.cancel')}
          </button>
          <button ref={confirmRef} onClick={onConfirm}
            className={`px-4 py-2.5 rounded-xl border-[3px] border-text text-[13px] font-extrabold text-white active:translate-y-0.5 transition-all ${danger ? 'bg-red-500 hover:bg-red-600' : 'bg-brand hover:bg-brand-hover'}`}
            style={{ boxShadow: '2px 2px 0 rgba(92,64,51,0.2)' }}>
            {confirmText ?? t('confirm.ok')}
          </button>
        </div>
      </div>
    </div>
  )
}
