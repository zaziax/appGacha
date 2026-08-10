/**
 * 构建 vendor ESM 库
 * 用法: node scripts/build-vendor.mjs
 * 输出: template/vendor/*.esm.js
 */
import { buildSync } from 'esbuild'
import { mkdirSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const OUT = join(ROOT, 'template', 'vendor')
mkdirSync(OUT, { recursive: true })

const bundle = (entry, outfile, opts = {}) => {
  buildSync({
    entryPoints: [join(ROOT, 'node_modules', entry)],
    bundle: true,
    format: 'esm',
    minify: true,
    platform: 'browser',
    target: 'es2022',
    outfile: join(OUT, outfile),
    ...opts
  })
  console.log(`  ✓ ${outfile}`)
}

console.log('Building vendor ESM libraries...')

// three.js — 已有原生 ESM，直接复制（不 minify，保留可读性供 AI 参考）
copyFileSync(
  join(ROOT, 'node_modules/three/build/three.module.js'),
  join(OUT, 'three.module.js')
)
console.log('  ✓ three.module.js (copy)')

// chart.js — 必须用 auto 入口：自动注册全部 controllers/elements/scales + 提供 default export
// （dist/chart.js 是裸入口，new Chart({type:'doughnut'}) 会报 "not a registered controller"）
bundle('chart.js/auto/auto.js', 'chart.esm.js')

// dayjs — CJS → ESM
bundle('dayjs/dayjs.min.js', 'dayjs.esm.js')

// marked — 已有 ESM
bundle('marked/lib/marked.esm.js', 'marked.esm.js')

// qrcode — CJS browser 入口 → ESM（esbuild 从包入口解析，自动处理 browser 字段）
buildSync({
  entryPoints: ['qrcode'],
  bundle: true,
  format: 'esm',
  minify: true,
  platform: 'browser',
  target: 'es2022',
  outfile: join(OUT, 'qrcode.esm.js'),
  nodePaths: [join(ROOT, 'node_modules')]
})
console.log('  ✓ qrcode.esm.js')

// canvas-confetti — 原生 ESM (dist/confetti.module.mjs)
bundle('canvas-confetti/dist/confetti.module.mjs', 'canvas-confetti.esm.js')

console.log('Done.')
