import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { KNOWN_PERMISSIONS } from '../shared/types'

export interface ValidationIssue {
  file: string
  message: string
}

const MAX_FILE_BYTES = 500 * 1024
const MAX_TOTAL_BYTES = 2 * 1024 * 1024
const FORBIDDEN_JS = [
  { re: /\brequire\s*\(/, msg: '禁止使用 require()——蛋没有 Node 环境' },
  { re: /\bprocess\s*\./, msg: '禁止访问 process——蛋没有 Node 环境' },
  { re: /['"`]node:/, msg: '禁止引用 node: 模块' },
  { re: /\blocalStorage\b/, msg: '禁止使用 localStorage（迁移会丢数据），用 egg.storage' }
]
const EXTERNAL_URL = /https?:\/\//i

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
        if (relPath === 'data') continue
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
      if (ext === '.js') {
        for (const rule of FORBIDDEN_JS) {
          if (rule.re.test(content)) add(relPath, rule.msg)
        }
        try {
          new vm.Script(content, { filename: relPath })
        } catch (e) {
          add(relPath, `JS 语法错误: ${(e as Error).message}`)
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
