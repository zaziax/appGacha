import { motion } from 'motion/react'
import { GachaProgress } from '../shelf'

// 扭蛋机主视觉：stage 驱动的演出组件。
// 当前为 2D/motion 实现；未来换 react-three-fiber 时只替换本组件内部。
export function GachaMachine({ stage }: { stage: GachaProgress['stage'] | null }) {
  const anim =
    stage === 'coin' ? { rotate: [0, 0, 0], y: [0, -4, 0] } :
    stage === 'clack' ? { rotate: [0, -6, 6, -6, 0], y: 0 } :
    stage === 'pop' ? { rotate: 0, y: [0, 10, 0], scale: [1, 1.25, 1] } :
    stage === 'fail' ? { rotate: 0, y: 0, scale: 1 } :
    { rotate: [0, -18, 14, -10, 6, 0], y: [0, -2, 0, -1, 0, 0] } // crank

  return (
    <div className="gacha-anim">
      <motion.span
        className={stage === 'fail' ? 'gacha-ball fail' : 'gacha-ball'}
        animate={anim}
        transition={{ duration: 1.1, repeat: stage === 'pop' || stage === 'fail' ? 0 : Infinity, ease: 'easeInOut' }}
      >
        ◓
      </motion.span>
    </div>
  )
}
