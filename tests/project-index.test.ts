import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { analyzeProject, formatProjectIndex, isPrivateProjectSegment } from '../src/main/projectIndex'
import { generateEggDoc } from '../src/main/eggDoc'
import { validateEgg } from '../src/main/validate'

const dirs: string[] = []
function fixture(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(tmpdir(), 'appgacha-project-index-'))
  dirs.push(dir)
  const defaults = {
    'manifest.json': JSON.stringify({ eggId: 'project-test', name: 'Project test', hostApiVersion: '1', permissions: [] }),
    'index.html': '<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body><div id="app">Ready</div><script type="module" src="app.js"></script></body></html>',
    'style.css': '',
    'app.js': '',
  }
  for (const [file, content] of Object.entries({ ...defaults, ...files })) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
    fs.writeFileSync(path.join(dir, file), content)
  }
  return dir
}
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('safe project index and ESM dependency validation', () => {
  it('accepts root/src imports, default/namespace/destructured exports, and a static dynamic import', () => {
    const dir = fixture({
      'app.js': "import initial, { value, count } from './src/store.js'; import * as all from './src/store.js'; import('./src/view.js'); console.log(initial, value, count, all)",
      'src/store.js': 'export const { value, count = 1 } = { value: 25 }; export default value',
      'src/view.js': "import { value } from './store.js'; export const text = `${value}`",
    })
    const analysis = analyzeProject(dir)
    expect(analysis.issues).toEqual([])
    expect(analysis.warnings).toEqual([])
    expect(analysis.modules['src/store.js'].exports).toEqual(['count', 'default', 'value'])
    expect(analysis.imports).toContainEqual(expect.objectContaining({ from: 'app.js', target: 'src/store.js', kind: 'import' }))
    expect(validateEgg(dir)).toEqual([])
  })

  it('rejects the Focus Timer failure: root app.js cannot import src/store.js as ./store.js', () => {
    const dir = fixture({
      'app.js': "import { state } from './store.js'; console.log(state)",
      'src/store.js': 'export const state = {}',
    })
    expect(validateEgg(dir)).toContainEqual(expect.objectContaining({ file: 'app.js', message: expect.stringContaining('文件 "store.js"') }))
    expect(formatProjectIndex(analyzeProject(dir))).toContain('app.js:1 → ./store.js → 未解析')
  })

  it('checks syntax in ESM and in unreferenced own modules without executing them', () => {
    const dir = fixture({
      'app.js': 'export const value = ;',
      'src/not-yet-used.js': 'export function broken( {',
      'src/never-run.js': 'throw new Error("DO NOT EXECUTE")',
    })
    const issues = analyzeProject(dir).issues
    expect(issues.filter(i => i.message.includes('JS/ESM 语法错误')).map(i => i.file)).toEqual(['app.js', 'src/not-yet-used.js'])
  })

  it('rejects missing named/default exports and invalid re-exports', () => {
    const dir = fixture({
      'app.js': "import notDefault, { missing } from './src/store.js'; export { absent as forwarded } from './src/store.js'; console.log(notDefault, missing)",
      'src/store.js': 'export const state = {}',
    })
    const issues = analyzeProject(dir).issues.map(i => i.message).join('\n')
    for (const name of ['default', 'missing', 'absent']) expect(issues).toContain(`导出 "${name}"`)
  })

  it('resolves aliases, namespace exports, cycles, and a shared-binding diamond', () => {
    const dir = fixture({
      'app.js': "import { value, ns } from './src/barrel.js'; console.log(value, ns)",
      'src/value.js': 'export const value = 1',
      'src/left.js': "export { value } from './value.js'",
      'src/right.js': "import { value as other } from './value.js'; export { other as value }; export * from './barrel.js'",
      'src/barrel.js': "export * from './left.js'; export * from './right.js'; export * as ns from './value.js'",
    })
    expect(analyzeProject(dir).issues).toEqual([])
  })

  it('rejects ambiguous star exports and does not inherit default via export star', () => {
    const dir = fixture({
      'app.js': "import value, { duplicate } from './barrel.js'; console.log(value, duplicate)",
      'barrel.js': "export * from './left.js'; export * from './right.js'",
      'left.js': 'export const duplicate = 1; export default 3',
      'right.js': 'export const duplicate = 2',
    })
    const messages = analyzeProject(dir).issues.map(i => i.message).join('\n')
    expect(messages).toContain('导出 "duplicate"')
    expect(messages).toContain('导出 "default"')
  })

  it('propagates ambiguous exports through intermediate barrels', () => {
    const dir = fixture({
      'app.js': "import { duplicate } from './outer.js'",
      'outer.js': "export * from './ambiguous.js'; export * from './left.js'",
      'ambiguous.js': "export * from './left.js'; export * from './right.js'",
      'left.js': 'export const duplicate = 1',
      'right.js': 'export const duplicate = 2',
    })
    expect(analyzeProject(dir).issues).toContainEqual(expect.objectContaining({ file: 'app.js', message: expect.stringContaining('导出 "duplicate"') }))
  })

  it('keeps the identity of named default declarations through diamond re-exports', () => {
    const dir = fixture({
      'app.js': "import { value } from './barrel.js'",
      'barrel.js': "export * from './left.js'; export * from './right.js'",
      'left.js': "export { default as value } from './original.js'",
      'right.js': "export { Example as value } from './original.js'",
      'original.js': 'export default function Example() {}; export { Example }',
    })
    expect(analyzeProject(dir).issues).toEqual([])
  })

  it('checks exact filename casing even on case-insensitive Windows', () => {
    const dir = fixture({
      'app.js': "import { value } from './src/store.js'",
      'src/Store.js': 'export const value = 1',
    })
    expect(analyzeProject(dir).issues).toContainEqual(expect.objectContaining({ message: expect.stringContaining('大小写不匹配') }))
  })

  it('warns about computed imports without rejecting a valid program', () => {
    const dir = fixture({ 'app.js': "const name = 'store'; import(`./src/${name}.js`)" })
    const analysis = analyzeProject(dir)
    expect(analysis.issues).toEqual([])
    expect(analysis.warnings).toContainEqual(expect.objectContaining({ message: expect.stringContaining('动态 import') }))
  })

  it('checks HTML scripts/styles/images and CSS imports/urls relative to their own file', () => {
    const dir = fixture({
      'index.html': '<html><head><link rel=stylesheet href="css/theme.css?rev=1"></head><body><img src="/assets/my%20image.svg#mark"><script src=app.js type=module></script></body></html>',
      'css/theme.css': '@import "./base.css"; .hero { background: url(../assets/my%20image.svg); }',
      'css/base.css': '.icon { background: url(data:image/png;base64,aGVsbG8=) }',
      'assets/my image.svg': '<svg></svg>',
    })
    expect(analyzeProject(dir).issues).toEqual([])
    fs.writeFileSync(path.join(dir, 'css/theme.css'), '.hero { background: url(./missing.svg) }')
    expect(analyzeProject(dir).issues).toContainEqual(expect.objectContaining({ file: 'css/theme.css', message: expect.stringContaining('css/missing.svg') }))
  })

  it('accepts SVG data URIs and local use/filter fragments without bloating the snapshot', () => {
    const data = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg"%3E%3C/svg%3E'
    const dir = fixture({
      'index.html': '<svg xmlns="http://www.w3.org/2000/svg"><defs><g id="local"></g></defs><use href="#local"></use><use href="icons.svg#icon"></use></svg><script type="module" src="app.js"></script>',
      'icons.svg': '<svg></svg>',
      'style.css': `.sample { background: url('${data}'); filter: url(#local-filter); }`,
    })
    const project = analyzeProject(dir)
    expect(validateEgg(dir, project)).toEqual([])
    expect(formatProjectIndex(project)).not.toContain('data:image')
  })

  it('reads CSS escaped filenames and ignores url-looking content strings', () => {
    const dir = fixture({
      'style.css': String.raw`.one { background: url(assets/my\ image.svg); } .two { background: url("assets/my\20 image.svg") } .three { background: url(assets/my\)icon.svg) } .label::before { content: "url(fake.png)" }`,
      'assets/my image.svg': '<svg></svg>',
      'assets/my)icon.svg': '<svg></svg>',
    })
    expect(analyzeProject(dir).issues).toEqual([])
  })

  it('resolves egg root-relative paths from nested modules and same-egg absolute URLs', () => {
    const dir = fixture({
      'app.js': "import { value } from 'egg://project-test/src/value.js'; import './src/deeper/view.js'",
      'src/value.js': 'export const value = 1',
      'src/deeper/view.js': "import { value } from '/src/value.js'",
    })
    const project = analyzeProject(dir)
    expect(project.issues).toEqual([])
    expect(project.warnings).toContainEqual(expect.objectContaining({ message: expect.stringContaining('绑定当前 eggId') }))
    fs.writeFileSync(path.join(dir, 'app.js'), "import 'egg://another-egg/src/value.js'")
    expect(analyzeProject(dir).issues).toContainEqual(expect.objectContaining({ message: expect.stringContaining('不属于当前扭蛋') }))
  })

  it('rejects missing HTML entry resources and ESM in a classic script', () => {
    const dir = fixture({
      'index.html': '<script src="app.js"></script><link rel="stylesheet" href="missing.css">',
      'app.js': 'export const value = 1',
    })
    const messages = analyzeProject(dir).issues.map(i => i.message).join('\n')
    expect(messages).toContain('missing.css')
    expect(messages).toContain('type="module"')
  })

  it('catches even an empty export or top-level await loaded as a classic script', () => {
    for (const app of ['export {}', 'await Promise.resolve()']) {
      const dir = fixture({ 'index.html': '<script src="app.js"></script>', 'app.js': app })
      expect(analyzeProject(dir).issues).toContainEqual(expect.objectContaining({ message: expect.stringContaining('type="module"') }))
    }
  })

  it('does not invent dependencies from JS comments/strings or HTML/CSS comments', () => {
    const dir = fixture({
      'app.js': "// import './not-real.js'\nconst sample = \"import { x } from './fake.js'\"",
      'style.css': '/* .fake { background: url(missing.png) } */',
      'index.html': '<!-- <script src="missing.js"></script> --><script type="module" src="app.js"></script>',
    })
    expect(analyzeProject(dir).issues).toEqual([])
  })

  it('includes pure constants and assets in the snapshot while excluding private paths', () => {
    const dir = fixture({
      'src/constants.js': 'export const MINUTES = 25',
      'assets/icon.svg': '<svg></svg>',
      'data/history.json': 'PRIVATE_DATA',
      'backups/old.js': 'not javascript',
      '.git/config': 'PRIVATE_GIT',
      'node_modules/fake/index.js': 'not javascript',
      'checkpoint.json': 'PRIVATE_CHECKPOINT',
      'build-report.json': 'PRIVATE_RUNTIME_REPORT',
      '.env': 'PRIVATE_KEY',
      'src/secrets.txt': 'PRIVATE_KEY',
    })
    const analysis = analyzeProject(dir)
    expect(analysis.issues).toEqual([])
    expect(analysis.files).toEqual(['app.js', 'assets/icon.svg', 'index.html', 'manifest.json', 'src/constants.js', 'style.css'])
    const doc = generateEggDoc(dir, analysis)
    expect(doc).toContain('## src/constants.js')
    expect(doc).toContain('assets/icon.svg')
    expect(doc).not.toContain('PRIVATE_')
  })

  it('shares private-segment policy for indexes and direct file tools', () => {
    for (const name of ['data', 'DATA', 'backups', 'node_modules', '.env', '.git', 'checkpoint.json', 'checkpoint.saved.json', 'build-report.json', 'credentials.json', 'secrets', 'secrets.txt']) {
      expect(isPrivateProjectSegment(name), name).toBe(true)
    }
    for (const name of ['src', 'app.js', 'widget.js', 'manifest.json', 'constants.json']) expect(isPrivateProjectSegment(name), name).toBe(false)
  })

  it('refuses links and does not enumerate or parse their target', () => {
    const outside = fixture({ 'secret.js': 'not valid javascript' })
    const dir = fixture({ 'app.js': "import './linked/secret.js'" })
    fs.symlinkSync(outside, path.join(dir, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
    const analysis = analyzeProject(dir)
    expect(analysis.files).not.toContain('linked/secret.js')
    expect(analysis.issues).toContainEqual({ file: 'linked', message: '项目内禁止符号链接，未读取目标' })
    expect(analysis.issues.some(i => i.message.includes('JS/ESM 语法错误'))).toBe(false)
  })

  it('rejects escaping, bare, and private module references', () => {
    const dir = fixture({
      'app.js': "import '../outside.js'; import 'some-package'; import './data/private.js'",
      'data/private.js': 'export const secret = 1',
    })
    const messages = analyzeProject(dir).issues.map(i => i.message).join('\n')
    expect(messages).toContain('越出项目目录')
    expect(messages).toContain('裸模块引用')
    expect(messages).toContain('受保护数据')
  })

  it('does not treat module specifiers as fragment-only or whitespace-trimmed asset URLs', () => {
    const dir = fixture({ 'app.js': "import '#unknown'; import ' ./exists.js'", 'exists.js': 'export {}' })
    expect(analyzeProject(dir).issues.filter(i => i.message.includes('裸模块引用'))).toHaveLength(2)
  })

  it('accepts real bundled dayjs and Chart exports from src and ignores unused vendor internals', () => {
    const dir = fixture({
      'app.js': "import './src/stats.js'",
      'src/stats.js': "import Chart from '../vendor/chart.esm.js'; import dayjs from '../vendor/dayjs.esm.js'; console.log(Chart, dayjs)",
      'vendor/unused.js': 'not valid javascript',
    })
    for (const name of ['chart.esm.js', 'dayjs.esm.js']) fs.copyFileSync(path.join(__dirname, '../template/vendor', name), path.join(dir, 'vendor', name))
    const analysis = analyzeProject(dir)
    expect(analysis.issues).toEqual([])
    expect(analysis.modules['vendor/chart.esm.js'].exports).toContain('default')
    expect(analysis.modules['vendor/dayjs.esm.js'].exports).toContain('default')
    expect(analysis.modules['vendor/unused.js']).toBeUndefined()
  })

  it('parses every current bundled vendor without imposing app-only style restrictions', () => {
    const vendorRoot = path.join(__dirname, '../template/vendor')
    const vendors = fs.readdirSync(vendorRoot).filter(name => name.endsWith('.js'))
    const dir = fixture({ 'app.js': vendors.map((name, i) => `import * as lib${i} from './vendor/${name}'`).join('\n') })
    fs.cpSync(vendorRoot, path.join(dir, 'vendor'), { recursive: true })
    const analysis = analyzeProject(dir)
    expect(analysis.issues).toEqual([])
    expect(Object.keys(analysis.modules).filter(name => name.startsWith('vendor/'))).toHaveLength(vendors.length)
  }, 15_000) // Parses every bundled library; allow slower Windows/CI disks without weakening assertions.
})
