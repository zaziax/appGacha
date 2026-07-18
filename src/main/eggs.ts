import fs from 'node:fs'
import path from 'node:path'
import type Database from 'better-sqlite3'
import { EggManifest, KNOWN_PERMISSIONS } from '../shared/types'

export interface EggContext {
  eggId: string
  dir: string
  manifest: EggManifest
  db?: Database.Database
}

const byEggId = new Map<string, EggContext>()

export function getEgg(eggId: string): EggContext | undefined {
  return byEggId.get(eggId)
}

export function discoverEggs(eggsRoot: string): EggContext[] {
  if (!fs.existsSync(eggsRoot)) return []
  const found: EggContext[] = []
  for (const entry of fs.readdirSync(eggsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.endsWith('.egg')) continue
    const dir = path.join(eggsRoot, entry.name)
    try {
      const manifest = loadManifest(dir)
      const ctx: EggContext = { eggId: manifest.eggId, dir, manifest }
      byEggId.set(manifest.eggId, ctx)
      found.push(ctx)
    } catch (e) {
      console.error(`[eggs] skip ${entry.name}: ${(e as Error).message}`)
    }
  }
  return found
}

function loadManifest(dir: string): EggManifest {
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
