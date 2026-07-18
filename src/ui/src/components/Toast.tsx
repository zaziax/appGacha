import { useCallback, useRef, useState } from 'react'

export interface ToastState { msg: string; key: number }

export function useToast() {
  const [toast, setToast] = useState<ToastState | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showToast = useCallback((msg: string) => {
    setToast({ msg, key: Date.now() })
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setToast(null), 2600)
  }, [])
  return { toast, showToast }
}

export function Toast({ toast }: { toast: ToastState | null }) {
  if (!toast) return null
  return <div id="toast" key={toast.key}>{toast.msg}</div>
}
