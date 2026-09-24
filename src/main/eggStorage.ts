import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { EggStorageStatus } from '../shared/eggStorage'

interface StorageConfig {
  directory?: string
  pending?: { directory: string; copyExisting: boolean }
  recoveryRequired?: boolean
}

function contains(parent: string, child: string): boolean {
  const relative = path.relative(parent, child)
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
}

function canonical(dir: string): string {
  if (!path.isAbsolute(dir)) throw new Error('Storage directory must be an absolute path')
  if (fs.existsSync(dir)) return fs.realpathSync(dir)
  const parent = path.dirname(dir)
  if (parent === dir) return path.resolve(dir)
  return path.join(canonical(parent), path.basename(dir))
}

/** Cold-start library switch. The live path is immutable until restart so open
 * windows, SQLite connections, sync jobs and MCP hosts agree on one directory. */
export class EggStorage {
  private config: StorageConfig = {}
  private error?: string
  private available = true
  private initialized = false
  private invalidConfig = false
  private configBackup?: string
  private readonly initialDirectory: string
  private activeDirectory: string
  constructor(private configFile: string, readonly defaultDirectory: string, private protectedDirectories: string[] = []) {
    try {
      const value = JSON.parse(fs.readFileSync(configFile, 'utf8')) as StorageConfig
      if (!value || typeof value !== 'object' || Array.isArray(value)
        || value.directory !== undefined && (typeof value.directory !== 'string' || !path.isAbsolute(value.directory))
        || value.recoveryRequired !== undefined && typeof value.recoveryRequired !== 'boolean'
        || value.pending !== undefined && (!value.pending || typeof value.pending.directory !== 'string' || !path.isAbsolute(value.pending.directory) || typeof value.pending.copyExisting !== 'boolean')) {
        throw new Error('Invalid egg-storage.json; restore its configuration before starting AppGacha')
      }
      this.config = value
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.invalidConfig = true
        this.config = { recoveryRequired: true }
        this.markUnavailable(`Cannot read egg-storage.json: ${(error as Error).message}`)
      }
    }
    if (this.config.recoveryRequired && !this.error) this.markUnavailable('Storage recovery is pending; select a library in Settings and restart')
    this.initialDirectory = path.resolve(this.config.directory ?? defaultDirectory)
    this.activeDirectory = this.initialDirectory
  }
  get directory() { return this.activeDirectory }
  markUnavailable(reason: string): void {
    this.available = false
    this.error = `Egg directory unavailable. ${reason}. Open Settings to select a directory, then fully quit and restart. No default library has been substituted.`
  }
  assertAvailable(): void {
    if (!this.available) throw new Error(this.error)
    try {
      if (!this.initialized && !fs.existsSync(this.directory) && this.directory === path.resolve(this.defaultDirectory)) return
      if (!fs.statSync(this.directory).isDirectory()) throw new Error('Configured path is not a directory')
    } catch (error) {
      this.markUnavailable((error as Error).message)
      throw new Error(this.error)
    }
  }
  status(): EggStorageStatus {
    return { directory: this.directory, defaultDirectory: this.defaultDirectory, pending: this.config.pending, error: this.error, available: this.available, configBackup: this.configBackup }
  }
  private persist(next: StorageConfig) {
    fs.mkdirSync(path.dirname(this.configFile), { recursive: true })
    if (this.invalidConfig) {
      const backup = `${this.configFile}.recovery-${randomUUID()}.bak`
      fs.copyFileSync(this.configFile, backup, fs.constants.COPYFILE_EXCL)
      this.configBackup = backup
      this.invalidConfig = false
    }
    fs.writeFileSync(this.configFile + '.tmp', JSON.stringify(next, null, 2), { mode: 0o600 })
    fs.renameSync(this.configFile + '.tmp', this.configFile)
    this.config = next
  }
  private validateTarget(target: string, copyExisting: boolean): string {
    if (copyExisting && !this.available) throw new Error('The original library is unavailable; turn off copying and select an existing library')
    const dir = canonical(target)
    let current: string | undefined
    try { if (!this.config.recoveryRequired) current = canonical(this.directory) }
    catch (error) { if (this.available) throw error }
    if (dir === path.parse(dir).root) throw new Error('Choose a dedicated folder, not a drive or volume root')
    if (!fs.statSync(dir).isDirectory()) throw new Error('Choose a directory')
    if (current && dir !== current && (contains(current, dir) || contains(dir, current))) throw new Error('The new and current egg directories must not contain one another')
    for (const protectedDir of this.protectedDirectories) {
      const reserved = canonical(protectedDir)
      if (dir !== canonical(this.defaultDirectory) && (contains(reserved, dir) || contains(dir, reserved))) throw new Error('Choose a folder outside AppGacha program and internal data directories')
    }
    if (copyExisting && dir !== current && fs.readdirSync(dir).length) throw new Error('Copying requires an empty target folder. Choose a new folder, or turn off copying to use an existing library')
    // Probe actual write access (ACLs/read-only volumes may not match mode bits).
    const probe = fs.mkdtempSync(path.join(dir, '.appgacha-write-test-'))
    fs.rmdirSync(probe)
    return dir
  }
  schedule(target: string, copyExisting: boolean): EggStorageStatus {
    const directory = this.validateTarget(target, copyExisting)
    if (this.available && directory === canonical(this.directory)) return this.cancel()
    this.persist({ ...this.config, pending: { directory, copyExisting } })
    if (this.available) this.error = undefined
    return this.status()
  }
  cancel(): EggStorageStatus {
    this.persist({ ...this.config, pending: undefined })
    if (this.available) this.error = undefined
    return this.status()
  }
  /** Call before discovery, scheduled tasks, windows or any external agent starts. */
  async initialize(): Promise<EggStorageStatus> {
    const pending = this.config.pending
    if (pending) {
      try {
        const target = this.validateTarget(pending.directory, pending.copyExisting)
        if (pending.copyExisting && target !== canonical(this.directory)) await this.copyLibrary(target)
        this.persist({ directory: target })
        this.activeDirectory = target
        this.available = true
        this.error = undefined
      } catch (error) {
        this.error = `Directory change failed; the configured library was not changed. ${(error as Error).message}`
      }
    }
    if (this.available) {
      try {
        if (this.directory === path.resolve(this.defaultDirectory)) fs.mkdirSync(this.directory, { recursive: true })
        if (!fs.statSync(this.directory).isDirectory()) throw new Error('Configured path is not a directory')
        fs.readdirSync(this.directory)
        const probe = fs.mkdtempSync(path.join(this.directory, '.appgacha-write-test-'))
        fs.rmdirSync(probe)
      } catch (error) { this.markUnavailable((error as Error).message) }
    }
    this.initialized = true
    return this.status()
  }
  private async copyLibrary(target: string) {
    const source = canonical(this.initialDirectory)
    try {
      if (!fs.statSync(source).isDirectory()) throw new Error('The current egg path is not a directory')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' && source === canonical(this.defaultDirectory)) return // New installation has no eggs yet.
      throw error
    }
    // Stage beside the empty target, then publish the whole library in one rename.
    // No partially copied .gacha directory can become visible at the chosen path.
    const parent = path.dirname(target)
    if (fs.statSync(parent).dev !== fs.statSync(target).dev) throw new Error('Choose a folder inside the volume, not a mount point')
    const staging = fs.mkdtempSync(path.join(parent, '.appgacha-eggs-copy-'))
    try {
      for (const entry of await fs.promises.readdir(source, { withFileTypes: true })) {
        if (!entry.name.endsWith('.gacha')) continue
        if (entry.isSymbolicLink()) throw new Error('Linked capsules cannot be migrated automatically')
        if (entry.isDirectory()) await copyCapsule(path.join(source, entry.name), path.join(staging, entry.name))
      }
      if (canonical(target) !== target || fs.readdirSync(target).length) throw new Error('Target directory changed during copying; no existing files were overwritten')
      // rmdir removes ONLY the selected empty directory; never recursively deletes it.
      fs.rmdirSync(target)
      try { fs.renameSync(staging, target) } catch (error) {
        if (!fs.existsSync(target)) fs.mkdirSync(target)
        throw error
      }
    } finally {
      if (path.dirname(staging) !== parent || !path.basename(staging).startsWith('.appgacha-eggs-copy-')) throw new Error('Unsafe migration cleanup path')
      try { fs.rmSync(staging, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }) } catch { /* Only an ignored temporary copy remains; original eggs are untouched. */ }
    }
  }
}

/** Avoid fs.cp's Electron/Windows emoji-path crash. At cold start keep WAL too:
 * after an unclean shutdown it can contain committed data not in the main DB. */
async function copyCapsule(source: string, target: string): Promise<void> {
  await fs.promises.mkdir(target)
  for (const entry of await fs.promises.readdir(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name), to = path.join(target, entry.name)
    if (entry.isDirectory()) await copyCapsule(from, to)
    else if (entry.isFile()) await fs.promises.copyFile(from, to, fs.constants.COPYFILE_EXCL)
    else throw new Error('Linked or special files cannot be migrated automatically')
  }
}
