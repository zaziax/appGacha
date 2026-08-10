import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { LogOut, Crown, Zap, Cloud, ChevronDown, ChevronUp } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { shelf, UserProfile, BillingSummary, CreditTx } from '../shelf'

interface Props {
  onClose: () => void
  onLogout: () => void
}

export function UserPanel({ onClose, onLogout }: Props) {
  const { t } = useTranslation()
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [billing, setBilling] = useState<BillingSummary | null>(null)
  const [hasOwnKey, setHasOwnKey] = useState(false)
  const [loading, setLoading] = useState(true)
  const [txsOpen, setTxsOpen] = useState(false)
  const [txs, setTxs] = useState<CreditTx[] | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  /** 展开积分明细：首次点开才拉流水 */
  const toggleTxs = () => {
    const next = !txsOpen
    setTxsOpen(next)
    if (next && txs === null) {
      shelf.billingCredits().then(r => setTxs(r.txs ?? [])).catch(() => setTxs([]))
    }
  }

  /** 流水原因文案映射 */
  const txReason = (tx: CreditTx): string => {
    if (tx.reason === 'ai_call') return t('userPanel.tx.aiCall')
    if (tx.reason === 'trial') return t('userPanel.tx.trial')
    if (tx.reason === 'admin_adjust') return t('userPanel.tx.adjust') + (tx.ref_id ? ` · ${tx.ref_id}` : '')
    return tx.reason
  }

  useEffect(() => {
    Promise.all([
      shelf.authProfile().then(setProfile).catch(() => {}),
      shelf.billingSummary().then(setBilling).catch(() => {}),
      shelf.getAiSettings().then(s => setHasOwnKey(!!s?.hasKey)).catch(() => {}),
    ]).finally(() => setLoading(false))
  }, [])

  // 点击外部关闭
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  const sub = profile?.subscriptions?.[0]
  // /auth/me 现已对过期/取消订阅返回 plan="free"，所以 isPro 准确反映生效状态
  const isPro = sub?.plan === 'pro'
  const isExpired = sub?.status === 'expired' || sub?.status === 'canceled'
  const isPastDue = !!sub?.past_due_since
  const planName = billing?.plan?.display_name || (isPro ? 'Pro' : 'Free')
  const balance = billing?.credits.balance ?? null
  const fmtBalance = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))
  const quotaBytes = billing?.plan?.storage_quota_bytes ?? 0
  const usedBytes = billing?.plan?.storage_used ?? 0
  const fmtBytes = (b: number) => {
    if (b === 0) return '0'
    const gb = b / 2 ** 30
    return gb >= 1 ? `${Number.isInteger(gb) ? gb : gb.toFixed(1)} GB` : `${Math.round(b / 2 ** 20)} MB`
  }

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: -10, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.96, transition: { duration: 0.18, ease: 'easeIn' } }}
      transition={{ type: 'spring', stiffness: 420, damping: 30 }}
      className="absolute top-[54px] right-4 w-[280px] bg-[#fffdf9] rounded-2xl shadow-[0_16px_48px_rgba(60,40,10,0.16),0_4px_12px_rgba(60,40,10,0.08)] border border-[#e8dfd4] z-50 overflow-hidden"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      {/* 用户信息头部 */}
      <div className="px-5 pt-5 pb-4 bg-[#f5efe7] border-b border-[#e8dfd4]">
        {loading ? (
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-full bg-black/8 animate-pulse" />
            <div className="space-y-2">
              <div className="h-3.5 w-24 bg-black/8 rounded animate-pulse" />
              <div className="h-2.5 w-32 bg-black/6 rounded animate-pulse" />
            </div>
          </div>
        ) : profile ? (
          <div className="flex items-center gap-3">
            {profile.avatar_url ? (
              <img src={profile.avatar_url} alt="" className="w-11 h-11 rounded-full ring-2 ring-brand/20 shadow-sm" />
            ) : (
              <div className="w-11 h-11 rounded-full bg-brand text-white flex items-center justify-center text-lg font-extrabold shadow-sm">
                {profile.name?.[0]?.toUpperCase() ?? 'U'}
              </div>
            )}
            <div className="min-w-0">
              <p className="font-extrabold text-[14px] text-text truncate">{profile.name}</p>
              <p className="text-[11px] text-muted truncate">{profile.email}</p>
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted">{t('userPanel.loadFailed')}</p>
        )}
      </div>

      {/* 套餐 & 额度 */}
      <div className="px-5 py-3.5 space-y-3">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-xs font-medium text-muted">
            <Crown className="w-4 h-4 text-amber-500" />
            {t('userPanel.plan')}
          </span>
          <span className={`text-[11px] font-extrabold px-2.5 py-1 rounded-full ${
            isPro ? 'bg-amber-100 text-amber-700'
            : isExpired ? 'bg-red-100 text-red-600'
            : 'bg-black/5 text-muted'
          }`}>
            {isExpired ? t('userPanel.expired') : planName}
          </span>
        </div>
        {isPastDue && (
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-orange-600 bg-orange-50 rounded-lg px-2.5 py-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-orange-500 shrink-0" />
            {t('userPanel.pastDue')}
          </div>
        )}
        <div className="flex items-center justify-between cursor-pointer select-none" onClick={toggleTxs}>
          <span className="flex items-center gap-2 text-xs font-medium text-muted">
            <Zap className="w-4 h-4 text-brand" />
            {t('userPanel.credits')}
            {txsOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </span>
          <span className="text-xs font-bold text-text flex items-center gap-1.5">
            {balance === null ? (
              <span className="text-muted font-medium">—</span>
            ) : hasOwnKey ? (
              <>
                <span className="text-muted line-through decoration-[1.5px]">{fmtBalance(balance)}</span>
                <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                  {t('userPanel.customKey')}
                </span>
              </>
            ) : (
              fmtBalance(balance)
            )}
          </span>
        </div>
        {/* 积分明细（展开后懒加载） */}
        {txsOpen && (
          <div className="bg-black/3 rounded-xl px-3 py-2 space-y-1">
            {txs === null ? (
              <p className="text-[11px] text-muted py-1">{t('userPanel.tx.loading')}</p>
            ) : txs.length === 0 ? (
              <p className="text-[11px] text-muted py-1">{t('userPanel.tx.empty')}</p>
            ) : (
              txs.map(tx => (
                <div key={tx.id} className="flex items-center justify-between gap-2 py-0.5">
                  <span className="text-[11px] text-muted truncate flex-1">{txReason(tx)}</span>
                  <span className={`text-[11px] font-extrabold shrink-0 ${tx.delta < 0 ? 'text-red-500' : 'text-emerald-600'}`}>
                    {tx.delta > 0 ? '+' : ''}{Number.isInteger(tx.delta) ? tx.delta : tx.delta.toFixed(1)}
                  </span>
                  <span className="text-[10px] text-muted/70 shrink-0 w-[64px] text-right">
                    {tx.created_at ? new Date(tx.created_at).toLocaleString(undefined, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}
                  </span>
                </div>
              ))
            )}
          </div>
        )}
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-xs font-medium text-muted">
            <Cloud className="w-4 h-4 text-sky-500" />
            {t('userPanel.storage')}
          </span>
          <span className="text-xs font-bold text-text">
            {quotaBytes > 0 ? (
              <span>
                <span className="text-muted font-medium">{fmtBytes(usedBytes)}</span>
                <span className="text-muted/50 mx-0.5">/</span>
                {fmtBytes(quotaBytes)}
              </span>
            ) : (
              <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-sky-100 text-sky-700">
                {t('userPanel.storageSoon')}
              </span>
            )}
          </span>
        </div>
        {sub?.expires_at && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted">{t('userPanel.expires')}</span>
            <span className="text-xs font-medium text-text">{new Date(sub.expires_at).toLocaleDateString()}</span>
          </div>
        )}
      </div>

      {/* 升级 / 积分包 — 打开官网定价页（购买行为在网页端完成，账号资产云端同步） */}
      <div className="px-4 pb-1 space-y-2">
        {(!isPro || isExpired) && (
          <button
            onClick={() => shelf.openPricing().catch(() => {})}
            className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-extrabold text-white transition-all active:scale-[0.98]"
            style={{ background: 'linear-gradient(135deg, #f59e0b, #d97706)', boxShadow: '0 4px 12px rgba(217,119,6,0.28)' }}
          >
            <Crown className="w-3.5 h-3.5" />
            {t('userPanel.upgrade')}
          </button>
        )}
        <button
          onClick={() => shelf.openPricing().catch(() => {})}
          className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-bold text-text border border-ink/15 hover:bg-black/3 active:scale-[0.98] transition-all"
        >
          <Zap className="w-3.5 h-3.5" />
          {t('userPanel.buyCredits')}
        </button>
      </div>

      {/* 管理账户 — 打开官网 /account 页面 */}
      <div className="px-4 pb-1">
        <button
          onClick={() => shelf.openAccount().catch(() => {})}
          className="w-full text-center text-[11px] font-medium text-muted hover:text-text transition-colors py-1"
        >
          {t('userPanel.manageAccount')}
        </button>
      </div>

      {/* 退出登录 */}
      <div className="px-4 pb-4 pt-1">
        <button
          onClick={onLogout}
          className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-bold text-red-500 border border-red-100 hover:bg-red-50 hover:border-red-200 active:scale-[0.98] transition-all"
        >
          <LogOut className="w-3.5 h-3.5" />
          {t('userPanel.logout')}
        </button>
      </div>
    </motion.div>
  )
}
