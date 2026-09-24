import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { shelf } from '../shelf'
import { ConfirmDialog } from './ConfirmDialog'

/** Pull state after renderer startup rather than sending an event before it can listen. */
export function EggStorageNotice({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { i18n } = useTranslation()
  const zh = i18n.language.startsWith('zh')
  const [error, setError] = useState('')
  useEffect(() => {
    let mounted = true
    void shelf.eggStorageStatus().then(status => {
      if (mounted) setError(status.error ?? '')
    }).catch(error => console.error('[storage] Could not load storage status:', error))
    return () => { mounted = false }
  }, [])
  if (!error) return null
  return <ConfirmDialog
    title={zh ? '请检查扭蛋存储目录' : 'Check egg storage'}
    message={(zh ? '目录切换失败或当前目录不可用，请在设置中检查。\n\n' : 'The directory change failed or your library is unavailable. Check the storage settings.\n\n') + error}
    confirmText={zh ? '打开设置' : 'Open Settings'}
    cancelText={zh ? '稍后处理' : 'Later'}
    onCancel={() => setError('')}
    onConfirm={() => { setError(''); onOpenSettings() }}
  />
}
