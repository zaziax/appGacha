import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plug, Copy, ShieldCheck } from 'lucide-react'
import { shelf } from '../shelf'
import type { McpStatus } from '../../../shared/mcp'
import { ConfirmDialog } from './ConfirmDialog'

export function McpPanel() {
  const { i18n } = useTranslation(), zh = i18n.language.startsWith('zh')
  const [status, setStatus] = useState<McpStatus>()
  const [name, setName] = useState('My agent')
  const [config, setConfig] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [discardDraft, setDiscardDraft] = useState<{ id: string; name: string } | null>(null)
  useEffect(() => {
    let mounted = true
    const refresh = () => { void shelf.mcpStatus().then(s => { if (mounted) setStatus(s) }).catch(e => { if (mounted) setError(e.message) }) }
    refresh()
    const unsubscribe = shelf.onMcpChanged(refresh)
    const timer = setInterval(refresh, 5000)
    return () => { mounted = false; unsubscribe(); clearInterval(timer) }
  }, [])
  async function action(fn: () => Promise<void>) {
    setBusy(true); setError('')
    try { await fn() } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  const button = 'rounded-xl border-2 border-text/20 px-3 py-2 text-xs font-bold hover:bg-cream disabled:opacity-50'
  return <section className="space-y-5 text-sm text-text">
    <div className="flex items-center gap-3"><Plug className="h-6 w-6" /><div>
      <h3 className="font-extrabold">{zh ? '外部智能体 · MCP' : 'External agents · MCP'}</h3>
      <p className="text-xs text-muted">{zh ? '实验功能：用你喜欢的智能体制造扭蛋' : 'Experimental: build capsules with your own agent'}</p>
    </div></div>
    <div className="rounded-xl border border-text/15 bg-cream/60 p-4 text-xs leading-relaxed">
      <ShieldCheck className="mb-2 h-5 w-5" />
      {zh ? '只开放该连接创建的草稿，不开放已有应用、用户数据或 API 密钥。源码、诊断和预览可能发送给外部智能体的服务商。授权连接可直接将验证通过的新应用入柜，不再逐个弹窗确认。'
        : 'Only connection-owned drafts are exposed—not existing apps, user data or API keys. Source, diagnostics and previews may reach your agent provider. Authorized connections can install verified new apps directly, without per-app confirmation.'}
      <p className="mt-2">{zh ? '连接仅限本机。请保持 AppGacha 运行。外部生成不扣平台积分；应用运行时调用 AI 仍使用你的 AppGacha 配置，可能产生费用。'
        : 'Local clients only. Keep AppGacha running. External generation uses no platform credits; live AI inside a capsule still uses your AppGacha configuration and may incur costs.'}</p>
    </div>
    <label className="flex items-center justify-between gap-3 font-bold">
      {zh ? '启用本地 MCP' : 'Enable local MCP'}
      <input type="checkbox" checked={status?.enabled ?? false} disabled={busy || !status} onChange={e => {
        const enabled = e.target.checked
        void action(async () => { setStatus(await shelf.mcpEnabled(enabled)); setConfig('') })
      }} />
    </label>
    <p className="text-xs text-muted" role="status">{status?.running ? (zh ? '已运行 · 本地连接可用' : 'Running · local connections available') : (zh ? '未运行' : 'Not running')}</p>
    {status?.enabled && <>
      <div className="flex gap-2">
        <input aria-label={zh ? '连接名称' : 'Connection name'} maxLength={80} value={name} onChange={e => setName(e.target.value)} className="min-w-0 flex-1 rounded-xl border border-text/25 bg-white px-3 py-2" />
        <button className={button} disabled={busy || !name.trim()} onClick={() => void action(async () => {
          const result = await shelf.mcpConnect(name.trim())
          setConfig(JSON.stringify(result.config, null, 2)); setCopied(false); setStatus(await shelf.mcpStatus())
        })}>{zh ? '创建连接' : 'Create connection'}</button>
      </div>
      {config && <div className="space-y-2 rounded-xl border border-text/20 p-3">
        <p className="text-xs font-bold">{zh ? '一次性连接配置（含密钥，请勿公开）' : 'One-time configuration (contains a secret; do not share publicly)'}</p>
        <p className="text-xs text-muted">{zh ? '粘贴到支持 stdio 的智能体 MCP 配置中；配置格式可能需要按客户端调整。关闭此面板后不再显示密钥。' : 'Paste into a stdio-capable client’s MCP configuration; adapt its format if needed. The secret is not shown again after closing this panel.'}</p>
        <pre className="max-h-44 overflow-auto rounded-lg bg-cream p-3 text-[10px] select-text">{config}</pre>
        <button className={button} onClick={() => void action(async () => { await shelf.copyText(config); setCopied(true) })}><Copy className="mr-1 inline h-3 w-3" />{copied ? (zh ? '已复制' : 'Copied') : (zh ? '复制配置' : 'Copy configuration')}</button>
      </div>}
    </>}
    {!!status?.connections.length && <div className="space-y-2">
      <h4 className="text-xs font-extrabold">{zh ? '已授权连接' : 'Authorized connections'}</h4>
      {status.connections.map(c => <div key={c.id} className="flex items-center justify-between gap-2 rounded-xl border border-text/10 p-3">
        <span className="break-all text-xs">{c.name}</span>
        <button className={button} disabled={busy} onClick={() => void action(async () => { setStatus(await shelf.mcpRevoke(c.id)); setConfig('') })}>{zh ? '撤销' : 'Revoke'}</button>
      </div>)}
    </div>}
    {!!status?.drafts.length && <div className="space-y-2">
      <h4 className="text-xs font-extrabold">{zh ? '外部构建草稿' : 'External build drafts'}</h4>
      {status.drafts.map(d => <div key={d.id} className="flex items-center justify-between gap-2 rounded-xl border border-text/10 p-3">
        <div className="min-w-0"><p className="break-all text-xs font-bold">{d.name}</p><p className="text-[11px] text-muted">{d.state === 'installed' ? (zh ? '已入柜 · 可清理草稿副本' : 'Installed · draft copy can be removed') : (zh ? '草稿' : 'Draft')}</p>
          {d.state !== 'installed' && d.lastJob && <p className="mt-1 text-[11px] text-muted" role="status">
            {d.lastJob.kind === 'install' ? (zh ? '入柜' : 'Installation') : (zh ? '检查' : 'Check')}
            {' · '}{d.lastJob.state === 'running' ? (zh ? '进行中' : 'Running') : d.lastJob.state === 'failed' ? (zh ? '失败，草稿已保留' : 'Failed; draft preserved') : d.lastJob.state === 'cancelled' ? (zh ? '已中断，草稿已保留' : 'Interrupted; draft preserved') : (zh ? '已结束' : 'Finished')}
          </p>}
          {d.state !== 'installed' && d.lastJob?.error && <p className="mt-1 max-h-24 overflow-auto break-words text-[11px] text-danger">{d.lastJob.error}</p>}
        </div>
        <button className={button} disabled={busy} onClick={() => setDiscardDraft({ id: d.id, name: d.name })}>{zh ? '清理草稿' : 'Remove draft'}</button>
      </div>)}
    </div>}
    {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    {discardDraft && <ConfirmDialog
      title={zh ? '清理构建草稿' : 'Remove build draft'}
      message={zh ? `删除「${discardDraft.name}」的构建草稿？此操作无法撤销，但不会删除已入柜的应用。` : `Delete the build draft “${discardDraft.name}”? This cannot be undone. Installed apps will not be deleted.`}
      confirmText={zh ? '清理草稿' : 'Remove draft'}
      danger
      onCancel={() => setDiscardDraft(null)}
      onConfirm={() => {
        const id = discardDraft.id
        setDiscardDraft(null)
        void action(async () => setStatus(await shelf.mcpDiscard(id)))
      }}
    />}
  </section>
}
