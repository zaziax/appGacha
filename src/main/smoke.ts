import { BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { EggContext, registerEgg, removeEgg } from './eggs'
import { createEggWindow } from './eggWindow'
import { createShelfWindow } from './shelfWindow'
import { validateEgg } from './validate'
import { dataRoot } from './paths'
import { runGacha, runUpgrade, restoreLatestBackup, hasBackup } from './pipeline'

// 升级管线冒烟：一次性假蛋 + 假驱动，全链路验证 备份→入舱→换装→数据完好→版本递增→回滚
export async function runUpgradeSmoke(): Promise<boolean> {
  console.log('[smoke] pipeline-upgrade')
  const eggId = 'a0000000-0000-4000-8000-smokeupgrade'
  const dir = dataRoot('eggs', '__smoke-upgrade.egg')
  const backups = dataRoot('backups', eggId)
  const cleanup = () => {
    removeEgg(eggId)
    fs.rmSync(dir, { recursive: true, force: true })
    fs.rmSync(backups, { recursive: true, force: true })
  }

  try {
    // 假蛋落地：可渲染的最小蛋 + 一份必须存活的数据
    fs.mkdirSync(path.join(dir, 'data'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
      eggId, name: '冒烟升级蛋', version: '1.0.0', hostApiVersion: '1',
      permissions: ['storage'], wish: '原始愿望'
    }, null, 2), 'utf-8')
    fs.writeFileSync(path.join(dir, 'index.html'),
      '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body><script src="app.js"></script></body></html>', 'utf-8')
    fs.writeFileSync(path.join(dir, 'app.js'), 'document.body.textContent = "smoke v1"', 'utf-8')
    fs.writeFileSync(path.join(dir, 'data', 'marker.txt'), 'precious', 'utf-8')
    registerEgg(dir)

    // 假驱动：改一行代码就算升级成功
    const result = await runUpgrade(eggId, '冒烟升级愿望', () => {}, async (job) => {
      fs.writeFileSync(path.join(job.stagingDir, 'app.js'), 'document.body.textContent = "smoke v2"', 'utf-8')
      return { ok: true, rounds: 1, turns: 1 }
    })

    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf-8'))
    const code = fs.readFileSync(path.join(dir, 'app.js'), 'utf-8')
    const marker = fs.readFileSync(path.join(dir, 'data', 'marker.txt'), 'utf-8')
    const upgraded =
      result.ok === true &&
      code.includes('smoke v2') &&
      marker === 'precious' &&
      manifest.version === '1.1.0' &&
      manifest.eggId === eggId &&
      manifest.wish === '原始愿望' &&
      manifest.upgrades?.length === 1 &&
      hasBackup(eggId)

    // 回滚：整蛋回到备份时刻
    const restoredName = restoreLatestBackup(eggId, dir)
    const rolledBack =
      restoredName === '冒烟升级蛋' &&
      fs.readFileSync(path.join(dir, 'app.js'), 'utf-8').includes('smoke v1') &&
      JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf-8')).version === '1.0.0' &&
      fs.readFileSync(path.join(dir, 'data', 'marker.txt'), 'utf-8') === 'precious'

    const pass = upgraded && rolledBack
    console.log(`[smoke] pipeline-upgrade result=${JSON.stringify(result)} upgraded=${upgraded} rolledBack=${rolledBack}`)
    console.log(pass ? '[smoke] pipeline-upgrade PASS' : '[smoke] pipeline-upgrade FAIL')
    return pass
  } catch (e) {
    console.error(`[smoke] pipeline-upgrade FAIL: ${(e as Error).message}`)
    return false
  } finally {
    cleanup()
  }
}

// 失败管线冒烟：假驱动必然失败，验证装配舱归档 failed/ + FAILURE.json 留档
export async function runPipelineFailSmoke(): Promise<boolean> {
  console.log('[smoke] pipeline-fail')
  const failedRoot = dataRoot('failed')
  const before = new Set(fs.existsSync(failedRoot) ? fs.readdirSync(failedRoot) : [])
  const stages: string[] = []

  const result = await runGacha(
    '冒烟测试：这颗蛋注定扭不出来',
    p => stages.push(p.stage),
    async () => ({ ok: false, rounds: 3, turns: 7, error: '假驱动固定失败（冒烟）' })
  )

  const archived = (fs.existsSync(failedRoot) ? fs.readdirSync(failedRoot) : [])
    .filter(d => !before.has(d))
  const record = archived.length === 1
    ? JSON.parse(fs.readFileSync(path.join(failedRoot, archived[0], 'FAILURE.json'), 'utf-8'))
    : null
  const stagingClean = !fs.existsSync(dataRoot('staging')) ||
    fs.readdirSync(dataRoot('staging')).length === 0

  const pass =
    result.ok === false &&
    stages.includes('fail') &&
    archived.length === 1 &&
    record?.error === '假驱动固定失败（冒烟）' &&
    typeof record?.wish === 'string' &&
    stagingClean

  console.log(`[smoke] pipeline-fail result=${JSON.stringify(result)} stages=[${stages.join(',')}] archived=${archived.length} stagingClean=${stagingClean}`)
  // 冒烟产物不留档，验证完即清
  for (const d of archived) fs.rmSync(path.join(failedRoot, d), { recursive: true, force: true })
  console.log(pass ? '[smoke] pipeline-fail PASS' : '[smoke] pipeline-fail FAIL')
  return pass
}

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

  const issues = validateEgg(egg.dir)
  if (issues.length > 0) {
    console.error(`[smoke] validate FAIL:\n` + issues.map(i => `  [${i.file}] ${i.message}`).join('\n'))
    return false
  }

  const win = createEggWindow(egg, { show: false })
  const consoleErrors: string[] = []
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 3) consoleErrors.push(message)
  })

  try {
    await waitForLoad(win)

    const has = (p: string) => egg.manifest.permissions.includes(p as never)
    const probe = await win.webContents.executeJavaScript(`(async () => {
      const out = {}
      out.bridge = typeof egg === 'object'
      out.ai = typeof egg.ai?.chat === 'function' && typeof egg.ai?.extract === 'function'
      out.notify = typeof egg.notify?.send === 'function'
      out.window = typeof egg.window?.setAlwaysOnTop === 'function' && typeof egg.window?.setSize === 'function'
      out.dialogs = typeof egg.ui?.pickFile === 'function' && typeof egg.ui?.saveFile === 'function'
      ${has('storage') ? `
      await egg.storage.set('__smoke', 42)
      out.storage = (await egg.storage.get('__smoke')) === 42
      await egg.storage.delete('__smoke')` : ''}
      ${has('db') ? `
      await egg.db.exec('CREATE TABLE IF NOT EXISTS __smoke(id INTEGER PRIMARY KEY, v TEXT)')
      await egg.db.exec('INSERT INTO __smoke(v) VALUES (?)', ['ok'])
      const rows = await egg.db.query('SELECT COUNT(*) AS n FROM __smoke')
      out.db = rows[0].n >= 1
      await egg.db.exec('DROP TABLE __smoke')` : ''}
      ${has('fs') ? `
      await egg.fs.write('__smoke/probe.txt', 'hello')
      out.fs = (await egg.fs.read('__smoke/probe.txt')) === 'hello' &&
               (await egg.fs.list('__smoke')).some(f => f.name === 'probe.txt')` : ''}
      ${has('schedule') ? `
      await egg.schedule.set('__smoke', '0 3 * * *', { title: 't', body: 'b' })
      out.schedule = (await egg.schedule.list()).some(e => e.id === '__smoke')
      await egg.schedule.cancel('__smoke')
      out.scheduleClean = !(await egg.schedule.list()).some(e => e.id === '__smoke')` : ''}
      return out
    })()`)

    const required = ['bridge', 'ai', 'notify', 'window', 'dialogs',
      ...(has('storage') ? ['storage'] : []),
      ...(has('db') ? ['db'] : []),
      ...(has('fs') ? ['fs'] : []),
      ...(has('schedule') ? ['schedule', 'scheduleClean'] : [])]
    const pass = required.every(k => probe[k] === true) && consoleErrors.length === 0
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
