import { createServer, type Server } from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { MCP_TOOLS } from '../../shared/mcp'
import type { RuntimeScenario } from '../runtimeScenarios'
import type { McpAuth } from './auth'
import type { McpDrafts } from './drafts'

/** Private authenticated loopback bridge, NOT a public MCP HTTP endpoint. */
export class McpBridge {
  private server?: Server
  private limits = new Map<string, { at: number; count: number }>()
  constructor(private auth: McpAuth, private drafts: McpDrafts, private endpointFile: string) {}
  get running() { return !!this.server?.listening }
  async start() {
    if (this.running) return
    const server = createServer(async (req, res) => {
      res.setHeader('Cache-Control', 'no-store')
      const reply = (status: number, body: unknown) => { if (!res.headersSent && !res.destroyed) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)) } }
      const address = server.address()
      if (typeof address !== 'object' || !address || req.headers.host !== `127.0.0.1:${address.port}` || req.headers.origin !== undefined) { reply(403, { error: 'Local native clients only' }); return }
      if (req.method !== 'POST' || req.url !== '/tool') { reply(404, { error: 'Not found' }); return }
      const token = req.headers.authorization?.replace(/^Bearer /, '') ?? ''
      const owner = this.auth.authenticate(token)
      if (!owner) { reply(401, { error: 'MCP disabled or connection revoked. Create a new connection in AppGacha Settings.' }); return }
      const now = Date.now(), recent = this.limits.get(owner)
      const bucket = recent && now - recent.at < 60000 ? recent : { at: now, count: 0 }
      this.limits.set(owner, bucket)
      if (++bucket.count > 120) { reply(429, { error: 'MCP rate limit: 120 calls/minute per connection' }); return }
      if (!req.headers['content-type']?.startsWith('application/json')) { reply(415, { error: 'JSON required' }); return }
      try {
        let bytes = 0
        const chunks: Buffer[] = []
        for await (const chunk of req) {
          bytes += chunk.length
          if (bytes > 2 * 1024 * 1024) { reply(413, { error: 'Request exceeds 2MB' }); return }
          chunks.push(Buffer.from(chunk))
        }
        if (!this.auth.has(owner)) { reply(401, { error: 'Connection revoked' }); return }
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        reply(200, { result: await this.dispatch(owner, payload?.name, payload?.arguments ?? {}) })
      } catch (error) {
        // Never return raw filesystem/stack errors containing machine paths.
        const e = error as Error & { code?: string }
        reply(400, { error: e.code ? `File operation failed (${e.code}); check the relative source path` : String(e.message).slice(0, 2000) })
      }
    })
    server.requestTimeout = 10000; server.headersTimeout = 10000; server.maxConnections = 16
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve() }) })
    // Keep runtime errors from terminating the app; no request data is logged.
    server.on('error', () => {})
    const address = server.address()
    if (!address || typeof address === 'string') { server.close(); throw new Error('Could not start MCP bridge') }
    try {
      fs.mkdirSync(path.dirname(this.endpointFile), { recursive: true })
      fs.writeFileSync(this.endpointFile, JSON.stringify({ port: address.port, pid: process.pid }), { mode: 0o600 })
      this.server = server
    } catch (e) { server.close(); throw e }
  }
  stop() {
    this.drafts.stop()
    this.server?.closeAllConnections(); this.server?.close(); this.server = undefined
    this.limits.clear()
    try { fs.unlinkSync(this.endpointFile) } catch { /* already absent */ }
  }
  private dispatch(owner: string, name: unknown, args: unknown): unknown {
    const definition = MCP_TOOLS.find(t => t.name === name)
    if (!definition || !args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Invalid tool or arguments')
    const a = args as Record<string, unknown>, props = definition.inputSchema.properties
    if (Object.keys(a).some(k => !Object.hasOwn(props, k)) || definition.inputSchema.required.some(k => a[k] === undefined)) throw new Error('Invalid tool argument fields')
    for (const [key, value] of Object.entries(a)) {
      const { type, minimum, maximum } = props[key] as { type: string; minimum?: number; maximum?: number }
      if (type === 'string' && typeof value !== 'string' || type === 'integer' && (!Number.isSafeInteger(value) || Number(value) < (minimum ?? 1) || maximum !== undefined && Number(value) > maximum) || type === 'array' && !Array.isArray(value)) throw new Error('Invalid argument type: ' + key)
    }
    const str = (key: string, max = 12000) => { const value = a[key]; if (typeof value !== 'string' || value.length > max) throw new Error('Invalid ' + key); return value }
    switch (name) {
      case 'get_guide': return { text: this.drafts.guide(a.topic === undefined ? 'overview' : str('topic', 160)) }
      case 'create_draft': return this.drafts.create(owner, str('name', 80), str('wish'))
      case 'list_drafts': return this.drafts.list(owner)
      case 'list_files': return { text: this.drafts.files(owner, str('draft_id', 36)) }
      case 'read_file': return { text: this.drafts.read(owner, a.draft_id, str('path', 240), a.start_line as number | undefined, a.end_line as number | undefined) }
      case 'write_file': return this.drafts.write(owner, a.draft_id, str('path', 240), str('content', 512000), str('expected_hash', 64))
      case 'edit_file': return this.drafts.write(owner, a.draft_id, str('path', 240), str('new_text', 512000), str('expected_hash', 64), str('old_text', 512000))
      case 'check_draft': return this.drafts.check(owner, a.draft_id, a.scenarios as RuntimeScenario[] | undefined)
      case 'get_job': return this.drafts.waitJob(owner, str('job_id', 36), a.wait_ms as number | undefined)
      case 'cancel_job': return this.drafts.cancel(owner, str('job_id', 36))
      case 'get_preview': return this.drafts.preview(owner, a.draft_id)
      case 'request_install': return this.drafts.install(owner, a.draft_id)
      default: throw new Error('Unknown tool')
    }
  }
}
