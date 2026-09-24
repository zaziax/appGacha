import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const env = vi.hoisted(() => ({ profile: '', project: '', packaged: false }))
vi.mock('electron', () => ({ app: {
  get isPackaged() { return env.packaged },
  getPath: () => env.profile,
  getAppPath: () => env.project,
} }))
let root: string
beforeEach(() => {
  vi.resetModules()
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'appgacha-storage-paths-'))
  env.profile = path.join(root, 'profile'); env.project = path.join(root, 'project'); env.packaged = false
  fs.mkdirSync(env.profile); fs.mkdirSync(env.project)
})
afterEach(() => {
  if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('appgacha-storage-paths-')) throw new Error('Unsafe test cleanup')
  fs.rmSync(root, { recursive: true, force: true })
})
it.each([false, true])('routes all egg paths to the custom library without moving staging/profile (packaged=%s)', async packaged => {
  env.packaged = packaged
  const { dataRoot, eggStorage } = await import('../src/main/paths')
  const base = packaged ? env.profile : env.project
  expect(dataRoot('eggs')).toBe(path.join(base, 'eggs'))
  const custom = path.join(root, 'custom'); fs.mkdirSync(custom)
  eggStorage().schedule(custom, false)
  expect(dataRoot('eggs')).toBe(path.join(base, 'eggs'))
  await eggStorage().initialize()
  expect(dataRoot('eggs', 'Timer.gacha', 'data')).toBe(path.join(custom, 'Timer.gacha/data'))
  expect(dataRoot('staging')).toBe(path.join(base, 'staging'))
  expect(dataRoot('backups')).toBe(path.join(base, 'backups'))
})
it('blocks library writes but leaves Settings/status and non-library paths usable in recovery', async () => {
  fs.writeFileSync(path.join(env.profile, 'egg-storage.json'), '{broken')
  const { dataRoot, eggStorage } = await import('../src/main/paths')
  expect((await eggStorage().initialize()).available).toBe(false)
  expect(() => dataRoot('eggs', 'New.gacha')).toThrow('unavailable')
  expect(dataRoot('staging')).toBe(path.join(env.project, 'staging'))
  expect(fs.existsSync(path.join(env.project, 'eggs'))).toBe(false)
})
