import fs from 'node:fs'
import path from 'node:path'

/** Display names cannot choose parent directories or Windows device paths. */
export function uniqueEggFolder(root: string, displayName: string): string {
  if (typeof displayName !== 'string' || !displayName.trim()) throw new Error('Application name is empty')
  const safe = displayName.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/[. ]+$/, '').slice(0, 100)
  const base = !safe || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(safe) ? 'App-' + (safe || 'Gacha') : safe
  const normalizedRoot = path.resolve(root)
  let suffix = 1
  for (;;) {
    const destination = path.resolve(normalizedRoot, `${base}${suffix === 1 ? '' : '-' + suffix}.gacha`)
    if (path.dirname(destination) !== normalizedRoot) throw new Error('Invalid application directory')
    try { fs.lstatSync(destination); suffix++ } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return destination
      throw error
    }
  }
}
