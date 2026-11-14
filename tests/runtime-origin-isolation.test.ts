import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { registerEgg, registerTestEgg, removeEgg } from '../src/main/eggs'
import { lockdownSession, registerEggProtocol, restrictEggNavigation } from '../src/main/protocol'
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

  it('binds a published session to one egg and keeps it usable after reinstall', async () => {
    const original = source('published-origin'), other = source('other-published')
    let handler: (request: { url: string }) => Promise<Response>
    registerEggProtocol({ protocol: { handle: (_scheme: string, fn: typeof handler) => { handler = fn } } } as any, original)
    const read = (host: string, file = 'index.html') => handler!({ url: `egg://${host}/${file}` })
    expect(await (await read(original.eggId)).text()).toBe('REAL SOURCE')
    expect((await read(other.eggId)).status).toBe(404)
    expect((await read(original.eggId, '..%2foutside.html')).status).toBe(403)
    expect((await read(original.eggId, '%zz')).status).toBe(404)

    fs.symlinkSync(other.dir, path.join(original.dir, 'linked'), 'junction')
    expect((await read(original.eggId, 'linked/index.html')).status).toBe(403)

    removeEgg(original.eggId)
    expect((await read(original.eggId)).status).toBe(404)
    const reinstalled = source(original.eggId)
    fs.writeFileSync(path.join(reinstalled.dir, 'index.html'), 'REINSTALLED')
    expect(await (await read(original.eggId)).text()).toBe('REINSTALLED')
  })

  it('rejects cross-egg requests and top-level navigation outside the egg', () => {
    type Decision = { cancel: boolean }
    let beforeRequest: (details: { url: string }, done: (decision: Decision) => void) => void
    lockdownSession({ webRequest: { onBeforeRequest: (fn: typeof beforeRequest) => { beforeRequest = fn } }, setPermissionRequestHandler() {} } as any, 'own')
    const show = (url: string) => { let cancel; beforeRequest!({ url }, decision => { cancel = decision.cancel }); return cancel }
    expect(show('egg://own/index.html')).toBe(false)
    expect(show('egg://other/index.html')).toBe(true)
    expect(show('https://example.com')).toBe(true)

    let navigate: (event: { url: string; isMainFrame: boolean; preventDefault: () => void }) => void
    restrictEggNavigation({ setWindowOpenHandler() {}, on: (_event: string, fn: typeof navigate) => { navigate = fn } } as any, 'own')
    const blocked = (url: string, isMainFrame = true) => {
      let prevented = false
      navigate!({ url, isMainFrame, preventDefault: () => { prevented = true } })
      return prevented
    }
    expect(blocked('egg://own/details.html')).toBe(false)
    expect(blocked('egg://other/index.html')).toBe(true)
    expect(blocked('about:blank')).toBe(true)
    expect(blocked('about:srcdoc', false)).toBe(false)
  })
})
