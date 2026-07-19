import { useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { X } from 'lucide-react'
import { EggInfo, shelf } from '../shelf'

function eggColor(eggId: string): { bg: string; shine: string; shadow: string } {
  let h = 0
  for (let i = 0; i < eggId.length; i++) h = ((h << 5) - h + eggId.charCodeAt(i)) | 0
  const H = 25 + (Math.abs(h) % 20)
  const S = 55 + (Math.abs(h >> 8) % 25)
  const L = 52 + (Math.abs(h >> 16) % 18)
  return {
    bg: `hsl(${H},${S}%,${L}%)`,
    shine: `hsl(${H},${S}%,${L + 14}%)`,
    shadow: `hsl(${H},${S + 10}%,${L - 18}%)`
  }
}

interface Props {
  egg: EggInfo
  onToast: (msg: string) => void
  onChanged: () => void
  onUpgrade: () => void
}

export function EggCard({ egg, onToast, onChanged, onUpgrade }: Props) {
  const [detailOpen, setDetailOpen] = useState(false)
  const c = eggColor(egg.eggId)
  const openEgg = () => shelf.open(egg.eggId).catch(err => onToast(err.message))

  const capsuleStyle = {
    background: `linear-gradient(160deg, ${c.shine} 0%, ${c.bg} 45%, ${c.shadow} 100%)`,
    boxShadow: `0 6px 18px ${c.shadow}44, inset 0 -6px 12px rgba(0,0,0,0.12), inset 0 6px 12px rgba(255,255,255,0.25)`
  }

  return (
    <>
      <div className="flex flex-col items-center gap-1.5 cursor-pointer select-none group" onDoubleClick={openEgg}>
        <motion.div
          className="w-[76px] h-[100px] rounded-[50%] relative"
          style={capsuleStyle}
          whileHover={{ y: -5, scale: 1.06 }}
          whileTap={{ scale: 0.95 }}
          transition={{ type: 'spring', stiffness: 200, damping: 14, mass: 0.8 }}
          onClick={() => setDetailOpen(true)}
        >
          {/* highlight */}
          <div className="absolute top-3 left-[14px] right-[14px] h-5 rounded-full bg-white/40 pointer-events-none" />
          {/* waist */}
          <div className="absolute left-[-2px] right-[-2px] top-[45%] h-[3px] rounded-sm bg-black/8" />
        </motion.div>
        <div className="text-[13px] font-semibold text-[#3a3530] max-w-[100px] truncate text-center">{egg.name}</div>
        <div className="text-[11px] text-[#a09888]">v{egg.version}</div>
      </div>

      <AnimatePresence>
        {detailOpen && (
          <motion.div
            className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={e => { if (e.target === e.currentTarget) setDetailOpen(false) }}
          >
            <motion.div
              className="bg-white rounded-2xl p-6 w-[360px] max-w-[92vw] shadow-xl relative"
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              transition={{ type: 'spring', stiffness: 250, damping: 18, mass: 0.8 }}
            >
              <button
                className="absolute top-3 right-4 w-7 h-7 rounded-full bg-[#f0ede8] text-[#888] hover:bg-[#e5e0d8] hover:text-[#555] flex items-center justify-center transition-colors"
                onClick={() => setDetailOpen(false)}
              >
                <X className="w-4 h-4" />
              </button>

              <div
                className="w-14 h-14 rounded-full flex items-center justify-center text-2xl mx-auto mb-3"
                style={{
                  background: `linear-gradient(160deg, ${c.shine} 0%, ${c.bg} 45%, ${c.shadow} 100%)`,
                  boxShadow: `0 4px 14px ${c.shadow}55`
                }}
              >
                {[...egg.name][0]}
              </div>

              <h3 className="text-lg font-semibold text-center">{egg.name}</h3>
              <div className="text-xs text-muted text-center mb-3">v{egg.version} · {egg.folder}</div>

              <div className="text-[13px] text-[#55555c] bg-[#f8f6f2] rounded-xl px-3.5 py-2.5 leading-relaxed mb-3 italic">
                {egg.wish || '（这颗蛋没有留下愿望）'}
              </div>

              {egg.permissions.length > 0 && (
                <div className="flex gap-1 flex-wrap mb-4">
                  {egg.permissions.map(p => (
                    <span key={p} className="text-[11px] text-muted bg-[#f2f0ec] rounded-full px-2 py-0.5">{p}</span>
                  ))}
                </div>
              )}

              <div className="flex gap-1.5 flex-wrap border-t border-[#f2f0ec] pt-3">
                <button onClick={() => { openEgg(); setDetailOpen(false) }}
                  className="px-3 py-1.5 bg-brand text-white rounded-lg text-xs font-medium hover:bg-brand-hover active:scale-95 transition-all">打开</button>
                <button onClick={() => { onUpgrade(); setDetailOpen(false) }}
                  className="px-3 py-1.5 border border-[#ddd9d2] rounded-lg text-xs hover:border-[#c9c4bb] active:scale-95 transition-all">升级</button>
                <button onClick={async () => {
                  try { const res = await shelf.export(egg.eggId); if (res.exported) onToast(`「${egg.name}」已导出`) }
                  catch (err) { onToast((err as Error).message) }
                }} className="px-3 py-1.5 border border-[#ddd9d2] rounded-lg text-xs hover:border-[#c9c4bb] active:scale-95 transition-all">导出</button>
                <button onClick={async () => {
                  if (!confirm(`把「${egg.name}」放进回收站？\n（蛋和它的数据一起，可从回收站找回）`)) return
                  try { await shelf.trash(egg.eggId); onToast(`「${egg.name}」已放进回收站`); onChanged(); setDetailOpen(false) }
                  catch (err) { onToast((err as Error).message) }
                }} className="px-3 py-1.5 border border-[#ddd9d2] rounded-lg text-xs text-danger hover:border-danger active:scale-95 transition-all">删除</button>
                {egg.hasBackup && (
                  <button onClick={async () => {
                    if (!confirm(`把「${egg.name}」还原到最近一次备份？`)) return
                    try { const res = await shelf.rollback(egg.eggId); onToast(`「${res.name}」已还原`); onChanged(); setDetailOpen(false) }
                    catch (err) { onToast((err as Error).message) }
                  }} className="px-3 py-1.5 border border-[#ddd9d2] rounded-lg text-xs hover:border-[#c9c4bb] active:scale-95 transition-all">还原</button>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
