import { describe, it, expect } from 'vitest'
import { assertSafeSql, hasLimitClause, MAX_QUERY_ROWS } from '../src/main/capabilities/dbGuard'

// dbGuard 是 db 能力的安全第一道防线：在 better-sqlite3 编译/执行之前就拦住
// ATTACH/VACUUM 等可逃逸 egg.db 的关键字。它是纯函数，无需 Electron/原生模块即可测。

describe('assertSafeSql', () => {
  it('rejects non-string / empty / whitespace-only sql', () => {
    expect(() => assertSafeSql(undefined)).toThrow(/non-empty string/)
    expect(() => assertSafeSql(123)).toThrow(/non-empty string/)
    expect(() => assertSafeSql('')).toThrow(/non-empty string/)
    expect(() => assertSafeSql('   ')).toThrow(/non-empty string/)
  })

  it('blocks path-escape / connection-level keywords (case-insensitive)', () => {
    const attacks = [
      "ATTACH DATABASE '/etc/passwd' AS evil",
      'attach database ? as evil',
      'VACUUM INTO "/tmp/x.db"',
      "vacuum into '/x'",
      'PRAGMA journal_mode = off',
      'pragma foreign_keys = off',
      'DETACH DATABASE evil',
      'detach evil',
    ]
    for (const sql of attacks) {
      expect(() => assertSafeSql(sql)).toThrow(/not allowed/)
    }
  })

  it('uses word boundary — an "attachments" identifier is not a blocked keyword', () => {
    expect(() => assertSafeSql('SELECT * FROM attachments')).not.toThrow()
    expect(() => assertSafeSql('CREATE TABLE attachments (id TEXT)')).not.toThrow()
    expect(() => assertSafeSql("INSERT INTO attachments (id) VALUES ('a')")).not.toThrow()
  })

  it('allows ordinary DML/DDL (self-harm only, no escape)', () => {
    const benign = [
      'SELECT * FROM t',
      'INSERT INTO t (a) VALUES (?)',
      'CREATE TABLE t (id TEXT PRIMARY KEY)',
      'DROP TABLE t',
      'WITH x AS (SELECT 1) SELECT * FROM x',
    ]
    for (const sql of benign) {
      expect(() => assertSafeSql(sql)).not.toThrow()
    }
  })
})

describe('hasLimitClause', () => {
  it('detects a LIMIT keyword', () => {
    expect(hasLimitClause('SELECT * FROM t LIMIT 10')).toBe(true)
    expect(hasLimitClause('select * from t limit 10')).toBe(true)
    expect(hasLimitClause('SELECT * FROM t')).toBe(false)
  })
})

describe('MAX_QUERY_ROWS', () => {
  it('is a positive integer', () => {
    expect(Number.isInteger(MAX_QUERY_ROWS)).toBe(true)
    expect(MAX_QUERY_ROWS).toBeGreaterThan(0)
  })
})
