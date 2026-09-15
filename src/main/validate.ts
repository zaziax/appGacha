import fs from 'node:fs'
import path from 'node:path'
import { KNOWN_PERMISSIONS } from '../shared/types'
import { analyzeProject, type ProjectAnalysis } from './projectIndex'

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
// emoji 检测（覆盖常见 emoji Unicode 区段）
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{200D}\u{2B50}\u{2705}\u{274C}\u{2757}\u{2764}\u{2194}-\u{21AA}\u{231A}-\u{23F3}]/u

export function validateEgg(dir: string, project: ProjectAnalysis = analyzeProject(dir)): ValidationIssue[] {
  const issues: ValidationIssue[] = [...project.issues]
  const files = new Set(project.files)
  const add = (file: string, message: string) => issues.push({ file, message })

  // manifest
  let manifest: Record<string, unknown> | null = null
  let isWidget = false
  try {
    if (!files.has('manifest.json')) throw new Error('manifest.json 缺失或不是安全项目文件')
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
    // window 字段（可选）：类型/尺寸/布尔校验，尺寸越界由运行时钳制不报错
    if (manifest.window !== undefined) {
      const w = manifest.window
      if (typeof w !== 'object' || w === null || Array.isArray(w)) {
        add('manifest.json', 'window 必须是对象')
      } else {
        const win = w as Record<string, unknown>
        if (win.type !== undefined && win.type !== 'standard' && win.type !== 'widget') {
          add('manifest.json', 'window.type 只能是 "standard" 或 "widget"')
        }
        isWidget = win.type === 'widget'
        for (const k of ['width', 'height'] as const) {
          if (win[k] !== undefined && (typeof win[k] !== 'number' || !Number.isFinite(win[k] as number))) {
            add('manifest.json', `window.${k} 必须是数字`)
          }
        }
        if (isWidget) {
          for (const k of ['width', 'height'] as const) {
            if (typeof win[k] !== 'number') add('manifest.json', `widget 必须明确声明 window.${k}`)
            else if ((win[k] as number) < 96 || (win[k] as number) > 1600) {
              add('manifest.json', `widget 的 window.${k} 必须在 96~1600 之间`)
            }
          }
        }
        for (const k of ['alwaysOnTop', 'autoStart'] as const) {
          if (win[k] !== undefined && typeof win[k] !== 'boolean') {
            add('manifest.json', `window.${k} 必须是布尔值`)
          }
        }
      }
    }
  }

  if (!files.has('index.html')) add('index.html', '入口文件缺失')

  // widget 专项结构：必须使用形状无关的系统骨架，避免每颗蛋从零实现边界与换页。
  if (isWidget) {
    const indexPath = path.join(dir, 'index.html')
    let html = ''
    try { if (files.has('index.html')) html = fs.readFileSync(indexPath, 'utf-8') } catch { /* 入口缺失已在上方报告 */ }
    const hasClassAndAttr = (className: string, attrName: string) => {
      const classFirst = new RegExp(`<[^>]*class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*${attrName}(?:\\s|=|>)`, 'i')
      const attrFirst = new RegExp(`<[^>]*${attrName}(?:\\s|=|>)[^>]*class=["'][^"']*\\b${className}\\b[^"']*["']`, 'i')
      return classFirst.test(html) || attrFirst.test(html)
    }
    if (!files.has('widget.css') || !/href=["'](?:\.\/)?widget\.css(?:[?#][^"']*)?["']/i.test(html)) {
      add('index.html', 'widget 必须引用受保护的 widget.css')
    }
    if (!files.has('widget.js') || !/<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["'](?:\.\/)?widget\.js(?:[?#][^"']*)?["']|<script\b[^>]*\bsrc=["'](?:\.\/)?widget\.js(?:[?#][^"']*)?["'][^>]*\btype=["']module["']/i.test(html)) {
      add('index.html', 'widget 必须引用受保护的 widget.js')
    }
    if (!/<body\b[^>]*class=["'][^"']*\bwidget-body\b[^"']*["']/i.test(html)) {
      add('index.html', 'widget 的 body 必须使用 widget-body')
    }
    if (!hasClassAndAttr('widget-shell', 'data-widget-shell')) {
      add('index.html', 'widget 缺少 class="widget-shell" data-widget-shell 根节点')
    }
    if (!hasClassAndAttr('widget-surface', 'data-widget-surface')) {
      add('index.html', 'widget 缺少 class="widget-surface" data-widget-surface 可见实体')
    }
    if (!hasClassAndAttr('widget-page', 'data-widget-page=["\'][^"\']+["\']')) {
      add('index.html', 'widget 至少需要一个具名的 class="widget-page" data-widget-page')
    }
  }

  // Reuse the safe index: never follow symlinks or inspect data/checkpoints.
  let total = 0
  const scan = () => {
    for (const relPath of project.files) {
      if (relPath.startsWith('vendor/')) continue
      const abs = path.join(dir, relPath)
      const size = fs.statSync(abs).size
      total += size
      if (size > MAX_FILE_BYTES) add(relPath, `单文件超过 ${MAX_FILE_BYTES / 1024}KB`)

      const ext = path.extname(relPath).toLowerCase()
      if (!['.js', '.mjs', '.cjs', '.html', '.css', '.json', '.md', '.svg', '.txt'].includes(ext)) continue
      const content = fs.readFileSync(abs, 'utf-8')

      // HTML/CSS resources are checked as references by analyzeProject. Scanning
      // their entire text rejects valid SVG data URIs containing the XML namespace.
      if (['.js', '.mjs', '.cjs'].includes(ext) && EXTERNAL_URL.test(content)) {
        add(relPath, '出现外部 http(s) 引用——蛋默认断网，外部资源会加载失败')
      }
      if (['.js', '.html', '.css'].includes(ext) && EMOJI_RE.test(content)) {
        add(relPath, '包含 emoji 字符——禁止使用 emoji，请用 icons.svg 图标代替')
      }
      if (['.js', '.mjs', '.cjs'].includes(ext)) {
        for (const rule of FORBIDDEN_JS) {
          if (rule.re.test(content)) add(relPath, rule.msg)
        }
        // Syntax and actual module imports/exports are checked by analyzeProject using Acorn.
      }
      if (ext === '.html' && /<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/i.test(content)) {
        add(relPath, 'CSP 禁止内联 <script>，JS 必须放外部文件')
      }
    }
  }
  try {
    scan()
  } catch (e) {
    add('.', `扫描失败: ${(e as Error).message}`)
  }
  if (total > MAX_TOTAL_BYTES) add('.', `蛋总体积超过 ${MAX_TOTAL_BYTES / 1024 / 1024}MB`)

  return issues
}
