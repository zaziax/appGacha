import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { read, write, list, readBytes, writeBytes } from '../src/main/capabilities/fsx'
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

describe('readBytes / writeBytes: 二进制往返', () => {
  it('任意字节写入再读出，逐字节一致', () => {
    const bytes = new Uint8Array([0, 1, 2, 127, 128, 255, 254, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a])
    writeBytes(ctx, 'img.png', bytes)
    const back = readBytes(ctx, 'img.png')
    expect(back).toBeInstanceOf(Uint8Array)
    expect(Buffer.compare(Buffer.from(back), Buffer.from(bytes))).toBe(0)
  })

  it('落盘内容不被 utf-8 重写', () => {
    const bytes = new Uint8Array([0xff, 0xfe, 0x00, 0x80])
    writeBytes(ctx, 'raw.bin', bytes)
    expect(readFileSync(join(dir, 'data', 'raw.bin'))).toEqual(Buffer.from(bytes))
  })

  it('拒绝非 Uint8Array', () => {
    expect(() => writeBytes(ctx, 'x', 'not bytes')).toThrow(/Uint8Array/)
  })

  it('拒绝超限', () => {
    expect(() => writeBytes(ctx, 'big.bin', new Uint8Array(MAX_FILE_BYTES + 1))).toThrow(/exceeds/)
  })

  it('复用路径穿越与大小守卫', () => {
    expect(() => writeBytes(ctx, '../escape.bin', new Uint8Array([1, 2, 3]))).toThrow(/escapes/)
    expect(() => readBytes(ctx, '..')).toThrow(/escapes/)
  })
})
