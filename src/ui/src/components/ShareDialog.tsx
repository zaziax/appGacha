import { useEffect, useState } from 'react'
import { Share2, Copy, Download, LogIn, Loader2, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { EggInfo, shelf, ShareResult } from '../shelf'
import { renderShareImage } from '../shareImage'

interface Props {
  egg: EggInfo
  cupColor: string
  contentColor: string
  onToast: (msg: string) => void
  onClose: () => void
}

/** 分享码弹窗：创建分享码 → 生成宣传截图 → 保存截图 / 复制分享码 */
export function ShareDialog({ egg, cupColor, contentColor, onToast, onClose }: Props) {
  const { t } = useTranslation()
  const [result, setResult] = useState<ShareResult | null>(null)
  const [image, setImage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(true)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const r = await shelf.shareCreate(egg.eggId)
        if (!alive) return
        setResult(r)
        try {
          const img = await renderShareImage({
            name: r.name, iconSvg: egg.icon, code: r.code, cupColor, contentColor,
            codeLabel: t('share.imageCodeLabel'), hint: t('share.imageHint'),
          })
          if (alive) setImage(img)
        } catch { /* 图片合成失败则只显示分享码 */ }
      } catch (e) {
        if (alive) setError((e as Error).message)
      } finally {
        if (alive) setCreating(false)
      }
    })()
    return () => { alive = false }
  }, [egg.eggId, egg.icon, cupColor, contentColor])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const errorText = error === 'SHARE_LOGIN_REQUIRED' ? t('share.needLogin')
    : error === 'SHARE_QUOTA_EXCEEDED' ? t('share.quotaExceeded')
    : (error ?? '')

  const copyCode = async () => {
    if (!result) return
    try { await shelf.copyText(result.code); onToast(t('share.copied')) }
    catch (e) { onToast((e as Error).message) }
  }

  const saveImage = async () => {
    if (!image) return
    try {
      const res = await shelf.saveShareImage(image, egg.name)
      if (res.saved) onToast(t('share.saved')) // 取消保存不再误报「已保存」
    } catch (e) { onToast((e as Error).message) }
  }

  return (
    <div className="fixed inset-0 bg-black/25 flex items-center justify-center z-[110]"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white border-[4px] border-text rounded-2xl p-6 w-[420px] max-w-[92vw] max-h-[90vh] overflow-y-auto animate-[popIn_.18s_ease-out]"
        style={{ boxShadow: '6px 6px 0 rgba(92,64,51,0.2)' }}>
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl border-[3px] border-text bg-cream flex items-center justify-center shrink-0"
            style={{ boxShadow: '2px 2px 0 rgba(92,64,51,0.15)' }}>
            <Share2 className="w-5 h-5 text-brand" strokeWidth={2.5} />
          </div>
          <div className="min-w-0">
            <h3 className="text-[15px] font-extrabold text-text leading-snug">{t('share.title', { name: egg.name })}</h3>
            <p className="text-[13px] font-semibold text-muted mt-1 leading-relaxed">{t('share.body')}</p>
          </div>
        </div>

        {creating ? (
          <div className="flex items-center justify-center gap-2 py-10 text-muted text-[13px] font-semibold">
            <Loader2 className="w-4 h-4 animate-spin" strokeWidth={2.5} />{t('share.creating')}
          </div>
        ) : error ? (
          <div className="mt-5">
            <p className="text-[13px] font-semibold text-muted leading-relaxed">{errorText}</p>
            <div className="flex justify-end gap-2 mt-5">
              {error === 'SHARE_LOGIN_REQUIRED' && (
                <button onClick={() => { shelf.authLogin().catch(() => {}) }}
                  className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border-[3px] border-text bg-brand text-white text-[13px] font-extrabold hover:bg-brand-hover active:translate-y-0.5 transition-all"
                  style={{ boxShadow: '2px 2px 0 rgba(92,64,51,0.2)' }}>
                  <LogIn className="w-4 h-4" strokeWidth={2.5} />{t('share.goLogin')}
                </button>
              )}
              {error === 'SHARE_QUOTA_EXCEEDED' && (
                <button onClick={() => { shelf.openPricing().catch(() => {}) }}
                  className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border-[3px] border-text bg-brand text-white text-[13px] font-extrabold hover:bg-brand-hover active:translate-y-0.5 transition-all"
                  style={{ boxShadow: '2px 2px 0 rgba(92,64,51,0.2)' }}>
                  <Sparkles className="w-4 h-4" strokeWidth={2.5} />{t('share.upgrade')}
                </button>
              )}
              <button onClick={onClose}
                className="px-3.5 py-2.5 rounded-xl border-[3px] border-text bg-white text-text text-[13px] font-extrabold hover:bg-cream active:translate-y-0.5 transition-all"
                style={{ boxShadow: '2px 2px 0 rgba(92,64,51,0.15)' }}>
                {t('exportDialog.cancel')}
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-5">
            {image && (
              <img src={image} alt=""
                className="w-full rounded-xl border-[3px] border-text mb-4"
                style={{ boxShadow: '3px 3px 0 rgba(92,64,51,0.15)' }} />
            )}
            <div className="flex items-center gap-2 mb-1.5">
              <div className="flex-1 rounded-xl border-[3px] border-text bg-cream py-2.5 text-center font-mono text-[22px] font-extrabold tracking-[0.18em] text-text">
                {result?.code}
              </div>
              <button onClick={copyCode} title={t('share.copy')}
                className="w-11 h-11 rounded-xl border-[3px] border-text bg-white text-text hover:bg-cream active:translate-y-0.5 transition-all flex items-center justify-center"
                style={{ boxShadow: '2px 2px 0 rgba(92,64,51,0.15)' }}>
                <Copy className="w-5 h-5" strokeWidth={2.5} />
              </button>
            </div>
            <div className="text-[11px] font-semibold text-muted mb-4">{t('share.expires')}</div>

            <div className="flex gap-2">
              <button onClick={saveImage}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-3 rounded-xl border-[3px] border-text bg-brand hover:bg-brand-hover text-white text-[13px] font-extrabold active:translate-y-0.5 transition-all"
                style={{ boxShadow: '2px 2px 0 rgba(92,64,51,0.2)' }}>
                <Download className="w-4 h-4" strokeWidth={2.5} />{t('share.saveImage')}
              </button>
              <button onClick={copyCode}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-3 rounded-xl border-[3px] border-text bg-white hover:bg-cream text-text text-[13px] font-extrabold active:translate-y-0.5 transition-all"
                style={{ boxShadow: '2px 2px 0 rgba(92,64,51,0.15)' }}>
                <Copy className="w-4 h-4" strokeWidth={2.5} />{t('share.copyCode')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
