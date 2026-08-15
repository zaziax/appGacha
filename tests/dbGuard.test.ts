import { describe, it, expect } from 'vitest'
import { assertSafeSql, hasLimitClause, MAX_QUERY_ROWS, MAX_RESULT_BYTES, rowBytes } from '../src/main/capabilities/dbGuard'

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

describe('rowBytes', () => {
  it('measures structured-clone size — Buffer stays compact', () => {
    const buf = Buffer.alloc(1024, 0x61)
    // v8.serialize 对 Buffer 保持紧凑；JSON.stringify 会膨胀成逐字节数组（对照）
    expect(rowBytes({ b: buf })).toBeLessThan(2048)
    expect(JSON.stringify({ b: buf }).length).toBeGreaterThan(2048)
  })

  it('measures plain rows by serialized size', () => {
    expect(rowBytes({ a: 1, b: 'x' })).toBeGreaterThan(0)
  })
})

describe('limits', () => {
  it('MAX_QUERY_ROWS and MAX_RESULT_BYTES are positive integers', () => {
    expect(Number.isInteger(MAX_QUERY_ROWS)).toBe(true)
    expect(MAX_QUERY_ROWS).toBeGreaterThan(0)
    expect(Number.isInteger(MAX_RESULT_BYTES)).toBe(true)
    expect(MAX_RESULT_BYTES).toBeGreaterThan(0)
  })
})
