import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import {
  Search, X, Plus, ArrowDownWideNarrow, ArrowDownAZ,
  Sparkles, Database, Package, FolderOpen, Bell, CalendarClock, AppWindow, Globe
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { EggCategory } from '../shelf'

export type SortMode = 'newest' | 'name'

interface Props {
  query: string
  onQuery: (q: string) => void
  categories: EggCategory[]
  activeCategory: string | null
  onCategory: (id: string | null) => void
  onCreateCategory: (name: string) => void
  onRenameCategory: (id: string, name: string) => void
  onDeleteCategory: (id: string) => void
  /** 当前蛋群实际用到的能力（按固定序） */
  availablePerms: string[]
  activePerm: string | null
  onPerm: (p: string | null) => void
  sort: SortMode
  onSort: (s: SortMode) => void
  resultCount: number
  totalCount: number
  /** 分享码导入（常驻入口） */
  shareCode: string
  onShareCodeChange: (code: string) => void
  onShareImport: () => void
}

const PERM_META: Record<string, { icon: typeof Sparkles }> = {
  ai: { icon: Sparkles },
  db: { icon: Database },
  storage: { icon: Package },
  fs: { icon: FolderOpen },
  notify: { icon: Bell },
  schedule: { icon: CalendarClock },
  window: { icon: AppWindow },
  network: { icon: Globe }
}

/** 能力显示名：ai 固定英文，其余走 i18n */
function permLabel(perm: string, t: (key: string) => string): string {
  return perm === 'ai' ? 'AI' : t(`perms.${perm}`)
}

const chipBase = 'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium cursor-pointer select-none transition-colors'
const chipOff = 'bg-[#efe9dc] text-[#8a7f70] hover:bg-[#e6ddca] hover:text-[#6b5f4e]'
const chipOn = 'bg-[#5c4033] text-[#fdfbf7] shadow-sm'

/** 行内编辑输入：Enter 提交 / Esc 取消 / 失焦提交 */
function InlineInput({ initial, onCommit, onCancel }: {
  initial: string
  onCommit: (v: string) => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const [value, setValue] = useState(initial)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { ref.current?.focus(); ref.current?.select() }, [])
  return (
    <input
      ref={ref}
      value={value}
      onChange={e => setValue(e.target.value)}
      onKeyDown={e => {
        if (e.key === 'Enter') onCommit(value)
        if (e.key === 'Escape') onCancel()
      }}
      onBlur={() => onCommit(value)}
      placeholder={t('shelf.categoryPlaceholder')}
      className="w-20 px-2 py-0.5 rounded-full bg-white/70 text-xs text-[#5c4033] outline-none ring-1 ring-[#d8cdb8]"
    />
  )
}

function CategoryChip({ cat, active, onClick, onRename, onDelete }: {
  cat: EggCategory
  active: boolean
  onClick: () => void
  onRename: (name: string) => void
  onDelete: () => void
}) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  return (
    <motion.span layout className={`${chipBase} ${active ? chipOn : chipOff} group`}>
      {editing ? (
        <InlineInput
          initial={cat.name}
          onCommit={v => { setEditing(false); if (v.trim() && v.trim() !== cat.name) onRename(v.trim()) }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <>
          <span onClick={onClick} onDoubleClick={() => setEditing(true)} title={t('shelf.chipHint')}>
            {cat.name}
          </span>
          <button
            onClick={e => { e.stopPropagation(); onDelete() }}
            className="w-3.5 h-3.5 -mr-1 rounded-full items-center justify-center hidden group-hover:flex hover:bg-black/10"
            title={t('shelf.deleteCategory')}
          >
            <X className="w-2.5 h-2.5" />
          </button>
        </>
      )}
    </motion.span>
  )
}

export function ShelfToolbar(p: Props) {
  const { t } = useTranslation()
  const [creating, setCreating] = useState(false)
  const filtering = p.query.trim() !== '' || p.activeCategory !== null || p.activePerm !== null

  return (
    <div className="shrink-0 px-6 pt-3.5 pb-1 space-y-2 relative z-20 bg-cream">
      {/* 第一行：搜索 + 计数 + 排序 */}
      <div className="flex items-center gap-3">
        <div className="relative w-60">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#a89c8c] pointer-events-none" />
          <input
            value={p.query}
            onChange={e => p.onQuery(e.target.value)}
            placeholder={t('shelf.searchPlaceholder')}
            className="w-full pl-8 pr-7 py-1.5 rounded-full bg-[#efe9dc] text-xs text-[#5c4033] placeholder-[#b3a794] outline-none focus:ring-2 ring-[#d8cdb8] transition-shadow"
          />
          {p.query && (
            <button
              onClick={() => p.onQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full flex items-center justify-center text-[#a89c8c] hover:bg-[#e0d6c2] hover:text-[#5c4033]"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {filtering && (
          <span className="text-[11px] text-[#a89c8c] tabular-nums">{p.resultCount} / {p.totalCount}</span>
        )}

        <div className="flex-1" />

        {/* 分享码导入：常驻入口，收藏柜非空时也能凭码领取 */}
        <div className="flex items-center gap-1.5">
          <input
            value={p.shareCode}
            onChange={e => p.onShareCodeChange(e.target.value.toUpperCase())}
            onKeyDown={e => { if (e.key === 'Enter') p.onShareImport() }}
            placeholder={t('share.inputPh')}
            className="w-32 px-3 py-1.5 rounded-full bg-[#efe9dc] text-xs text-[#5c4033] placeholder-[#b3a794] outline-none focus:ring-2 ring-[#d8cdb8] transition-shadow font-bold tracking-[0.06em]"
          />
          <button
            onClick={p.onShareImport}
            className="px-3 py-1.5 rounded-full bg-[#5c4033] text-[#fdfbf7] text-xs font-bold hover:bg-[#4a342a] active:translate-y-0.5 transition-all"
            title={t('share.import')}
          >
            {t('share.import')}
          </button>
        </div>

        <button
          onClick={() => p.onSort(p.sort === 'newest' ? 'name' : 'newest')}
          className={`${chipBase} ${chipOff}`}
          title={t('shelf.sortTitle')}
        >
          {p.sort === 'newest' ? <ArrowDownWideNarrow className="w-3 h-3" /> : <ArrowDownAZ className="w-3 h-3" />}
          {p.sort === 'newest' ? t('shelf.newest') : t('shelf.byName')}
        </button>
      </div>

      {/* 第二行：分类 chips + 能力筛选 */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <motion.span layout>
          <button
            onClick={() => p.onCategory(null)}
            className={`${chipBase} ${p.activeCategory === null ? chipOn : chipOff}`}
          >
            {t('shelf.all')}
          </button>
        </motion.span>

        {p.categories.map(cat => (
          <CategoryChip
            key={cat.id}
            cat={cat}
            active={p.activeCategory === cat.id}
            onClick={() => p.onCategory(p.activeCategory === cat.id ? null : cat.id)}
            onRename={name => p.onRenameCategory(cat.id, name)}
            onDelete={() => p.onDeleteCategory(cat.id)}
          />
        ))}

        {creating ? (
          <InlineInput
            initial=""
            onCommit={v => { setCreating(false); if (v.trim()) p.onCreateCategory(v.trim()) }}
            onCancel={() => setCreating(false)}
          />
        ) : (
          <button onClick={() => setCreating(true)} className={`${chipBase} ${chipOff} border border-dashed border-[#c9bda6]`}>
            <Plus className="w-3 h-3" /> {t('shelf.newCategory')}
          </button>
        )}

        {p.availablePerms.length > 0 && (
          <>
            <span className="w-px h-3.5 bg-[#ddd2bc] mx-1.5" />
            {p.availablePerms.map(perm => {
              const meta = PERM_META[perm]
              if (!meta) return null
              const Icon = meta.icon
              const active = p.activePerm === perm
              const label = permLabel(perm, t)
              return (
                <button
                  key={perm}
                  onClick={() => p.onPerm(active ? null : perm)}
                  className={`${chipBase} ${active ? chipOn : chipOff}`}
                  title={t('shelf.permFilterTitle', { label })}
                >
                  <Icon className="w-3 h-3" /> {label}
                </button>
              )
            })}
          </>
        )}
      </div>
    </div>
  )
}
