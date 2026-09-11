import { app, net } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { getAiSettings } from './settings'

export const TELEMETRY_EFFECTIVE = '2026-09-26'
export type Metric = 'collection_started' | 'session_started' | 'second_session' | 'ai_configured' |
  'build_started' | 'build_succeeded' | 'build_failed' | 'first_build_succeeded' |
  'egg_opened' | 'first_generated_egg_opened' | 'generated_egg_reopened' | 'pricing_opened' | 'checkout_started'
export interface MetricFields {
  mode?: 'managed' | 'byok' | 'unconfigured'
  operation?: 'create' | 'upgrade' | 'resume'
  duration?: 'under_1m' | '1_5m' | '5_15m' | 'over_15m'
  error?: 'cancelled' | 'interrupted' | 'validation' | 'migration' | 'other'
}
interface Event extends MetricFields {
  event_id: string; event: Metric; platform: 'windows' | 'macos' | 'linux'; version: string; cohort: string
}
interface LocalState {
  enabled: boolean; sessions: number; cohort?: string; milestones: string[]
  eggs: Record<string, number>; pending: { at: number; data: Event }[]
}
const empty = (enabled = true): LocalState => ({ enabled, sessions: 0, milestones: [], eggs: {}, pending: [] })
let state: LocalState | undefined
let started = false
let active = false
let sending = false
let generation = 0
let requests = new Set<AbortController>()
let startPromise: Promise<void> | undefined
let retryTimer: ReturnType<typeof setInterval> | undefined

function file(): string { return path.join(app.getPath('userData'), 'usage-statistics.json') }
function read(): LocalState {
  if (state) return state
  try {
    const raw = JSON.parse(fs.readFileSync(file(), 'utf8')) as Partial<LocalState> & { consent?: string }
    if (!Array.isArray(raw.pending) || !Array.isArray(raw.milestones)) throw new Error('Invalid state')
    // Compatibility with the unreleased opt-in draft: only an explicit denial
    // remains disabled. Missing/unknown settings adopt the new default-on policy.
    const enabled = typeof raw.enabled === 'boolean' ? raw.enabled : raw.consent !== 'denied'
    const normalized: Partial<LocalState> & { consent?: string } = { ...raw }
    delete normalized.consent
    state = { ...empty(enabled), ...normalized, enabled }
  } catch { state = empty() }
  return state
}
function save(): void {
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true })
    fs.writeFileSync(`${file()}.tmp`, JSON.stringify(read()))
    fs.renameSync(`${file()}.tmp`, file())
  } catch { /* Metrics must never break a workflow. */ }
}
function eligible(): boolean {
  return app.isPackaged && read().enabled && new Date().toISOString().slice(0, 10) >= TELEMETRY_EFFECTIVE
}
function baseUrl(): string { return 'https://api.appgacha.com' }
async function request(route: string, body?: unknown): Promise<Response> {
  const controller = new AbortController()
  requests.add(controller)
  const timer = setTimeout(() => controller.abort(), 5000)
  try {
    return await net.fetch(`${baseUrl()}${route}`, {
      method: body ? 'POST' : 'GET', credentials: 'omit', signal: controller.signal,
      headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined,
    })
  } finally { clearTimeout(timer); requests.delete(controller) }
}

export function getTelemetryEnabled(): boolean { return read().enabled }
export function setTelemetryEnabled(enabled: boolean): void {
  if (read().enabled === enabled) return
  generation++
  for (const controller of requests) controller.abort()
  requests.clear()
  if (retryTimer) clearInterval(retryTimer)
  retryTimer = undefined
  active = false
  started = false
  startPromise = undefined
  state = empty(enabled)
  save()
  if (enabled) void initTelemetry()
}

export function aiMode(): NonNullable<MetricFields['mode']> {
  const settings = getAiSettings()
  return !settings ? 'unconfigured' : settings.providerId === 'appgacha' ? 'managed' : 'byok'
}

export function initTelemetry(): Promise<void> {
  if (!eligible()) return Promise.resolve()
  if (active) return Promise.resolve()
  if (startPromise) return startPromise
  const token = generation
  startPromise = (async () => {
    try {
      const response = await request('/analytics/config')
      const config = response.ok ? await response.json() as { desktop_enabled?: boolean } : null
      if (token !== generation || !eligible() || !config?.desktop_enabled) return
      active = true
      if (!started) {
        started = true
        const data = read()
        data.sessions++
        data.cohort ??= new Date().toISOString().slice(0, 10)
        emit('collection_started', {}, true)
        emit('session_started')
        if (data.sessions >= 2) emit('second_session', {}, true)
        if (aiMode() !== 'unconfigured') emit('ai_configured', { mode: aiMode() }, true)
      }
      if (!retryTimer) retryTimer = setInterval(() => { void flush() }, 60000)
      await flush()
    } catch { /* No analytics network error is user-facing. */ }
  })().finally(() => { if (token === generation) startPromise = undefined })
  return startPromise
}

function emit(event: Metric, fields: MetricFields = {}, once = false): void {
  if (!active || !eligible()) return
  const data = read()
  if (once && data.milestones.includes(event)) return
  if (once) data.milestones.push(event)
  data.pending = data.pending.filter(item => Date.now() - item.at < 86400000).slice(-199)
  data.pending.push({ at: Date.now(), data: {
    event_id: randomUUID(), event, platform: process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux',
    version: app.getVersion(), cohort: data.cohort!, ...fields,
  } })
  save()
}

export function track(event: Metric, fields: MetricFields = {}, once = false): void {
  if (!eligible()) return
  void initTelemetry().then(() => { emit(event, fields, once); void flush() })
}

export function trackBuildSuccess(eggId?: string): void {
  if (!eligible()) return
  void initTelemetry().then(() => {
    if (!active) return
    if (eggId) {
      // IDs never leave the device; bounded list only checks locally built eggs.
      read().eggs[eggId] ??= 0
      const entries = Object.entries(read().eggs).slice(-1000)
      read().eggs = Object.fromEntries(entries)
    }
    emit('first_build_succeeded', { mode: aiMode() }, true)
    save()
    void flush()
  })
}

export function trackEggOpen(eggId: string): void {
  if (!eligible()) return
  void initTelemetry().then(() => {
    if (!active) return
    emit('egg_opened')
    const firstSession = read().eggs[eggId]
    if (firstSession !== undefined) {
      if (firstSession === 0) {
        read().eggs[eggId] = read().sessions
        emit('first_generated_egg_opened', {}, true)
      } else if (firstSession < read().sessions) emit('generated_egg_reopened', {}, true)
    }
    save()
    void flush()
  })
}

async function flush(): Promise<void> {
  if (sending || !active || !eligible()) return
  sending = true
  const token = generation
  try {
    const data = read()
    data.pending = data.pending.filter(item => Date.now() - item.at < 86400000)
    while (data.pending.length && token === generation && eligible()) {
      const item = data.pending[0]
      const response = await request('/analytics/events', { ...item.data, collection_enabled: true })
      if (token !== generation || !eligible()) break
      if (!response.ok) break
      data.pending.shift()
      save()
    }
  } catch { /* Retry bounded, content-free events during this session. */ }
  finally { sending = false }
}

export function stopTelemetry(): void {
  generation++
  active = false
  if (retryTimer) clearInterval(retryTimer)
  for (const controller of requests) controller.abort()
}
