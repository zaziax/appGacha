import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { isPrivateProjectSegment } from './projectIndex'

const PROTECTED = new Set(['base.css', 'icons.svg', 'widget.css', 'widget.js'])
const MAX_BYTES = 500 * 1024
const TEXT_EXT = new Set(['.js', '.mjs', '.html', '.css', '.json', '.md', '.txt', '.svg'])
const hash = (text: string) => createHash('sha256').update(text).digest('hex')

/** No shell, symlinks, private task state, or traversal. Imports have different semantics. */
export function resolveWorkspacePath(root: string, relative: string, write = false): string {
  if (!relative || path.isAbsolute(relative) || /^[A-Za-z]:/.test(relative) || relative.includes(':') || relative.includes('\0')) throw new Error('Invalid root-relative file path')
  const parts = relative.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '').split('/')
  if (parts.some(p => !p || p === '..' || isPrivateProjectSegment(p))) throw new Error('Private or invalid workspace path')
  if (parts.some(p => /[. ]$/.test(p) || /[<>"|?*]/.test(p) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) throw new Error('Invalid portable filename')
  const normalized = parts.join('/')
  if (write && (PROTECTED.has(normalized.toLowerCase()) || parts[0].toLowerCase() === 'vendor' || normalized.toLowerCase() === 'eggdoc.md')) throw new Error('Protected host file: read-only')
  const rootPath = fs.realpathSync(root)
  let target = rootPath
  for (const part of parts) {
    target = path.join(target, part)
    try {
      if (fs.lstatSync(target).isSymbolicLink()) throw new Error('Symbolic links are not allowed in the workspace')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  if (!target.startsWith(rootPath + path.sep)) throw new Error('Path escapes workspace')
  return target
}

export class WorkspaceTools {
  private readHashes = new Map<string, string>()
  constructor(private root: string) {}

  read(relative: string, startLine = 1, endLine?: number): string {
    const target = resolveWorkspacePath(this.root, relative)
    if (!Number.isInteger(startLine) || startLine < 1 || (endLine !== undefined && (!Number.isInteger(endLine) || endLine < startLine))) throw new Error('Invalid 1-based line range')
    if (!TEXT_EXT.has(path.extname(target).toLowerCase())) throw new Error('Only text source files can be read')
    if (fs.statSync(target).size > 5 * 1024 * 1024) throw new Error('File too large to read; use its guide')
    const content = fs.readFileSync(target, 'utf8')
    const revision = hash(content)
    this.readHashes.set(target, revision)
    const lines = content.split(/\r?\n/)
    const end = Math.min(endLine ?? startLine + 249, startLine + 499, lines.length)
    if (startLine > lines.length) throw new Error(`File has ${lines.length} lines`)
    const selected: string[] = []
    let length = 0
    let last = startLine - 1
    for (let i = startLine - 1; i < end; i++) {
      const line = `${i + 1}: ${lines[i]}`
      if (length + line.length > 20_000) {
        if (selected.length === 0) return `${relative}\nsha256=${revision}\n[Line ${i + 1} exceeds read limit; use search or exact edit. No partial source returned.]`
        break
      }
      selected.push(line)
      length += line.length + 1
      last = i + 1
    }
    return `${relative}\nsha256=${revision}\nlines ${startLine}-${last}/${lines.length}\n${selected.join('\n')}\n${last < lines.length ? `[PARTIAL FILE: continue at start_line=${last + 1}; do not overwrite using this fragment.]` : startLine > 1 ? '[PARTIAL FILE: earlier lines omitted.]' : '[COMPLETE FILE]'}`
  }

  private checkRevision(target: string, expectedHash?: string): void {
    const expected = expectedHash ?? this.readHashes.get(target)
    if (expected && (!fs.existsSync(target) || hash(fs.readFileSync(target, 'utf8')) !== expected)) throw new Error('File changed since read; read it again before editing')
  }

  write(relative: string, content: string, expectedHash?: string): string {
    const target = resolveWorkspacePath(this.root, relative, true)
    if (Buffer.byteLength(content) > MAX_BYTES) throw new Error('File exceeds 500KB')
    this.checkRevision(target, expectedHash)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    const temp = path.join(path.dirname(target), `.write-${randomUUID()}.tmp`)
    try {
      fs.writeFileSync(temp, content, { encoding: 'utf8', flag: 'wx' })
      fs.renameSync(temp, target)
    } finally {
      if (fs.existsSync(temp)) fs.unlinkSync(temp)
    }
    const revision = hash(content)
    this.readHashes.set(target, revision)
    return `已写入 ${relative}（${Buffer.byteLength(content)} bytes）\nsha256=${revision}`
  }

  edit(relative: string, oldText: string, newText: string, expectedHash?: string): string {
    const target = resolveWorkspacePath(this.root, relative, true)
    this.checkRevision(target, expectedHash)
    if (!oldText) throw new Error('old_text must not be empty')
    const content = fs.readFileSync(target, 'utf8')
    const first = content.indexOf(oldText)
    if (first < 0 || content.indexOf(oldText, first + 1) >= 0) throw new Error('old_text must match exactly once; read more context')
    return this.write(relative, content.slice(0, first) + newText + content.slice(first + oldText.length), expectedHash)
  }

  search(files: string[], query: string): string {
    if (!query || query.length > 300) throw new Error('query must be 1–300 characters (literal text)')
    const matches: string[] = []
    let truncated = false
    for (const file of files) {
      if (!TEXT_EXT.has(path.extname(file).toLowerCase())) continue
      let content: string
      try {
        const target = resolveWorkspacePath(this.root, file)
        if (fs.statSync(target).size > MAX_BYTES) continue
        content = fs.readFileSync(target, 'utf8')
      } catch { continue }
      const lines = content.split(/\r?\n/)
      for (let i = 0; i < lines.length; i++) {
        const offset = lines[i].toLowerCase().indexOf(query.toLowerCase())
        if (offset < 0) continue
        if (matches.length === 40) { truncated = true; break }
        matches.push(`${file}:${i + 1}: ${lines[i].slice(Math.max(0, offset - 80), offset + 220)}`)
      }
      if (truncated) break
    }
    return `${matches.join('\n') || 'No matches in searchable source files.'}${truncated ? '\n[More matches omitted; narrow the query.]' : ''}`
  }
}
