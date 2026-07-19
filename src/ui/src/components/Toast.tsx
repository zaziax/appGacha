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
  return (
    <div key={toast.key} className="fixed left-1/2 bottom-7 -translate-x-1/2 bg-[rgba(30,30,36,0.92)] text-white px-5 py-2.5 rounded-full text-[13px] shadow-lg max-w-[70vw] z-[300]">
      {toast.msg}
    </div>
  )
}
