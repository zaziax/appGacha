import fs from 'node:fs'
import path from 'node:path'
import type Database from 'better-sqlite3'
import { EggManifest, KNOWN_PERMISSIONS } from '../shared/types'

export interface EggContext {
  eggId: string
  dir: string
  manifest: EggManifest
  db?: Database.Database
  /** 测试模式：egg.ai 返回 mock 数据，不发真实请求 */
  aiMock?: boolean
  /** 装配舱里的临时蛋，不在收藏柜陈列 */
  ephemeral?: boolean
}

const byEggId = new Map<string, EggContext>()

export function getEgg(eggId: string): EggContext | undefined {
  return byEggId.get(eggId)
}

export function allEggs(): EggContext[] {
  return [...byEggId.values()]
}

export function registerEgg(dir: string): EggContext {
  const manifest = loadManifest(dir)
  if (byEggId.has(manifest.eggId)) throw new Error(`egg "${manifest.eggId}" already registered`)
  const ctx: EggContext = { eggId: manifest.eggId, dir, manifest }
  byEggId.set(manifest.eggId, ctx)
  return ctx
}

export function removeEgg(eggId: string): void {
  byEggId.delete(eggId)
}

export function discoverEggs(eggsRoot: string): EggContext[] {
  if (!fs.existsSync(eggsRoot)) return []
  const found: EggContext[] = []
  for (const entry of fs.readdirSync(eggsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.endsWith('.egg')) continue
    try {
      found.push(registerEgg(path.join(eggsRoot, entry.name)))
    } catch (e) {
      console.error(`[eggs] skip ${entry.name}: ${(e as Error).message}`)
    }
  }
  return found
}

export function loadManifest(dir: string): EggManifest {
  const raw = fs.readFileSync(path.join(dir, 'manifest.json'), 'utf-8')
  const m = JSON.parse(raw) as EggManifest
  if (!m.eggId || typeof m.eggId !== 'string') throw new Error('manifest: eggId missing')
  // eggId 会成为 egg:// 的 hostname（小写），统一小写避免大小写不一致
  if (m.eggId !== m.eggId.toLowerCase()) throw new Error('manifest: eggId must be lowercase')
  if (!m.name) throw new Error('manifest: name missing')
  if (!m.hostApiVersion) throw new Error('manifest: hostApiVersion missing')
  if (!Array.isArray(m.permissions)) throw new Error('manifest: permissions missing')
  for (const p of m.permissions) {
    if (!KNOWN_PERMISSIONS.includes(p)) throw new Error(`manifest: unknown permission "${p}"`)
  }
  if (!fs.existsSync(path.join(dir, 'index.html'))) throw new Error('index.html missing')
  return m
}
