import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { EggContext } from '../eggs'

// db 能力的安全边界：蛋只能操作自己的 data/egg.db，绝不能触碰蛋目录以外的文件系统。
// 这条边界靠两层守住——(1) 禁用 ATTACH/DETACH/VACUUM/PRAGMA（ATTACH 可挂载任意路径的
// SQLite 文件读取、VACUUM INTO 可写任意路径，都是绕过 fsx.resolveSafe 的沙箱逃逸）；
// (2) query 只读、exec 只写，且单次 query 返回行数封顶，防止超大结果集灌爆 IPC/内存。

const MAX_QUERY_ROWS = 1000
// 路径逃逸/连接级状态关键字（大小写不敏感）。字符串字面量里恰好含这些词会误判为真
// 而抛错——宁可误伤也不放过，开发者可用参数绑定 `?` 或改写法绕过字面量冲突。
const FORBIDDEN_SQL = /\b(attach|detach|vacuum|pragma)\b/i

function getDb(ctx: EggContext): Database.Database {
  if (!ctx.db) {
    const dataDir = path.join(ctx.dir, 'data')
    fs.mkdirSync(dataDir, { recursive: true })
    ctx.db = new Database(path.join(dataDir, 'egg.db'))
    ctx.db.pragma('journal_mode = WAL')
  }
  return ctx.db
}

function assertSql(sql: unknown): asserts sql is string {
  if (typeof sql !== 'string' || sql.trim().length === 0) throw new Error('db: sql must be a non-empty string')
}

function assertSafeSql(sql: string): void {
  assertSql(sql)
  if (FORBIDDEN_SQL.test(sql)) {
    throw new Error('db: ATTACH/DETACH/VACUUM/PRAGMA not allowed (sandboxed to egg.db)')
  }
  // 多语句由 better-sqlite3 的 prepare() 天然拦截（编译即抛「more than one statement」），无需重复检测
}

// 简易探测是否已带 LIMIT。字符串字面量里出现 "limit" 会误判为真 → 少追加一层 LIMIT，
// 但 query 的收集上限（MAX_QUERY_ROWS）仍兜底，不构成风险。
function hasLimitClause(sql: string): boolean {
  return /\blimit\b/i.test(sql)
}

export function exec(ctx: EggContext, sql: string, params?: unknown[]): { changes: number; lastInsertRowid: number } {
  assertSafeSql(sql)
  const stmt = getDb(ctx).prepare(sql)
  if (stmt.reader) throw new Error('db: exec is for writes; use query() for SELECT')
  const info = stmt.run(...((params ?? []) as never[]))
  return { changes: info.changes, lastInsertRowid: Number(info.lastInsertRowid) }
}

export function query(ctx: EggContext, sql: string, params?: unknown[]): unknown[] {
  assertSafeSql(sql)
  const db = getDb(ctx)
  // 先编译原句判只读：数据修改 CTE（WITH ... DELETE/INSERT）首关键字是 WITH，但 .reader=false，必须拦下
  const probe = db.prepare(sql)
  if (!probe.reader) throw new Error('db: query is read-only; use exec() for writes')
  // 无 LIMIT 时追加 MAX+1：表里真有超限行数会抛错（而非静默截断丢数据），≤MAX 行则原样返回
  const capped = hasLimitClause(sql) ? sql : `${sql.replace(/;\s*$/, '')} LIMIT ${MAX_QUERY_ROWS + 1}`
  const stmt = capped === sql ? probe : db.prepare(capped)
  const rows: unknown[] = []
  for (const row of stmt.iterate(...((params ?? []) as never[]))) {
    rows.push(row)
    if (rows.length > MAX_QUERY_ROWS) throw new Error(`db: query exceeds ${MAX_QUERY_ROWS} rows — add a LIMIT`)
  }
  return rows
}
