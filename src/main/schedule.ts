import { Notification } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { CronExpressionParser } from 'cron-parser'
import { EggContext, getEgg } from './eggs'
import { openEgg } from './eggWindow'

export interface ScheduleEntry {
  id: string
  cron: string
  title: string
  body: string
}

// 最大 setTimeout 约 24.8 天，超过就分段睡
const MAX_TIMEOUT = 2_000_000_000

const timers = new Map<string, NodeJS.Timeout>() // key: eggId/entryId

function scheduleFile(ctx: EggContext): string {
  return path.join(ctx.dir, 'data', 'schedule.json')
}

function loadEntries(ctx: EggContext): ScheduleEntry[] {
  try {
    return JSON.parse(fs.readFileSync(scheduleFile(ctx), 'utf-8'))
  } catch {
    return []
  }
}

function saveEntries(ctx: EggContext, entries: ScheduleEntry[]): void {
  const file = scheduleFile(ctx)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(entries, null, 2), 'utf-8')
  fs.renameSync(tmp, file)
}

export function showNotification(eggId: string, title: string, body: string): void {
  if (!Notification.isSupported()) return
  const n = new Notification({ title: title.slice(0, 80), body: body.slice(0, 300) })
  n.on('click', () => {
    const egg = getEgg(eggId)
    if (egg) openEgg(egg)
  })
  n.show()
}

function nextDelay(cron: string): number {
  const next = CronExpressionParser.parse(cron).next().getTime()
  return Math.max(0, next - Date.now())
}

function arm(ctx: EggContext, entry: ScheduleEntry): void {
  const key = `${ctx.eggId}/${entry.id}`
  clearTimeout(timers.get(key))

  const tick = () => {
    const delay = nextDelay(entry.cron)
    if (delay > MAX_TIMEOUT) {
      timers.set(key, setTimeout(tick, MAX_TIMEOUT))
      return
    }
    timers.set(key, setTimeout(() => {
      // 触发前确认登记还在（可能已被 cancel 或蛋被删）
      if (loadEntries(ctx).some(e => e.id === entry.id)) {
        showNotification(ctx.eggId, entry.title, entry.body)
        tick()
      }
    }, delay))
  }
  tick()
}

export function set(ctx: EggContext, id: unknown, cron: unknown, n: unknown): void {
  if (typeof id !== 'string' || !id) throw new Error('schedule: id must be a non-empty string')
  if (typeof cron !== 'string') throw new Error('schedule: cron must be a string')
  const note = n as { title?: unknown; body?: unknown }
  if (typeof note?.title !== 'string' || typeof note?.body !== 'string') {
    throw new Error('schedule: notification must be { title: string, body: string }')
  }
  try {
    CronExpressionParser.parse(cron)
  } catch {
    throw new Error(`schedule: invalid cron expression "${cron}"`)
  }

  const entries = loadEntries(ctx).filter(e => e.id !== id)
  const entry: ScheduleEntry = { id, cron, title: note.title, body: note.body }
  entries.push(entry)
  if (entries.length > 20) throw new Error('schedule: max 20 entries per egg')
  saveEntries(ctx, entries)
  arm(ctx, entry)
}

export function cancel(ctx: EggContext, id: unknown): void {
  if (typeof id !== 'string') throw new Error('schedule: id must be a string')
  saveEntries(ctx, loadEntries(ctx).filter(e => e.id !== id))
  const key = `${ctx.eggId}/${id}`
  clearTimeout(timers.get(key))
  timers.delete(key)
}

export function list(ctx: EggContext): ScheduleEntry[] {
  return loadEntries(ctx)
}

export function cancelAllForEgg(eggId: string): void {
  for (const [key, timer] of timers) {
    if (key.startsWith(eggId + '/')) {
      clearTimeout(timer)
      timers.delete(key)
    }
  }
}

// 开机装弹：扫描所有蛋的 schedule.json
export function initSchedules(eggs: EggContext[]): void {
  for (const egg of eggs) {
    for (const entry of loadEntries(egg)) {
      try {
        arm(egg, entry)
      } catch (e) {
        console.error(`[schedule] ${egg.manifest.name}/${entry.id}: ${(e as Error).message}`)
      }
    }
  }
}
