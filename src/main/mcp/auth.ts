import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'

interface Connection { id: string; name: string; hash: string; createdAt: string }
interface Config { enabled: boolean; connections: Connection[] }
export class McpAuth {
  private config: Config = { enabled: false, connections: [] }
  constructor(private file: string) {
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8')) as Config
      if (typeof saved.enabled !== 'boolean' || !Array.isArray(saved.connections) || saved.connections.length > 8 ||
        saved.connections.some(c => !/^[a-f0-9]{64}$/.test(c.hash) || typeof c.id !== 'string' || typeof c.name !== 'string')) throw new Error('Invalid config')
      this.config = saved
    } catch { /* Missing/corrupt authorization is disabled, never auto-approved. */ }
  }
  get enabled() { return this.config.enabled }
  list() { return this.config.connections.map(({ hash: _hash, ...publicInfo }) => publicInfo) }
  has(id: string) { return this.enabled && this.config.connections.some(c => c.id === id) }
  setEnabled(enabled: boolean) { this.config.enabled = enabled; this.save() }
  create(name: string) {
    if (!this.enabled) throw new Error('Enable MCP first')
    if (typeof name !== 'string' || !name.trim() || name.length > 80) throw new Error('Connection name must be 1–80 characters')
    if (this.config.connections.length >= 8) throw new Error('At most 8 connections; revoke an old connection first')
    const token = randomBytes(32).toString('hex'), id = randomUUID()
    this.config.connections.push({ id, name: name.trim(), hash: this.digest(token).toString('hex'), createdAt: new Date().toISOString() })
    this.save()
    return { id, token }
  }
  revoke(id: string) { this.config.connections = this.config.connections.filter(c => c.id !== id); this.save() }
  authenticate(token: string): string | undefined {
    if (!this.enabled || !/^[a-f0-9]{64}$/.test(token)) return
    const digest = this.digest(token)
    return this.config.connections.find(c => timingSafeEqual(Buffer.from(c.hash, 'hex'), digest))?.id
  }
  private digest(token: string) { return createHash('sha256').update(token).digest() }
  private save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.config), { mode: 0o600 })
    fs.renameSync(this.file + '.tmp', this.file)
  }
}
