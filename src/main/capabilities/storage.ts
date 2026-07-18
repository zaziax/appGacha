import fs from 'node:fs'
import path from 'node:path'
import { EggContext } from '../eggs'

function storageFile(ctx: EggContext): string {
  return path.join(ctx.dir, 'data', 'storage.json')
}

function load(ctx: EggContext): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(storageFile(ctx), 'utf-8'))
  } catch {
    return {}
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
  const data = load(ctx)
  data[key] = value
  save(ctx, data)
}

export function del(ctx: EggContext, key: string): void {
  assertKey(key)
  const data = load(ctx)
  delete data[key]
  save(ctx, data)
}
