import { useEffect, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { AnimatePresence, motion } from 'motion/react'
import { ClipboardList, Palette, Wand2 } from 'lucide-react'
import type { GachaProgress } from '../shelf'
import { sfx } from '../sound'
import { RevealCeremony, ShowcaseBalls } from './GachaShowcase3D'

interface Props {
  stage: GachaProgress['stage'] | null
  running: boolean
  resultReady: boolean
  onReveal: () => void
  icon?: string
  journeyProgress?: number
  heroActive?: boolean
  heroColor?: string
  palette?: string[]
  thinking?: boolean
  revealLabel?: string
}

const C = {
  ink: '#5C4033', coral: '#DE5A56', cream: '#F7EEE5', paper: '#FFFDF9',
  yellow: '#FFD36A', mint: '#9ADBC8', blue: '#9FC5EC', peach: '#F6D8C7',
  coralDark: '#B8403C',
}

type RevealStep = 'idle' | 'turning' | 'dropped' | 'ceremony'

/** 温暖纸感的轻拟物应用扭蛋机；旋钮只在最终揭晓时成为操作。 */
export function AppAssemblyStage({
  stage, running, resultReady, onReveal, icon,
  journeyProgress = 0, heroActive = false, heroColor = C.yellow,
  palette = [], thinking = false, revealLabel = 'Reveal app capsule',
}: Props) {
  const [revealStep, setRevealStep] = useState<RevealStep>('idle')
  const agitatedRef = useRef(false)
  const revealTimers = useRef<number[]>([])
  const wasReady = useRef(false)
  const progress = Math.max(0, Math.min(1, journeyProgress))
  const active = heroActive || running || resultReady
  const effectiveProgress = running || resultReady ? 1 : progress
  const assembling = running && (stage === 'crank' || stage === 'clack')
  const revealing = revealStep !== 'idle'

  useEffect(() => {
    if (stage === 'coin') sfx.pop()
    if (stage === 'clack') sfx.whoosh()
  }, [stage])

  // 完成瞬间只提示一次；后续依靠安静的视觉节奏吸引注意。
  useEffect(() => {
    if (resultReady && !wasReady.current) sfx.ready()
    wasReady.current = resultReady
  }, [resultReady])

  // 生成时短促搅拌、自然停顿；避免一直翻滚造成焦躁和视觉噪声。
  useEffect(() => {
    let stopped = false
    let stopTimer = 0
    let nextTimer = 0
    const burst = () => {
      if (stopped) return
      agitatedRef.current = true
      stopTimer = window.setTimeout(() => {
        agitatedRef.current = false
        nextTimer = window.setTimeout(burst, 850 + Math.random() * 650)
      }, 420 + Math.random() * 240)
    }
    if (assembling || thinking) burst()
    else agitatedRef.current = false
    return () => {
      stopped = true
      clearTimeout(stopTimer)
      clearTimeout(nextTimer)
      agitatedRef.current = false
    }
  }, [assembling, thinking])

  useEffect(() => () => revealTimers.current.forEach(clearTimeout), [])

  const reveal = () => {
    if (!resultReady || running || revealing) return
    setRevealStep('turning')
    agitatedRef.current = true
    sfx.crank()
    revealTimers.current = [
      window.setTimeout(() => {
        agitatedRef.current = false
        setRevealStep('dropped')
        sfx.drop()
      }, 500),
      window.setTimeout(() => setRevealStep('ceremony'), 1180),
    ]
  }

  return (
    <div className="flex flex-col items-center select-none">
      <div className="wish-stage-model shrink-0">
        <div className="relative h-[448px] w-[300px]">
          <SoftBackdrop active={active} color={heroColor} />
          <div className="absolute left-1/2 top-[14px] z-10 -translate-x-1/2">
            <AnimatePresence>{thinking && <ThinkingDots />}</AnimatePresence>
            <SoftGachaMachine
              active={active}
              progress={effectiveProgress}
              palette={palette}
              heroColor={heroColor}
              assembling={assembling || thinking}
              agitatedRef={agitatedRef}
              resultReady={resultReady}
              revealStep={revealStep}
              revealLabel={revealLabel}
              onReveal={reveal}
            />
          </div>
          <div className="absolute left-1/2 top-[414px] h-[13px] w-[210px] -translate-x-1/2 rounded-[50%] bg-[#5C4033]/16 blur-[0.3px]" />
        </div>
      </div>

      <AnimatePresence>
        {revealStep === 'ceremony' && (
          <RevealCeremony icon={icon} onDone={() => {
            setRevealStep('idle')
            onReveal()
          }} />
        )}
      </AnimatePresence>
    </div>
  )
}

function SoftBackdrop({ active, color }: { active: boolean; color: string }) {
  return (
    <div className="absolute left-1/2 top-[18px] h-[350px] w-[286px] -translate-x-1/2" aria-hidden="true">
      <motion.div className="absolute left-[23px] top-[16px] h-[276px] w-[240px] rounded-[48%_52%_46%_54%]"
        style={{ background: C.peach }}
        animate={{ rotate: active ? [0, 1.5, 0] : 0, scale: active ? 1 : 0.96, opacity: active ? 0.55 : 0.34 }}
        transition={{ duration: 5.5, repeat: Infinity, ease: 'easeInOut' }} />
      <motion.div className="absolute left-[48px] top-[42px] h-[225px] w-[190px] rounded-[52%_48%_54%_46%] border-2 border-dashed"
        style={{ borderColor: `${color}68` }}
        animate={{ rotate: active ? [0, -2.5, 0] : 0, opacity: active ? 0.64 : 0.25 }}
        transition={{ duration: 6.4, repeat: Infinity, ease: 'easeInOut' }} />
      {[0, 1, 2, 3, 4].map(i => (
        <motion.span key={i} className="absolute h-2 w-2 rounded-full"
          style={{ left: 30 + i * 53, top: i % 2 ? 31 : 8, background: i % 2 ? C.coral : color }}
          animate={{ y: active ? [0, -5, 0] : 0, opacity: active ? 0.58 : 0.2 }}
          transition={{ duration: 2.7 + i * 0.25, repeat: Infinity, delay: i * 0.12 }} />
      ))}
    </div>
  )
}

function SoftGachaMachine({ active, progress, palette, heroColor, assembling, agitatedRef, resultReady, revealStep, revealLabel, onReveal }: {
  active: boolean
  progress: number
  palette: string[]
  heroColor: string
  assembling: boolean
  agitatedRef: React.MutableRefObject<boolean>
  resultReady: boolean
  revealStep: RevealStep
  revealLabel: string
  onReveal: () => void
}) {
  const colors = [palette[0] ?? C.yellow, palette[1] ?? C.mint, palette[2] ?? C.blue]

  return (
    <motion.div className="relative h-[400px] w-[236px]"
      animate={assembling ? { rotate: [0, -0.8, 0.8, -0.45, 0], y: [0, -2, 0] } : { y: active ? [0, -2, 0] : 0 }}
      transition={assembling
        ? { duration: 1.1, repeat: Infinity, repeatDelay: 0.7, ease: 'easeInOut' }
        : { duration: 3.4, repeat: Infinity, ease: 'easeInOut' }}>

      <div className="absolute left-[18px] top-[9px] h-[388px] w-[205px] rounded-[25px] bg-[#8F5C51] opacity-24" />

      {/* 旧红机箱的塔式比例，内部继续使用当前 3D 与交互内核。 */}
      <div className="absolute left-[21px] top-0 h-[388px] w-[194px] overflow-hidden rounded-[22px] border-[4px]"
        style={{ borderColor: C.ink, background: C.coral, boxShadow: '7px 7px 0 rgba(92,64,51,0.16), inset 0 3px 0 rgba(255,255,255,0.20)' }}>
        <div className="absolute inset-x-0 bottom-0 h-[76px] border-t-[4px]"
          style={{ borderColor: C.ink, background: C.coralDark }} />

        <div className="absolute left-[10px] top-[10px] h-[190px] w-[168px] overflow-hidden rounded-[12px] border-[4px]"
          style={{
            borderColor: C.ink,
            background: 'linear-gradient(155deg, #627489 0%, #4B5C6F 52%, #394757 100%)',
            boxShadow: 'inset 0 0 16px rgba(15,24,35,0.28), inset 0 3px 0 rgba(255,255,255,0.14)',
          }}>
          <div className="absolute inset-0">
            <Canvas gl={{ antialias: true, alpha: true }} dpr={[1, 1.5]}>
              <ShowcaseBalls agitatedRef={agitatedRef} resultReady={resultReady} count={6} warmCabinet />
            </Canvas>
          </div>
          <div className="pointer-events-none absolute inset-x-0 top-0 h-[112px]"
            style={{ background: 'linear-gradient(180deg, rgba(255,248,226,0.14) 0%, rgba(255,240,205,0.04) 52%, transparent 100%)' }} />
          <div className="pointer-events-none absolute inset-x-[12px] bottom-[-2px] h-[48px]"
            style={{ background: 'radial-gradient(ellipse at 50% 100%, rgba(255,201,113,0.22) 0%, rgba(255,213,145,0.08) 46%, transparent 76%)' }} />
          <div className="pointer-events-none absolute left-[17px] top-[-18px] h-[202px] w-[18px] -rotate-[25deg] rounded-full bg-white/10" />
          <div className="pointer-events-none absolute left-[44px] top-[-24px] h-[195px] w-[8px] -rotate-[25deg] rounded-full bg-white/6" />
        </div>

        <div className="absolute inset-x-0 bottom-0 z-10 h-[174px]">
          <Knob ready={resultReady} revealStep={revealStep} label={revealLabel} onReveal={onReveal} />
          <StageLights progress={progress} colors={colors} />

          <div className="absolute bottom-[12px] left-1/2 h-[52px] w-[112px] -translate-x-1/2 overflow-hidden rounded-[11px_11px_16px_16px] border-[4px]"
            style={{ borderColor: C.ink, background: '#3B2C24', boxShadow: 'inset 0 5px 8px rgba(0,0,0,0.28)' }}>
            <div className="absolute inset-x-[12px] top-0 h-[11px] rounded-b-[7px] bg-[#DE5A56]" />
            <AnimatePresence>
              {revealStep === 'dropped' && (
                <motion.div className="absolute left-1/2 top-[8px] h-[27px] w-[27px] -translate-x-1/2 overflow-hidden rounded-full border-2"
                  style={{ borderColor: C.ink, background: C.paper }}
                  initial={{ y: -42, rotate: -30, scale: 0.7 }}
                  animate={{ y: [-42, 2, -5, 2], rotate: [-30, 12, -5, 0], scale: [0.7, 1.08, 0.96, 1] }}
                  transition={{ duration: 0.72, ease: 'easeOut' }}>
                  <div className="absolute inset-x-0 bottom-0 h-1/2" style={{ background: heroColor }} />
                  <div className="absolute inset-x-0 top-1/2 h-[2px] -translate-y-1/2 bg-[#5C4033]" />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* 主要结构节点：与一体外壳相扣，而不是重新拆成上下两个箱体。 */}
      <div className="absolute left-[13px] top-[194px] z-20 h-[20px] w-[210px] rounded-full border-[4px]"
        style={{ borderColor: C.ink, background: C.cream, boxShadow: '0 3px 0 rgba(92,64,51,0.12), inset 0 3px 0 white' }}>
        <span className="absolute left-[14px] top-[5px] h-[5px] w-[5px] rounded-full bg-[#8F7664]" />
        <span className="absolute right-[14px] top-[5px] h-[5px] w-[5px] rounded-full bg-[#8F7664]" />
      </div>
    </motion.div>
  )
}

function Knob({ ready, revealStep, label, onReveal }: { ready: boolean; revealStep: RevealStep; label: string; onReveal: () => void }) {
  const turning = revealStep === 'turning'
  const busy = revealStep !== 'idle'
  return (
    <motion.button type="button" disabled={!ready || busy} onClick={onReveal} aria-label={label}
      onHoverStart={() => { if (ready && !busy) sfx.tick() }}
      className="absolute left-[13px] top-[30px] flex h-[64px] w-[64px] items-center justify-center rounded-full border-[3px] outline-none"
      style={{
        borderColor: C.ink,
        background: C.cream,
        cursor: ready ? 'pointer' : 'default',
        boxShadow: ready ? '3px 4px 0 rgba(92,64,51,0.17), inset 0 4px 0 white' : 'inset 0 3px 0 white',
      }}
      animate={turning
        ? { scale: [1, 0.91, 1], y: [0, 3, 0], rotate: 0 }
        : ready && !busy
          ? { scale: [1, 1, 1.065, 0.975, 1], rotate: [0, 0, -2, 2, 0] }
          : { scale: 1, opacity: 1, rotate: 0 }}
      whileHover={ready ? { scale: 1.06, y: -1 } : undefined}
      whileTap={ready ? { scale: 0.95, y: 2 } : undefined}
      transition={turning
        ? { duration: 0.42, ease: 'easeOut' }
        : { duration: 2.6, times: [0, 0.58, 0.7, 0.82, 1], repeat: ready && !busy ? Infinity : 0, ease: 'easeInOut' }}>
      <AnimatePresence>
        {ready && !busy && (
          <span className="pointer-events-none absolute inset-0">
            {[0, 1].map(i => (
              <motion.span key={i} className="absolute inset-[-7px] rounded-full border-2"
                style={{ borderColor: '#FFFFFF', boxShadow: '0 0 0 1px rgba(92,64,51,0.07), 0 0 12px rgba(255,255,255,0.72)' }}
                initial={{ scale: 0.82, opacity: 0 }}
                animate={{ scale: [0.82, 1.38], opacity: [0, 0.56, 0] }}
                exit={{ opacity: 0 }}
                transition={{ duration: 1.15, repeat: Infinity, repeatDelay: 1.35, delay: i * 0.22, ease: 'easeOut' }} />
            ))}
          </span>
        )}
      </AnimatePresence>
      <motion.div className="relative z-10 h-[43px] w-[43px] overflow-hidden rounded-full border-[3px]"
        style={{ borderColor: C.ink, background: ready ? C.coral : '#D9CFC4', boxShadow: 'inset 0 3px 0 rgba(255,255,255,0.35)' }}
        animate={{ rotate: turning || busy ? 125 : ready ? [0, 0, -8, 4, 0] : -28 }}
        transition={turning
          ? { duration: 0.48, ease: [0.2, 0.75, 0.25, 1] }
          : { duration: 2.6, times: [0, 0.58, 0.7, 0.82, 1], repeat: ready && !busy ? Infinity : 0, ease: 'easeInOut' }}>
        <div className="absolute left-1/2 top-1/2 h-[12px] w-[34px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2"
          style={{ borderColor: C.ink, background: C.paper }} />
        {ready && !busy && (
          <motion.span className="absolute -top-2 h-[58px] w-[11px] -skew-x-12 bg-white/45"
            animate={{ x: [-30, 58] }} transition={{ duration: 0.55, repeat: Infinity, repeatDelay: 2.05, ease: 'easeOut' }} />
        )}
      </motion.div>
    </motion.button>
  )
}

function StageLights({ progress, colors }: { progress: number; colors: string[] }) {
  const lights = [
    { at: 0.16, Icon: Wand2 },
    { at: 0.38, Icon: ClipboardList },
    { at: 0.7, Icon: Palette },
  ]
  return (
    <div className="absolute right-[14px] top-[35px] flex gap-1.5">
      {lights.map(({ at, Icon }, i) => {
        const on = progress >= at
        return <motion.div key={at} className="flex h-[25px] w-[25px] items-center justify-center rounded-[8px] border-2"
          style={{ borderColor: C.ink, background: on ? colors[i] : '#E7DED4', color: on ? C.ink : '#9C8E82' }}
          animate={{ scale: on ? [0.8, 1.12, 1] : 1 }} transition={{ duration: 0.4 }}>
          <Icon className="h-3.5 w-3.5" strokeWidth={2.5} />
        </motion.div>
      })}
    </div>
  )
}

function ThinkingDots() {
  return (
    <motion.div className="absolute left-1/2 top-[-30px] z-30 flex -translate-x-1/2 gap-1.5 rounded-full border-2 bg-white px-3 py-2"
      style={{ borderColor: C.ink, boxShadow: '2px 3px 0 rgba(92,64,51,0.10)' }}
      initial={{ opacity: 0, y: 5, scale: 0.8 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4 }}>
      {[0, 1, 2].map(i => <motion.span key={i} className="h-2 w-2 rounded-full bg-[#DE5A56]"
        animate={{ y: [0, -5, 0] }} transition={{ duration: 0.85, repeat: Infinity, delay: i * 0.15 }} />)}
    </motion.div>
  )
}
