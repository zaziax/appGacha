import { shelf, GachaProgress, GachaResult } from './shelf'

// 扭蛋状态独立于任何组件存在（支持关掉弹窗后台挂起）。
// preload 的 on* 只能增不能减监听，所以订阅放模块级、只做一次。
export interface GachaState {
  running: boolean
  stage: GachaProgress['stage'] | null
  detail: string
  result: GachaResult | null
  /** 非空表示当前/上次许愿是对这颗蛋的升级 */
  upgrade: { eggId: string; name: string } | null
}

let state: GachaState = { running: false, stage: null, detail: '', result: null, upgrade: null }
const listeners = new Set<() => void>()

function setState(patch: Partial<GachaState>): void {
  state = { ...state, ...patch }
  for (const l of listeners) l()
}

export function subscribeGacha(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function getGachaState(): GachaState {
  return state
}

export function beginGacha(upgrade: GachaState['upgrade']): void {
  setState({ running: true, stage: 'coin', detail: '', result: null, upgrade })
}

export function clearGachaResult(): void {
  setState({ result: null, upgrade: null })
}

// 失败重试：清结果但保留升级对象（还是对同一颗蛋许愿）
export function dismissResult(): void {
  setState({ result: null })
}

export function setGachaUpgrade(upgrade: GachaState['upgrade']): void {
  setState({ upgrade })
}

type DoneCallback = (r: GachaResult) => void
const doneCallbacks = new Set<DoneCallback>()

export function onGachaDone(cb: DoneCallback): () => void {
  doneCallbacks.add(cb)
  return () => doneCallbacks.delete(cb)
}

shelf.onGachaProgress(p => {
  setState({ running: true, stage: p.stage, detail: p.detail ?? '' })
})

shelf.onGachaDone(r => {
  setState({ running: false, result: r })
  for (const cb of doneCallbacks) cb(r)
})
