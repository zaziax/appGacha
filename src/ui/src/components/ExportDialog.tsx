import { useEffect, useRef } from 'react'
import { Share2, Database, AppWindow } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface Props {
  name: string
  /** 用户选定导出方式：true=包含数据 / false=仅应用 */
  onChoose: (includeData: boolean) => void
  onCancel: () => void
}

/** 导出询问弹窗（GACHAGO 风格）：选择是否连同蛋内数据一起导出 */
export function ExportDialog({ name, onChoose, onCancel }: Props) {
  const { t } = useTranslation()
  const primaryRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    primaryRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div className="fixed inset-0 bg-black/25 flex items-center justify-center z-[110]"
      onClick={e => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="bg-white border-[4px] border-text rounded-2xl p-6 w-[400px] max-w-[92vw] animate-[popIn_.18s_ease-out]"
        style={{ boxShadow: '6px 6px 0 rgba(92,64,51,0.2)' }}>
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl border-[3px] border-text bg-cream flex items-center justify-center shrink-0"
            style={{ boxShadow: '2px 2px 0 rgba(92,64,51,0.15)' }}>
            <Share2 className="w-5 h-5 text-brand" strokeWidth={2.5} />
          </div>
          <div className="min-w-0">
            <h3 className="text-[15px] font-extrabold text-text leading-snug">{t('exportDialog.title', { name })}</h3>
            <p className="text-[13px] font-semibold text-muted mt-1 leading-relaxed">{t('exportDialog.body')}</p>
          </div>
        </div>

        {/* 两种导出方式：包含数据 / 仅应用 */}
        <div className="flex flex-col gap-2.5 mt-5">
          <button ref={primaryRef} onClick={() => onChoose(true)}
            className="flex items-center gap-3 px-4 py-3 rounded-xl border-[3px] border-text bg-brand hover:bg-brand-hover text-white text-left active:translate-y-0.5 transition-all"
            style={{ boxShadow: '2px 2px 0 rgba(92,64,51,0.2)' }}>
            <Database className="w-5 h-5 shrink-0" strokeWidth={2.5} />
            <span className="min-w-0">
              <span className="block text-[13px] font-extrabold">{t('exportDialog.withData')}</span>
              <span className="block text-[11px] font-semibold opacity-80 mt-0.5">{t('exportDialog.withDataHint')}</span>
            </span>
          </button>
          <button onClick={() => onChoose(false)}
            className="flex items-center gap-3 px-4 py-3 rounded-xl border-[3px] border-text bg-white hover:bg-cream text-text text-left active:translate-y-0.5 transition-all"
            style={{ boxShadow: '2px 2px 0 rgba(92,64,51,0.15)' }}>
            <AppWindow className="w-5 h-5 shrink-0 text-brand" strokeWidth={2.5} />
            <span className="min-w-0">
              <span className="block text-[13px] font-extrabold">{t('exportDialog.appOnly')}</span>
              <span className="block text-[11px] font-semibold text-muted mt-0.5">{t('exportDialog.appOnlyHint')}</span>
            </span>
          </button>
        </div>

        <div className="flex justify-end mt-4">
          <button onClick={onCancel}
            className="px-4 py-2.5 rounded-xl border-[3px] border-text bg-white text-text text-[13px] font-extrabold hover:bg-cream active:translate-y-0.5 transition-all"
            style={{ boxShadow: '2px 2px 0 rgba(92,64,51,0.15)' }}>
            {t('exportDialog.cancel')}
          </button>
        </div>
      </div>
    </div>
  )
}
