import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createRuntimeFixture } from '../src/main/runtimeFixture'
import { registerTestEgg, removeEgg } from '../src/main/eggs'

const sources: string[] = []
afterEach(() => { for (const dir of sources.splice(0)) fs.rmSync(dir, { recursive: true, force: true }) })

describe('isolated runtime data fixture', () => {
  it('uses a new identity, preserves the source, and carries inactive WAL data', async () => {
    const source = fs.mkdtempSync(path.join(os.tmpdir(), 'appgacha-runtime-source-'))
    sources.push(source)
    fs.mkdirSync(path.join(source, 'data'))
    fs.writeFileSync(path.join(source, 'manifest.json'), JSON.stringify({ eggId: 'original-egg', name: 'Example', hostApiVersion: '1', permissions: [] }))
    fs.writeFileSync(path.join(source, 'index.html'), '<button>Original</button>')
    fs.writeFileSync(path.join(source, 'data/storage.json'), '{"count":0}')
    fs.writeFileSync(path.join(source, 'data/egg.db-wal'), 'committed wal fixture')
    fs.writeFileSync(path.join(source, 'data/egg.db-shm'), 'transient shm fixture')
    const fixture = createRuntimeFixture(source)
    try {
      const context = registerTestEgg(fixture.dir)
      expect(context.eggId).not.toBe('original-egg')
      expect(context.manifest.eggId).toBe('original-egg')
      removeEgg(context.eggId)
      expect(fs.readFileSync(path.join(fixture.dir, 'data/egg.db-wal'), 'utf8')).toBe('committed wal fixture')
      expect(fs.existsSync(path.join(fixture.dir, 'data/egg.db-shm'))).toBe(false)
      fs.writeFileSync(path.join(fixture.dir, 'data/storage.json'), '{"count":99}')
      expect(fs.readFileSync(path.join(source, 'data/storage.json'), 'utf8')).toBe('{"count":0}')
      expect(JSON.parse(fs.readFileSync(path.join(source, 'manifest.json'), 'utf8')).eggId).toBe('original-egg')
    } finally { await fixture.dispose() }
    expect(fs.existsSync(fixture.dir)).toBe(false)
  })
})
