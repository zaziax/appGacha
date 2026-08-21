/**
 * WebAudio 合成音效 —— 零音频文件。
 *
 * 设计原则：
 * - 短促、清脆、不抢戏（单音 < 0.3s，音量克制）
 * - AudioContext 延迟到首次播放时创建（浏览器自动播放策略要求用户手势）
 * - 纯合成正弦/三角波，无采样加载开销
 */
let ctx: AudioContext | null = null
let enabled = true

/** 音效总开关（设置面板持久化） */
export function setSoundEnabled(v: boolean): void { enabled = v }
export function isSoundEnabled(): boolean { return enabled }

function ac(): AudioContext | null {
  try {
    if (!ctx) ctx = new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    return null // 音频不可用时静默降级，不影响功能
  }
}

/** 单个音符：振荡器 + 增益包络（快攻慢放，避免爆音） */
function tone(freq: number, opts: {
  at?: number            // 相对当前的延迟（秒）
  dur?: number           // 时长
  gain?: number          // 峰值音量
  to?: number            // 结束频率（滑音）
  type?: OscillatorType
} = {}): void {
  if (!enabled) return
  const c = ac()
  if (!c) return
  const { at = 0, dur = 0.1, gain = 0.1, to, type = 'sine' } = opts
  const t0 = c.currentTime + at
  const osc = c.createOscillator()
  const g = c.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t0)
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur)
  g.gain.setValueAtTime(0, t0)
  g.gain.linearRampToValueAtTime(gain, t0 + 0.008)          // 8ms 快攻
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)     // 指数衰减
  osc.connect(g).connect(c.destination)
  osc.start(t0)
  osc.stop(t0 + dur + 0.02)
}

export const sfx = {
  /** 悬停：极轻高频嘀声（仅用于菜单按钮，避免扫过蛋架时过吵） */
  tick(): void {
    tone(1500, { dur: 0.035, gain: 0.025, type: 'triangle' })
  },
  /** 点击/选中：气泡"啵"（下滑滑音） */
  pop(): void {
    tone(520, { to: 180, dur: 0.11, gain: 0.12 })
  },
  /** 关闭/取消：短促下行 */
  blip(): void {
    tone(360, { to: 240, dur: 0.07, gain: 0.06 })
  },
  /** 环形菜单展开：上行琶音 do-mi-so */
  whoosh(): void {
    tone(523, { at: 0, dur: 0.06, gain: 0.045 })
    tone(659, { at: 0.045, dur: 0.06, gain: 0.045 })
    tone(784, { at: 0.09, dur: 0.09, gain: 0.055 })
  },
  /** 出蛋成功：ta-da 四音上行 */
  taDa(): void {
    tone(523, { at: 0, dur: 0.09, gain: 0.07 })
    tone(659, { at: 0.07, dur: 0.09, gain: 0.07 })
    tone(784, { at: 0.14, dur: 0.09, gain: 0.07 })
    tone(1047, { at: 0.21, dur: 0.24, gain: 0.09 })
  },
  /** 操作就绪：轻快双音，只在可操作状态出现时播放一次 */
  ready(): void {
    tone(659, { dur: 0.09, gain: 0.045, type: 'triangle' })
    tone(988, { at: 0.085, dur: 0.16, gain: 0.06, type: 'triangle' })
  },

  // ─── 扭蛋机物理音效 ───

  /** 投币：金属"叮"（双谐波叠加，模拟硬币清脆撞击） */
  coin(): void {
    tone(2200, { dur: 0.08, gain: 0.09, type: 'triangle' })
    tone(3300, { at: 0.012, dur: 0.12, gain: 0.05 })
    tone(1650, { at: 0.06, dur: 0.1, gain: 0.04, type: 'triangle' })
  },
  /** 旋钮棘轮："咔哒咔哒"机械连击 */
  crank(): void {
    for (let i = 0; i < 4; i++) {
      tone(170, { at: i * 0.085, dur: 0.028, gain: 0.09, type: 'square' })
      tone(950, { at: i * 0.085, dur: 0.018, gain: 0.03, type: 'square' })
    }
  },
  /** 落蛋：低频闷响 + 弹跳回音 */
  drop(): void {
    tone(280, { to: 70, dur: 0.14, gain: 0.14 })
    tone(200, { at: 0.16, to: 90, dur: 0.08, gain: 0.06 })
  },
  /** 开壳：脆裂爆音 + 分离轻响 */
  crack(): void {
    tone(900, { to: 300, dur: 0.06, gain: 0.12, type: 'square' })
    tone(1400, { at: 0.05, to: 800, dur: 0.09, gain: 0.06 })
  }
}
