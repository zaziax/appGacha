// utilityProcess 子进程：开库后报告 pid，收到 'go' 就跑会卡死原生循环的递归 CTE。
// 用于验证主进程 kill() 能否打断卡在 better-sqlite3 原生循环里的子进程。
const Database = require('better-sqlite3')
const path = require('node:path')

const dbPath = path.join(process.env.KILL_TEST_DIR, 't.db')
const db = new Database(dbPath)
db.pragma('journal_mode = WAL')

process.parentPort.postMessage({ ready: true, pid: process.pid })

process.parentPort.on('message', (e) => {
  if (e.data === 'go') {
    process.parentPort.postMessage({ started: true })
    // 递归 CTE 计数到 1e9：在原生循环里狂转，等不到返回 JS
    db.prepare("WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c WHERE x < 1000000000) SELECT count(*) AS n FROM c").get()
    process.parentPort.postMessage({ done: true })
  }
})
