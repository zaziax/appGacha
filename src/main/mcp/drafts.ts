import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { WorkspaceTools, resolveWorkspacePath } from '../fcWorkspaceTools'
import { analyzeProject, formatProjectIndex } from '../projectIndex'
import { verificationIdentity } from '../generationEvidence'
import { retainRegressionScenarios } from '../scenarioPolicy'
import type { RuntimeScenario } from '../runtimeScenarios'
import { pruneBuildResources } from '../finalArtifact'
import { uniqueEggFolder } from '../eggFolder'

interface Draft {
  id: string; owner: string; name: string; wish: string; revision: number; updatedAt: string
  state: 'draft' | 'installed'; scenarios: RuntimeScenario[]; eggId?: string
  lastJob?: Pick<Job, 'kind' | 'state' | 'error'>
}
interface Job {
  id: string; owner: string; draftId: string; state: 'running' | 'succeeded' | 'failed' | 'cancelled'
  kind: 'check' | 'install'; result?: unknown; error?: string; controller: AbortController
}
export interface McpDraftDependencies {
  allowed(owner: string): boolean
  busy(): boolean
  check(dir: string, signal: AbortSignal, scenarios: RuntimeScenario[], screenshot: string): Promise<{ ok: boolean; [key: string]: unknown }>
  verify(dir: string, signal: AbortSignal, scenarios: RuntimeScenario[]): Promise<unknown>
  registered(dir: string): void
  installed?(id: string): boolean
  changed(): void
  activity?(active: boolean): void
}
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
export class McpDrafts {
  private drafts = new Map<string, Draft>()
  private jobs = new Map<string, Job>()
  private locks = new Set<string>()
  private verified = new Map<string, string>()
  private previews = new Map<string, string>()
  constructor(private root: string, private template: string, private eggs: string, private deps: McpDraftDependencies) {
    fs.mkdirSync(root, { recursive: true })
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || !UUID.test(entry.name)) continue
      try {
        const saved = JSON.parse(fs.readFileSync(path.join(root, entry.name, 'metadata.json'), 'utf8')) as Draft
        if (saved.id !== entry.name || !UUID.test(saved.owner) || !Number.isInteger(saved.revision) || typeof saved.name !== 'string' || !['draft', 'installed'].includes(saved.state)) continue
        retainRegressionScenarios([], saved.scenarios)
        if (saved.lastJob?.state === 'running') saved.lastJob = { kind: saved.lastJob.kind, state: 'cancelled', error: 'App restarted; draft preserved. Check again before retrying installation.' }
        // Recover an install committed before the draft metadata could be saved.
        if (deps.installed?.(saved.id)) { saved.state = 'installed'; saved.eggId = saved.id }
        this.drafts.set(saved.id, saved)
      } catch { /* Invalid drafts never become trusted inputs. */ }
    }
  }
  list(owner?: string) {
    return [...this.drafts.values()].filter(d => !owner || d.owner === owner).map(d => ({
      id: d.id, name: d.name, owner: d.owner, state: d.state, revision: d.revision, updatedAt: d.updatedAt, eggId: d.eggId, lastJob: d.lastJob,
    }))
  }
  private save(d: Draft) {
    d.updatedAt = new Date().toISOString()
    const file = path.join(this.root, d.id, 'metadata.json')
    fs.writeFileSync(file + '.tmp', JSON.stringify(d), { mode: 0o600 })
    fs.renameSync(file + '.tmp', file)
    this.deps.changed()
  }
  private source(d: Draft) { return path.join(this.root, d.id, 'source') }
  private get(owner: string, id: unknown, writable = false): Draft {
    if (!this.deps.allowed(owner)) throw new Error('Connection disabled or revoked')
    if (typeof id !== 'string' || !UUID.test(id)) throw new Error('Invalid draft ID')
    const d = this.drafts.get(id)
    if (!d || d.owner !== owner) throw new Error('Draft not found for this connection')
    if (d.state === 'installed') throw new Error('Draft already installed; installed code/data is not exposed')
    if (writable && this.locks.has(id)) throw new Error('Draft is locked by a running check or install; poll or cancel its job')
    return d
  }
  guide(topic: string) {
    if (topic === 'overview') return fs.readFileSync(path.join(this.template, 'EGG_GUIDE.md'), 'utf8')
    if (topic === 'api') return fs.readFileSync(path.join(this.template, 'egg.d.ts'), 'utf8')
    if (topic === 'icons') return fs.readFileSync(path.join(this.template, 'icons-manifest.json'), 'utf8')
    if (!/^guides\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(topic)) throw new Error('Unknown guide topic')
    let target = resolveWorkspacePath(this.template, topic + '.md')
    if (!fs.existsSync(target)) target = resolveWorkspacePath(this.template, topic + '/index.md')
    const data = fs.readFileSync(target, 'utf8')
    if (data.length > 100000) throw new Error('Guide too large; choose a narrower topic')
    return data
  }
  create(owner: string, name: string, wish: string) {
    if (!this.deps.allowed(owner)) throw new Error('Connection disabled or revoked')
    if (!name.trim() || name.length > 80 || /[\r\n\x00-\x1f]/.test(name) || wish.length < 2 || wish.length > 12000) throw new Error('Invalid app name or wish')
    const pending = [...this.drafts.values()].filter(d => d.state !== 'installed')
    if (pending.length >= 24 || pending.filter(d => d.owner === owner).length >= 8) throw new Error('Draft quota reached (8 per connection, 24 total); manage drafts in AppGacha')
    const d: Draft = { id: randomUUID(), owner, name, wish, revision: 0, updatedAt: '', state: 'draft', scenarios: [] }
    const dir = this.source(d)
    fs.cpSync(this.template, dir, { recursive: true, errorOnExist: true, force: false })
    for (const file of ['EGG_GUIDE.md', 'egg.d.ts']) fs.rmSync(path.join(dir, file), { force: true })
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'))
    Object.assign(manifest, { eggId: d.id, name, wish, version: '1.0.0', hostApiVersion: '1', createdBy: { model: 'external-agent', pipelineVersion: 'mcp-1' } })
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2))
    this.drafts.set(d.id, d)
    this.save(d)
    return { draft_id: d.id, revision: 0, next: 'Read overview/api guides, then list/read/write source; check_draft before request_install.' }
  }
  files(owner: string, id: unknown) { const d = this.get(owner, id); return formatProjectIndex(analyzeProject(this.source(d))) }
  read(owner: string, id: unknown, file: string, start?: number, end?: number) {
    return new WorkspaceTools(this.source(this.get(owner, id))).read(file, start, end)
  }
  write(owner: string, id: unknown, file: string, content: string, expected: string, oldText?: string) {
    const d = this.get(owner, id, true), dir = this.source(d)
    const target = resolveWorkspacePath(dir, file, true)
    if (!/\.(?:html|css|js|mjs|json|svg)$/i.test(file)) throw new Error('Only HTML/CSS/JS/JSON/SVG source may be written')
    if (['build-report.json', 'icons-manifest.json'].includes(path.relative(dir, target).replace(/\\/g, '/').toLowerCase())) throw new Error('Protected host file')
    const exists = fs.existsSync(target)
    if (expected === 'new' ? exists : !/^[a-f0-9]{64}$/.test(expected) || !exists || createHash('sha256').update(fs.readFileSync(target)).digest('hex') !== expected) throw new Error('Stale file revision: read again (use expected_hash="new" only for a new file)')
    if (oldText !== undefined) {
      const before = fs.readFileSync(target, 'utf8'), at = before.indexOf(oldText)
      if (!oldText || at < 0 || before.indexOf(oldText, at + 1) >= 0) throw new Error('old_text must match exactly once')
      content = before.slice(0, at) + content + before.slice(at + oldText.length)
    }
    if (path.relative(dir, target).replace(/\\/g, '/').toLowerCase() === 'manifest.json') {
      const proposed = JSON.parse(content), prior = JSON.parse(fs.readFileSync(target, 'utf8'))
      if (!proposed || Array.isArray(proposed) || typeof proposed !== 'object') throw new Error('Invalid manifest')
      for (const key of Object.keys(proposed)) if (!['name', 'permissions', 'window'].includes(key) && JSON.stringify(proposed[key]) !== JSON.stringify(prior[key])) throw new Error('Only manifest name/permissions/window are editable')
      if (typeof proposed.name !== 'string' || !proposed.name.trim() || proposed.name.length > 80 || /[\r\n\x00-\x1f]/.test(proposed.name)) throw new Error('Invalid manifest name')
      content = JSON.stringify({ ...prior, name: proposed.name, permissions: proposed.permissions, window: proposed.window }, null, 2)
    }
    // Bound authored content independently of the trusted template/vendor payload.
    const files = analyzeProject(dir).files.filter(f => !f.startsWith('vendor/') && !['base.css', 'icons.svg', 'widget.css', 'widget.js', 'icons-manifest.json'].includes(f))
    const bytes = files.reduce((n, f) => n + (path.resolve(dir, f) === target ? 0 : fs.statSync(resolveWorkspacePath(dir, f)).size), 0) + Buffer.byteLength(content)
    if (bytes > 5 * 1024 * 1024 || files.length + (exists ? 0 : 1) > 128) throw new Error('Draft source quota exceeded (5MB / 128 files)')
    const result = new WorkspaceTools(dir).write(file, content, exists ? expected : undefined)
    d.name = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')).name
    d.revision++
    this.verified.delete(d.id); this.previews.delete(d.id)
    this.save(d)
    return { revision: d.revision, result }
  }
  private start(owner: string, d: Draft, kind: Job['kind'], run: (job: Job) => Promise<unknown>) {
    if (this.deps.busy() || [...this.jobs.values()].some(j => j.state === 'running')) throw new Error('Another build/check is active; retry after it completes')
    for (const [id, j] of this.jobs) if (this.jobs.size >= 100 && j.state !== 'running') this.jobs.delete(id)
    const job: Job = { id: randomUUID(), owner, draftId: d.id, state: 'running', kind, controller: new AbortController() }
    this.jobs.set(job.id, job); this.locks.add(d.id)
    this.deps.activity?.(true)
    this.recordJob(d, job)
    // Start after returning the job id. RPC disconnects do not silently lose work.
    void Promise.resolve().then(() => run(job)).then(result => {
      job.result = result; job.state = 'succeeded'
    }).catch(error => {
      job.state = job.controller.signal.aborted ? 'cancelled' : 'failed'
      job.error = String(error instanceof Error ? error.message : error).split(this.root).join('[drafts]').split(this.template).join('[template]').split(this.eggs).join('[shelf]').slice(0, 6000)
    }).finally(() => { this.locks.delete(d.id); this.deps.activity?.(this.active); this.recordJob(d, job) })
    return { job_id: job.id, state: job.state }
  }
  private recordJob(d: Draft, job: Job) {
    d.lastJob = { kind: job.kind, state: job.state, error: job.error }
    // Status persistence/notification must not turn an already committed install into a failure.
    try { this.save(d) } catch { /* Live status remains available via list_drafts/get_job. */ }
  }
  check(owner: string, id: unknown, proposed?: RuntimeScenario[]) {
    const d = this.get(owner, id, true)
    const next = proposed === undefined ? d.scenarios : retainRegressionScenarios(d.scenarios, proposed)
    return this.start(owner, d, 'check', async job => {
      this.assertJob(job)
      d.scenarios = next; this.save(d); this.verified.delete(d.id); this.previews.delete(d.id)
      const dir = this.source(d), identity = verificationIdentity(dir, d.scenarios)
      if (!identity) throw new Error('Unable to fingerprint draft')
      const screenshot = path.join(this.root, d.id, 'preview.png')
      fs.rmSync(screenshot, { force: true })
      const result = await this.deps.check(dir, job.controller.signal, d.scenarios, screenshot)
      this.assertJob(job)
      if (identity !== verificationIdentity(dir, d.scenarios)) throw new Error('Draft changed during verification; check again')
      if (fs.existsSync(screenshot)) this.previews.set(d.id, identity)
      if (result.ok) this.verified.set(d.id, identity)
      return { ...result, revision: d.revision, external_services: 'mocked/not-verified', level: d.scenarios.length ? 'scenarios' : 'startup' }
    })
  }
  preview(owner: string, id: unknown) {
    const d = this.get(owner, id)
    if (!this.previews.has(d.id) || this.previews.get(d.id) !== verificationIdentity(this.source(d), d.scenarios)) throw new Error('No current preview; run check_draft first')
    const file = path.join(this.root, d.id, 'preview.png')
    if (fs.statSync(file).size > 5 * 1024 * 1024) throw new Error('Preview too large')
    return { png: fs.readFileSync(file).toString('base64') }
  }
  install(owner: string, id: unknown) {
    const d = this.get(owner, id, true), identity = verificationIdentity(this.source(d), d.scenarios)
    if (!identity || this.verified.get(d.id) !== identity) throw new Error('Run a successful check on the current revision before installation')
    return this.start(owner, d, 'install', async job => {
      this.assertJob(job)
      const source = this.source(d)
      fs.mkdirSync(this.eggs, { recursive: true })
      // Stage on the destination volume. Drafts and shelf may live on different
      // drives/mounts; only copying may cross that boundary, never rename.
      // No .gacha suffix: interrupted candidates cannot be discovered as apps.
      const candidate = fs.mkdtempSync(path.join(this.eggs, '.mcp-install-'))
      try {
        fs.cpSync(source, candidate, { recursive: true })
        pruneBuildResources(candidate)
        const candidateIdentity = verificationIdentity(candidate, d.scenarios)
        if (!candidateIdentity) throw new Error('Unable to fingerprint installation candidate')
        const verification = await this.deps.verify(candidate, job.controller.signal, d.scenarios)
        this.assertJob(job)
        const manifest = JSON.parse(fs.readFileSync(path.join(candidate, 'manifest.json'), 'utf8'))
        if (identity !== verificationIdentity(source, d.scenarios) || candidateIdentity !== verificationIdentity(candidate, d.scenarios)) throw new Error('Code changed after verification; installation refused')
        const dest = uniqueEggFolder(this.eggs, manifest.name)
        // Windows can briefly retain file handles after the isolated test exits.
        for (let attempt = 0; ; attempt++) {
          this.assertJob(job)
          if (fs.existsSync(dest)) throw new Error('Installation destination already exists; retry installation')
          try { fs.renameSync(candidate, dest); break } catch (error) {
            if (attempt >= 3 || !['EBUSY', 'EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
            await delay(150 * (attempt + 1), undefined, { signal: job.controller.signal })
            if (identity !== verificationIdentity(source, d.scenarios) || candidateIdentity !== verificationIdentity(candidate, d.scenarios)) throw new Error('Code changed during installation; check again')
          }
        }
        try { this.deps.registered(dest) } catch (error) { fs.renameSync(dest, candidate); throw error }
        // Commit is synchronous. Cancellation after this point cannot roll it back.
        d.state = 'installed'; d.eggId = d.id
        this.verified.delete(d.id); this.previews.delete(d.id)
        let warning: string | undefined
        try { this.save(d) } catch { warning = 'App installed, but draft metadata could not be saved; do not retry installation' }
        return { installed: true, egg_id: d.id, name: d.name, verification, warning }
      } finally {
        // Only this invocation's host-created directory; preserve source on any failure.
        // Cleanup errors must not hide the actual install error or committed success.
        try { fs.rmSync(candidate, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }) } catch { /* Non-.gacha staging directory is ignored by shelf discovery. */ }
      }
    })
  }
  private assertJob(job: Job) {
    job.controller.signal.throwIfAborted()
    if (!this.deps.allowed(job.owner)) throw new Error('Connection revoked or MCP disabled')
  }
  job(owner: string, id: string) {
    const job = this.jobs.get(id)
    if (!this.deps.allowed(owner) || !job || job.owner !== owner) throw new Error('Job not found for this connection (jobs expire on restart; drafts remain)')
    const { controller: _controller, owner: _owner, ...result } = job
    return result
  }
  async waitJob(owner: string, id: string, waitMs = 0) {
    if (!Number.isSafeInteger(waitMs) || waitMs < 0 || waitMs > 10000) throw new Error('wait_ms must be between 0 and 10000')
    const deadline = Date.now() + waitMs
    let result = this.job(owner, id)
    while (result.state === 'running' && Date.now() < deadline) {
      await delay(Math.min(100, deadline - Date.now()))
      result = this.job(owner, id)
    }
    return result
  }
  cancel(owner: string, id: string) {
    this.job(owner, id)
    const job = this.jobs.get(id)!
    if (job.state === 'running') job.controller.abort(new Error('Cancelled'))
    return this.job(owner, id)
  }
  stop(owner?: string) { for (const job of this.jobs.values()) if ((!owner || job.owner === owner) && job.state === 'running') job.controller.abort(new Error('MCP connection stopped')) }
  get active() { return this.locks.size > 0 }
  /** Shelf-only cleanup; no MCP delete tool. Installed capsules are never removed here. */
  discard(id: string) {
    const d = this.drafts.get(id)
    if (!d || !UUID.test(id) || this.locks.has(id)) throw new Error('Draft missing or busy')
    const target = path.resolve(this.root, id)
    if (path.dirname(target) !== path.resolve(this.root)) throw new Error('Invalid cleanup target')
    fs.rmSync(target, { recursive: true, force: true })
    this.drafts.delete(id); this.verified.delete(id); this.previews.delete(id); this.deps.changed()
  }
}
