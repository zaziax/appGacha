// test-utility.cjs — 用真实 Electron 主进程验证 utilityProcess 版 db 隔离。
// 运行：./node_modules/electron/dist/electron.exe test-utility.cjs
// Phase A：直接验证 kill() 能打断卡在原生循环的子进程（对比 worker.terminate() 的 ~11s 延迟）。
// Phase B：编译后的 db.ts/dbWorker.ts 端到端（往返 / 关键字拦截 / 行数上限 / 字节上限 / 超时 / 恢复）。
const { app, utilityProcess } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const db = require('./dist/main/capabilities/db.js') // { exec, query }

let passed = 0, failed = 0
const ok = (n) => { passed++; console.log('  PASS', n) }
const bad = (n, e) => { failed++; console.error('  FAIL', n, '->', (e && e.message) || e) }
const expectThrow = async (n, fn, re) => {
  try { await fn(); bad(n, new Error('expected throw, got success')) }
  catch (e) { re.test(e.message) ? ok(n) : bad(n, new Error('wrong error: ' + e.message)) }
}

app.whenReady().then(async () => {
  const t0 = Date.now()

  // ---- Phase A：kill() 打断原生循环 ----
  const killDir = fs.mkdtempSync(path.join(os.tmpdir(), 'utility-kill-'))
  const child = utilityProcess.fork(path.join(__dirname, 'test-utility-child.cjs'), [], {
    env: { ...process.env, KILL_TEST_DIR: killDir },
  })
  await new Promise((resolve) => {
    let killTs = 0
    child.on('message', (m) => {
      if (m.ready) {
        console.log(`[${Date.now() - t0}ms] phase A child ready pid=${m.pid}`)
        child.postMessage('go')
      } else if (m.started) {
        console.log(`[${Date.now() - t0}ms] runaway query started`)
        setTimeout(() => { killTs = Date.now(); console.log(`[${Date.now() - t0}ms] calling kill()`); child.kill() }, 1000)
      }
    })
    child.on('exit', (code) => {
      const dt = Date.now() - killTs
      console.log(`[${Date.now() - t0}ms] child EXIT code=${code}; ${dt}ms after kill()`)
      dt < 3000 ? ok(`kill() reclaims CPU fast (${dt}ms)`) : bad('kill() reclaims CPU fast', new Error(dt + 'ms'))
      resolve()
    })
  })
  try { fs.rmSync(killDir, { recursive: true, force: true }) } catch {}

  // ---- Phase B：db.ts 端到端 ----
  process.env.APPGACHA_DB_TIMEOUT_MS = '1500'
  const ctx = { dir: fs.mkdtempSync(path.join(os.tmpdir(), 'db-util-')) }

  try {
    await db.exec(ctx, 'CREATE TABLE t(id INTEGER PRIMARY KEY, v TEXT)')
    await db.exec(ctx, 'INSERT INTO t(v) VALUES (?)', ['hello'])
    const rows = await db.query(ctx, 'SELECT v FROM t')
    rows.length === 1 && rows[0].v === 'hello' ? ok('round-trip') : bad('round-trip', new Error(JSON.stringify(rows)))
  } catch (e) { bad('round-trip', e) }

  await expectThrow('forbidden ATTACH', () => db.exec(ctx, "ATTACH DATABASE '/tmp/evil.db' AS x"), /not allowed/)

  try {
    await db.exec(ctx, 'CREATE TABLE t2(id INTEGER PRIMARY KEY)')
    await db.exec(ctx, "INSERT INTO t2(id) WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c WHERE x < 1500) SELECT x FROM c")
  } catch (e) { bad('seed 1500', e) }
  await expectThrow('row cap', () => db.query(ctx, 'SELECT * FROM t2'), /exceeds 1000 rows/)

  try {
    await db.exec(ctx, 'CREATE TABLE t3(v BLOB)')
    await db.exec(ctx, 'INSERT INTO t3(v) VALUES (?)', [Buffer.alloc(11 * 1024 * 1024, 0x61)])
  } catch (e) { bad('seed 11MB blob', e) }
  await expectThrow('byte cap', () => db.query(ctx, 'SELECT v FROM t3'), /result set exceeds/)

  const runaway = "WITH RECURSIVE cnt(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM cnt WHERE x < 1000000000) SELECT count(*) FROM cnt"
  await expectThrow('timeout', () => db.query(ctx, runaway), /timed out/)
  try {
    const rows = await db.query(ctx, 'SELECT v FROM t WHERE v = ?', ['hello'])
    rows.length === 1 ? ok('recovery after timeout') : bad('recovery', new Error(JSON.stringify(rows)))
  } catch (e) { bad('recovery after timeout', e) }

  try { fs.rmSync(ctx.dir, { recursive: true, force: true }) } catch {}
  console.log(`\n${passed} passed, ${failed} failed`)
  setTimeout(() => app.exit(failed ? 1 : 0), 200)
})
