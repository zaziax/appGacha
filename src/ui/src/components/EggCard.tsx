import { useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { X } from 'lucide-react'
import { EggInfo, shelf } from '../shelf'
import { ConfirmDialog } from './ConfirmDialog'

function eggColor(eggId: string): string {
  let h = 0
  for (let i = 0; i < eggId.length; i++) h = ((h << 5) - h + eggId.charCodeAt(i)) | 0
  return `hsl(${Math.abs(h) % 360},${58 + (Math.abs(h >> 8) % 20)}%,${50 + (Math.abs(h >> 16) % 10)}%)`
}

interface Props { egg: EggInfo; onToast: (msg: string) => void; onChanged: () => void; onUpgrade: () => void }

export function EggCard({ egg, onToast, onChanged, onUpgrade }: Props) {
  const [detailOpen, setDetailOpen] = useState(false)
  const [confirmState, setConfirmState] = useState<null | { title: string; message: string; confirmText: string; danger: boolean; action: () => Promise<void> }>(null)
  const c = eggColor(egg.eggId)
  const openEgg = () => shelf.open(egg.eggId).catch(err => onToast(err.message))

  return (
    <>
      <div className="flex flex-col items-center gap-2 cursor-pointer select-none group" onDoubleClick={openEgg}>
        {/* Capsule — bordered object, hard shadow */}
        <motion.div
          className="w-[56px] h-[80px] rounded-[28px] border-[3px] border-text"
          style={{ background: c, boxShadow: '4px 4px 0 rgba(92,64,51,0.2)' }}
          whileHover={{ scale: 1.06, y: -3 }}
          whileTap={{ scale: 0.95 }}
          transition={{ type: 'spring', stiffness: 200, damping: 14, mass: 0.8 }}
          onClick={() => setDetailOpen(true)}
        />
        <div className="text-[13px] font-extrabold text-text max-w-[100px] truncate text-center">{egg.name}</div>
        <div className="text-[11px] font-bold text-muted">v{egg.version}</div>
      </div>

      {/* Detail modal — card style */}
      <AnimatePresence>
        {detailOpen && (
          <motion.div className="fixed inset-0 bg-black/25 flex items-center justify-center z-50"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={e => { if (e.target === e.currentTarget) setDetailOpen(false) }}>
            <motion.div
              className="bg-white border-[4px] border-text rounded-2xl p-6 w-[380px] max-w-[92vw] relative"
              style={{ boxShadow: '6px 6px 0 rgba(92,64,51,0.2)' }}
              initial={{ opacity: 0, scale: 0.9, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9, y: 20 }}
              transition={{ type: 'spring', stiffness: 250, damping: 18, mass: 0.8 }}>
              {/* Close button — bordered */}
              <button
                className="absolute top-3 right-4 w-8 h-8 rounded-xl border-[3px] border-text flex items-center justify-center text-text hover:bg-cream active:translate-y-0.5 transition-all font-extrabold"
                style={{ boxShadow: '2px 2px 0 rgba(92,64,51,0.15)' }}
                onClick={() => setDetailOpen(false)}>
                <X className="w-4 h-4" strokeWidth={3} />
              </button>

              {/* Capsule icon in modal — bordered */}
              <div className="w-16 h-[66px] rounded-[24px] border-[3px] border-text mx-auto mb-3"
                style={{ background: c, boxShadow: '3px 3px 0 rgba(92,64,51,0.18)' }} />

              <h3 className="text-lg font-extrabold text-center text-text">{egg.name}</h3>
              <div className="text-xs font-bold text-muted text-center mb-4">v{egg.version} · {egg.folder}</div>

              {/* Wish text — clean, no border, just card-like bg */}
              <div className="text-[14px] text-text bg-cream rounded-2xl px-4 py-3 leading-relaxed mb-4 font-bold italic">
                {egg.wish || '（这颗蛋没有留下愿望）'}
              </div>

              {egg.permissions.length > 0 && (
                <div className="flex gap-1.5 flex-wrap mb-4">
                  {egg.permissions.map(p => (
                    <span key={p} className="text-[11px] font-extrabold text-muted border-[2.5px] border-text rounded-full px-2.5 py-0.5">{p}</span>
                  ))}
                </div>
              )}

              {/* Actions — buttons, no top divider */}
              <div className="flex gap-2 flex-wrap pt-2">
                <Btn primary onClick={() => { openEgg(); setDetailOpen(false) }}>打开</Btn>
                <Btn onClick={() => { onUpgrade(); setDetailOpen(false) }}>升级</Btn>
                <Btn onClick={async () => {
                  try { const res = await shelf.export(egg.eggId); if (res.exported) onToast(`「${egg.name}」已导出`) }
                  catch (err) { onToast((err as Error).message) }
                }}>导出</Btn>
                <Btn danger onClick={() => setConfirmState({
                  title: '放进回收站',
                  message: `把「${egg.name}」放进回收站？蛋和它的数据一起，可从回收站找回。`,
                  confirmText: '删除', danger: true,
                  action: async () => { await shelf.trash(egg.eggId); onToast(`「${egg.name}」已放进回收站`); onChanged(); setDetailOpen(false) }
                })}>删除</Btn>
                {egg.hasBackup && (
                  <Btn onClick={() => setConfirmState({
                    title: '还原备份',
                    message: `把「${egg.name}」还原到最近一次备份？代码和数据一起回到备份时刻。`,
                    confirmText: '还原', danger: false,
                    action: async () => { const res = await shelf.rollback(egg.eggId); onToast(`「${res.name}」已还原`); onChanged(); setDetailOpen(false) }
                  })}>还原</Btn>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {confirmState && (
        <ConfirmDialog
          title={confirmState.title}
          message={confirmState.message}
          confirmText={confirmState.confirmText}
          danger={confirmState.danger}
          onConfirm={async () => {
            setConfirmState(null)
            try { await confirmState.action() }
            catch (err) { onToast((err as Error).message) }
          }}
          onCancel={() => setConfirmState(null)}
        />
      )}
    </>
  )
}

function Btn({ children, primary, danger, onClick }: {
  children: React.ReactNode; primary?: boolean; danger?: boolean; onClick: () => void
}) {
  return (
    <button onClick={onClick}
      className="px-3.5 py-2 rounded-xl text-xs font-extrabold active:translate-y-0.5 transition-all border-[3px] border-text"
      style={{
        background: primary ? '#D9534F' : '#fff',
        color: primary ? '#fff' : danger ? '#D9534F' : '#5C4033',
        boxShadow: '3px 3px 0 rgba(92,64,51,0.18)'
      }}>
      {children}
    </button>
  )
}
