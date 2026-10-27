import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { EventEmitter } from 'node:events'

const mocks = vi.hoisted(() => ({
  dir: '', fetch: vi.fn(), send: vi.fn(),
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
}))
vi.mock('electron', () => ({
  app: { isPackaged: true, getPath: () => mocks.dir },
  net: { fetch: mocks.fetch },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (text: string) => Buffer.from(text),
    decryptString: (bytes: Buffer) => bytes.toString(),
  },
  shell: { openExternal: vi.fn() },
}))
vi.mock('../src/main/log', () => ({ logLine: vi.fn() }))
vi.mock('../src/main/api', () => ({ checkHealth: vi.fn(), apiFetch: vi.fn() }))
vi.mock('../src/main/shelfWindow', () => ({ sendToShelf: mocks.send }))
vi.mock('../src/main/channels/ipc', () => ({
  handle: (name: string, handler: (...args: unknown[]) => unknown) => mocks.handlers.set(name, handler),
}))
import { registerAuthChannels } from '../src/main/channels/authChannels'
import { getAuthStatus, handleCallback, updateTokens } from '../src/main/auth'

const user = { id: 'test-user', email: 'test@example.invalid', name: 'Test', avatar_url: null }
const invoke = (name: string, ...args: unknown[]) => mocks.handlers.get(`shelf:${name}`)!(...args)
const authEvents: EventEmitter = process
const oldListeners = authEvents.listeners('appgacha:auth-changed')

beforeAll(() => { registerAuthChannels() })
beforeEach(() => {
  mocks.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'appgacha-auth-test-'))
  mocks.fetch.mockReset()
  mocks.send.mockClear()
  mocks.fetch.mockResolvedValue(new Response(JSON.stringify({
    access_token: 'test-access', refresh_token: 'test-refresh', user,
  }), { status: 200 }))
})
afterEach(() => { fs.rmSync(mocks.dir, { recursive: true, force: true }) })
afterAll(() => {
  for (const listener of authEvents.listeners('appgacha:auth-changed')) {
    if (!oldListeners.includes(listener)) {
      authEvents.removeListener('appgacha:auth-changed', listener as (...args: unknown[]) => void)
    }
  }
})

describe('persisted auth changes reach the desktop renderer', () => {
  it.each([false, true])('email code login (has_password=%s) updates UI before IPC completes', async hasPassword => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({
      access_token: 'test-access', refresh_token: 'test-refresh', user: { ...user, has_password: hasPassword },
    })))
    mocks.send.mockImplementationOnce(() => {
      expect(getAuthStatus().loggedIn).toBe(true)
    })
    expect(await invoke('verifyCode', user.email, '123456')).toEqual({ ok: true, hasPassword })
    expect(mocks.send).toHaveBeenCalledExactlyOnceWith('auth:changed', { loggedIn: true, reason: 'email-code' })
  })

  it('password login notifies without restarting', async () => {
    await invoke('loginPassword', user.email, 'test-password')
    expect(getAuthStatus()).toEqual({ loggedIn: true, user })
    expect(mocks.send).toHaveBeenCalledExactlyOnceWith('auth:changed', { loggedIn: true, reason: 'password' })
  })

  it('OAuth uses the same bridge and identifies external completion', async () => {
    expect(await handleCallback('appgacha://callback?link_code=test')).toEqual({ ok: true })
    expect(mocks.send).toHaveBeenCalledExactlyOnceWith('auth:changed', { loggedIn: true, reason: 'oauth' })
  })

  it('refresh emits only public metadata; logout updates every consumer even offline', async () => {
    await invoke('loginPassword', user.email, 'test-password')
    mocks.send.mockClear()
    updateTokens('new-access', 'new-refresh')
    expect(mocks.send).toHaveBeenCalledExactlyOnceWith('auth:changed', { loggedIn: true, reason: 'refresh' })
    mocks.send.mockClear()
    mocks.fetch.mockRejectedValue(new Error('offline'))
    await invoke('authLogout')
    expect(getAuthStatus()).toEqual({ loggedIn: false })
    expect(mocks.send).toHaveBeenCalledExactlyOnceWith('auth:changed', { loggedIn: false, reason: 'logout' })
  })

  it.each(['verifyCode', 'loginPassword'])('failed %s never publishes a successful login', async name => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ detail: 'Invalid credentials' }), { status: 401 }))
    await expect(invoke(name, user.email, 'invalid')).rejects.toThrow('Invalid credentials')
    expect(mocks.send).not.toHaveBeenCalled()
    expect(getAuthStatus()).toEqual({ loggedIn: false })
  })

  it('re-registering channels does not duplicate notifications', async () => {
    registerAuthChannels()
    await invoke('loginPassword', user.email, 'test-password')
    expect(mocks.send).toHaveBeenCalledTimes(1)
  })
})
