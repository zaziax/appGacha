import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { set, get, del } from '../src/main/capabilities/storage'
import type { EggContext } from '../src/main/eggs'

// storage 能力三道上限：单值 1MB、总量 10MB、键数 1000。纯 Node（fs+JSON），无需原生模块。

const MAX_VALUE_BYTES = 1 * 1024 * 1024
const MAX_TOTAL_BYTES = 10 * 1024 * 1024

let dir: string
let ctx: EggContext

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'storage-test-'))
  ctx = {
    eggId: 'test-egg',
    dir,
    manifest: { eggId: 'test-egg', name: 't', version: '1.0.0', hostApiVersion: '1', permissions: [] },
  }
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('get', () => {
  it('returns null for a missing key', () => {
    expect(get(ctx, 'nope')).toBeNull()
  })

  it('returns the stored value (falsy values are not nulled)', () => {
    set(ctx, 'zero', 0)
    set(ctx, 'no', false)
    set(ctx, 'empty', '')
    expect(get(ctx, 'zero')).toBe(0)
    expect(get(ctx, 'no')).toBe(false)
    expect(get(ctx, 'empty')).toBe('')
  })

  it('returns null when the file is corrupt JSON', () => {
    mkdirSync(join(dir, 'data'), { recursive: true })
    writeFileSync(join(dir, 'data', 'storage.json'), '{not valid json', 'utf-8')
    expect(get(ctx, 'any')).toBeNull()
  })
})

describe('set / get round-trip', () => {
  it('stores and retrieves nested structures', () => {
    const v = { list: [1, 2, 3], nested: { ok: true } }
    set(ctx, 'k', v)
    expect(get(ctx, 'k')).toEqual(v)
  })
})

describe('set guards', () => {
  it('rejects a non-string or empty key', () => {
    expect(() => set(ctx, '', 1)).toThrow(/non-empty string/)
    expect(() => set(ctx, undefined as unknown as string, 1)).toThrow(/non-empty string/)
  })

  it('rejects undefined values (would serialize away silently)', () => {
    expect(() => set(ctx, 'k', undefined)).toThrow(/undefined/)
  })

  it('rejects a value over the single-value cap', () => {
    const big = 'x'.repeat(MAX_VALUE_BYTES + 1)
    expect(() => set(ctx, 'k', big)).toThrow(/value exceeds/)
  })

  it('rejects too many keys', () => {
    for (let i = 0; i < 1000; i++) set(ctx, 'k' + i, 1)
    expect(() => set(ctx, 'k1000', 1)).toThrow(/too many keys/)
  })
})

describe('total cap (regression: serialization must match)', () => {
  it('rejects when the on-disk (indented) bytes exceed the cap, even if compact fits', () => {
    // 历史 bug：set 用紧凑 JSON.stringify 校验总量，save 却落盘缩进版（更大），
    // 结果「set 成功、下次 get 抛 file exceeds」。修复后 save 用落盘同款字节数校验。
    // 用「短字符串数组」放大缩进开销（缩进 ≈ 1.5× 紧凑），让「紧凑总量在限内、缩进超限」的窗口
    // 足够宽、可稳定命中，而每个 value 自身仍在单值 1MB 上限内。
    const value = Array.from({ length: 150_000 }, () => 'abc')

    // 先算出临界 key 数：紧凑总量 ≤ 10MB 但缩进总量 > 10MB 的那个点
    const data: Record<string, unknown> = {}
    let straddleKey = -1
    for (let i = 0; i < 1000; i++) {
      data['k' + i] = value
      const compact = Buffer.byteLength(JSON.stringify(data))
      const pretty = Buffer.byteLength(JSON.stringify(data, null, 2))
      if (compact > MAX_TOTAL_BYTES) throw new Error('test setup: compact crossed cap before pretty — no straddle window')
      if (pretty > MAX_TOTAL_BYTES) { straddleKey = i; break }
    }
    expect(straddleKey).toBeGreaterThanOrEqual(0)

    // 临界点之前的 key 都能正常写入；触发超限的那一个 set 必须抛错
    for (let i = 0; i < straddleKey; i++) set(ctx, 'k' + i, value)
    expect(() => set(ctx, 'k' + straddleKey, value)).toThrow(/total exceeds/)

    // 失败的那次 set 没有破坏既有数据——之前写进去的还能读回
    expect(get(ctx, 'k0')).toEqual(value)
  })

  it('rejects a pre-existing oversized file on load', () => {
    mkdirSync(join(dir, 'data'), { recursive: true })
    writeFileSync(join(dir, 'data', 'storage.json'), 'x'.repeat(MAX_TOTAL_BYTES + 1), 'utf-8')
    expect(() => get(ctx, 'any')).toThrow(/file exceeds/)
  })
})

describe('del', () => {
  it('removes a key', () => {
    set(ctx, 'k', 'v')
    del(ctx, 'k')
    expect(get(ctx, 'k')).toBeNull()
  })
})
