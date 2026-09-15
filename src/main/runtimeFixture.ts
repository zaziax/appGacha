import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'

/** A private disposable copy, so a probe can never edit the source egg's data. */
export interface RuntimeFixture { dir: string; bootstrapFile: string; dispose: () => Promise<void> }

export function createRuntimeFixture(sourceDir: string, signal?: AbortSignal): RuntimeFixture {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'appgacha-runtime-fixture-'))
  const copy = (source: string, target: string) => {
    if (signal?.aborted) throw signal.reason ?? new Error('Runtime test cancelled')
    fs.mkdirSync(target, { recursive: true })
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
      if (signal?.aborted) throw signal.reason ?? new Error('Runtime test cancelled')
      // Do not follow a link out of an egg when collecting a test fixture.
      if (entry.isSymbolicLink()) throw new Error(`Runtime test does not follow symbolic links: ${entry.name}`)
      const from = path.join(source, entry.name), to = path.join(target, entry.name)
      if (entry.isDirectory()) copy(from, to)
      else if (entry.isFile() && !entry.name.endsWith('-shm')) fs.copyFileSync(from, to)
      // An inactive source's WAL may contain committed data. Keep it with the DB.
    }
  }
  const dispose = async () => {
    const resolved = path.resolve(dir)
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('appgacha-runtime-fixture-')) throw new Error('Unexpected runtime fixture cleanup path')
    await fs.promises.rm(resolved, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 })
  }
  try {
    copy(sourceDir, dir)
    const bootstrapFile = `__runtime_bootstrap_${randomUUID()}.html`
    fs.writeFileSync(path.join(dir, bootstrapFile), '<!doctype html><html><head><title>Runtime inspection</title></head><body></body></html>', 'utf-8')
    return { dir, bootstrapFile, dispose }
  } catch (e) {
    fs.rmSync(dir, { recursive: true, force: true })
    throw e
  }
}
