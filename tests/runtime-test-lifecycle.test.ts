import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const state = vi.hoisted(() => ({ behavior: 'healthy', windows: [] as any[], destroyed: 0, deferred: false, active: false, sessionsCleaned: 0 }))
vi.mock('../src/main/schedule', () => ({ cancelAllForEgg: vi.fn() }))
vi.mock('../src/main/registry', () => ({ isEggActive: () => state.active }))
vi.mock('../src/main/eggWindow', async () => {
  const { EventEmitter } = await import('node:events')
  class FakeDebugger extends EventEmitter {
    attached = false
    isAttached() { return this.attached }
    attach() { this.attached = true }
    detach() { this.attached = false; this.emit('detach', {}, 'target_closed') }
    async sendCommand() {}
  }
  class FakeWindow extends EventEmitter {
    destroyed = false
    webContents = Object.assign(new EventEmitter(), {
      id: 42,
      debugger: new FakeDebugger(),
      isDestroyed: () => this.destroyed,
      executeJavaScript: vi.fn(async () => ({ textLen: 50, nodeCount: 10 }))
    })
    async loadURL(url: string) {
      expect(this.webContents.listenerCount('preload-error')).toBe(1)
      if (url.includes('__runtime_bootstrap_')) return
      expect(this.webContents.debugger.isAttached()).toBe(true)
      if (state.behavior === 'module404') this.webContents.debugger.emit('message', {}, 'Network.responseReceived', { response: { url: url.replace('index.html', 'store.js'), status: 404, statusText: 'Not Found' } })
      if (state.behavior === 'throw') this.webContents.debugger.emit('message', {}, 'Runtime.exceptionThrown', { exceptionDetails: { exception: { description: 'Error: startup failed' } } })
      if (state.behavior === 'preload') this.webContents.emit('preload-error', {}, '/fixture/preload.js', new Error('bridge failed'))
      if (state.behavior === 'hang') await new Promise(() => {})
    }
    isDestroyed() { return this.destroyed }
    destroy() { if (!this.destroyed) { this.destroyed = true; state.destroyed++; this.emit('closed') } }
  }
  return { disposeTestEggSession: async () => { expect(state.destroyed).toBe(1); state.sessionsCleaned++ }, createEggWindow: (_ctx: unknown, options: any) => {
    state.deferred = options.deferLoad === true && options.testMode === true
    const win = new FakeWindow()
    state.windows.push(win)
    return win
  } }
})

import { testEgg } from '../src/main/test'
import { allEggs } from '../src/main/eggs'

let dir: string
beforeEach(() => {
  vi.useFakeTimers()
  state.behavior = 'healthy'; state.windows = []; state.destroyed = 0; state.deferred = false; state.active = false; state.sessionsCleaned = 0
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'appgacha-runtime-lifecycle-'))
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ eggId: 'runtime-lifecycle-fixture', name: 'Fixture', version: '1.0.0', hostApiVersion: '1', permissions: [] }))
  fs.writeFileSync(path.join(dir, 'index.html'), '<button>Looks healthy</button>')
})
afterEach(() => { vi.useRealTimers(); fs.rmSync(dir, { recursive: true, force: true }) })

describe('testEgg lifecycle and compatibility', () => {
  it.each(['module404', 'throw', 'preload'])('fails %s even with static content and releases observers/windows', async behavior => {
    state.behavior = behavior
    const pending = testEgg(dir)
    await vi.advanceTimersByTimeAsync(1900)
    const result = await pending
    expect(state.deferred).toBe(true)
    expect(result.blank).toBe(false)
    expect(result.ok).toBe(false)
    expect(result.diagnostics.length).toBeGreaterThan(0)
    expect(result.consoleErrors.length).toBeGreaterThan(0)
    expect(state.destroyed).toBe(1)
    expect(state.sessionsCleaned).toBe(1)
    expect(state.windows[0].webContents.debugger.listenerCount('message')).toBe(0)
    expect(allEggs()).toHaveLength(0)
  })

  it('passes healthy startup but does not claim functionality was tested', async () => {
    const pending = testEgg(dir)
    await vi.advanceTimersByTimeAsync(1900)
    const result = await pending
    expect(result.ok).toBe(true)
    expect(result.coverage).toMatchObject({ startup: 'passed', resources: 'passed', scenarios: 'not-run' })
    expect(result.scenarios).toEqual([])
    expect(state.destroyed).toBe(1)
    expect(state.sessionsCleaned).toBe(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels during navigation and cleans registration, debugger, window and timers', async () => {
    state.behavior = 'hang'
    const controller = new AbortController()
    const pending = testEgg(dir, { signal: controller.signal })
    await vi.advanceTimersByTimeAsync(1)
    controller.abort()
    const result = await pending
    expect(result.ok).toBe(false)
    expect(result.aborted).toBe(true)
    expect(state.destroyed).toBe(1)
    expect(state.sessionsCleaned).toBe(1)
    expect(allEggs()).toHaveLength(0)
    expect(state.windows[0].webContents.debugger.listenerCount('message')).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not create a window for a pre-cancelled request', async () => {
    const controller = new AbortController(); controller.abort()
    expect((await testEgg(dir, { signal: controller.signal })).aborted).toBe(true)
    expect(state.windows).toHaveLength(0)
    expect(allEggs()).toHaveLength(0)
  })
})
