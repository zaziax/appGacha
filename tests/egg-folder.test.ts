import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { uniqueEggFolder } from '../src/main/eggFolder'

let root: string
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'appgacha-name-test-')) })
afterEach(() => {
  if (!path.basename(root).startsWith('appgacha-name-test-') || path.dirname(root) !== os.tmpdir()) throw new Error('Unsafe test cleanup')
  fs.rmSync(root, { recursive: true, force: true })
})

describe('safe application folder naming', () => {
  it('preserves normal display names without creating a directory', () => {
    const destination = uniqueEggFolder(root, 'Focus Timer')
    expect(destination).toBe(path.join(root, 'Focus Timer.gacha'))
    expect(fs.existsSync(destination)).toBe(false)
  })

  it('never replaces an existing app directory or file', () => {
    fs.mkdirSync(path.join(root, 'Focus Timer.gacha'))
    fs.writeFileSync(path.join(root, 'Focus Timer.gacha', 'keep.txt'), 'existing app')
    fs.writeFileSync(path.join(root, 'Focus Timer-2.gacha'), 'existing file')
    expect(uniqueEggFolder(root, 'Focus Timer')).toBe(path.join(root, 'Focus Timer-3.gacha'))
    expect(fs.readFileSync(path.join(root, 'Focus Timer.gacha', 'keep.txt'), 'utf8')).toBe('existing app')
  })

  it.each(['../escape', '..\\escape', 'C:\\Windows\\system32', '/etc/passwd', 'a/b:c*?"<>|', 'emoji-free 中文应用', '...', '.'])('keeps %s inside the exact application root', name => {
    const destination = uniqueEggFolder(root, name)
    expect(path.dirname(destination)).toBe(path.resolve(root))
    expect(path.basename(destination)).toMatch(/\.gacha$/)
    expect(path.basename(destination)).not.toMatch(/[<>:"/\\|?*\u0000-\u001f]/)
  })

  it.each(['CON', 'con.txt', 'NUL', 'AUX', 'COM1', 'LPT9', 'prn'])('avoids the Windows device name %s', name => {
    expect(path.basename(uniqueEggFolder(root, name))).toMatch(/^App-/)
  })

  it('bounds long names and removes unsafe trailing spaces/dots', () => {
    const destination = uniqueEggFolder(root, 'a'.repeat(200) + '... ')
    expect(path.basename(destination).length).toBeLessThanOrEqual(106)
    expect(path.basename(uniqueEggFolder(root, ' Timer... '))).toBe('Timer.gacha')
  })

  it.each(['', ' ', '\t\n'])('rejects an empty display name', name => {
    expect(() => uniqueEggFolder(root, name)).toThrow('empty')
  })
})
