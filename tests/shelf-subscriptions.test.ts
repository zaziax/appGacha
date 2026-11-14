import { EventEmitter } from 'node:events'
import { expect, it, vi } from 'vitest'

const { expose } = vi.hoisted(() => ({ expose: vi.fn() }))
vi.mock('electron', async () => ({
  contextBridge: { exposeInMainWorld: expose },
  ipcRenderer: new (await import('node:events')).EventEmitter(),
}))

it('removes shelf event listeners when React resubscribes', async () => {
  const { ipcRenderer } = await import('electron')
  await import('../src/preload/shelf')
  const events = ipcRenderer as unknown as EventEmitter
  const bridge = expose.mock.calls[0][1]
  const channels = {
    onBillingSettled: 'billing:settled',
    onDownloadProgress: 'sync:downloadProgress',
    onEggsChanged: 'shelf:eggsChanged',
    onClosePrompt: 'shelf:closePrompt',
    onImportConflict: 'shelf:importConflict',
    onWindowState: 'win:stateChanged',
  }
  for (const [method, channel] of Object.entries(channels)) {
    const stale = vi.fn()
    const current = vi.fn()
    bridge[method](stale)()
    const unsubscribe = bridge[method](current)
    events.emit(channel, {}, { example: true })
    expect(stale).not.toHaveBeenCalled()
    expect(current).toHaveBeenCalledTimes(1)
    unsubscribe()
    expect(events.listenerCount(channel)).toBe(0)
  }
})
