import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { registerEgg, registerTestEgg, removeEgg } from '../src/main/eggs'
import { registerEggProtocol } from '../src/main/protocol'
import { createRuntimeFixture } from '../src/main/runtimeFixture'

const dirs: string[] = [], ids: string[] = []
afterEach(() => { for (const id of ids.splice(0)) removeEgg(id); for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive:true, force:true }) })
function source(id: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'appgacha-origin-source-')); dirs.push(dir)
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ eggId:id, name:id, hostApiVersion:'1', permissions:[] }))
  fs.writeFileSync(path.join(dir, 'index.html'), 'REAL SOURCE')
  const ctx = registerEgg(dir); ids.push(ctx.eggId)
  return ctx
}

describe('isolated test origin mapping', () => {
  it('serves absolute self references from the copy and cannot serve another registered real egg', async () => {
    const original = source('source-origin'), other = source('other-origin')
    const fixture = createRuntimeFixture(original.dir)
    try {
      fs.writeFileSync(path.join(fixture.dir, 'index.html'), 'PRIVATE COPY')
      const ctx = registerTestEgg(fixture.dir); ids.push(ctx.eggId)
      let handler: (request: {url:string}) => Promise<Response>
      registerEggProtocol({ protocol: { handle: (_scheme:string, fn: typeof handler) => { handler = fn } } } as any, ctx)
      const ownResponse = await handler!({ url:'egg://source-origin/index.html' })
      expect(await ownResponse.text()).toBe('PRIVATE COPY')
      const otherResponse = await handler!({ url:`egg://${other.eggId}/index.html` })
      expect(otherResponse.status).toBe(404)
      expect(fs.readFileSync(path.join(original.dir, 'index.html'), 'utf8')).toBe('REAL SOURCE')
    } finally { await fixture.dispose() }
  })
})
