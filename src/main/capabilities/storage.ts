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
  const file = storageFile(ctx)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8')
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
  if (value === undefined) throw new Error('storage: value cannot be undefined')
  const valueBytes = Buffer.byteLength(JSON.stringify(value))
  if (valueBytes > MAX_VALUE_BYTES) throw new Error(`storage: value exceeds ${MAX_VALUE_BYTES} bytes`)
  const data = load(ctx)
  data[key] = value
  if (Object.keys(data).length > MAX_KEYS) throw new Error(`storage: too many keys (max ${MAX_KEYS})`)
  if (Buffer.byteLength(JSON.stringify(data)) > MAX_TOTAL_BYTES) {
    throw new Error(`storage: total exceeds ${MAX_TOTAL_BYTES} bytes`)
  }
  save(ctx, data)
}

export function del(ctx: EggContext, key: string): void {
  assertKey(key)
  const data = load(ctx)
  delete data[key]
  save(ctx, data)
}
