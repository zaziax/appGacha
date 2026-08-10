// 布局复现探针：不依赖 Electron GPU，用系统 Edge headless 复现蛋 + 宿主标题栏的真实布局
// 用法: node scripts/repro-layout.mjs <蛋目录> [--show]
// 产物: dist/repro-<蛋名>.png 截图 + stdout 输出几何 JSON
// 原理: 拷贝蛋目录到临时目录，在 index.html 里注入 preload 的宿主标题栏 DOM/CSS
//        （照抄 src/preload/index.ts injectTitleBar）+ mock egg bridge，量应用壳几何。
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)(
  'C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules/playwright-core'
)

const eggDir = process.argv[2]
if (!eggDir) { console.error('usage: node scripts/repro-layout.mjs <eggDir> [--base <base.css 路径>]'); process.exit(1) }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const absEgg = path.resolve(root, eggDir)
// --base：用指定 base.css 覆盖蛋内的（模拟"未来蛋使用修复后模板"的场景）
const baseIdx = process.argv.indexOf('--base')
const baseOverride = baseIdx > 0 ? path.resolve(root, process.argv[baseIdx + 1]) : null
// --remove <selector>：加载后移除匹配元素（模拟"未来蛋去掉重复标题"等场景）
const removeIdx = process.argv.indexOf('--remove')
const removeSelector = removeIdx > 0 ? process.argv[removeIdx + 1] : null
const manifest = JSON.parse(fs.readFileSync(path.join(absEgg, 'manifest.json'), 'utf-8'))

// ---- 1. 拷贝蛋目录到临时目录并改造 index.html ----
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'egg-repro-'))
const copyDir = (src, dst) => {
  fs.mkdirSync(dst, { recursive: true })
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name)
    if (e.isDirectory()) copyDir(s, d)
    else fs.copyFileSync(s, d)
  }
}
copyDir(absEgg, tmp)
if (baseOverride) fs.copyFileSync(baseOverride, path.join(tmp, 'base.css'))

// 宿主标题栏：与 src/preload/index.ts injectTitleBar 完全一致
const TITLEBAR_HTML = `
<div id="__egg_titlebar">
  <style>
    #__egg_titlebar {
      position: fixed; top: 0; left: 0; right: 0; z-index: 2147483646;
      height: 38px; display: flex; align-items: center; justify-content: space-between;
      padding: 0 8px;
      background: var(--card, #fff);
      border-bottom: 1px solid var(--border, #e8e4dc);
      font-family: system-ui, "Microsoft YaHei", sans-serif;
      -webkit-app-region: drag; user-select: none;
    }
    #__egg_titlebar .tb-left { display: flex; align-items: center; gap: 6px; padding-left: 4px; font-size: 13px; font-weight: 600; color: var(--text, #2b2b30); }
    #__egg_titlebar .tb-right { display: flex; align-items: center; gap: 2px; -webkit-app-region: no-drag; }
    #__egg_titlebar .tb-right button { width: 34px; height: 26px; border: none; background: none; border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center; color: var(--text-3, #8a8a92); font-size: 16px; line-height: 1; transition: background 0.15s, color 0.15s; font-family: inherit; padding: 0; }
    #__egg_titlebar .tb-right button:hover { background: var(--bg-inset, #f2f0ec); color: var(--text, #2b2b30); }
    #__egg_titlebar .tb-right button.tb-close:hover { background: var(--bad, #c0574f); color: #fff; }
    body.__egg-frameless { padding-top: 38px !important; }
  </style>
  <div class="tb-left"><span class="tb-title">${manifest.name}</span></div>
  <div class="tb-right"><button>—</button><button>□</button><button class="tb-close">×</button></div>
</div>`

const MOCK_BRIDGE = `<script>
window.egg = {
  hostApiVersion: '1',
  storage: { get: async () => null, set: async () => {}, delete: async () => {} },
  db: { exec: async () => {}, query: async () => [] },
  ai: { chat: async () => '清风送爽\\n南风知我意，吹梦到西洲', extract: async () => ({}) },
  fs: { read: async () => '', write: async () => {}, list: async () => [] },
  notify: { send: async () => {} },
  schedule: { set: async () => {}, cancel: async () => {}, list: async () => [] },
  window: { setAlwaysOnTop: async () => {}, setSize: async () => {} },
  net: { createRoom: async () => { throw new Error('noop') }, findRooms: async () => [], joinRoom: async () => { throw new Error('noop') } },
  ui: { toast: () => {}, confirm: async () => true, pickFile: async () => null, saveFile: async () => null },
  minimize: () => {}, maximize: () => {}, close: () => {}, isMaximized: async () => false
}
</script>`

const htmlPath = path.join(tmp, 'index.html')
let html = fs.readFileSync(htmlPath, 'utf-8')
html = html.replace(/<body([^>]*)>/, (m, attrs) => {
  const withClass = /class="([^"]*)"/.test(attrs)
    ? attrs.replace(/class="([^"]*)"/, 'class="$1 __egg-frameless"')
    : attrs + ' class="__egg-frameless"'
  return `<body${withClass}>${MOCK_BRIDGE}${TITLEBAR_HTML}`
})
fs.writeFileSync(htmlPath, html, 'utf-8')

// ---- 2. Edge headless 加载，量几何 + 截图 ----
const spec = manifest.window ?? {}
const vw = Math.min(1600, Math.max(240, Math.round(spec.width ?? 900)))
const vh = Math.min(1600, Math.max(240, Math.round(spec.height ?? 640)))

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1 })
page.on('console', msg => { if (msg.type() === 'error') console.error('[egg console]', msg.text()) })
page.on('pageerror', err => console.error('[egg pageerror]', err.message))

await page.goto(pathToFileURL(htmlPath).href)
await page.waitForTimeout(1800)
if (removeSelector) {
  await page.evaluate((sel) => document.querySelector(sel)?.remove(), removeSelector)
  await page.waitForTimeout(200)
}

const geo = await page.evaluate(`(() => {
  const q = (s) => {
    const el = document.querySelector(s)
    if (!el) return null
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    const rd = (v) => Math.round(v * 10) / 10
    return { x: rd(r.x), y: rd(r.y), w: rd(r.width), h: rd(r.height),
      margin: cs.margin, padding: cs.padding, display: cs.display, position: cs.position }
  }
  const bodyR = document.body.getBoundingClientRect()
  return {
    viewport: { w: innerWidth, h: innerHeight },
    docClientW: document.documentElement.clientWidth,
    docScrollW: document.documentElement.scrollWidth,
    bodyClass: document.body.className,
    bodyRect: { x: bodyR.x, y: bodyR.y, w: bodyR.width, h: bodyR.height },
    bodyCS: { margin: getComputedStyle(document.body).margin, padding: getComputedStyle(document.body).padding },
    titlebar: q('#__egg_titlebar'),
    toolbar: q('.toolbar'),
    content: q('.content'),
    actionbar: q('.actionbar')
  }
})()`)
console.log(JSON.stringify(geo, null, 2))

const out = path.join(root, 'dist', `repro-${manifest.name}.png`)
fs.mkdirSync(path.dirname(out), { recursive: true })
await page.screenshot({ path: out })
console.log('screenshot ->', out)

await browser.close().catch(() => {})
try { fs.rmSync(tmp, { recursive: true, force: true }) } catch {}
