import { BrowserWindow } from 'electron'
import { EggContext } from './eggs'
import { createEggWindow } from './eggWindow'
import { createShelfWindow } from './shelfWindow'

function waitForLoad(win: BrowserWindow, timeoutMs = 10_000): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`load timeout (${timeoutMs}ms)`)), timeoutMs)
    win.webContents.once('did-finish-load', () => { clearTimeout(timer); resolve() })
    win.webContents.once('did-fail-load', (_e, code, desc) => {
      clearTimeout(timer)
      reject(new Error(`did-fail-load ${code} ${desc}`))
    })
  })
}

// 收藏柜冒烟：离屏开柜，探测 shelf bridge 与蛋列表渲染
export async function runShelfSmoke(expectedEggs: number): Promise<boolean> {
  console.log('[smoke] shelf')
  const win = createShelfWindow({ show: false })
  const consoleErrors: string[] = []
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 3) consoleErrors.push(message)
  })

  try {
    await waitForLoad(win)
    const probe = await win.webContents.executeJavaScript(`(async () => {
      const eggs = await shelf.list()
      return {
        bridge: typeof shelf === 'object',
        count: eggs.length,
        cards: document.querySelectorAll('.egg-card').length
      }
    })()`)

    const pass =
      probe.bridge === true &&
      probe.count === expectedEggs &&
      consoleErrors.length === 0
    console.log(`[smoke] shelf probe=${JSON.stringify(probe)} expected=${expectedEggs} consoleErrors=${consoleErrors.length}`)

    // 截图落盘，供人工/智能体视觉检查（test_egg 截图自查的雏形）
    const image = await win.webContents.capturePage()
    const { writeFileSync } = await import('node:fs')
    writeFileSync('dist/smoke-shelf.png', image.toPNG())

    console.log(pass ? '[smoke] shelf PASS' : '[smoke] shelf FAIL')
    return pass
  } catch (e) {
    console.error(`[smoke] shelf FAIL: ${(e as Error).message}`)
    if (consoleErrors.length) console.error('[smoke] console errors:\n' + consoleErrors.join('\n'))
    return false
  } finally {
    win.destroy()
  }
}

// test_egg 的雏形：离屏起蛋窗口，加载后经主世界探测 bridge 全链路
export async function runSmoke(egg: EggContext): Promise<boolean> {
  console.log(`[smoke] ${egg.manifest.name} (${egg.eggId})`)
  const win = createEggWindow(egg, { show: false })
  const consoleErrors: string[] = []
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 3) consoleErrors.push(message)
  })

  try {
    await waitForLoad(win)

    const probe = await win.webContents.executeJavaScript(`(async () => {
      const out = {}
      out.bridge = typeof egg === 'object'
      out.ai = typeof egg.ai?.chat === 'function' && typeof egg.ai?.extract === 'function'
      await egg.storage.set('__smoke', 42)
      out.storage = (await egg.storage.get('__smoke')) === 42
      await egg.storage.delete('__smoke')
      await egg.db.exec('CREATE TABLE IF NOT EXISTS __smoke(id INTEGER PRIMARY KEY, v TEXT)')
      await egg.db.exec('INSERT INTO __smoke(v) VALUES (?)', ['ok'])
      const rows = await egg.db.query('SELECT COUNT(*) AS n FROM __smoke')
      out.db = rows[0].n >= 1
      await egg.db.exec('DROP TABLE __smoke')
      return out
    })()`)

    const pass =
      probe.bridge === true && probe.ai === true && probe.storage === true && probe.db === true && consoleErrors.length === 0
    console.log(`[smoke] probe=${JSON.stringify(probe)} consoleErrors=${consoleErrors.length}`)
    console.log(pass ? '[smoke] PASS' : '[smoke] FAIL')
    return pass
  } catch (e) {
    console.error(`[smoke] FAIL: ${(e as Error).message}`)
    if (consoleErrors.length) console.error('[smoke] console errors:\n' + consoleErrors.join('\n'))
    return false
  } finally {
    win.destroy()
  }
}
