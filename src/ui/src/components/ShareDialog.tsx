import { useEffect, useState } from 'react'
import { Share2, Copy, Download, LogIn, Loader2, Sparkles, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { EggInfo, shelf, ShareResult } from '../shelf'
import { renderShareImage } from '../shareImage'

interface Props {
  egg: EggInfo
  cupColor: string
  contentColor: string
  onToast: (msg: string) => void
  onClose: () => void
  /** 请求打开应用内登录框（不跳浏览器） */
  onRequestLogin: () => void
}

/** 分享码弹窗：打开即生成分享码 → 生成宣传截图 → 保存截图 / 复制分享码 */
export function ShareDialog({ egg, cupColor, contentColor, onToast, onClose, onRequestLogin }: Props) {
  const { t } = useTranslation()
  const [result, setResult] = useState<ShareResult | null>(null)
  const [image, setImage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [generating, setGenerating] = useState(true)

  // 打开即生成：入口「生成分享码」已是显式意图，无需再点一次
  const handleGenerate = async () => {
    setGenerating(true)
    setError(null)
    setResult(null)
    setImage(null)
    try {
      const r = await shelf.shareCreate(egg.eggId)
      setResult(r)
      try {
        const img = await renderShareImage({
          name: r.name, iconSvg: egg.icon, code: r.code, cupColor, contentColor,
          codeLabel: t('share.imageCodeLabel'), hint: t('share.imageHint'),
        })
        setImage(img)
      } catch { /* 图片合成失败则只显示分享码 */ }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setGenerating(false)
    }
  }

  // 打开即生成（入口「生成分享码」已是显式意图）
  useEffect(() => {
    handleGenerate()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const errorText = error === 'SHARE_LOGIN_REQUIRED' ? t('share.needLogin')
    : error === 'SHARE_QUOTA_FREE' ? t('share.quotaExceeded')
    : error === 'SHARE_QUOTA_PRO' ? t('share.quotaExceededPro')
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
      <div className="bg-[#fffdf9] border-[3px] border-text rounded-[22px] p-5 w-[700px] max-w-[94vw] max-h-[90vh] overflow-y-auto animate-[popIn_.18s_ease-out]"
        style={{ boxShadow: '6px 6px 0 rgba(92,64,51,0.2)' }}>
        <div className="flex items-start gap-3 pr-10 relative">
          <div className="w-10 h-10 rounded-xl border-[3px] border-text bg-cream flex items-center justify-center shrink-0"
            style={{ boxShadow: '2px 2px 0 rgba(92,64,51,0.15)' }}>
            <Share2 className="w-5 h-5 text-brand" strokeWidth={2.5} />
          </div>
          <div className="min-w-0">
            <h3 className="text-[15px] font-extrabold text-text leading-snug">{t('share.title', { name: egg.name })}</h3>
            <p className="text-[13px] font-semibold text-muted mt-1 leading-relaxed">{t('share.body')}</p>
          </div>
          <button onClick={onClose} aria-label={t('exportDialog.cancel')}
            className="absolute -top-1 right-0 w-8 h-8 rounded-lg flex items-center justify-center text-muted hover:text-text hover:bg-cream transition-colors">
            <X className="w-4 h-4" strokeWidth={2.5} />
          </button>
        </div>

        {result ? (
          <div className="mt-4 grid grid-cols-[minmax(0,290px)_minmax(0,1fr)] gap-5 items-stretch">
            <div className="rounded-2xl border-[3px] border-text bg-cream/50 p-2.5 flex items-center justify-center min-h-[276px]"
              style={{ boxShadow: '3px 3px 0 rgba(92,64,51,0.12)' }}>
              {image ? (
                <img src={image} alt="" className="w-full aspect-square object-cover rounded-[11px]" />
              ) : (
                <Share2 className="w-12 h-12 text-brand/35" strokeWidth={2} />
              )}
            </div>

            <div className="min-w-0 rounded-2xl bg-cream/55 px-4 py-4 flex flex-col">
              <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-muted">{t('share.imageCodeLabel')}</p>
              <button onClick={copyCode}
                className="group mt-2 w-full rounded-xl border-[3px] border-text bg-white px-3 py-3 text-center transition-colors hover:bg-[#fff8e2]"
                title={t('share.copy')}>
                <span className="block font-mono text-[24px] leading-none font-extrabold tracking-[0.16em] text-text">{result.code}</span>
                <span className="mt-2 inline-flex items-center gap-1 text-[10px] font-bold text-muted group-hover:text-text">
                  <Copy className="w-3 h-3" />{t('share.copy')}
                </span>
              </button>
              <p className="mt-2 text-[11px] font-semibold leading-relaxed text-muted">{t('share.expires')}</p>

              <div className="mt-auto pt-4 space-y-2">
                <button onClick={copyCode}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border-[3px] border-text bg-brand hover:bg-brand-hover text-white text-[13px] font-extrabold active:translate-y-0.5 transition-all"
                  style={{ boxShadow: '2px 2px 0 rgba(92,64,51,0.2)' }}>
                  <Copy className="w-4 h-4" strokeWidth={2.5} />{t('share.copyCode')}
                </button>
                <button onClick={saveImage} disabled={!image}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border-[2px] border-text/70 bg-white hover:bg-cream text-text text-[12px] font-extrabold active:translate-y-0.5 transition-all disabled:opacity-40">
                  <Download className="w-4 h-4" strokeWidth={2.5} />{t('share.saveImage')}
                </button>
              </div>
            </div>
          </div>
        ) : generating ? (
          <div className="flex items-center justify-center gap-2 py-10 text-muted text-[13px] font-semibold">
            <Loader2 className="w-4 h-4 animate-spin" strokeWidth={2.5} />{t('share.creating')}
          </div>
        ) : (
          <div className="mt-5">
            <p className="text-[13px] font-semibold text-muted leading-relaxed">{errorText}</p>
            <div className="flex justify-end gap-2 mt-5">
              {error === 'SHARE_LOGIN_REQUIRED' && (
                <button onClick={onRequestLogin}
                  className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border-[3px] border-text bg-brand text-white text-[13px] font-extrabold hover:bg-brand-hover active:translate-y-0.5 transition-all"
                  style={{ boxShadow: '2px 2px 0 rgba(92,64,51,0.2)' }}>
                  <LogIn className="w-4 h-4" strokeWidth={2.5} />{t('share.goLogin')}
                </button>
              )}
              {error === 'SHARE_QUOTA_FREE' && (
                <button onClick={() => { shelf.openPricing().catch(() => {}) }}
                  className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border-[3px] border-text bg-brand text-white text-[13px] font-extrabold hover:bg-brand-hover active:translate-y-0.5 transition-all"
                  style={{ boxShadow: '2px 2px 0 rgba(92,64,51,0.2)' }}>
                  <Sparkles className="w-4 h-4" strokeWidth={2.5} />{t('share.upgrade')}
                </button>
              )}
              <button onClick={handleGenerate}
                className="px-3.5 py-2.5 rounded-xl border-[3px] border-text bg-white text-text text-[13px] font-extrabold hover:bg-cream active:translate-y-0.5 transition-all"
                style={{ boxShadow: '2px 2px 0 rgba(92,64,51,0.15)' }}>
                {t('share.retry')}
              </button>
              <button onClick={onClose}
                className="px-3.5 py-2.5 rounded-xl border-[3px] border-text bg-white text-text text-[13px] font-extrabold hover:bg-cream active:translate-y-0.5 transition-all"
                style={{ boxShadow: '2px 2px 0 rgba(92,64,51,0.15)' }}>
                {t('exportDialog.cancel')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
