import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { installEggAtomically } from '../src/main/atomicEggInstall'

let root: string, source: string, destination: string
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'appgacha-atomic-install-'))
  source = path.join(root, 'download')
  destination = path.join(root, 'shelf/🍅 专注.gacha')
  fs.mkdirSync(source)
  fs.mkdirSync(destination, { recursive: true })
  fs.writeFileSync(path.join(source, 'app.js'), 'new code')
  fs.writeFileSync(path.join(source, 'egg.db-wal'), 'new WAL')
  fs.writeFileSync(path.join(destination, 'app.js'), 'old code')
  fs.writeFileSync(path.join(destination, 'egg.db'), 'irreplaceable user data')
})
afterEach(() => {
  vi.restoreAllMocks()
  if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('appgacha-atomic-install-')) throw new Error('Unsafe test cleanup')
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 })
})
const oldIntact = () => {
  expect(fs.readFileSync(path.join(destination, 'app.js'), 'utf8')).toBe('old code')
  expect(fs.readFileSync(path.join(destination, 'egg.db'), 'utf8')).toBe('irreplaceable user data')
}
it('publishes a complete replacement and keeps the downloaded source intact', () => {
  const rename = fs.renameSync
  const calls = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => rename(from, to))
  installEggAtomically(source, destination, true)
  expect(fs.readFileSync(path.join(destination, 'app.js'), 'utf8')).toBe('new code')
  expect(fs.readFileSync(path.join(destination, 'egg.db-wal'), 'utf8')).toBe('new WAL')
  expect(fs.existsSync(source)).toBe(true)
  expect(fs.readdirSync(path.dirname(destination))).toEqual([path.basename(destination)])
  for (const [from, to] of calls.mock.calls) {
    expect(String(from).startsWith(path.dirname(destination) + path.sep)).toBe(true)
    expect(String(to).startsWith(path.dirname(destination) + path.sep)).toBe(true)
  }
})
it('refuses accidental replacement in new-install mode', () => {
  expect(() => installEggAtomically(source, destination)).toThrow('already exists')
  oldIntact()
})
it('publishes a new capsule only after copying all files', () => {
  const target = path.join(root, 'shelf/New.gacha')
  installEggAtomically(source, target)
  expect(fs.readFileSync(path.join(target, 'app.js'), 'utf8')).toBe('new code')
  oldIntact()
})
it.each(['ENOSPC', 'EACCES'])('keeps the original if incoming copying fails: %s', code => {
  vi.spyOn(fs, 'copyFileSync').mockImplementationOnce(() => { throw new Error(code) })
  expect(() => installEggAtomically(source, destination, true)).toThrow(code)
  oldIntact()
  expect(fs.readdirSync(path.dirname(destination))).toHaveLength(1)
})
it.each(['EXDEV', 'EPERM'])('never deletes the original when backup rename fails: %s', code => {
  vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => { throw new Error(code) })
  expect(() => installEggAtomically(source, destination, true)).toThrow(code)
  oldIntact()
})
it('restores the original when publication fails', () => {
  const rename = fs.renameSync
  vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
    if (path.basename(String(from)) === 'candidate') throw new Error('Publish locked')
    return rename(from, to)
  })
  expect(() => installEggAtomically(source, destination, true)).toThrow('Publish locked')
  oldIntact()
  expect(fs.readdirSync(path.dirname(destination))).toHaveLength(1)
})
it('preserves and reports the backup if rollback also fails', () => {
  const rename = fs.renameSync
  vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
    if (String(from) !== destination) throw new Error('Volume locked')
    return rename(from, to)
  })
  expect(() => installEggAtomically(source, destination, true)).toThrow('Original capsule preserved at:')
  const holder = fs.readdirSync(path.dirname(destination)).find(name => name.startsWith('.appgacha-install-'))!
  expect(fs.readFileSync(path.join(path.dirname(destination), holder, 'previous/egg.db'), 'utf8')).toBe('irreplaceable user data')
})
it('does not report a successful install as failed when temporary cleanup is locked', () => {
  vi.spyOn(fs, 'rmSync').mockImplementationOnce(() => { throw new Error('Cleanup locked') })
  const warn = vi.fn()
  installEggAtomically(source, destination, true, warn)
  expect(fs.readFileSync(path.join(destination, 'app.js'), 'utf8')).toBe('new code')
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('retained at'))
})
it('does not leave a partial new capsule when copying fails', () => {
  const target = path.join(root, 'shelf/New.gacha')
  vi.spyOn(fs, 'copyFileSync').mockImplementationOnce(() => { throw new Error('ENOSPC') })
  expect(() => installEggAtomically(source, target)).toThrow('ENOSPC')
  expect(fs.existsSync(target)).toBe(false)
  oldIntact()
})
