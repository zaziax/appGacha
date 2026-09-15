import { describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { installRuntimeMonitor } from '../src/main/runtimeMonitor'
import { RuntimeDiagnostics } from '../src/main/runtimeDiagnostics'

function contents(attached = false) {
  const api = Object.assign(new EventEmitter(), {
    isAttached: () => attached,
    attach: vi.fn(() => { attached = true }),
    detach: vi.fn(() => { attached = false }),
    sendCommand: vi.fn(async (_method: string, _params?: unknown) => ({}))
  })
  return { id: 3, debugger: api, isDestroyed: () => false } as any
}

describe('exclusive runtime observer ownership', () => {
  it('never replaces or detaches another debugger session', async () => {
    const wc = contents(true)
    await expect(installRuntimeMonitor(wc, new RuntimeDiagnostics(), new AbortController().signal)).rejects.toThrow('already attached')
    expect(wc.debugger.detach).not.toHaveBeenCalled()
    expect(wc.debugger.attach).not.toHaveBeenCalled()
  })

  it('removes all listeners and its own debugger if initialization fails', async () => {
    const wc = contents()
    wc.debugger.sendCommand.mockRejectedValue(new Error('CDP unavailable'))
    await expect(installRuntimeMonitor(wc, new RuntimeDiagnostics(), new AbortController().signal)).rejects.toThrow('CDP unavailable')
    expect(wc.debugger.detach).toHaveBeenCalledOnce()
    expect(wc.debugger.listenerCount('message')).toBe(0)
    expect(wc.debugger.listenerCount('detach')).toBe(0)
  })

  it('turns an unexpected detach into failure evidence, but not normal disposal', async () => {
    const wc = contents(), evidence = new RuntimeDiagnostics()
    const dispose = await installRuntimeMonitor(wc, evidence, new AbortController().signal)
    wc.debugger.emit('detach', {}, 'replaced_with_devtools')
    expect(evidence.items[0].kind).toBe('observer')
    dispose(); dispose()
    expect(wc.debugger.detach).toHaveBeenCalledOnce()
    expect(evidence.items).toHaveLength(1)
  })
})
