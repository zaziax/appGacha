import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { McpAuth } from '../src/main/mcp/auth'
import { McpDrafts, type McpDraftDependencies } from '../src/main/mcp/drafts'
import { McpBridge } from '../src/main/mcp/bridge'
import { retainRegressionScenarios } from '../src/main/scenarioPolicy'
import type { RuntimeScenario } from '../src/main/runtimeScenarios'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { build } from 'esbuild'
import { request } from 'node:http'
vi.mock('../src/main/finalArtifact', () => ({ pruneBuildResources: () => {} }))

let root: string, auth: McpAuth, drafts: McpDrafts, bridge: McpBridge, owner: string, token: string, deps: McpDraftDependencies
const scenario: RuntimeScenario = { name: 'Count changes', steps: [{ action: 'click', selector: '#add' }, { action: 'assert', selector: '#count', property: 'text', equals: '1' }] }
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'appgacha-mcp-test-'))
  const template = path.join(root, 'template')
  fs.mkdirSync(template)
  fs.writeFileSync(path.join(template, 'manifest.json'), JSON.stringify({ eggId: '__PLACEHOLDER__', name: 'Untitled', permissions: [], hostApiVersion: '1' }))
  fs.writeFileSync(path.join(template, 'index.html'), '<button id="add">Add</button><p id="count">0</p>')
  fs.writeFileSync(path.join(template, 'app.js'), 'export const initial = 0;')
  fs.writeFileSync(path.join(template, 'base.css'), 'body{}')
  fs.writeFileSync(path.join(template, 'EGG_GUIDE.md'), 'Capsule guide')
  fs.writeFileSync(path.join(template, 'egg.d.ts'), 'declare const egg: unknown')
  auth = new McpAuth(path.join(root, 'auth.json')); auth.setEnabled(true)
  const connection = auth.create('Test agent'); owner = connection.id; token = connection.token
  deps = {
    allowed: id => auth.has(id), busy: () => false, changed: vi.fn(),
    check: vi.fn(async (_dir, _signal, _scenarios, screenshot) => { fs.writeFileSync(screenshot, 'png-fixture'); return { ok: true } }),
    verify: vi.fn(async () => ({ level: 'startup' })), registered: vi.fn(),
  }
  drafts = new McpDrafts(path.join(root, 'drafts'), template, path.join(root, 'eggs'), deps)
  bridge = new McpBridge(auth, drafts, path.join(root, 'endpoint.json'))
})
afterEach(() => {
  bridge.stop()
  const resolved = path.resolve(root)
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('appgacha-mcp-test-')) throw new Error('Unsafe test cleanup')
  fs.rmSync(resolved, { recursive: true, force: true })
})
const create = () => drafts.create(owner, 'Counter', 'Create a working counter').draft_id
const sha = (s: string) => createHash('sha256').update(s).digest('hex')
async function done(id: string) {
  for (let i = 0; i < 100; i++) {
    const job = drafts.job(owner, id)
    if (job.state !== 'running') return job
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw new Error('Job did not finish')
}
describe('MCP authorization', () => {
  it('defaults off, stores only token hashes, persists and revokes credentials', () => {
    const empty = new McpAuth(path.join(root, 'missing.json'))
    expect(empty.enabled).toBe(false)
    expect(() => empty.create('x')).toThrow('Enable')
    expect(fs.readFileSync(path.join(root, 'auth.json'), 'utf8')).not.toContain(token)
    expect(auth.authenticate(token)).toBe(owner)
    const reload = new McpAuth(path.join(root, 'auth.json'))
    expect(reload.authenticate(token)).toBe(owner)
    reload.revoke(owner); expect(reload.authenticate(token)).toBeUndefined()
    auth.setEnabled(false); expect(auth.authenticate(token)).toBeUndefined()
  })
  it('fails closed on corrupted configuration', () => {
    fs.writeFileSync(path.join(root, 'bad.json'), '{"enabled":true,"connections":[{}]}')
    expect(new McpAuth(path.join(root, 'bad.json')).enabled).toBe(false)
  })
})
describe('MCP drafts', () => {
  it('isolates connection ownership and denies installed/user paths', () => {
    const id = create(), other = auth.create('Other').id
    expect(drafts.list(other)).toEqual([])
    expect(() => drafts.read(other, id, 'app.js')).toThrow('not found')
    for (const file of ['../auth.json', 'data/db.json', 'C:/secret', 'vendor/../app.js']) expect(() => drafts.read(owner, id, file)).toThrow()
    expect(() => drafts.write(owner, id, 'base.css', 'x', sha('body{}'))).toThrow('Protected')
  })
  it('requires hashes, rejects traversal/host metadata, and invalidates verified revisions', async () => {
    const id = create()
    expect(() => drafts.write(owner, id, 'app.js', 'x', 'new')).toThrow('Stale')
    drafts.write(owner, id, 'app.js', 'export const next = 1;', sha('export const initial = 0;'))
    expect(() => drafts.write(owner, id, 'app.js', 'x', sha('export const initial = 0;'))).toThrow('Stale')
    const manifest = fs.readFileSync(path.join(root, 'drafts', id, 'source/manifest.json'), 'utf8')
    expect(() => drafts.write(owner, id, 'manifest.json', JSON.stringify({ ...JSON.parse(manifest), eggId: 'attacker' }), sha(manifest))).toThrow('Only manifest')
    const job = drafts.check(owner, id); expect((await done(job.job_id)).state).toBe('succeeded')
    expect(drafts.preview(owner, id).png).toBeTruthy()
    drafts.write(owner, id, 'new.js', 'export const x = 1;', 'new')
    expect(() => drafts.preview(owner, id)).toThrow('No current preview')
    expect(() => drafts.install(owner, id)).toThrow('successful check')
  })
  it('does not allow deletion/weakening of scenarios even with a rationale', () => {
    const id = create()
    expect(() => retainRegressionScenarios([scenario], [])).toThrow('Cannot remove')
    expect(() => retainRegressionScenarios([scenario], [{ ...scenario, steps: [{ action: 'assert', selector: '#count', property: 'text', equals: '0' }] }])).toThrow('Cannot weaken')
    expect(retainRegressionScenarios([scenario], [{ ...scenario, steps: [...scenario.steps, { action: 'wait', ms: 10 }] }])).toHaveLength(1)
    expect(id).toBeTruthy()
  })
  it('locks pending jobs; cancellation preserves drafts', async () => {
    const id = create()
    deps.check = vi.fn(async (_dir, signal) => new Promise<{ ok: boolean }>(resolve => signal.addEventListener('abort', () => resolve({ ok: false }), { once: true })))
    const job = drafts.check(owner, id)
    await Promise.resolve()
    expect(() => drafts.write(owner, id, 'new.js', 'x', 'new')).toThrow('locked')
    drafts.cancel(owner, job.job_id)
    expect((await done(job.job_id)).state).toBe('cancelled')
    expect(drafts.list(owner)).toHaveLength(1)
  })
  it('installs directly after verification without exposing installed data', async () => {
    const id = create()
    expect(() => drafts.install(owner, id)).toThrow('successful check')
    await done(drafts.check(owner, id).job_id)
    expect((await done(drafts.install(owner, id).job_id)).state).toBe('succeeded')
    expect(deps.verify).toHaveBeenCalledOnce()
    expect(deps.registered).toHaveBeenCalledOnce()
    expect(path.dirname(vi.mocked(deps.verify).mock.calls[0][0])).toBe(path.join(root, 'eggs'))
    expect(drafts.list(owner)[0]).toMatchObject({ state: 'installed', lastJob: { kind: 'install', state: 'succeeded' } })
    expect(() => drafts.read(owner, id, 'app.js')).toThrow('already installed')
    drafts.discard(id)
    expect(fs.existsSync(path.join(root, 'eggs', 'Counter.gacha', 'app.js'))).toBe(true)
  })
  it('rejects candidate code changed during final verification', async () => {
    const id = create()
    await done(drafts.check(owner, id).job_id)
    deps.verify = vi.fn(async dir => { fs.writeFileSync(path.join(dir, 'app.js'), 'changed'); return { level: 'startup' } })
    expect((await done(drafts.install(owner, id).job_id)).error).toContain('Code changed')
    expect(deps.registered).not.toHaveBeenCalled()
  })
  it('revocation aborts a pending installation', async () => {
    const id = create()
    await done(drafts.check(owner, id).job_id)
    deps.verify = vi.fn(async () => { auth.revoke(owner); drafts.stop(owner); return { level: 'startup' } })
    drafts.install(owner, id)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(deps.registered).not.toHaveBeenCalled()
    expect(fs.existsSync(path.join(root, 'drafts', id, 'source/app.js'))).toBe(true)
  })
  it('resumes drafts after restart but requires fresh verification', async () => {
    const id = create()
    await done(drafts.check(owner, id).job_id)
    const reload = new McpDrafts(path.join(root, 'drafts'), path.join(root, 'template'), path.join(root, 'eggs'), deps)
    expect(reload.list(owner)[0].id).toBe(id)
    expect(() => reload.install(owner, id)).toThrow('successful check')
  })
  it('preserves drafts and a visible failure on copy failure, then allows retry', async () => {
    const id = create()
    await done(drafts.check(owner, id).job_id)
    const copy = vi.spyOn(fs, 'cpSync').mockImplementationOnce(() => { throw Object.assign(new Error('Disk full'), { code: 'ENOSPC' }) })
    try {
      expect((await done(drafts.install(owner, id).job_id)).error).toContain('Disk full')
      expect(drafts.list(owner)[0]).toMatchObject({ state: 'draft', lastJob: { kind: 'install', state: 'failed', error: 'Disk full' } })
      expect(fs.readdirSync(path.join(root, 'eggs'))).toEqual([])
      expect(fs.existsSync(path.join(root, 'drafts', id, 'source/app.js'))).toBe(true)
      const reload = new McpDrafts(path.join(root, 'drafts'), path.join(root, 'template'), path.join(root, 'eggs'), deps)
      expect(reload.list(owner)[0].lastJob?.error).toBe('Disk full')
      expect((await done(drafts.install(owner, id).job_id)).state).toBe('succeeded')
    } finally { copy.mockRestore() }
  })
  it('rolls back registration failure without leaving a discoverable capsule', async () => {
    const id = create()
    await done(drafts.check(owner, id).job_id)
    deps.registered = vi.fn(() => { throw new Error('Registry rejected') })
    expect((await done(drafts.install(owner, id).job_id)).error).toBe('Registry rejected')
    expect(fs.readdirSync(path.join(root, 'eggs'))).toEqual([])
    expect(drafts.list(owner)[0].state).toBe('draft')
  })
  it('keeps existing same-name apps and retries transient Windows rename errors', async () => {
    const id = create()
    await done(drafts.check(owner, id).job_id)
    fs.mkdirSync(path.join(root, 'eggs/Counter.gacha'), { recursive: true })
    fs.writeFileSync(path.join(root, 'eggs/Counter.gacha/existing.txt'), 'untouched')
    const original = fs.renameSync
    let attempts = 0
    const rename = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (path.basename(String(from)).startsWith('.mcp-install-') && attempts++ === 0) throw Object.assign(new Error('Handle busy'), { code: 'EPERM' })
      return original(from, to)
    })
    try {
      expect((await done(drafts.install(owner, id).job_id)).state).toBe('succeeded')
      expect(attempts).toBe(2)
      expect(fs.readFileSync(path.join(root, 'eggs/Counter.gacha/existing.txt'), 'utf8')).toBe('untouched')
      expect(fs.existsSync(path.join(root, 'eggs/Counter-2.gacha/app.js'))).toBe(true)
    } finally { rename.mockRestore() }
  })
  it('waits for a job without rapid polling and bounds the wait duration', async () => {
    const id = create()
    deps.check = vi.fn(async () => { await new Promise(resolve => setTimeout(resolve, 30)); return { ok: true } })
    const job = drafts.check(owner, id)
    expect((await drafts.waitJob(owner, job.job_id, 0)).state).toBe('running')
    expect((await drafts.waitJob(owner, job.job_id, 1000)).state).toBe('succeeded')
    await expect(drafts.waitJob(owner, job.job_id, 10001)).rejects.toThrow('wait_ms')
  })
})
describe('native-only bridge and actual MCP protocol', () => {
  async function endpoint() { await bridge.start(); return `http://127.0.0.1:${JSON.parse(fs.readFileSync(path.join(root, 'endpoint.json'), 'utf8')).port}/tool` }
  it('rejects missing authorization, browser origins, forged hosts and invalid tool parameters', async () => {
    const url = await endpoint(), body = JSON.stringify({ name: 'list_drafts', arguments: {} })
    expect((await fetch(url, { method: 'POST', body })).status).toBe(401)
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    expect((await fetch(url, { method: 'POST', headers: { ...headers, Origin: 'https://evil.test' }, body })).status).toBe(403)
    const forgedHostStatus = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(url, { method: 'POST', headers: { ...headers, Host: 'evil.test' } }, res => { res.resume(); resolve(res.statusCode) })
      req.on('error', reject); req.end(body)
    })
    expect(forgedHostStatus).toBe(403)
    expect((await fetch(url, { method: 'POST', headers, body: JSON.stringify({ name: 'read_file', arguments: { draft_id: create(), path: 'app.js', start_line: '1' } }) })).status).toBe(400)
    expect((await fetch(url, { method: 'POST', headers, body })).status).toBe(200)
  })
  it('supports SDK initialize, tools, resources and revocation over a real stdio child', async () => {
    await endpoint()
    const entry = path.join(root, 'connector.cjs')
    await build({ entryPoints: [path.resolve('src/mcp/stdio.ts')], bundle: true, platform: 'node', outfile: entry, logLevel: 'silent' })
    const transport = new StdioClientTransport({ command: process.execPath, args: [entry], env: { APPGACHA_MCP_ENDPOINT_FILE: path.join(root, 'endpoint.json'), APPGACHA_MCP_TOKEN: token }, stderr: 'pipe' })
    const client = new Client({ name: 'appgacha-test', version: '1' })
    try {
      await client.connect(transport)
      expect((await client.listTools()).tools.some(t => t.name === 'request_install')).toBe(true)
      expect((await client.readResource({ uri: 'appgacha://docs/overview' })).contents[0]).toMatchObject({ text: 'Capsule guide' })
      const created = await client.callTool({ name: 'create_draft', arguments: { name: 'SDK app', wish: 'Create an app' } })
      expect(created.isError).not.toBe(true)
      expect(created.structuredContent).toHaveProperty('draft_id')
      expect(drafts.list(owner)[0].name).toBe('SDK app')
      const draft_id = drafts.list(owner)[0].id
      const check = await client.callTool({ name: 'check_draft', arguments: { draft_id } })
      const job_id = (check.structuredContent as { job_id: string }).job_id
      const waited = await client.callTool({ name: 'get_job', arguments: { job_id, wait_ms: 1000 } })
      expect(waited.structuredContent).toMatchObject({ state: 'succeeded', result: { ok: true } })
      expect((await client.callTool({ name: 'get_job', arguments: { job_id, wait_ms: 10001 } })).isError).toBe(true)
      auth.revoke(owner)
      expect((await client.callTool({ name: 'list_drafts', arguments: {} })).isError).toBe(true)
    } finally { await client.close() }
  }, 20000)
})
