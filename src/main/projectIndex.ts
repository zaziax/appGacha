import fs from 'node:fs'
import path from 'node:path'
import { parse } from 'acorn'

export interface ProjectIssue { file: string; message: string }
export interface ProjectReference {
  from: string
  specifier: string
  kind: 'import' | 're-export' | 'dynamic-import' | 'script' | 'stylesheet' | 'asset'
  target?: string
  line?: number
  importedNames?: string[]
  module?: boolean
}
export interface ProjectAnalysis {
  /** All safe project files, including vendor/assets; never application data or checkpoints. */
  files: string[]
  imports: ProjectReference[]
  issues: ProjectIssue[]
  warnings: ProjectIssue[]
  modules: Record<string, { exports: string[] }>
}

const PRIVATE_DIRS = new Set(['data', 'backups', 'node_modules'])
const PRIVATE_FILES = /^(?:checkpoint(?:[.-].*)?\.json|build-report\.json|credentials\.json|secrets(?:\..*)?)$/i
/** Shared with source read/search/write tools so index omissions cannot be bypassed by direct paths. */
export function isPrivateProjectSegment(name: string): boolean {
  return name.startsWith('.') || PRIVATE_DIRS.has(name.toLowerCase()) || PRIVATE_FILES.test(name)
}
const JS_FILE = /\.(?:mjs|cjs|js)$/i
const MAX_PARSE_BYTES = 16 * 1024 * 1024
const MAX_FILES = 20_000
type Ast = { type: string; loc?: { start: { line: number } } | null; [key: string]: unknown }
type Binding = { local?: string; ref?: ProjectReference; imported?: string }
interface ModuleInfo {
  explicit: Map<string, Binding>
  locals: Map<string, Binding>
  stars: ProjectReference[]
  syntax: boolean
}
const node = (value: unknown) => value as Ast
const children = (value: unknown) => (Array.isArray(value) ? value as Ast[] : [])
const nameOf = (value: unknown): string => {
  const n = node(value)
  return String(n?.name ?? n?.value ?? '')
}
const literal = (value: unknown): string | undefined => {
  const n = node(value)
  if (n?.type === 'Literal' && typeof n.value === 'string') return n.value
  if (n?.type === 'TemplateLiteral' && children(n.expressions).length === 0) {
    return String((node(children(n.quasis)[0])?.value as { cooked?: string })?.cooked ?? '')
  }
  return undefined
}

/** Read-only analysis: parses code as data. It never imports or executes egg JavaScript. */
export function analyzeProject(dir: string): ProjectAnalysis {
  const result: ProjectAnalysis = { files: [], imports: [], issues: [], warnings: [], modules: {} }
  const issue = (file: string, message: string) => result.issues.push({ file, message })
  const warn = (file: string, message: string) => result.warnings.push({ file, message })
  let realRoot: string
  try {
    if (fs.lstatSync(dir).isSymbolicLink() || !fs.statSync(dir).isDirectory()) {
      issue('.', '项目根目录必须是真实目录，不能是符号链接')
      return result
    }
    realRoot = fs.realpathSync(dir)
  } catch (e) {
    issue('.', `无法读取项目目录: ${(e as Error).message}`)
    return result
  }
  const walkFiles = (rel: string) => {
    for (const entry of fs.readdirSync(path.join(realRoot, rel), { withFileTypes: true })) {
      if (isPrivateProjectSegment(entry.name)) continue
      const file = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isSymbolicLink()) { issue(file, '项目内禁止符号链接，未读取目标'); continue }
      if (entry.isDirectory()) walkFiles(file)
      else if (entry.isFile()) {
        result.files.push(file)
        if (result.files.length > MAX_FILES) throw new Error(`项目文件数超过 ${MAX_FILES}`)
      }
    }
  }
  try { walkFiles('') } catch (e) { issue('.', `扫描失败: ${(e as Error).message}`) }
  result.files.sort()
  const files = new Set(result.files)
  const folded = new Map<string, string>()
  for (const file of result.files) {
    const previous = folded.get(file.toLowerCase())
    if (previous && previous !== file) issue(file, `文件名仅大小写不同，跨平台冲突: ${previous}`)
    folded.set(file.toLowerCase(), file)
  }
  const contentCache = new Map<string, string>()
  const read = (file: string): string | undefined => {
    if (contentCache.has(file)) return contentCache.get(file)
    try {
      const abs = path.join(realRoot, file)
      const real = fs.realpathSync(abs)
      if (real !== realRoot && !real.startsWith(realRoot + path.sep)) throw new Error('路径越出项目目录')
      if (fs.lstatSync(abs).isSymbolicLink()) throw new Error('拒绝读取符号链接')
      if (fs.statSync(abs).size > MAX_PARSE_BYTES) {
        issue(file, `文件过大，无法完成静态分析（上限 ${MAX_PARSE_BYTES / 1024 / 1024}MB）`)
        return undefined
      }
      const text = fs.readFileSync(abs, 'utf-8')
      contentCache.set(file, text)
      return text
    } catch (e) { issue(file, `读取失败: ${(e as Error).message}`); return undefined }
  }
  const reference = (from: string, specifier: string, kind: ProjectReference['kind'], line?: number): ProjectReference => {
    const ref: ProjectReference = { from, specifier, kind, line }
    const moduleReference = ['import', 're-export', 'dynamic-import'].includes(kind)
    let source = moduleReference ? specifier : specifier.trim()
    if (!moduleReference && (!source || source.startsWith('#') || /^(?:data|blob):/i.test(source))) return ref
    // Inline data and fragment references are not file dependencies. In particular,
    // do not copy large base64 images into every structural snapshot/model message.
    result.imports.push(ref)
    if (/^egg:/i.test(source)) {
      try {
        const url = new URL(source)
        const manifest = files.has('manifest.json') ? JSON.parse(read('manifest.json') ?? '{}') as { eggId?: unknown } : {}
        if (typeof manifest.eggId !== 'string') {
          warn(from, `绝对 egg:// 引用 "${source}" 无法确认所属扭蛋，需运行期验证`)
          return ref
        }
        if (url.hostname.toLowerCase() !== manifest.eggId.toLowerCase() || url.port || url.username || url.password) {
          issue(from, `egg:// 引用不属于当前扭蛋: "${source}"`)
          return ref
        }
        source = url.pathname + url.search + url.hash
        warn(from, `绝对 egg:// 引用绑定当前 eggId，建议改用相对路径以保持复制/迁移可用: "${specifier}"`)
      } catch { issue(from, `无效 egg:// 引用 "${source}"`); return ref }
    }
    if (/^[a-z][a-z\d+.-]*:/i.test(source) || source.startsWith('//')) {
      issue(from, `不支持的外部资源或模块引用 "${source}"${line ? `（第 ${line} 行）` : ''}`)
      return ref
    }
    if (moduleReference && !/^(?:\.{1,2}\/|\/)/.test(source)) {
      issue(from, `裸模块引用 "${source}" 无法解析；请使用相对当前文件的本地路径`)
      return ref
    }
    let clean: string
    try { clean = decodeURIComponent(source.split(/[?#]/, 1)[0]) } catch {
      issue(from, `无效资源路径 "${source}"`); return ref
    }
    if (clean.includes('\\') || clean.includes('\0')) { issue(from, `资源路径必须使用正斜杠: "${source}"`); return ref }
    const target = path.posix.normalize(clean.startsWith('/') ? clean.slice(1) : path.posix.join(path.posix.dirname(from), clean))
    if (target === '..' || target.startsWith('../') || path.posix.isAbsolute(target)) {
      issue(from, `引用越出项目目录: "${source}"`); return ref
    }
    if (!files.has(target)) {
      const actual = folded.get(target.toLowerCase())
      issue(from, actual
        ? `引用 "${source}" 大小写不匹配；实际文件为 "${actual}"`
        : `引用 "${source}" 无法解析到文件 "${target}"（缺失、受保护数据或符号链接）`)
      return ref
    }
    ref.target = target
    return ref
  }

  const modules = new Map<string, ModuleInfo>()
  const bindPattern = (pattern: Ast, add: (name: string) => void): void => {
    if (!pattern) return
    if (pattern.type === 'Identifier') add(nameOf(pattern))
    else if (pattern.type === 'RestElement') bindPattern(node(pattern.argument), add)
    else if (pattern.type === 'AssignmentPattern') bindPattern(node(pattern.left), add)
    else if (pattern.type === 'ArrayPattern') children(pattern.elements).filter(Boolean).forEach(p => bindPattern(p, add))
    else if (pattern.type === 'ObjectPattern') children(pattern.properties).forEach(p => bindPattern(node(p.type === 'RestElement' ? p.argument : p.value), add))
  }
  const parseModule = (file: string) => {
    if (modules.has(file) || !JS_FILE.test(file)) return
    const info: ModuleInfo = { explicit: new Map(), locals: new Map(), stars: [], syntax: false }
    modules.set(file, info)
    const text = read(file)
    if (text === undefined) return
    let program: Ast
    try { program = parse(text, { ecmaVersion: 'latest', sourceType: 'module', locations: true }) as unknown as Ast }
    catch (e) { issue(file, `JS/ESM 语法错误: ${(e as Error).message}`); return }
    info.syntax = true
    const makeRef = (n: Ast, kind: ProjectReference['kind']) => reference(file, String(node(n.source).value), kind, n.loc?.start.line)
    for (const n of children(program.body)) {
      if (n.type === 'ImportDeclaration') {
        const ref = makeRef(n, 'import')
        ref.importedNames = []
        for (const spec of children(n.specifiers)) {
          const imported = spec.type === 'ImportDefaultSpecifier' ? 'default' : spec.type === 'ImportNamespaceSpecifier' ? '*' : nameOf(spec.imported)
          info.locals.set(nameOf(spec.local), { ref, imported })
          if (imported !== '*') ref.importedNames.push(imported)
        }
      } else if (n.type === 'ExportDefaultDeclaration') {
        const declaration = node(n.declaration)
        info.explicit.set('default', { local: declaration.id ? nameOf(declaration.id) : 'default' })
      } else if (n.type === 'ExportNamedDeclaration') {
        const ref = n.source ? makeRef(n, 're-export') : undefined
        if (ref) ref.importedNames = []
        for (const spec of children(n.specifiers)) {
          const imported = nameOf(spec.local)
          info.explicit.set(nameOf(spec.exported), ref ? { ref, imported } : { local: imported })
          ref?.importedNames?.push(imported)
        }
        const declaration = node(n.declaration)
        if (declaration?.type === 'VariableDeclaration') {
          children(declaration.declarations).forEach(d => bindPattern(node(d.id), name => info.explicit.set(name, { local: name })))
        } else if (declaration?.id) info.explicit.set(nameOf(declaration.id), { local: nameOf(declaration.id) })
      } else if (n.type === 'ExportAllDeclaration') {
        const ref = makeRef(n, 're-export')
        if (n.exported) info.explicit.set(nameOf(n.exported), { ref, imported: '*' })
        else info.stars.push(ref)
      }
    }
    // Walk dynamic imports without evaluating expressions or executing code.
    const pending = [program]
    while (pending.length) {
      const n = pending.pop()!
      if (n.type === 'ImportExpression') {
        const source = literal(n.source)
        if (source === undefined) warn(file, `第 ${n.loc?.start.line ?? '?'} 行动态 import 路径由运行时计算，静态依赖未验证`)
        else reference(file, source, 'dynamic-import', n.loc?.start.line)
      }
      for (const value of Object.values(n)) {
        if (Array.isArray(value)) {
          for (const child of value) if (child && typeof child === 'object' && typeof child.type === 'string') pending.push(child)
        } else if (value && typeof value === 'object' && typeof (value as Ast).type === 'string') pending.push(value as Ast)
      }
    }
  }

  const stripComments = (text: string, html = false) => text.replace(html ? /<!--[\s\S]*?-->/g : /\/\*[\s\S]*?\*\//g, match => match.replace(/[^\n]/g, ' '))
  const lineAt = (text: string, at: number) => text.slice(0, at).split('\n').length
  const attr = (tag: string, name: string) => {
    const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))
    return match ? (match[1] ?? match[2] ?? match[3]).replace(/&amp;/g, '&') : undefined
  }
  const parseHtml = (file: string) => {
    const raw = read(file)
    if (raw === undefined) return
    const text = stripComments(raw, true)
    for (const match of text.matchAll(/<(script|link|img|source|audio|video|use|image)\b[^>]*>/gi)) {
      const tag = match[0], type = match[1].toLowerCase()
      const scriptType = attr(tag, 'type')?.toLowerCase()
      if (type === 'script' && scriptType && scriptType !== 'module' && !/^(?:text|application)\/(?:java|ecma)script\b/.test(scriptType)) continue
      const src = attr(tag, 'src') ?? attr(tag, 'href') ?? attr(tag, 'xlink:href')
      if (src === undefined) continue
      const rel = attr(tag, 'rel')?.toLowerCase()
      if (type === 'link' && rel && !/\b(?:stylesheet|modulepreload|preload|icon)\b/.test(rel)) continue
      const ref = reference(file, src, type === 'script' ? 'script' : type === 'link' && rel === 'stylesheet' ? 'stylesheet' : 'asset', lineAt(text, match.index!))
      if (type === 'script') ref.module = scriptType === 'module'
    }
  }
  const parsedCss = new Set<string>()
  const parseCss = (file: string) => {
    if (parsedCss.has(file)) return
    parsedCss.add(file)
    const raw = read(file)
    if (raw === undefined) return
    // A small resource-token reader, not a CSS validity checker. Skip comments and
    // ordinary strings (e.g. content:"url(example.png)") instead of matching those
    // as loads. Decode CSS escapes only after reading the complete URL token.
    const decodeCss = (value: string) => value.replace(/\\(?:([\da-fA-F]{1,6})(?:\r\n|[\t\n\f\r ])?|([\r\n\f])|([\s\S]))/g,
      (_all, hex: string | undefined, newline: string | undefined, char: string | undefined) => {
        if (hex) { const point = parseInt(hex, 16); return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '\ufffd' }
        return newline ? '' : char ?? ''
      })
    const stringEnd = (at: number) => {
      const quote = raw[at++]
      while (at < raw.length) {
        if (raw[at] === '\\') at += 2
        else if (raw[at++] === quote) return at
      }
      return at
    }
    for (let i = 0; i < raw.length;) {
      if (raw.startsWith('/*', i)) { const end = raw.indexOf('*/', i + 2); i = end < 0 ? raw.length : end + 2; continue }
      if (raw[i] === '"' || raw[i] === "'") { i = stringEnd(i); continue }
      const importMatch: RegExpMatchArray | null = raw.slice(i).match(/^@import\s+/i)
      if (importMatch) {
        const start = i + importMatch[0].length
        if (raw[start] === '"' || raw[start] === "'") {
          const end = stringEnd(start)
          reference(file, decodeCss(raw.slice(start + 1, end - 1)), 'stylesheet', lineAt(raw, i))
          i = end
          continue
        }
      }
      const urlMatch: RegExpMatchArray | null | false = (i === 0 || !/[\w-]/.test(raw[i - 1])) && raw.slice(i).match(/^url\(\s*/i)
      if (!urlMatch) { i++; continue }
      const start = i + urlMatch[0].length
      let end = start
      let source = ''
      if (raw[start] === '"' || raw[start] === "'") {
        end = stringEnd(start)
        source = raw.slice(start + 1, end - 1)
        while (/\s/.test(raw[end] ?? '') && end < raw.length) end++
      } else {
        while (end < raw.length && raw[end] !== ')') end += raw[end] === '\\' ? 2 : 1
        source = raw.slice(start, end).trim()
      }
      if (raw[end] === ')') reference(file, decodeCss(source), 'asset', lineAt(raw, i))
      else warn(file, `第 ${lineAt(raw, i)} 行 CSS url 无法静态解析，需运行期验证`)
      i = Math.max(end + 1, i + 1)
    }
  }
  for (const file of result.files) {
    if (file.startsWith('vendor/')) continue
    if (JS_FILE.test(file)) parseModule(file)
    else if (/\.html?$/i.test(file)) parseHtml(file)
    else if (/\.css$/i.test(file)) parseCss(file)
  }
  // Vendor files are trusted host assets, but their actual exports must match imports.
  // Parse only referenced modules/resources, not every bundled library on each check.
  for (let i = 0; i < result.imports.length; i++) {
    const ref = result.imports[i]
    if (!ref.target) continue
    if (['import', 're-export', 'dynamic-import', 'script'].includes(ref.kind)) {
      if (JS_FILE.test(ref.target)) parseModule(ref.target)
      else warn(ref.from, `引用 "${ref.specifier}" 不是 JS 模块；其加载类型和导出未静态验证`)
    }
    if (/\.css$/i.test(ref.target)) parseCss(ref.target)
  }

  // undefined = not statically known; null = absent; symbol = ambiguous; string = binding identity.
  // Keeping binding identity distinguishes a harmless diamond re-export from ambiguity.
  const ambiguous = Symbol('ambiguous export')
  const resolveExport = (file: string, name: string, visited = new Set<string>()): string | null | undefined | typeof ambiguous => {
    const key = `${file}\0${name}`
    if (visited.has(key)) return null
    const info = modules.get(file)
    if (!info?.syntax) return undefined
    const next = new Set(visited).add(key)
    const binding = info.explicit.get(name)
    if (binding) {
      const imported = binding.ref ? binding : info.locals.get(binding.local!)
      if (!imported) return `${file}\0${binding.local}`
      if (!imported.ref?.target) return undefined
      return imported.imported === '*' ? `${imported.ref.target}\0*` : resolveExport(imported.ref.target, imported.imported!, next)
    }
    if (name === 'default') return null
    let found: string | null = null
    let unknown = false
    for (const ref of info.stars) {
      if (!ref.target) { unknown = true; continue }
      const value = resolveExport(ref.target, name, next)
      if (value === undefined) unknown = true
      else if (value === ambiguous) return ambiguous
      else if (value !== null) {
        if (found && found !== value) return ambiguous
        found = value
      }
    }
    return unknown ? undefined : found
  }
  const exportNames = new Map([...modules].map(([file, info]) => [file, new Set(info.explicit.keys())]))
  let changed = true
  while (changed) {
    changed = false
    for (const [file, info] of modules) for (const ref of info.stars) {
      for (const name of exportNames.get(ref.target ?? '') ?? []) {
        if (name !== 'default' && !exportNames.get(file)!.has(name)) { exportNames.get(file)!.add(name); changed = true }
      }
    }
  }
  for (const [file, names] of exportNames) result.modules[file] = { exports: [...names].filter(name => typeof resolveExport(file, name) === 'string').sort() }
  for (const ref of result.imports) {
    if (!ref.target) continue
    for (const name of ref.importedNames ?? []) {
      const resolved = resolveExport(ref.target, name)
      if (resolved === null || resolved === ambiguous) issue(ref.from, `模块 "${ref.specifier}" 没有可唯一解析的导出 "${name}"（目标 ${ref.target}）`)
    }
    if (ref.kind === 'script' && !ref.module && modules.get(ref.target)?.syntax) {
      try { parse(read(ref.target)!, { ecmaVersion: 'latest', sourceType: 'script' }) }
      catch { issue(ref.from, `脚本 "${ref.specifier}" 使用 ESM，HTML 必须声明 type="module"`) }
    }
  }
  return result
}

/** Deterministic snapshot text; regenerate from the current staging directory after edits. */
export function formatProjectIndex(project: ProjectAnalysis): string {
  const lines = ['## 当前安全项目文件清单', '', '路径相对扭蛋根目录；不含 data/、备份、隐藏文件、node_modules、检查点和符号链接。', '```text', ...project.files, '```', '', '## 本地依赖关系', '']
  for (const ref of project.imports) lines.push(`- ${ref.from}${ref.line ? `:${ref.line}` : ''} → ${ref.specifier} → ${ref.target ?? '未解析/运行时资源'}${ref.importedNames?.length ? `（导入 ${ref.importedNames.join(', ')}）` : ''}`)
  if (!project.imports.length) lines.push('（没有静态资源或模块引用）')
  if (project.issues.length) lines.push('', '## 静态问题', ...project.issues.map(i => `- [${i.file}] ${i.message}`))
  if (project.warnings.length) lines.push('', '## 尚未静态验证', ...project.warnings.map(i => `- [${i.file}] ${i.message}`))
  return lines.join('\n')
}
