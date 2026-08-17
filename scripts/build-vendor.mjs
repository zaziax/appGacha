// 生成 template/vendor/*.esm.js 的构建脚本。
// 依赖 node_modules 里的库（见 package.json devDependencies），
// 用 esbuild 把每个库打成「自包含浏览器 ESM」单文件。
// 用法：node scripts/build-vendor.mjs
import { build } from 'esbuild'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const VENDOR = path.join(ROOT, 'template', 'vendor')

const common = {
  bundle: true,
  format: 'esm',
  platform: 'browser',
  minify: true,
  target: 'es2020',
  logLevel: 'warning',
  absWorkingDir: ROOT,
}

// entry 为空表示「直接拷贝 dist 里已自包含的 ESM 文件」
const jobs = [
  // 注意：官方 three.module.js 拆分了 three.core.js（跨文件 import），单独拷贝会缺兄弟文件。
  // 这里必须 bundle 成自包含单文件，否则 `import * as THREE` 在运行时解析 ./three.core.js 失败。
  { entry: 'three', out: 'three.module.js' },
  { entry: 'exceljs', out: 'exceljs.esm.js' },                       // browser 字段 → dist/exceljs.min.js（UMD→default）
  { entry: 'mathjs', out: 'math.esm.js' },                          // exports["."].import → lib/esm（命名 + default）
  { entry: 'scripts/vendor-entry/pdfmake.js', out: 'pdfmake.esm.js' }, // 注入 vfs 字体
  { copy: 'node_modules/js-yaml/dist/js-yaml.mjs', out: 'jsyaml.esm.js' }, // 自包含，命名导出 load/dump
  { entry: 'diff', out: 'jsdiff.esm.js' },                           // exports["."].import → libesm（命名导出）
  { entry: 'matter-js/build/matter.js', out: 'matter.esm.js' },      // UMD→default 命名空间
  { copy: 'node_modules/animejs/dist/bundles/anime.esm.js', out: 'anime.esm.js' }, // 自包含，命名导出 animate 等
  { entry: 'tone/build/esm/index.js', out: 'tone.esm.js' },          // 命名导出 + 命名空间用法
  { copy: 'node_modules/p5/lib/p5.esm.min.js', out: 'p5.esm.js' },   // 自包含，default 导出
  { entry: 'scripts/vendor-entry/katex.js', out: 'katex.esm.js' },    // 运行时注入 CSS；字体/CSS 在 katex/ 子目录
]

fs.mkdirSync(VENDOR, { recursive: true })

for (const job of jobs) {
  const target = path.join(VENDOR, job.out)
  if (job.copy) {
    fs.copyFileSync(path.join(ROOT, job.copy), target)
    console.log(`copy   ${job.copy} → ${job.out}`)
  } else {
    await build({
      ...common,
      entryPoints: [job.entry],
      outfile: target,
    })
    console.log(`bundle ${job.entry} → ${job.out}`)
  }
}

// KaTeX 是第一个带资产子目录的 vendor：CSS + 字体（CSP font-src 'self' 只许本地字体，不能内联 data:）。
// 字体只拷 .woff2（Electron=Chromium 必支持；CSS 里的 .woff/.ttf 是 fallback，运行时用不到）。
fs.mkdirSync(path.join(VENDOR, 'katex'), { recursive: true })
fs.copyFileSync(
  path.join(ROOT, 'node_modules/katex/dist/katex.min.css'),
  path.join(VENDOR, 'katex', 'katex.min.css'),
)
fs.cpSync(
  path.join(ROOT, 'node_modules/katex/dist/fonts'),
  path.join(VENDOR, 'katex', 'fonts'),
  { recursive: true, filter: (src) => fs.statSync(src).isDirectory() || src.endsWith('.woff2') },
)
console.log('copy   katex.min.css + fonts(.woff2) → katex/')

console.log('\n完成。检查每个文件头尾确认导出形状与无残留裸导入。')
