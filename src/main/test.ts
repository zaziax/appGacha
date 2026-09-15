import fs from 'node:fs'
import path from 'node:path'
import { EggContext, getEgg, loadManifest, registerTestEgg, removeEgg } from './eggs'
import { createEggWindow, disposeTestEggSession } from './eggWindow'
import { cancelAllForEgg } from './schedule'
import { isEggActive } from './registry'
import { RuntimeDiagnostics, type RuntimeDiagnostic } from './runtimeDiagnostics'
import { installRuntimeMonitor } from './runtimeMonitor'
import { abortable, abortReason, waitForRuntime, runRuntimeScenarios, validateRuntimeScenarios, type RuntimeScenario, type RuntimeScenarioResult } from './runtimeScenarios'
import { createRuntimeFixture, type RuntimeFixture } from './runtimeFixture'

export type VerificationStatus = 'passed' | 'failed' | 'not-run'
export interface TestEggOptions {
  screenshotTo?: string
  signal?: AbortSignal
  scenarios?: RuntimeScenario[]
}

export interface TestResult {
  ok: boolean
  consoleErrors: string[]
  widgetIssues: string[]
  blank: boolean
  crashed: boolean
  screenshotPath?: string
  error?: string
  diagnostics: RuntimeDiagnostic[]
  coverage: { resources: VerificationStatus; startup: VerificationStatus; nonBlank: VerificationStatus; widgetGeometry: VerificationStatus; scenarios: VerificationStatus }
  scenarios: RuntimeScenarioResult[]
  aborted: boolean
  environment: { ai: 'mock'; network: 'disabled'; notifications: 'simulated'; schedule: 'storage-only'; fileDialogs: 'cancelled' }
}

// test_egg：按正式运行时规则离屏起蛋，收集报错、检测白屏、截图落盘。egg.ai 走 mock。
export async function testEgg(dir: string, opts?: TestEggOptions): Promise<TestResult> {
  const result: TestResult = {
    ok: false, consoleErrors: [], widgetIssues: [], blank: false, crashed: false,
    diagnostics: [], scenarios: [], aborted: false,
    environment: { ai: 'mock', network: 'disabled', notifications: 'simulated', schedule: 'storage-only', fileDialogs: 'cancelled' },
    coverage: { resources: 'not-run', startup: 'not-run', nonBlank: 'not-run', widgetGeometry: 'not-run', scenarios: 'not-run' }
  }

  let ctx: EggContext
  let ephemeralRegistered = false
  let fixture: RuntimeFixture | undefined
  try {
    if (opts?.signal?.aborted) throw abortReason(opts.signal)
    validateRuntimeScenarios(opts?.scenarios ?? [])
    const manifest = loadManifest(dir)
    const existing = getEgg(manifest.eggId)
    if (existing && path.resolve(existing.dir) !== path.resolve(dir)) {
      throw new Error(`eggId 与已注册的蛋冲突: ${manifest.eggId}`)
    }
    if (existing && isEggActive(manifest.eggId)) throw new Error('Cannot snapshot an egg while another window or Space view is using it')
    fixture = createRuntimeFixture(dir, opts?.signal)
    ctx = registerTestEgg(fixture.dir)
    ephemeralRegistered = true
  } catch (e) {
    result.error = (e as Error).message
    result.aborted = opts?.signal?.aborted === true
    result.diagnostics.push({ kind: result.aborted ? 'cancelled' : 'observer', source: 'test', message: result.error })
    await fixture?.dispose()
    return result
  }

  const previousAiMock = ctx.aiMock
  ctx.aiMock = true
  const runtimeOrigin = ctx.manifest.eggId
  // The host titlebar deliberately falls back when this optional image is absent.
  const optionalHostResources = new Set<string>()
  if (ctx.manifest.window?.type !== 'widget' && !fs.existsSync(path.join(dir, 'icon.svg'))) optionalHostResources.add(`egg://${runtimeOrigin}/icon.svg`)
  const evidence = new RuntimeDiagnostics(optionalHostResources)
  result.diagnostics = evidence.items
  const controller = new AbortController()
  const signal = controller.signal
  let win: ReturnType<typeof createEggWindow> | undefined
  let disposeMonitor: (() => void) | undefined
  let completedStartup = false
  let completing = false
  const cancel = () => controller.abort(opts?.signal?.reason ?? Object.assign(new Error('Runtime test cancelled'), { name: 'AbortError' }))
  opts?.signal?.addEventListener('abort', cancel, { once: true })
  if (opts?.signal?.aborted) cancel()
  const stopWindow = () => { if (win && !win.isDestroyed()) win.destroy() }
  signal.addEventListener('abort', stopWindow, { once: true })
  // Caps hung JS, blocked dialogs, hidden-window animation frames, and scenario evaluation.
  const deadline = setTimeout(() => controller.abort(new Error('Runtime test timed out (45s)')), 45_000)

  try {
    if (signal.aborted) throw abortReason(signal)
    win = createEggWindow(ctx, { show: false, deferLoad: true, testMode: true })
    const contents = win.webContents
    contents.on('console-message', event => {
      const level = event.level
      const message = event.message
      if (level === 'error') evidence.add({ kind: 'console', source: 'electron', message, url: event.sourceId, line: event.lineNumber })
      else if (level === 'warning' && /vendor\/[\w.-]+/.test(message)) evidence.add({ kind: 'console', source: 'electron', message: `[依赖降级] ${message}`, url: event.sourceId })
    })
    contents.on('preload-error', (_event, preloadPath, error) => evidence.add({ kind: 'preload', source: 'electron', message: error.message, url: preloadPath }))
    contents.on('render-process-gone', (_event, details) => {
      result.crashed = true
      evidence.add({ kind: 'crash', source: 'electron', message: `Renderer gone: ${details.reason}` })
    })
    contents.on('did-fail-load', (_event, code, description, url) => evidence.add({ kind: 'navigation', source: 'electron', message: `Navigation failed (${code}): ${description}`, url }))
    win.on('closed', () => {
      if (!completing && !signal.aborted) controller.abort(new Error('Test window closed before verification completed'))
    })
    // Electron may not start a renderer for a deferred empty window. Bootstrap with
    // a host-written inert document, never the generated entrypoint, before CDP setup.
    await abortable(win.loadURL(`egg://${runtimeOrigin}/${fixture!.bootstrapFile}`), signal)
    disposeMonitor = await installRuntimeMonitor(contents, evidence, signal)
    let loadTimer: ReturnType<typeof setTimeout> | undefined
    try {
      loadTimer = setTimeout(() => controller.abort(new Error('Runtime page load timed out (15s)')), 15_000)
      await abortable(win.loadURL(`egg://${runtimeOrigin}/index.html`), signal)
    } finally { clearTimeout(loadTimer) }

    // 给异步初始化留时间（建表、首次渲染等）
    await waitForRuntime(1800, signal)
    completedStartup = true

    const evaluate = (source: string): Promise<any> => abortable(contents.executeJavaScript(source), signal)
    const view = await evaluate(`(() => {
      const body = document.body?.cloneNode(true);
      body?.querySelectorAll('#__egg_titlebar, #__egg_confirm, script, style').forEach(node => node.remove());
      return { textLen:(body?.textContent ?? '').trim().length, nodeCount:body?.querySelectorAll('*').length ?? 0 };
    })()`)
    result.blank = view.textLen === 0 && view.nodeCount < 3
    result.coverage.nonBlank = result.blank ? 'failed' : 'passed'

    // widget 专项运行时验收：逐页检查根溢出、不可达裁切和交互控件越界。
    if (ctx.manifest.window?.type === 'widget') {
      result.widgetIssues = await evaluate(`(async () => {
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
      result.coverage.widgetGeometry = result.widgetIssues.length ? 'failed' : 'passed'
    }

    if (opts?.scenarios?.length && evidence.items.length === 0 && !result.blank && !result.widgetIssues.length) {
      result.scenarios = await runRuntimeScenarios(opts.scenarios, evaluate, signal)
      const failed = result.scenarios.find(scenario => !scenario.ok)
      result.coverage.scenarios = failed ? 'failed' : 'passed'
      if (failed) evidence.add({ kind: 'scenario', source: 'test', message: `${failed.name}: ${failed.error ?? 'Scenario failed'}` })
      // Let queued rejection/error events from the final interaction reach the main process.
      await waitForRuntime(100, signal)
    }

    if (opts?.screenshotTo || ctx.manifest.window?.type === 'widget') {
      const image = await abortable(contents.capturePage(), signal)
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

    if (ctx.manifest.window?.type === 'widget') result.coverage.widgetGeometry = result.widgetIssues.length ? 'failed' : 'passed'
    if (signal.aborted) throw abortReason(signal)
    result.ok = evidence.items.length === 0 && result.widgetIssues.length === 0 && !result.blank && !result.crashed
  } catch (e) {
    result.error = (e as Error).message
    result.aborted = opts?.signal?.aborted === true
    evidence.add({ kind: result.aborted ? 'cancelled' : 'observer', source: 'test', message: result.error })
  } finally {
    completing = true
    clearTimeout(deadline)
    opts?.signal?.removeEventListener('abort', cancel)
    signal.removeEventListener('abort', stopWindow)
    disposeMonitor?.()
    stopWindow()
    try { await disposeTestEggSession(ctx) } catch (e) {
      result.ok = false
      result.error = `Could not clean isolated runtime session: ${(e as Error).message}`
      evidence.add({ kind: 'observer', source: 'test', message: result.error })
    }
    ctx.aiMock = previousAiMock
    result.consoleErrors = evidence.items.filter(item => item.kind !== 'cancelled').map(item => `${item.kind}: ${item.message}${item.url ? ` [${item.url}${item.line ? `:${item.line}` : ''}]` : ''}`)
    if (completedStartup && !signal.aborted) {
      result.coverage.resources = evidence.items.some(item => item.kind === 'resource' || item.kind === 'csp') ? 'failed' : 'passed'
      result.coverage.startup = evidence.items.some(item => item.kind !== 'scenario') ? 'failed' : 'passed'
    }
    if (signal.aborted || result.error) result.ok = false
    if (ephemeralRegistered) {
      cancelAllForEgg(ctx.eggId) // 试跑期蛋代码可能设了提醒，临时蛋销毁后不能留定时器
      removeEgg(ctx.eggId)
    }
    try { await fixture?.dispose() } catch (e) {
      result.ok = false
      result.error = `Could not clean isolated runtime fixture: ${(e as Error).message}`
      evidence.add({ kind: 'observer', source: 'test', message: result.error })
    }
  }
  return result
}
