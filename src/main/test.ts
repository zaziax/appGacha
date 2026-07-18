import fs from 'node:fs'
import path from 'node:path'
import { EggContext, getEgg, loadManifest, registerEgg, removeEgg } from './eggs'
import { createEggWindow } from './eggWindow'
import { cancelAllForEgg } from './schedule'

export interface TestResult {
  ok: boolean
  consoleErrors: string[]
  blank: boolean
  crashed: boolean
  screenshotPath?: string
  error?: string
}

// test_egg：按正式运行时规则离屏起蛋，收集报错、检测白屏、截图落盘。egg.ai 走 mock。
export async function testEgg(dir: string, opts?: { screenshotTo?: string }): Promise<TestResult> {
  const result: TestResult = { ok: false, consoleErrors: [], blank: false, crashed: false }

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

    if (opts?.screenshotTo) {
      const image = await win.webContents.capturePage()
      fs.mkdirSync(path.dirname(opts.screenshotTo), { recursive: true })
      fs.writeFileSync(opts.screenshotTo, image.toPNG())
      result.screenshotPath = opts.screenshotTo
    }

    result.ok = result.consoleErrors.length === 0 && !result.blank && !result.crashed
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
