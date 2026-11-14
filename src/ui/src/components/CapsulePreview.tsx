import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { View } from '@react-three/drei'
import { CapsuleScene } from './Capsule3D'

export const CapsulePageActive = createContext(true)

const visibilityCallbacks = new WeakMap<Element, (visible: boolean) => void>()
let observer: IntersectionObserver | undefined

function observeCapsule(element: Element, callback: (visible: boolean) => void) {
  observer ??= new IntersectionObserver(entries => {
    for (const entry of entries) visibilityCallbacks.get(entry.target)?.(entry.isIntersecting)
  })
  visibilityCallbacks.set(element, callback)
  observer.observe(element)
  return () => {
    observer?.unobserve(element)
    visibilityCallbacks.delete(element)
  }
}

export function eggColors(eggId: string): { cup: string; content: string } {
  let h = 0
  for (let i = 0; i < eggId.length; i++) h = ((h << 5) - h + eggId.charCodeAt(i)) | 0
  const hue = Math.round((Math.abs(h) % 24) * 137.508) % 360
  const sat = 74 + (Math.abs(h >> 8) % 14)
  const lit = 52 + (Math.abs(h >> 16) % 9)
  return {
    cup: `hsl(${hue},${sat}%,${lit}%)`,
    content: `hsl(${hue},${Math.min(sat + 6, 94)}%,${lit + 21}%)`,
  }
}

/** Use SVG as an image, so capsule artwork never runs as part of the host page. */
export function iconDataUrl(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

export function CapsulePreview({ cup, content, iconUrl, dimmed, hovered, phase, visible = true }: {
  cup: string
  content: string
  iconUrl?: string
  dimmed?: boolean
  hovered?: boolean
  phase?: number
  visible?: boolean
}) {
  const pageActive = useContext(CapsulePageActive)
  const marker = useRef<HTMLDivElement>(null)
  const [inView, setInView] = useState(false)

  useEffect(() => {
    if (marker.current) return observeCapsule(marker.current, setInView)
  }, [])

  const active = pageActive && visible
  return (
    <div ref={marker} className="w-full h-full" aria-hidden="true" data-capsule-preview>
      {inView && (
        <View className="w-full h-full" visible={active} frames={active ? Infinity : 1}>
          <CapsuleScene cupColor={cup} contentColor={content} iconUrl={iconUrl}
            dimmed={dimmed} hovered={hovered} phase={phase} active={active} />
        </View>
      )}
    </div>
  )
}
