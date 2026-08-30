import fs from 'node:fs'
import path from 'node:path'
import { EggContext } from '../eggs'

// storage 资源上限：恶意蛋不能无界写入撑爆磁盘/内存
const MAX_VALUE_BYTES = 1 * 1024 * 1024    // 单值 1MB
const MAX_TOTAL_BYTES = 10 * 1024 * 1024   // storage.json 总量 10MB
const MAX_KEYS = 1000                      // 键数上限

function storageFile(ctx: EggContext): string {
  return path.join(ctx.dir, 'data', 'storage.json')
}

function load(ctx: EggContext): Record<string, unknown> {
  const file = storageFile(ctx)
  let raw: string
  try {
    const stat = fs.statSync(file)
    if (stat.size > MAX_TOTAL_BYTES) throw new Error(`storage: file exceeds ${MAX_TOTAL_BYTES} bytes`)
    raw = fs.readFileSync(file, 'utf-8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {} // 首次访问，无文件
    throw e // 超限等其它错误上抛，别悄悄吞
  }
  try {
    return JSON.parse(raw)
  } catch {
    return {} // 损坏的 JSON 视为空，别让一个坏文件卡死整个蛋
  }
}

function save(ctx: EggContext, data: Record<string, unknown>): void {
  // 序列化一次，用落盘同款字节数做总量校验——杜绝「校验用紧凑、落盘用缩进」的口径不一致
  // （否则 set 通过校验写入成功，下次 load 却因文件真实字节超限抛错，数据读不回来）
  const serialized = JSON.stringify(data, null, 2)
  if (Buffer.byteLength(serialized) > MAX_TOTAL_BYTES) {
    throw new Error(`storage: total exceeds ${MAX_TOTAL_BYTES} bytes`)
  }
  const file = storageFile(ctx)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, serialized, 'utf-8')
  fs.renameSync(tmp, file)
}

function assertKey(key: unknown): asserts key is string {
  if (typeof key !== 'string' || key.length === 0) throw new Error('storage: key must be a non-empty string')
}

export function get(ctx: EggContext, key: string): unknown {
  assertKey(key)
  return load(ctx)[key] ?? null
}

export function set(ctx: EggContext, key: string, value: unknown): void {
  assertKey(key)
  setMany(ctx, { [key]: value })
}

/** 一次读取、校验并原子写入多个键，避免初始化数据时反复重写完整 JSON。 */
export function setMany(ctx: EggContext, entries: Record<string, unknown>): void {
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) {
    throw new Error('storage: entries must be an object')
  }
  const data = load(ctx)
  for (const [key, value] of Object.entries(entries)) {
    assertKey(key)
    if (value === undefined) throw new Error('storage: value cannot be undefined')
    const serialized = JSON.stringify(value)
    if (serialized === undefined) throw new Error('storage: value must be JSON serializable')
    const valueBytes = Buffer.byteLength(serialized)
    if (valueBytes > MAX_VALUE_BYTES) throw new Error(`storage: value exceeds ${MAX_VALUE_BYTES} bytes`)
    data[key] = value
  }
  if (Object.keys(data).length > MAX_KEYS) throw new Error(`storage: too many keys (max ${MAX_KEYS})`)
  save(ctx, data) // 总量校验在 save 内，用落盘同款序列化
}

export function del(ctx: EggContext, key: string): void {
  assertKey(key)
  const data = load(ctx)
  delete data[key]
  save(ctx, data)
}
