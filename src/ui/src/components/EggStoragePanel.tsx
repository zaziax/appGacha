import { useEffect, useState } from 'react'
import { FolderOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { shelf } from '../shelf'
import type { EggStorageStatus } from '../../../shared/eggStorage'

export function EggStoragePanel() {
  const { i18n } = useTranslation()
  const zh = i18n.language.startsWith('zh')
  const [status, setStatus] = useState<EggStorageStatus>()
  const [copyExisting, setCopyExisting] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const unavailable = status?.available === false
  const shouldCopy = copyExisting && !unavailable
  useEffect(() => { void shelf.eggStorageStatus().then(setStatus).catch(e => setError(String(e.message || e))) }, [])
  async function action(run: () => Promise<EggStorageStatus | void>) {
    setBusy(true); setError('')
    try { const next = await run(); if (next) setStatus(next) }
    catch (e) { setError(String((e as Error).message || e)) }
    finally { setBusy(false) }
  }
  const button = 'rounded-xl border border-text/20 bg-white px-3 py-2 text-xs font-bold hover:bg-cream disabled:opacity-40'
  return <section className="mt-5 space-y-3 rounded-2xl border border-text/15 bg-white/60 p-4 text-text">
    <h3 className="flex items-center gap-2 text-sm font-extrabold"><FolderOpen className="h-4 w-4" />{zh ? '扭蛋存储目录' : 'Egg storage directory'}</h3>
    <p className="text-xs text-muted">{zh ? '生成、导入、云端下载和 MCP 入柜的扭蛋及其数据统一保存在这里。' : 'Generated, imported, cloud-downloaded and MCP-installed capsules and their data are stored here.'}</p>
    <p className="select-text break-all rounded-xl bg-cream p-3 text-xs">{status?.directory ?? '…'}</p>
    {unavailable && <p role="alert" className="text-xs text-danger">{zh ? '扭蛋库尚未加载，已暂停新建、导入和入柜。上方路径仅供参考；配置损坏时显示默认候选位置，并未切换到该目录。请重新连接原磁盘后重启，或选择可用目录后重启。' : 'No library is loaded. Building, importing and installing are paused. The path above is only a reference (the default candidate if configuration is damaged), not a fallback library. Reconnect the original drive and restart, or select a working directory and restart.'}</p>}
    <label className="flex items-start gap-2 text-xs leading-relaxed">
      <input type="checkbox" checked={shouldCopy} disabled={busy || unavailable} onChange={e => setCopyExisting(e.target.checked)} className="mt-0.5" />
      <span>{zh ? '切换时复制已有扭蛋和数据，保留原目录作为备份（目标须为空文件夹）' : 'Copy existing capsules and data; keep originals as a backup (requires an empty destination)'}</span>
    </label>
    <p className="text-[11px] leading-relaxed text-muted">{zh ? '下次完全退出并重新打开 AppGacha 时生效，关闭到托盘不算退出。取消复制可使用另一份已有扭蛋库，当前扭蛋不会删除，但不会显示在新库中。设置、密钥和构建草稿仍留在原来的应用数据位置。' : 'Takes effect after fully quitting and reopening AppGacha, not minimizing to the tray. Turn off copying to use another existing library. Original capsules are not deleted but will not appear in the new library. Settings, keys and build drafts keep their current locations.'}</p>
    <div className="flex flex-wrap gap-2">
      <button className={button} disabled={busy || !status} onClick={() => void action(() => shelf.chooseEggDirectory(shouldCopy))}>{zh ? '选择目录' : 'Choose directory'}</button>
      <button className={button} disabled={busy || !status || unavailable} onClick={() => void action(() => shelf.openEggDirectory())}>{zh ? '打开当前目录' : 'Open current directory'}</button>
      {status && (unavailable || status.directory !== status.defaultDirectory) && <button className={button} disabled={busy} onClick={() => void action(() => shelf.resetEggDirectory(shouldCopy))}>{zh ? '恢复默认目录' : 'Use default directory'}</button>}
    </div>
    {status?.pending && <div className="space-y-2 rounded-xl bg-cream p-3 text-xs" role="status">
      <p className="font-bold">{zh ? '待重启生效' : 'Pending restart'} · {status.pending.copyExisting ? (zh ? '复制现有扭蛋' : 'Copy current capsules') : (zh ? '直接使用目标库' : 'Use destination library')}</p>
      <p className="select-text break-all">{status.pending.directory}</p>
      <p className="text-muted">{zh ? '复制会在下次启动时进行，扭蛋较多时需要一些时间；请勿同时修改两份库。' : 'Copying runs at next startup and may take time for a large library. Avoid editing both copies.'}</p>
      <button className={button} disabled={busy} onClick={() => void action(() => shelf.cancelEggDirectoryChange())}>{zh ? '取消更改' : 'Cancel change'}</button>
    </div>}
    {(error || status?.error) && <p role="alert" className="break-words text-xs text-danger">{error || status?.error}</p>}
    {status?.configBackup && <p className="select-text break-all text-xs text-muted">{zh ? '原配置已保留：' : 'Original configuration preserved: '}{status.configBackup}</p>}
  </section>
}
