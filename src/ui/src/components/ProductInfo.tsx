import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { shelf } from '../shelf'
import { releases } from '../../../shared/releaseNotes'

export function ReleaseNotes({ version, notes }: { version?: string; notes?: string }) {
  const { i18n } = useTranslation()
  const zh = i18n.language.startsWith('zh')
  const items = version ? releases.filter(r => r.version === version.replace(/^v/, '')) : releases
  // Prefer the bundled localized copy. Raw GitHub release notes are only a
  // fallback for a version the client does not know yet, so bilingual release
  // bodies are not displayed twice inside the app.
  if (version && !items.length && notes) return <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{notes}</p>
  return <div className="space-y-4 text-sm leading-relaxed">
    {items.length ? items.map(r => <section key={r.version}>
      <h3 className="font-bold">v{r.version}</h3>
      <ul className="list-disc pl-5 space-y-1 mt-2">{(zh ? r.zh : r.en).map(note => <li key={note}>{note}</li>)}</ul>
    </section>) : <p>{zh ? '此版本尚未提供更新说明。' : 'No release notes are available for this version.'}</p>}
  </div>
}

export function ProductInfoPanel() {
  const { i18n } = useTranslation()
  const zh = i18n.language.startsWith('zh')
  const [info, setInfo] = useState<Awaited<ReturnType<typeof shelf.productInfo>>>()
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => { shelf.productInfo().then(setInfo).catch(() => setError(zh ? '无法读取设置' : 'Unable to load settings')) }, [zh])
  async function change(enabled: boolean) {
    setSaving(true)
    setError('')
    try { await shelf.setTelemetryEnabled(enabled); setInfo(await shelf.productInfo()) }
    catch { setError(zh ? '保存失败，请重试' : 'Could not save. Please retry.') }
    finally { setSaving(false) }
  }
  return <div className="mt-5 space-y-5 border-t border-text/10 pt-5 text-text">
    <section className="space-y-2">
      <h3 className="font-bold">{zh ? '隐私与使用统计' : 'Privacy & usage statistics'}</h3>
      <label className="flex gap-3 items-start text-sm">
        <input type="checkbox" checked={info?.telemetryEnabled ?? true} disabled={!info || saving}
          onChange={e => { void change(e.target.checked) }} className="mt-1" />
        <span>{zh ? '分享最少量的使用统计' : 'Share minimal usage statistics'}</span>
      </label>
      <p className="text-xs leading-relaxed text-muted">{zh
        ? '仅统计版本、系统、构建结果、耗时区间与回访里程碑。不发送提示词、代码、API 密钥、文件或扭蛋名称，也不发送账号或固定设备标识。不需要登录，关闭后不影响 BYOK 或其他功能。'
        : 'Counts version, OS, build outcomes, duration buckets and return-use milestones. No prompts, code, API keys, files, egg names, account IDs or persistent device IDs. No login required; turning it off does not affect BYOK or other features.'}</p>
      <p className="text-xs leading-relaxed text-muted">{zh
        ? `默认开启，但要等政策公告期结束且服务端启用后才发送（最早 ${info?.effective ?? '2026-09-26'}）。可随时关闭；关闭会清除本地统计记录和待发队列。`
        : `Enabled by default, but sending starts only after the notice period and server activation (no earlier than ${info?.effective ?? '2026-09-26'}). You can turn it off at any time, which clears local statistics and queued events.`}</p>
      <button onClick={() => { void shelf.openPrivacy() }} className="text-sm text-brand underline">{zh ? '阅读隐私政策' : 'Read the privacy policy'}</button>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </section>
    <details>
      <summary className="cursor-pointer font-bold">{zh ? '版本历史' : 'Version history'} · {info?.version ?? ''}</summary>
      <div className="mt-3"><ReleaseNotes /></div>
    </details>
  </div>
}

export function WhatsNew() {
  const { i18n } = useTranslation()
  const zh = i18n.language.startsWith('zh')
  const [version, setVersion] = useState<string>()
  useEffect(() => {
    let disposed = false
    const check = () => { void shelf.productInfo().then(info => {
      if (!disposed && info.visible && !info.seen) setVersion(info.version)
    }).catch(() => {}) }
    check()
    const unsubscribe = shelf.onShelfShown(check)
    return () => { disposed = true; unsubscribe() }
  }, [])
  if (!version) return null
  return <div className="fixed inset-0 z-[105] bg-black/20 flex items-center justify-center" role="dialog" aria-modal="true" aria-labelledby="whats-new-title">
    <div className="bg-cream border border-text/20 rounded-2xl p-6 w-[580px] max-w-[92vw] max-h-[85vh] overflow-y-auto shadow-xl">
      <h2 id="whats-new-title" className="text-xl font-bold mb-4">{zh ? '此版本有哪些更新' : 'What’s new'}</h2>
      <ReleaseNotes version={version} />
      <ProductInfoPanel />
      <button className="mt-5 px-5 py-2 rounded-xl bg-brand text-white font-bold" onClick={() => {
        void Promise.all([shelf.acknowledgeVersion(), shelf.acknowledgeTelemetryNotice()]).then(() => setVersion(undefined)).catch(() => setVersion(undefined))
      }}>{zh ? '开始使用' : 'Continue'}</button>
    </div>
  </div>
}

export function UsageStatisticsNotice() {
  const { i18n } = useTranslation()
  const zh = i18n.language.startsWith('zh')
  const [open, setOpen] = useState(false)
  useEffect(() => {
    let disposed = false
    const check = () => { void shelf.productInfo().then(info => {
      // An update dialog already contains the same disclosure.
      if (!disposed && info.visible && info.seen && !info.metricsNoticeSeen) setOpen(true)
    }).catch(() => {}) }
    check()
    const unsubscribe = shelf.onShelfShown(check)
    return () => { disposed = true; unsubscribe() }
  }, [])
  if (!open) return null
  async function finish(disable: boolean) {
    if (disable) await shelf.setTelemetryEnabled(false)
    await shelf.acknowledgeTelemetryNotice()
    setOpen(false)
  }
  return <div className="fixed inset-0 z-[104] bg-black/20 flex items-center justify-center" role="dialog" aria-modal="true" aria-labelledby="usage-notice-title">
    <div className="bg-cream border border-text/20 rounded-2xl p-6 w-[520px] max-w-[92vw] shadow-xl">
      <h2 id="usage-notice-title" className="text-xl font-bold">{zh ? '帮助改进 AppGacha' : 'Help improve AppGacha'}</h2>
      <p className="mt-3 text-sm leading-relaxed text-muted">{zh
        ? '公告生效后，AppGacha 会默认发送最少量的匿名使用统计，帮助判断构建是否成功以及用户是否再次使用。不会发送提示词、代码、密钥、文件、扭蛋名称、账号或固定设备标识。'
        : 'After the announced effective date, AppGacha sends minimal anonymous usage statistics by default to measure build success and return use. It never sends prompts, code, keys, files, egg names, accounts or persistent device identifiers.'}</p>
      <p className="mt-2 text-xs text-muted">{zh ? '你可以现在关闭，也可以之后随时在“设置 → 常规”中更改。' : 'Turn it off now or change it later under Settings → General.'}</p>
      <button onClick={() => { void shelf.openPrivacy() }} className="mt-3 text-sm text-brand underline">{zh ? '阅读隐私政策' : 'Read the privacy policy'}</button>
      <div className="mt-5 flex justify-end gap-3">
        <button className="px-4 py-2 rounded-xl border border-text/20 font-bold" onClick={() => { void finish(true) }}>{zh ? '关闭统计' : 'Turn off'}</button>
        <button className="px-4 py-2 rounded-xl bg-brand text-white font-bold" onClick={() => { void finish(false) }}>{zh ? '知道了' : 'Got it'}</button>
      </div>
    </div>
  </div>
}
