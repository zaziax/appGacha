import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { EggContext } from '../eggs'

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

export function exec(ctx: EggContext, sql: string, params?: unknown[]): { changes: number; lastInsertRowid: number } {
  assertSql(sql)
  const info = getDb(ctx).prepare(sql).run(...((params ?? []) as never[]))
  return { changes: info.changes, lastInsertRowid: Number(info.lastInsertRowid) }
}

export function query(ctx: EggContext, sql: string, params?: unknown[]): unknown[] {
  assertSql(sql)
  return getDb(ctx).prepare(sql).all(...((params ?? []) as never[]))
}
