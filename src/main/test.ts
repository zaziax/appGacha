import fs from 'node:fs'
import path from 'node:path'
import { EggContext, getEgg, loadManifest, registerEgg, removeEgg } from './eggs'
import { createEggWindow } from './eggWindow'
import { cancelAllForEgg } from './schedule'

export interface TestResult {
  ok: boolean
  consoleErrors: string[]
  widgetIssues: string[]
  blank: boolean
  crashed: boolean
  screenshotPath?: string
  error?: string
}

// test_egg：按正式运行时规则离屏起蛋，收集报错、检测白屏、截图落盘。egg.ai 走 mock。
export async function testEgg(dir: string, opts?: { screenshotTo?: string }): Promise<TestResult> {
  const result: TestResult = { ok: false, consoleErrors: [], widgetIssues: [], blank: false, crashed: false }

  let ctx: EggContext
  let ephemeralRegistered = false
  try {
    const manifest = loadManifest(dir)
    const existing = getEgg(manifest.eggId)
    if (existing && path.resolve(existing.dir) !== path.resolve(dir)) {
      throw new Error(`eggId 与已注册的蛋冲突: ${manifest.eggId}`)
    }
    if (existing) {
      ctx = existing
    } else {
      ctx = registerEgg(dir)
      ctx.ephemeral = true
      ephemeralRegistered = true
    }
  } catch (e) {
    result.error = (e as Error).message
    return result
  }

  ctx.aiMock = true
  const win = createEggWindow(ctx, { show: false })
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 3) result.consoleErrors.push(message)
    // vendor 依赖加载失败的 warn 视同错误——静默降级不能骗过验收
    else if (level === 2 && /vendor\/[\w.-]+/.test(message)) result.consoleErrors.push(`[依赖降级] ${message}`)
  })
  win.webContents.on('render-process-gone', (_e, details) => {
    result.crashed = true
    result.consoleErrors.push(`renderer gone: ${details.reason}`)
  })

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('load timeout (15s)')), 15_000)
      win.webContents.once('did-finish-load', () => { clearTimeout(timer); resolve() })
      win.webContents.once('did-fail-load', (_e, code, desc) => {
        clearTimeout(timer)
        reject(new Error(`did-fail-load ${code} ${desc}`))
      })
    })

    // 给异步初始化留时间（建表、首次渲染等）
    await new Promise(r => setTimeout(r, 1800))

    const view = await win.webContents.executeJavaScript(`({
      textLen: document.body.innerText.trim().length,
      nodeCount: document.body.querySelectorAll('*').length
    })`)
    result.blank = view.textLen === 0 && view.nodeCount < 3

    // widget 专项运行时验收：逐页检查根溢出、不可达裁切和交互控件越界。
    if (ctx.manifest.window?.type === 'widget') {
      result.widgetIssues = await win.webContents.executeJavaScript(`(async () => {
        const issues = []
        const vw = window.innerWidth
        const vh = window.innerHeight
        const shell = document.querySelector('[data-widget-shell]')
        const surface = document.querySelector('[data-widget-surface]')
        if (!shell || !surface) return ['Widget Shell 未在运行时挂载']

        const rootOverflow = document.documentElement.scrollWidth > vw + 1 ||
          document.documentElement.scrollHeight > vh + 1 ||
          document.body.scrollWidth > vw + 1 || document.body.scrollHeight > vh + 1
        if (rootOverflow) issues.push('根页面超出透明窗口；只能在 .widget-scroll 内滚动')

        const sr = surface.getBoundingClientRect()
        if (sr.left < -1 || sr.top < -1 || sr.right > vw + 1 || sr.bottom > vh + 1) {
          issues.push('data-widget-surface 超出透明窗口边界')
        }
        const safeInset = Math.min(sr.left, sr.top, vw - sr.right, vh - sr.bottom)
        if (safeInset < 8) {
          issues.push('可见实体与窗口边缘的透明安全带不足 8px，容易暴露矩形边界')
        }

        const pages = [...document.querySelectorAll('[data-widget-page]')]
        const original = pages.map(page => ({
          page,
          active: page.getAttribute('data-active'),
          inert: page.hasAttribute('inert'),
          aria: page.getAttribute('aria-hidden')
        }))

        const visible = el => {
          const style = getComputedStyle(el)
          const rect = el.getBoundingClientRect()
          return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0.01 && rect.width > 0 && rect.height > 0
        }
        const auditPage = page => {
          const name = page.getAttribute('data-widget-page') || '未命名页'
          const clipped = page.scrollHeight > page.clientHeight + 2 || page.scrollWidth > page.clientWidth + 2
          if (clipped && !page.querySelector('.widget-scroll')) {
            issues.push('页面「' + name + '」内容被裁切且没有 .widget-scroll')
          }
          const controls = page.querySelectorAll('button, input, select, textarea, [role="button"], a[href]')
          for (const control of controls) {
            if (!visible(control)) continue
            const r = control.getBoundingClientRect()
            if (r.left < sr.left - 1 || r.top < sr.top - 1 || r.right > sr.right + 1 || r.bottom > sr.bottom + 1) {
              const label = control.getAttribute('aria-label') || control.textContent?.trim().slice(0, 24) || control.tagName.toLowerCase()
              issues.push('页面「' + name + '」控件「' + label + '」超出可见实体，可能被裁切')
            }
          }
        }

        for (const page of pages) {
          for (const other of pages) {
            other.setAttribute('data-active', String(other === page))
            if (other === page) other.removeAttribute('inert'); else other.setAttribute('inert', '')
          }
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
          auditPage(page)
        }

        for (const state of original) {
          if (state.active === null) state.page.removeAttribute('data-active'); else state.page.setAttribute('data-active', state.active)
          if (state.inert) state.page.setAttribute('inert', ''); else state.page.removeAttribute('inert')
          if (state.aria === null) state.page.removeAttribute('aria-hidden'); else state.page.setAttribute('aria-hidden', state.aria)
        }
        return [...new Set(issues)]
      })()`)
    }

    if (opts?.screenshotTo || ctx.manifest.window?.type === 'widget') {
      const image = await win.webContents.capturePage()
      if (ctx.manifest.window?.type === 'widget') {
        const size = image.getSize()
        const bitmap = image.toBitmap()
        if (size.width > 4 && size.height > 4 && bitmap.length === size.width * size.height * 4) {
          let visibleAtEdge = 0
          let edgePixels = 0
          const band = Math.min(3, Math.floor(Math.min(size.width, size.height) / 2))
          for (let y = 0; y < size.height; y++) {
            for (let x = 0; x < size.width; x++) {
              if (x >= band && y >= band && x < size.width - band && y < size.height - band) continue
              const alpha = bitmap[(y * size.width + x) * 4 + 3]
              edgePixels++
              if (alpha > 4) visibleAtEdge++
            }
          }
          if (edgePixels > 0 && visibleAtEdge / edgePixels > 0.05) {
            result.widgetIssues.push('窗口边缘存在可见像素，实体、背景或外阴影可能已暴露矩形边界')
          }
        }
      }
      if (opts?.screenshotTo) {
        fs.mkdirSync(path.dirname(opts.screenshotTo), { recursive: true })
        fs.writeFileSync(opts.screenshotTo, image.toPNG())
        result.screenshotPath = opts.screenshotTo
      }
    }

    result.ok = result.consoleErrors.length === 0 && result.widgetIssues.length === 0 && !result.blank && !result.crashed
  } catch (e) {
    result.error = (e as Error).message
  } finally {
    win.destroy()
    ctx.aiMock = false
    if (ephemeralRegistered) {
      cancelAllForEgg(ctx.eggId) // 试跑期蛋代码可能设了提醒，临时蛋销毁后不能留定时器
      removeEgg(ctx.eggId)
    }
  }
  return result
}
