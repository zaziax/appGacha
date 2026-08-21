import { useRef, useEffect, useState, useCallback } from 'react'
import { Canvas } from '@react-three/fiber'
import { motion, AnimatePresence } from 'motion/react'
import type { GachaProgress } from '../shelf'
import { sfx } from '../sound'
import { ShowcaseBalls, RevealCeremony } from './GachaShowcase3D'

/* ================================================================
   V5 扭蛋机 —— 第五版（A/B/C/D/E 对比用，勿覆盖 GachaMachine3D）。

   诊断旧版"丑"的根因：新粗野主义的粗描边壳子里塞满拟物渐变
   （机身 4 段红渐变、橱窗蓝渐变、镀金饰条、径向渐变球钮），
   两套视觉语言打架。V5 统一到 GACHAGO 平色硬阴影语言：

   - 平色 + 硬阴影：机身 = brand 红平色，零渐变零模糊
   - 色彩纪律：红（主）/ 深墨蓝橱窗（衬 3D 球发光）/ 黄只点缀
     投币口一处 / 其余全墨棕中性色
   - 真旋钮：奶油圆盘 + 墨握把 + 红毂 + 方向点，"拧"可读
   - 货满：橱窗球 9 → 15，堆叠感
   - 描边统一 4px，阴影统一实色 offset
   Props 接口与 GachaMachine3D 完全一致，可在 MachineView 直接替换。
   ================================================================ */

interface Props {
  stage: GachaProgress['stage'] | null
  running: boolean
  /** AI 完成生成——旋钮邀请转动，用户亲手开蛋 */
  resultReady: boolean
  /** 开蛋仪式（棘轮→落蛋→开壳）完成后回调 */
  onReveal: () => void
  /** 向导步骤微反应：idle=静止 / thinking=旋钮慢转 / excited=轻微弹跳 */
  mood?: 'idle' | 'thinking' | 'excited'
  /** 蛋图标 SVG 原文——裂壳时爆出 */
  icon?: string
}

// GACHAGO 平色令牌（与 app.css @theme 对齐）
const INK = '#5C4033'       // 描边 / 深色件（= text token）
const RED = '#D9534F'       // 机身主色（= brand token）
const RED_DK = '#B8403C'    // 底座平色（机身同色相暗部，非渐变）
const PAPER = '#FFFDF8'     // 旋钮盘 / 蛋壳上半
const CREAM = '#F4EBE1'     // 饰条（= cream token）
const NAVY = '#26313F'      // 橱窗内腔主色
const NAVY_WALL = '#2E3A4B' // 橱窗后壁
const NAVY_TRAY = '#1B222D' // 橱窗托盘
const YELL = '#FFC21A'      // 唯一点缀色：投币口 / 蛋壳下半 / 星光

/** 实色硬阴影（新粗野主义签名，零模糊） */
const HARD_SHADOW = '7px 7px 0 rgba(92,64,51,0.16)'
const HARD_SHADOW_SM = '3px 3px 0 rgba(92,64,51,0.18)'

export function GachaMachineV5({ stage, running, resultReady, onReveal, mood = 'idle', icon }: Props) {
  const agitatedRef = useRef(false)
  const knobRef = useRef<HTMLDivElement>(null)
  const knobAngle = useRef(0)
  const crankInterval = useRef<number>(0)
  const [coinIn, setCoinIn] = useState(false)
  const [dropping, setDropping] = useState(false)
  const [cracking, setCracking] = useState(false)
  const [revealing, setRevealing] = useState(false)
  const [ceremony, setCeremony] = useState(false)
  const timers = useRef<number[]>([])

  const later = (fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms))
  }

  // ---- 管线阶段 → 机器反应（与 GachaMachine3D 一致） ----
  useEffect(() => {
    if (stage === 'coin') {
      sfx.coin()
      setCoinIn(true)
      later(() => setCoinIn(false), 600)
    }
    if (stage === 'crank') {
      agitatedRef.current = true
      sfx.crank()
      spinKnob(360 + Math.random() * 180)
      clearInterval(crankInterval.current)
      crankInterval.current = window.setInterval(() => spinKnob(120), 2200)
    }
    if (stage === 'clack') {
      agitatedRef.current = false
      clearInterval(crankInterval.current)
      sfx.drop()
      setDropping(true)
    }
    if (stage === 'pop' || stage === 'fail') {
      agitatedRef.current = false
      clearInterval(crankInterval.current)
      setDropping(false)
    }
  }, [stage])

  // ---- 清理 ----
  useEffect(() => () => {
    timers.current.forEach(clearTimeout)
    clearInterval(crankInterval.current)
  }, [])

  const spinKnob = (deg: number) => {
    knobAngle.current += deg
    if (knobRef.current) {
      knobRef.current.style.transform = `rotate(${knobAngle.current}deg)`
    }
  }

  // ---- 开蛋仪式：棘轮 → 全屏开奖 ----
  const handleKnob = useCallback(() => {
    if (running || revealing) return

    if (resultReady) {
      setRevealing(true)
      agitatedRef.current = true
      sfx.crank()
      spinKnob(360 + Math.random() * 180)
      later(() => {
        agitatedRef.current = false
        setCeremony(true)
      }, 950)
    } else {
      sfx.tick()
      spinKnob(90)
      agitatedRef.current = true
      later(() => { agitatedRef.current = false }, 400)
    }
  }, [running, revealing, resultReady])

  return (
    <div className="flex flex-col items-center select-none gap-2.5">
      <div className="gacha-machine-model shrink-0">
        <motion.div
        animate={
          mood === 'thinking' ? { rotate: [0, 1.2, -1.2, 0.8, -0.8, 0] }
          : mood === 'excited' ? { y: [0, -4, 0, -2, 0] }
          : { rotate: 0, y: 0 }
        }
        transition={
          mood === 'thinking' ? { duration: 2.4, repeat: Infinity, ease: 'easeInOut' }
          : mood === 'excited' ? { duration: 1.6, repeat: Infinity, ease: 'easeInOut' }
          : { duration: 0.3 }
        }
      >
        <div className="relative" style={{ width: 300, height: 448 }}>

          {/* ======== 地面阴影（实色，零模糊） ======== */}
          <div className="absolute left-1/2 -translate-x-1/2 top-[428px] w-[200px] h-[14px] rounded-[50%]"
            style={{ background: 'rgba(92,64,51,0.22)' }} />

          {/* ======== 粗短脚 ======== */}
          <div className="absolute top-[400px] left-[72px] w-[36px] h-[26px] rounded-b-[8px] border-4 border-t-0 border-text"
            style={{ background: RED_DK }} />
          <div className="absolute top-[400px] right-[72px] w-[36px] h-[26px] rounded-b-[8px] border-4 border-t-0 border-text"
            style={{ background: RED_DK }} />

          {/* ======== 塔式机身（平红 + 硬阴影） ======== */}
          <div className="absolute inset-x-[46px] top-[16px] h-[388px] rounded-[16px] border-4 border-text z-10 overflow-hidden"
            style={{ background: RED, boxShadow: HARD_SHADOW }}>
            {/* 底座板（平色暗部 + 硬分界，非渐变） */}
            <div className="absolute bottom-0 inset-x-0 h-[100px] border-t-4 border-text"
              style={{ background: RED_DK }} />
          </div>

          {/* ======== 方形橱窗（深墨蓝内腔 + 15 颗 3D 扭蛋） ======== */}
          <div className="absolute left-[62px] right-[62px] top-[32px] h-[164px] rounded-[10px] border-4 border-text overflow-hidden z-20"
            style={{ background: NAVY, boxShadow: HARD_SHADOW_SM }}>
            {/* 内腔结构：后壁 + 托盘（平色二分） */}
            <div className="absolute inset-x-0 top-0 h-[76%]" style={{ background: NAVY_WALL }} />
            <div className="absolute inset-x-0 bottom-0 h-[24%] border-t-[3px]" style={{ background: NAVY_TRAY, borderTopColor: 'rgba(255,255,255,0.07)' }} />
            <Canvas
              style={{ position: 'absolute', inset: 0 }}
              gl={{ antialias: true, alpha: true }}
              dpr={[1, 2]}
            >
              <ShowcaseBalls agitatedRef={agitatedRef} resultReady={resultReady} count={15} />
            </Canvas>
            {/* 玻璃反光：硬边斜杠（新粗野主义的"玻璃"记号） */}
            <div className="absolute top-[-24px] left-[18px] w-[26px] h-[220px] rotate-[-24deg] pointer-events-none z-10"
              style={{ background: 'rgba(255,255,255,0.10)' }} />
            <div className="absolute top-[-24px] left-[54px] w-[10px] h-[220px] rotate-[-24deg] pointer-events-none z-10"
              style={{ background: 'rgba(255,255,255,0.06)' }} />
          </div>

          {/* ======== 饰条（奶油平色 + 墨铆钉） ======== */}
          <div className="absolute top-[204px] inset-x-[40px] h-[16px] rounded-[8px] border-4 border-text z-30 flex items-center justify-between px-[12px]"
            style={{ background: CREAM, boxShadow: HARD_SHADOW_SM }}>
            <div className="w-[6px] h-[6px] rounded-full" style={{ background: INK }} />
            <div className="w-[6px] h-[6px] rounded-full" style={{ background: INK }} />
          </div>

          {/* ======== 投币面板（唯一黄点缀） ======== */}
          <div className="absolute right-[68px] top-[230px] w-[30px] h-[48px] rounded-[8px] border-4 border-text z-20 flex items-center justify-center"
            style={{ background: YELL, boxShadow: HARD_SHADOW_SM }}>
            <div className="w-[5px] h-[22px] rounded-full" style={{ background: INK }} />
            <AnimatePresence>
              {coinIn && (
                <motion.div
                  className="absolute -top-1 left-1/2 w-[20px] h-[20px] rounded-full border-[3px] border-text z-10"
                  style={{ background: YELL }}
                  initial={{ x: '-50%', y: -32, opacity: 1, scaleY: 1 }}
                  animate={{ x: '-50%', y: [-32, 5, 9], scaleY: [1, 1, 0.15], opacity: [1, 1, 0] }}
                  transition={{ duration: 0.55, times: [0, 0.7, 1], ease: 'easeIn' }}
                  exit={{ opacity: 0 }}
                />
              )}
            </AnimatePresence>
          </div>

          {/* ======== 真旋钮 —— 任天堂式引导：扩散波纹 + 白细环 + 镜面高光 + 精致抖动 ======== */}
          <div className="absolute left-[78px] top-[226px] z-20">
            {/* 扩散波纹：从旋钮中心向外扩散的同心圆环，像水面涟漪把视线「吸」向圆心 */}
            {resultReady && !revealing && (
              <div className="absolute pointer-events-none z-[15]" style={{ left: 34, top: 34 }}>
                {[0, 1, 2].map(i => (
                  <motion.div
                    key={i}
                    className="absolute rounded-full border-[1.5px] border-white/50"
                    style={{ width: 68, height: 68, marginLeft: -34, marginTop: -34 }}
                    animate={{ scale: [1, 3.8], opacity: [0.5, 0] }}
                    transition={{ duration: 2.4, repeat: Infinity, delay: i * 0.75, ease: 'easeOut' }}
                  />
                ))}
              </div>
            )}

            <motion.div
              animate={resultReady && !revealing ? {
                rotate: [0, -7, 6, -4, 3, -1, 0],
                scale: [1, 1, 1.03, 1, 1.02, 1, 1],
              } : { rotate: 0, scale: 1 }}
              transition={{ duration: 1.8, repeat: resultReady ? Infinity : 0, repeatDelay: 1.8, ease: 'easeInOut' }}
            >
              {/* 聚焦环：白色细环呼吸透明度（荒野之息 Sheikah 锁定风格） */}
              {resultReady && !revealing && (
                <motion.div
                  className="absolute -inset-[5px] rounded-full pointer-events-none border-[2px] border-white/70"
                  animate={{ opacity: [0.2, 0.65, 0.2] }}
                  transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
                />
              )}

              {/* 12 点刻度（固定，给握把一个"目标"） */}
              <div className="absolute -top-[7px] left-1/2 -translate-x-1/2 w-[6px] h-[10px] rounded-full z-10"
                style={{ background: INK }} />

              <div
                className="relative w-[68px] h-[68px] rounded-full border-4 border-text cursor-pointer flex items-center justify-center"
                style={{ background: PAPER, boxShadow: '3px 4px 0 rgba(92,64,51,0.20)' }}
                onClick={handleKnob}
              >
                {/* 旋转体：一字握把 + 红毂 + 末端方向点 */}
                <div ref={knobRef} className="absolute inset-0 flex items-center justify-center"
                  style={{ transition: 'transform 0.9s cubic-bezier(0.22, 1.2, 0.36, 1)' }}>
                  <div className="absolute w-[46px] h-[13px] rounded-full" style={{ background: INK }} />
                  <div className="absolute right-[8px] top-1/2 -translate-y-1/2 w-[5px] h-[5px] rounded-full" style={{ background: PAPER }} />
                  <div className="w-[22px] h-[22px] rounded-full border-[3.5px] border-text z-[2]"
                    style={{ background: RED }} />
                </div>

                {/* 镜面高光扫过：白色光条从左到右滑过旋钮表面（塞尔达宝箱式"可交互"暗示） */}
                {resultReady && !revealing && (
                  <div className="absolute inset-0 rounded-full overflow-hidden pointer-events-none z-10">
                    <motion.div
                      className="absolute w-8 h-2.5 bg-white/55 rounded-full blur-[1.5px]"
                      animate={{
                        left: ['-22%', '108%'],
                        top: ['22%', '22%'],
                        opacity: [0, 0.5, 0],
                      }}
                      transition={{
                        duration: 2.6,
                        repeat: Infinity,
                        repeatDelay: 0.9,
                        ease: 'easeInOut',
                        times: [0, 0.5, 1],
                      }}
                    />
                  </div>
                )}
              </div>
            </motion.div>

            {/* 旋钮旁白色小星光（动森式"注意这里"粒子） */}
            {resultReady && !revealing && (
              <>
                <Sparkle color="white" x={-6} y={-2} size={7} delay={0.3} />
                <Sparkle color="white" x={66} y={8} size={5} delay={1.1} />
                <Sparkle color="white" x={10} y={64} size={6} delay={0.8} />
              </>
            )}
          </div>

          {/* ======== 品牌小牌（填补控制区与取蛋口之间的红留白） ======== */}
          <div className="absolute left-1/2 -translate-x-1/2 top-[300px] w-[64px] h-[22px] rounded-[6px] border-[3px] border-text z-20 flex items-center justify-center"
            style={{ background: CREAM, boxShadow: '2px 2px 0 rgba(92,64,51,0.18)' }}>
            <span className="text-[9px] font-extrabold tracking-[0.14em]" style={{ color: INK }}>GACHA</span>
          </div>

          {/* ======== 取蛋口（墨洞 + 红色翻盖，结构可读） ======== */}
          <div className="absolute left-1/2 -translate-x-1/2 top-[332px] w-[116px] h-[58px] rounded-[12px_12px_24px_24px] border-4 border-text z-20 overflow-hidden"
            style={{ background: '#3A2C22', perspective: '220px' }}>
            <motion.div className="absolute top-[2px] left-[7px] w-[46px] h-[15px] rounded-b-[8px] origin-top border-b-[3px] border-text"
              style={{ background: RED }}
              animate={dropping && !cracking ? { rotateX: 65 } : { rotateX: 0 }}
              transition={{ duration: 0.25 }} />
            <motion.div className="absolute top-[2px] right-[7px] w-[46px] h-[15px] rounded-b-[8px] origin-top border-b-[3px] border-text"
              style={{ background: RED }}
              animate={dropping && !cracking ? { rotateX: 65 } : { rotateX: 0 }}
              transition={{ duration: 0.25 }} />
            <AnimatePresence>
              {dropping && (
                <motion.div className="absolute left-1/2 bottom-[4px] z-20" style={{ x: '-50%' }}
                  initial={{ y: -78, scale: 0.55, opacity: 1 }}
                  animate={cracking
                    ? { y: 0, scale: 1, opacity: 1 }
                    : { y: [-78, 0, -15, 0, -5, 0], scale: [0.55, 1.1, 0.95, 1.04, 0.99, 1], opacity: 1 }
                  }
                  transition={cracking
                    ? { duration: 0.1 }
                    : { duration: 0.72, times: [0, 0.38, 0.56, 0.72, 0.86, 1], ease: 'easeOut' }
                  }
                  exit={{ opacity: 0, scale: 0.6, transition: { duration: 0.25 } }}
                >
                  <FlatCapsule cracking={cracking} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* ======== 结果就绪：橱窗周围星光（平黄四角星） ======== */}
          {resultReady && !revealing && (
            <>
              <Sparkle x={40} y={40} size={15} delay={0} />
              <Sparkle x={246} y={34} size={12} delay={0.6} />
              <Sparkle x={30} y={150} size={10} delay={1.1} />
              <Sparkle x={256} y={146} size={13} delay={1.5} />
            </>
          )}
        </div>
        </motion.div>
      </div>


      {/* ======== 全屏开奖仪式（复用 V4） ======== */}
      <AnimatePresence>
        {ceremony && (
          <RevealCeremony icon={icon} onDone={() => {
            setCeremony(false)
            setDropping(false)
            setCracking(false)
            setRevealing(false)
            onReveal()
          }} />
        )}
      </AnimatePresence>
    </div>
  )
}

/* ================================================================
   小部件：平色星光 / 平色扭蛋壳
   ================================================================ */

function Sparkle({ x, y, size, delay, color = YELL }: { x: number; y: number; size: number; delay: number; color?: string }) {
  return (
    <motion.div className="absolute pointer-events-none z-40" style={{ left: x, top: y, width: size, height: size }}
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: [0, 1.2, 0], opacity: [0, 1, 0], rotate: [0, 90] }}
      transition={{ duration: 1.3, delay, repeat: Infinity, repeatDelay: 0.7, ease: 'easeInOut' }}>
      <div className="w-full h-full" style={{
        clipPath: 'polygon(50% 0%, 62% 38%, 100% 50%, 62% 62%, 50% 100%, 38% 62%, 0% 50%, 38% 38%)',
        background: color
      }} />
    </motion.div>
  )
}

/** 平色扭蛋壳 —— 白纸上半 + 琥珀下半 + 墨接缝（零渐变） */
function FlatCapsule({ cracking }: { cracking: boolean }) {
  return (
    <div className="relative w-[54px] h-[54px]">
      <motion.div
        className="absolute inset-x-0 top-0 h-[28px] rounded-t-full border-[3.5px] border-b-0 border-text overflow-hidden"
        style={{ background: PAPER }}
        animate={cracking ? { y: -24, rotate: -16, opacity: 0 } : { y: 0, rotate: 0, opacity: 1 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
      />
      <motion.div
        className="absolute inset-x-0 bottom-0 h-[28px] rounded-b-full border-[3.5px] border-t-0 border-text"
        style={{ background: YELL }}
        animate={cracking ? { y: 15, opacity: 0 } : { y: 0, opacity: 1 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
      />
      {!cracking && (
        <div className="absolute top-1/2 -translate-y-1/2 inset-x-[1px] h-[5px] rounded-full" style={{ background: INK }} />
      )}
    </div>
  )
}
