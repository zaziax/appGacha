import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const mock = vi.hoisted(() => ({ handlers: new Map<string, any>(), ctx: undefined as any, notifications: 0, dialog: vi.fn(), network: vi.fn() }))
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: any) => mock.handlers.set(channel, fn) },
  BrowserWindow: { fromWebContents: () => ({}) },
  dialog: { showOpenDialog: mock.dialog, showSaveDialog: mock.dialog },
  Notification: class { static isSupported() { return true } on() {} show() { mock.notifications++ } }
}))
vi.mock('../src/main/registry', () => ({ get: () => mock.ctx }))
vi.mock('../src/main/eggs', () => ({ getEgg: () => mock.ctx }))
vi.mock('../src/main/eggWindow', () => ({ openEgg: vi.fn() }))
vi.mock('../src/main/capabilities/db', () => ({ exec: vi.fn(), query: vi.fn() }))
vi.mock('../src/main/capabilities/ai', () => ({ chat: vi.fn(), extract: vi.fn() }))
vi.mock('../src/main/net/coordinator', () => ({ createRoom: mock.network, findRooms: mock.network, joinRoom: mock.network, broadcast: mock.network, closeRoom: mock.network }))

import { registerCapabilities } from '../src/main/capabilities/index'
import { cancelAllForEgg } from '../src/main/schedule'

let dir: string
beforeEach(() => {
  vi.useFakeTimers(); mock.handlers.clear(); mock.notifications = 0; mock.dialog.mockReset(); mock.network.mockReset()
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'appgacha-runtime-effects-'))
  mock.ctx = { eggId: 'test-side-effects', dir, testMode: true, ephemeral: true, manifest: { permissions: ['schedule', 'notify', 'network'] } }
  registerCapabilities()
})
afterEach(() => { cancelAllForEgg(mock.ctx.eggId); vi.useRealTimers(); fs.rmSync(dir, { recursive: true, force: true }) })
const call = (channel: string, ...args: unknown[]) => mock.handlers.get(channel)({ sender: { id: 1 } }, ...args)

describe('host-owned testMode prevents external effects', () => {
  it('checks and stores schedule data but never arms notifications', async () => {
    expect((await call('egg:schedule:set', 'reminder', '* * * * *', { title: 'test', body: 'test' })).ok).toBe(true)
    expect((await call('egg:schedule:list')).value).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(0)
    expect((await call('egg:notify:send', 'test', 'test')).ok).toBe(true)
    expect(mock.notifications).toBe(0)
    expect((await call('egg:schedule:set', 'bad', 'not a cron', { title: 'test', body: 'test' })).ok).toBe(false)
  })

  it('cancels OS file dialogs and rejects network room activity before invoking services', async () => {
    expect((await call('egg:ui:pickFile')).value).toBeNull()
    expect((await call('egg:ui:saveFile', 'test', 'file.txt')).value).toEqual({ saved: false })
    expect((await call('egg:net:createRoom', 'test')).ok).toBe(false)
    expect(mock.dialog).not.toHaveBeenCalled()
    expect(mock.network).not.toHaveBeenCalled()
  })

  it('does not relax permissions or change normal-mode capability behavior', async () => {
    mock.ctx.manifest.permissions = []
    expect((await call('egg:notify:send', 'test', 'test')).ok).toBe(false)
    mock.ctx.manifest.permissions = ['notify']; mock.ctx.testMode = false
    expect((await call('egg:notify:send', 'test', 'test')).ok).toBe(true)
    expect(mock.notifications).toBe(1)
    mock.dialog.mockResolvedValue({ canceled: true, filePaths: [] })
    await call('egg:ui:pickFile')
    expect(mock.dialog).toHaveBeenCalledOnce()
  })
})
