import { motion } from 'motion/react'
import { useTranslation } from 'react-i18next'

interface Props {
  version: string
  onInstall: () => void
  onDismiss: () => void
}

/**
 * 更新就绪弹窗 — 与 ClosePromptDialog 同风格的项目内弹窗。
 * 替代旧版硬编码中文的 native dialog.showMessageBox。
 */
export function UpdateDialog({ version, onInstall, onDismiss }: Props) {
  const { t } = useTranslation()

  return (
    <div className="fixed inset-0 flex items-center justify-center z-[110] bg-black/20" onClick={e => { if (e.target === e.currentTarget) onDismiss() }}>
      <motion.div
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white border-[4px] border-text rounded-2xl w-[400px] max-w-[92vw] p-7"
        style={{ boxShadow: '6px 6px 0 rgba(92,64,51,0.2)' }}
      >
        <h2 className="text-lg font-extrabold text-text mb-2">{t('update.title')}</h2>
        <p className="text-sm font-bold text-text/70 leading-relaxed mb-5">
          {t('update.body', { version })}
        </p>
        <div className="flex gap-3 justify-end">
          <button
            onClick={onDismiss}
            className="px-5 py-2.5 rounded-xl text-sm font-extrabold text-muted border-[3px] border-text/20 hover:border-text/50 active:translate-y-0.5 transition-all"
          >
            {t('update.later')}
          </button>
          <button
            onClick={onInstall}
            className="px-5 py-2.5 rounded-xl text-sm font-extrabold text-white active:translate-y-0.5 transition-all border-[3px] border-text"
            style={{ background: '#D9534F', boxShadow: '3px 3px 0 rgba(92,64,51,0.18)' }}
          >
            {t('update.install')}
          </button>
        </div>
      </motion.div>
    </div>
  )
}
