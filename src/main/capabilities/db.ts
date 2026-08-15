import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { EggContext } from '../eggs'
import { MAX_QUERY_ROWS, assertSafeSql, hasLimitClause } from './dbGuard'

// db 能力的安全边界：蛋只能操作自己的 data/egg.db，绝不能触碰蛋目录以外的文件系统。
// SQL 层守卫（禁 ATTACH/VACUUM 等）见 dbGuard.ts；这里负责连接管理 + 读/写分离 + 行数封顶。

function getDb(ctx: EggContext): Database.Database {
  if (!ctx.db) {
    const dataDir = path.join(ctx.dir, 'data')
    fs.mkdirSync(dataDir, { recursive: true })
    ctx.db = new Database(path.join(dataDir, 'egg.db'))
    ctx.db.pragma('journal_mode = WAL')
  }
  return ctx.db
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
  // 先编译原句判只读：数据修改 CTE（WITH ... DELETE）首关键字是 WITH，但 .reader=false，必须拦下
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
