import { useCallback, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'

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
  return (
    <AnimatePresence>
      {toast && (
        <motion.div
          key={toast.key}
          initial={{ opacity: 0, y: 16, scale: 0.92 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8, scale: 0.96 }}
          transition={{ type: 'spring', stiffness: 380, damping: 26, mass: 0.6 }}
          className="fixed left-1/2 bottom-7 -translate-x-1/2 bg-[rgba(30,30,36,0.92)] text-white px-5 py-2.5 rounded-full text-[13px] shadow-lg max-w-[70vw] z-[300]"
        >
          {toast.msg}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
