/**
 * 构建 Lucide SVG sprite + manifest
 * 用法: node scripts/build-icons.mjs
 * 输出: template/icons.svg, template/icons-manifest.json
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ICONS_DIR = join(import.meta.dirname, '..', 'node_modules', 'lucide-static', 'icons')
const OUT_DIR = join(import.meta.dirname, '..', 'template')

const files = readdirSync(ICONS_DIR).filter(f => f.endsWith('.svg')).sort()

const symbols = []
const names = []

for (const file of files) {
  const name = file.replace('.svg', '')
  const raw = readFileSync(join(ICONS_DIR, file), 'utf-8')
  // 提取 <svg> 内部内容（去掉外层 <svg> 标签和注释）
  const inner = raw
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<svg[^>]*>/, '')
    .replace(/<\/svg>/, '')
    .trim()
  symbols.push(`<symbol id="${name}" viewBox="0 0 24 24">${inner}</symbol>`)
  names.push(name)
}

const sprite = `<svg xmlns="http://www.w3.org/2000/svg" style="display:none">\n${symbols.join('\n')}\n</svg>\n`
writeFileSync(join(OUT_DIR, 'icons.svg'), sprite, 'utf-8')
writeFileSync(join(OUT_DIR, 'icons-manifest.json'), JSON.stringify(names, null, 0), 'utf-8')

const sizeKB = (Buffer.byteLength(sprite) / 1024).toFixed(0)
console.log(`✓ ${names.length} icons → icons.svg (${sizeKB} KB) + icons-manifest.json`)
