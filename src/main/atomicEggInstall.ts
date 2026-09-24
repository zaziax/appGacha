import fs from 'node:fs'
import path from 'node:path'

/** Copy across volumes first; all publication/rollback renames stay on the
 * destination volume. Never remove the original to recover from a failed copy. */
export function installEggAtomically(source: string, destination: string, replaceExisting = false, warn: (message: string) => void = () => {}): void {
  const parent = path.dirname(destination)
  const staging = fs.mkdtempSync(path.join(parent, '.appgacha-install-'))
  const candidate = path.join(staging, 'candidate')
  const previous = path.join(staging, 'previous')
  let oldMoved = false
  let preserveBackup = false
  try {
    copyTree(source, candidate)
    if (fs.existsSync(destination)) {
      if (!replaceExisting) throw new Error('Destination already exists; no capsule was overwritten')
      fs.renameSync(destination, previous)
      oldMoved = true
    }
    try {
      fs.renameSync(candidate, destination)
    } catch (error) {
      if (oldMoved) {
        try {
          // Do not overwrite something another process put at the destination.
          if (fs.existsSync(destination)) throw new Error('Destination changed during installation')
          fs.renameSync(previous, destination)
        } catch (rollbackError) {
          preserveBackup = true
          throw new Error(`Installation failed: ${(error as Error).message}. Restore failed: ${(rollbackError as Error).message}. Original capsule preserved at: ${previous}`)
        }
      }
      throw error
    }
  } finally {
    if (!preserveBackup) {
      try { fs.rmSync(staging, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }) }
      catch (error) { warn(`Temporary installation directory retained at ${staging}: ${(error as Error).message}`) }
    }
  }
}

// Keep this emoji-safe and preserve every file (including SQLite WAL). Refuse
// symlinks/special files rather than following them outside a capsule.
function copyTree(source: string, destination: string): void {
  if (!fs.lstatSync(source).isDirectory()) throw new Error('Capsule source must be a real directory')
  fs.mkdirSync(destination)
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name), to = path.join(destination, entry.name)
    if (entry.isDirectory()) copyTree(from, to)
    else if (entry.isFile()) fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL)
    else throw new Error('Linked or special capsule files cannot be installed')
  }
}
