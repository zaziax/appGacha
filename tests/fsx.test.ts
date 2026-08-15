import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { read, write, list } from '../src/main/capabilities/fsx'
import type { EggContext } from '../src/main/eggs'

// fsx 能力：egg.fs 的世界只有蛋 data/ 目录。resolveSafe 的路径穿越判空 + 10MB 上限。

const MAX_FILE_BYTES = 10 * 1024 * 1024

let dir: string
let ctx: EggContext

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fsx-test-'))
  ctx = {
    eggId: 'test-egg',
    dir,
    manifest: { eggId: 'test-egg', name: 't', version: '1.0.0', hostApiVersion: '1', permissions: [] },
  }
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('resolveSafe: path traversal', () => {
  it('rejects escaping the data dir via ..', () => {
    expect(() => read(ctx, '../evil.txt')).toThrow(/escapes/)
    expect(() => read(ctx, '..')).toThrow(/escapes/)
  })

  it('rejects nested .. that resolve outside', () => {
    expect(() => read(ctx, 'sub/../../evil.txt')).toThrow(/escapes/)
  })

  it('applies the same guard to write and list', () => {
    expect(() => write(ctx, '../evil.txt', 'x')).toThrow(/escapes/)
    expect(() => list(ctx, '..')).toThrow(/escapes/)
  })

  it('rejects a non-string or empty path', () => {
    expect(() => read(ctx, '')).toThrow(/non-empty string/)
    expect(() => read(ctx, undefined as unknown as string)).toThrow(/non-empty string/)
  })
})

describe('read / write / list round-trip', () => {
  it('writes and reads within the data dir', () => {
    write(ctx, 'sub/probe.txt', 'hello')
    expect(read(ctx, 'sub/probe.txt')).toBe('hello')
  })

  it('lists files', () => {
    write(ctx, 'probe.txt', 'x')
    expect(list(ctx, '.').some(f => f.name === 'probe.txt')).toBe(true)
  })

  it('allows a sibling .. that stays inside', () => {
    write(ctx, 'a/f.txt', '1')
    expect(read(ctx, 'a/../a/f.txt')).toBe('1')
  })
})

describe('size cap', () => {
  it('rejects writing over 10MB', () => {
    expect(() => write(ctx, 'big.txt', 'x'.repeat(MAX_FILE_BYTES + 1))).toThrow(/exceeds/)
  })

  it('rejects reading a pre-existing oversized file', () => {
    mkdirSync(join(dir, 'data'), { recursive: true })
    writeFileSync(join(dir, 'data', 'big.txt'), 'x'.repeat(MAX_FILE_BYTES + 1), 'utf-8')
    expect(() => read(ctx, 'big.txt')).toThrow(/exceeds/)
  })
})
