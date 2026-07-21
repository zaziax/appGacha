import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { KNOWN_PERMISSIONS } from '../shared/types'

export interface ValidationIssue {
  file: string
  message: string
}

const MAX_FILE_BYTES = 500 * 1024
const MAX_TOTAL_BYTES = 5 * 1024 * 1024   // vendor 库可能较大
const FORBIDDEN_JS = [
  { re: /\brequire\s*\(/, msg: '禁止使用 require()——蛋没有 Node 环境' },
  { re: /\bprocess\s*\./, msg: '禁止访问 process——蛋没有 Node 环境' },
  { re: /['"`]node:/, msg: '禁止引用 node: 模块' },
  { re: /\blocalStorage\b/, msg: '禁止使用 localStorage（迁移会丢数据），用 egg.storage' }
]
const EXTERNAL_URL = /https?:\/\//i
// ESM 检测：含顶层 import/export 的文件不用 vm.Script 检查（vm.Script 不支持模块语法）
const ESM_RE = /(?:^|\n)\s*(?:import\s[\s\S]*?from\s|import\s*\(|export\s+(?:default\s|const\s|function\s|class\s|\{))/
// emoji 检测（覆盖常见 emoji Unicode 区段）
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{200D}\u{2B50}\u{2705}\u{274C}\u{2757}\u{2764}\u{2194}-\u{21AA}\u{231A}-\u{23F3}]/u

export function validateEgg(dir: string): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const add = (file: string, message: string) => issues.push({ file, message })

  // manifest
  let manifest: Record<string, unknown> | null = null
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf-8'))
  } catch (e) {
    add('manifest.json', `无法解析: ${(e as Error).message}`)
  }
  if (manifest) {
    if (typeof manifest.eggId !== 'string' || !manifest.eggId || manifest.eggId === '__PLACEHOLDER__') {
      add('manifest.json', 'eggId 缺失')
    } else if (manifest.eggId !== (manifest.eggId as string).toLowerCase()) {
      add('manifest.json', 'eggId 必须全小写')
    }
    if (typeof manifest.name !== 'string' || !(manifest.name as string).trim() || manifest.name === '未命名扭蛋') {
      add('manifest.json', 'name 必须填写一个有意义的应用名')
    }
    if (manifest.hostApiVersion !== '1') add('manifest.json', 'hostApiVersion 必须是 "1"')
    if (!Array.isArray(manifest.permissions)) {
      add('manifest.json', 'permissions 必须是数组')
    } else {
      for (const p of manifest.permissions as unknown[]) {
        if (!KNOWN_PERMISSIONS.includes(p as never)) add('manifest.json', `未知权限 "${p}"`)
      }
    }
  }

  if (!fs.existsSync(path.join(dir, 'index.html'))) add('index.html', '入口文件缺失')

  // 逐文件扫描（跳过 data/）
  let total = 0
  const walk = (rel: string) => {
    for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const relPath = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (relPath === 'data' || relPath === 'vendor') continue  // vendor 是宿主资产，不扫描
        walk(relPath)
        continue
      }
      const abs = path.join(dir, relPath)
      const size = fs.statSync(abs).size
      total += size
      if (size > MAX_FILE_BYTES) add(relPath, `单文件超过 ${MAX_FILE_BYTES / 1024}KB`)

      const ext = path.extname(entry.name).toLowerCase()
      if (!['.js', '.html', '.css', '.json', '.md', '.svg', '.txt'].includes(ext)) continue
      const content = fs.readFileSync(abs, 'utf-8')

      if (['.js', '.html', '.css'].includes(ext) && EXTERNAL_URL.test(content)) {
        add(relPath, '出现外部 http(s) 引用——蛋默认断网，外部资源会加载失败')
      }
      if (['.js', '.html', '.css'].includes(ext) && EMOJI_RE.test(content)) {
        add(relPath, '包含 emoji 字符——禁止使用 emoji，请用 icons.svg 图标代替')
      }
      if (ext === '.js') {
        for (const rule of FORBIDDEN_JS) {
          if (rule.re.test(content)) add(relPath, rule.msg)
        }
        // ESM 文件跳过 vm.Script（不支持 import/export 语法），由 testEgg 在 Chromium 中实际加载验证
        if (!ESM_RE.test(content)) {
          try {
            new vm.Script(content, { filename: relPath })
          } catch (e) {
            add(relPath, `JS 语法错误: ${(e as Error).message}`)
          }
        }
      }
      if (ext === '.html' && /<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/i.test(content)) {
        add(relPath, 'CSP 禁止内联 <script>，JS 必须放外部文件')
      }
    }
  }
  try {
    walk('')
  } catch (e) {
    add('.', `扫描失败: ${(e as Error).message}`)
  }
  if (total > MAX_TOTAL_BYTES) add('.', `蛋总体积超过 ${MAX_TOTAL_BYTES / 1024 / 1024}MB`)

  return issues
}
