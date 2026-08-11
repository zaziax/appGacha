import fs from 'node:fs'
import path from 'node:path'

/**
 * 扫描蛋目录，生成一份 Markdown 格式的结构快照。
 * 供升级时 AI 快速理解蛋的结构，避免通读所有文件。
 */
export function generateEggDoc(dir: string): string {
  const manifest = readManifest(dir)
  if (!manifest) return `# 蛋结构快照\n\n（无法读取 manifest.json）\n`

  const lines: string[] = []

  // ─── manifest ───
  lines.push('# 蛋结构快照', '', '## manifest')
  const name = String(manifest.name ?? '未命名')
  const wish = typeof manifest.wish === 'string' ? manifest.wish : ''
  const permissions = Array.isArray(manifest.permissions) ? manifest.permissions as string[] : []
  const version = typeof manifest.version === 'string' ? manifest.version : '1.0.0'
  const upgrades = Array.isArray(manifest.upgrades) ? manifest.upgrades as unknown[] : []
  const windowCfg = manifest.window as Record<string, unknown> | undefined
  lines.push(`- **名称:** ${name}`)
  if (wish) lines.push(`- **愿望:** ${truncate(wish, 120)}`)
  lines.push(`- **权限:** ${permissions.join(', ') || '（无）'}`)
  if (windowCfg) {
    const wt = windowCfg.type ?? 'standard'
    const ww = windowCfg.width
    const wh = windowCfg.height
    lines.push(`- **窗口:** ${wt}${ww && wh ? ` (${ww}×${wh})` : ''}`)
  }
  lines.push(`- **版本:** ${version}`)
  lines.push(`- **升级次数:** ${upgrades.length}`)
  lines.push('')

  // ─── vendor ───
  const vendorDir = path.join(dir, 'vendor')
  const vendorFiles = fs.existsSync(vendorDir) ? fs.readdirSync(vendorDir).filter(f => !f.startsWith('.')) : []
  // 记录哪些 vendor 文件被 import 了
  const allImports = new Set<string>()
  if (vendorFiles.length > 0) {
    lines.push('## vendor', '')
    for (const f of vendorFiles) {
      lines.push(`- \`${f}\``)
    }
    lines.push('')
  }

  // ─── base.css 设计系统（提取可用组件 class，省去 AI 读 9KB 全文） ───
  const baseCssPath = path.join(dir, 'base.css')
  if (fs.existsSync(baseCssPath)) {
    try {
      const baseContent = fs.readFileSync(baseCssPath, 'utf-8')
      const baseClasses = extractBaseClasses(baseContent)
      if (baseClasses.length > 0) {
        lines.push('## base.css（设计系统，不要修改）', '')
        lines.push(`**可用 class:** ${baseClasses.join(', ')}`)
        lines.push('')
      }
    } catch { /* base.css 读取失败不阻塞 */ }
  }

  // ─── 扫描代码文件 ───
  const codeFiles = listCodeFiles(dir)
  for (const rel of codeFiles) {
    const abs = path.join(dir, rel)
    let content: string
    try { content = fs.readFileSync(abs, 'utf-8') } catch { continue }
    const stat = fs.statSync(abs)
    const sizeKB = Math.round(stat.size / 1024)
    const lineCount = content.split('\n').length

    const ext = path.extname(rel).toLowerCase()
    if (ext === '.js') {
      const section = scanJs(rel, content, lineCount, sizeKB, allImports)
      if (section) lines.push(...section, '')
    } else if (ext === '.css') {
      const section = scanCss(rel, content, lineCount, sizeKB)
      if (section) lines.push(...section, '')
    } else if (ext === '.html') {
      const section = scanHtml(rel, content, lineCount, sizeKB)
      if (section) lines.push(...section, '')
    }
  }

  return lines.join('\n')
}

// ─── 辅助 ───

function readManifest(dir: string): Record<string, unknown> | null {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf-8'))
    return raw as Record<string, unknown>
  } catch { return null }
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + '…'
}

/** 列出蛋目录下的所有代码文件（跳过 vendor/ data/ .json .svg .md .png 等辅助文件） */
function listCodeFiles(dir: string): string[] {
  const out: string[] = []
  function walk(rel: string) {
    const abs = path.join(dir, rel)
    let entries: fs.Dirent[]
    try { entries = fs.readdirSync(abs, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) {
        if (r === 'vendor' || r === 'data' || r === 'backups') continue
        walk(r)
      } else {
        const ext = path.extname(e.name).toLowerCase()
        if (['.js', '.css', '.html'].includes(ext)) out.push(r)
      }
    }
  }
  walk('')
  return out
}

// ─── JS 扫描 ───

function scanJs(
  rel: string, content: string, lineCount: number, _sizeKB: number, allImports: Set<string>
): string[] | null {
  const out: string[] = []

  // 函数声明: function name()  /  async function name()
  const funcs = new Set<string>()
  for (const m of content.matchAll(/(?:async\s+)?function\s+(\w+)\s*\(/g)) funcs.add(m[1])
  // 箭头函数赋值: const name = (...) =>  /  const name = async (...) =>
  for (const m of content.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\([\s\S]*?\)\s*=>/g)) funcs.add(m[1])
  // class 声明: class Name
  const classes = new Set<string>()
  for (const m of content.matchAll(/class\s+(\w+)/g)) classes.add(m[1])

  // vendor import
  const vendorRefs = new Set<string>()
  for (const m of content.matchAll(/from\s+['"]\.\/vendor\/([\w.-]+)['"]/g)) {
    vendorRefs.add(m[1])
    allImports.add(m[1])
  }

  // DB schema
  const tables: string[] = []
  for (const m of content.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s*\(([\s\S]*?)\)/gi)) {
    const name = m[1]
    const body = m[2].replace(/\s+/g, ' ').trim()
    tables.push(`${name}(${body.slice(0, 200)})`)
  }

  // DOM 查询
  const domRefs = new Set<string>()
  for (const m of content.matchAll(/(?:querySelector|getElementById|querySelectorAll)\s*\(\s*['"]([^'"]+)['"]/g)) {
    domRefs.add(m[1])
  }

  // egg.* API 使用
  const eggApis = new Set<string>()
  for (const m of content.matchAll(/egg\.(\w+)\.(\w+)/g)) {
    eggApis.add(`${m[1]}.${m[2]}`)
  }

  if (funcs.size === 0 && classes.size === 0 && vendorRefs.size === 0 && tables.length === 0) return null

  const sizeLabel = `${lineCount} 行`
  out.push(`## ${rel} (${sizeLabel})`)

  if (funcs.size > 0) {
    out.push(`**导出/关键函数:** ${[...funcs].join(', ')}`)
  }
  if (classes.size > 0) {
    out.push(`**类:** ${[...classes].join(', ')}`)
  }
  if (vendorRefs.size > 0) {
    out.push(`**vendor 引用:** ${[...vendorRefs].join(', ')}`)
  }
  if (eggApis.size > 0) {
    out.push(`**egg API 使用:** ${[...eggApis].join(', ')}`)
  }
  if (tables.length > 0) {
    out.push(`**数据库:**`)
    for (const t of tables) {
      out.push(`\`\`\`sql\n${t}\n\`\`\``)
    }
  }
  if (domRefs.size > 0) {
    out.push(`**DOM 引用:** ${[...domRefs].join(', ')}`)
  }

  return out
}

// ─── CSS 扫描 ───

function scanCss(rel: string, content: string, lineCount: number, _sizeKB: number): string[] | null {
  const out: string[] = []

  // CSS 自定义属性
  const vars = new Set<string>()
  for (const m of content.matchAll(/--[\w-]+/g)) vars.add(m[0])

  // 顶层选择器（class/id，只取前两级）
  const selectors = new Set<string>()
  // 匹配选择器直到 { ，例如 .card { 、 #app > .btn { 、 .toolbar .btn {
  for (const m of content.matchAll(/^([^{}]+?)\s*\{/gm)) {
    const sel = m[1].trim()
    // 跳过 @media @keyframes 等 at-rules 和纯元素/属性选择器
    if (sel.startsWith('@') || sel.startsWith(':') || sel.includes(',')) continue
    // 提取 class 和 id
    for (const part of sel.split(/\s+/)) {
      if (part.startsWith('.') || part.startsWith('#')) selectors.add(part)
    }
  }

  if (vars.size === 0 && selectors.size === 0) return null

  out.push(`## ${rel} (${lineCount} 行)`)
  if (vars.size > 0) {
    out.push(`**CSS 变量:** ${[...vars].join(', ')}`)
  }
  if (selectors.size > 0) {
    // 限制数量，避免太长
    const selArr = [...selectors].slice(0, 20)
    out.push(`**主要选择器:** ${selArr.join(', ')}${selectors.size > 20 ? ` … 等 ${selectors.size} 个` : ''}`)
  }

  return out
}

// ─── HTML 扫描 ───

function scanHtml(rel: string, content: string, lineCount: number, _sizeKB: number): string[] | null {
  const out: string[] = []

  // 带 id 的元素
  const ids = new Set<string>()
  for (const m of content.matchAll(/\sid\s*=\s*['"]([^'"]+)['"]/g)) ids.add('#' + m[1])

  // script/link 引用
  const scripts: string[] = []
  for (const m of content.matchAll(/<script[^>]+src\s*=\s*['"]([^'"]+)['"]/g)) scripts.push(m[1])
  const links: string[] = []
  for (const m of content.matchAll(/<link[^>]+href\s*=\s*['"]([^'"]+)['"]/g)) links.push(m[1])

  if (ids.size === 0 && scripts.length === 0 && links.length === 0) return null

  out.push(`## ${rel} (${lineCount} 行)`)
  if (ids.size > 0) {
    out.push(`**关键元素:** ${[...ids].join(', ')}`)
  }
  if (scripts.length > 0) {
    out.push(`**脚本:** ${scripts.join(', ')}`)
  }
  if (links.length > 0) {
    out.push(`**样式:** ${links.join(', ')}`)
  }

  return out
}

// ─── base.css 组件 class 提取 ───

/**
 * 从 base.css 中提取设计系统提供的组件/工具类名。
 * 这些是蛋可以使用的预置 class，如 .card .btn .toolbar 等。
 */
function extractBaseClasses(content: string): string[] {
  const classes = new Set<string>()
  // 匹配以 . 开头的选择器，提取顶层 class 名
  for (const m of content.matchAll(/^\.([\w-]+)\s*[,{:\s[]/gm)) {
    const name = m[1]
    // 跳过明显不是组件类的：颜色/状态/尺寸变体、伪类、过短的名字
    if (name.length < 2) continue
    if (/^(sm|lg|xl|xs|md)$/.test(name)) continue
    if (/^(active|disabled|hover|focus|open|closed|show|hide|visible|hidden|empty|loading)$/.test(name)) continue
    classes.add('.' + name)
  }
  // 排序，常见组件类排在前面
  const priority = ['card', 'btn', 'icon-btn', 'toolbar', 'actionbar', 'content', 'app-shell',
    'spacer', 'segment', 'switch', 'fab', 'badge', 'list-item', 'icon', 'label']
  const sorted = [...classes]
  sorted.sort((a, b) => {
    const ai = priority.indexOf(a.slice(1))
    const bi = priority.indexOf(b.slice(1))
    if (ai >= 0 && bi >= 0) return ai - bi
    if (ai >= 0) return -1
    if (bi >= 0) return 1
    return a.localeCompare(b)
  })
  return sorted.slice(0, 40)
}
