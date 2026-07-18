import fs from 'node:fs'
import path from 'node:path'
import { EggContext } from '../eggs'

const MAX_FILE_BYTES = 10 * 1024 * 1024

function dataDir(ctx: EggContext): string {
  return path.join(ctx.dir, 'data')
}

// egg.fs 的世界只有 data/，路径穿越在这里掐死
function resolveSafe(ctx: EggContext, rel: unknown): string {
  if (typeof rel !== 'string' || rel.length === 0) throw new Error('fs: path must be a non-empty string')
  const root = path.normalize(dataDir(ctx))
  const abs = path.normalize(path.join(root, rel))
  if (abs !== root && !abs.startsWith(root + path.sep)) throw new Error('fs: path escapes egg data dir')
  return abs
}

export function read(ctx: EggContext, rel: string): string {
  const abs = resolveSafe(ctx, rel)
  const stat = fs.statSync(abs)
  if (stat.size > MAX_FILE_BYTES) throw new Error(`fs: file exceeds ${MAX_FILE_BYTES} bytes`)
  return fs.readFileSync(abs, 'utf-8')
}

export function write(ctx: EggContext, rel: string, content: unknown): void {
  if (typeof content !== 'string') throw new Error('fs: content must be a string')
  if (Buffer.byteLength(content) > MAX_FILE_BYTES) throw new Error(`fs: content exceeds ${MAX_FILE_BYTES} bytes`)
  const abs = resolveSafe(ctx, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  const tmp = abs + '.tmp'
  fs.writeFileSync(tmp, content, 'utf-8')
  fs.renameSync(tmp, abs)
}

export function list(ctx: EggContext, rel?: string): { name: string; isDir: boolean }[] {
  const abs = resolveSafe(ctx, rel ?? '.')
  if (!fs.existsSync(abs)) return []
  return fs.readdirSync(abs, { withFileTypes: true }).map(e => ({ name: e.name, isDir: e.isDirectory() }))
}
