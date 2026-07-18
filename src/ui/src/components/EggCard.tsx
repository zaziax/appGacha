import { EggInfo, shelf } from '../shelf'

interface Props {
  egg: EggInfo
  onToast: (msg: string) => void
  onChanged: () => void
  onUpgrade: () => void
}

export function EggCard({ egg, onToast, onChanged, onUpgrade }: Props) {
  const open = () => shelf.open(egg.eggId).catch(err => onToast(err.message))

  return (
    <div className="egg-card" title={`双击打开「${egg.name}」`} onDoubleClick={open}>
      <div className="egg-top">
        <div className="egg-icon">{[...egg.name][0]}</div>
        <div>
          <div className="egg-name">{egg.name}</div>
          <div className="egg-version">v{egg.version} · {egg.folder}</div>
        </div>
      </div>
      <div className="egg-wish">{egg.wish || '（这颗蛋没有留下愿望）'}</div>
      <div className="egg-perms">
        {egg.permissions.map(p => <span key={p} className="perm">{p}</span>)}
      </div>
      <div className="egg-actions">
        <button onClick={e => { e.stopPropagation(); open() }}>打开</button>
        <button title="对着这颗蛋许愿，机芯会在原有基础上改造它"
          onClick={e => { e.stopPropagation(); onUpgrade() }}>升级</button>
        <button onClick={async e => {
          e.stopPropagation()
          try {
            const res = await shelf.export(egg.eggId)
            if (res.exported) onToast(`「${egg.name}」已导出，拷给朋友吧`)
          } catch (err) { onToast((err as Error).message) }
        }}>导出</button>
        <button className="danger" onClick={async e => {
          e.stopPropagation()
          if (!confirm(`把「${egg.name}」放进回收站？\n（蛋和它的数据一起，可从回收站找回）`)) return
          try {
            await shelf.trash(egg.eggId)
            onToast(`「${egg.name}」已放进回收站`)
            onChanged()
          } catch (err) { onToast((err as Error).message) }
        }}>删除</button>
        {egg.hasBackup && (
          <button title="回到上次升级前的样子（代码和数据一起）" onClick={async e => {
            e.stopPropagation()
            if (!confirm(`把「${egg.name}」还原到最近一次备份？\n（代码和数据一起回到备份时刻）`)) return
            try {
              const res = await shelf.rollback(egg.eggId)
              onToast(`「${res.name}」已还原`)
              onChanged()
            } catch (err) { onToast((err as Error).message) }
          }}>还原</button>
        )}
      </div>
    </div>
  )
}
