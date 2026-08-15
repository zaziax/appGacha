// dbWorker.ts — 在 utilityProcess（独立 OS 进程）里跑 better-sqlite3，把同步阻塞彻底隔离出主进程。
// 主进程（db.ts）用 utilityProcess.fork() 拉起本文件，通过 message 下发 {id, op, sql, params}，
// 这里执行后 process.parentPort.postMessage 回 {id, ok, value|error}。
//
// 与 worker_threads 的关键区别：utilityProcess 是独立进程，主进程超时后 kill() 能硬杀，
// OS 立即回收被 CROSS JOIN/递归 CTE 吃掉的 CPU——worker.terminate() 只能等原生循环返回 JS 后
// 才生效（实测卡 ~11s），无法真正止损。SQLite 用 WAL，进程被杀后下次启动自动恢复，不丢已提交数据。
import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { MAX_QUERY_ROWS, MAX_RESULT_BYTES, assertSafeSql, hasLimitClause, rowBytes } from './dbGuard'

const dbPath = process.env.APPGACHA_DB_PATH
if (!dbPath) throw new Error('db: missing APPGACHA_DB_PATH in fork env')
fs.mkdirSync(path.dirname(dbPath), { recursive: true })
const db = new Database(dbPath)
db.pragma('journal_mode = WAL')

function exec(sql: string, params?: unknown[]): { changes: number; lastInsertRowid: number } {
  assertSafeSql(sql)
  const stmt = db.prepare(sql)
  if (stmt.reader) throw new Error('db: exec is for writes; use query() for SELECT')
  const info = stmt.run(...((params ?? []) as never[]))
  return { changes: info.changes, lastInsertRowid: Number(info.lastInsertRowid) }
}

function query(sql: string, params?: unknown[]): unknown[] {
  assertSafeSql(sql)
  const probe = db.prepare(sql)
  if (!probe.reader) throw new Error('db: query is read-only; use exec() for writes')
  // 无 LIMIT 时追加 MAX+1：表里真有超限行数会抛错（而非静默截断），≤MAX 行则原样返回
  const capped = hasLimitClause(sql) ? sql : `${sql.replace(/;\s*$/, '')} LIMIT ${MAX_QUERY_ROWS + 1}`
  const stmt = capped === sql ? probe : db.prepare(capped)
  const rows: unknown[] = []
  let totalBytes = 0
  for (const row of stmt.iterate(...((params ?? []) as never[]))) {
    rows.push(row)
    totalBytes += rowBytes(row)
    if (rows.length > MAX_QUERY_ROWS) throw new Error(`db: query exceeds ${MAX_QUERY_ROWS} rows — add a LIMIT`)
    if (totalBytes > MAX_RESULT_BYTES) throw new Error(`db: result set exceeds ${MAX_RESULT_BYTES} bytes`)
  }
  return rows
}

type Msg = { id: number; op: 'exec' | 'query'; sql: string; params?: unknown[] }

// utilityProcess 子进程侧：message 事件回调收到的是 MessageEvent，真实负载在 .data 上
process.parentPort.on('message', (e: Electron.MessageEvent) => {
  const msg = e.data as Msg
  try {
    const value = msg.op === 'exec' ? exec(msg.sql, msg.params) : query(msg.sql, msg.params)
    process.parentPort.postMessage({ id: msg.id, ok: true, value })
  } catch (err) {
    process.parentPort.postMessage({ id: msg.id, ok: false, error: (err as Error).message })
  }
})
