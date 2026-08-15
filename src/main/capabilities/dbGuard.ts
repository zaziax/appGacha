import { serialize } from 'node:v8'

// db 能力的 SQL 守卫——纯函数，不依赖 better-sqlite3，可直接单测覆盖。

export const MAX_QUERY_ROWS = 1000
// 结果集结构化克隆（IPC 传输）字节上限：行数封顶挡不住「1000 行 × 单字段 10MB」这种撑爆 IPC 的情况
export const MAX_RESULT_BYTES = 10 * 1024 * 1024
// 路径逃逸/连接级状态关键字（大小写不敏感）。字符串字面量里恰好含这些词会误判为真
// 而抛错——宁可误伤也不放过，开发者可用参数绑定 `?` 或改写法绕过字面量冲突。
const FORBIDDEN_SQL = /\b(attach|detach|vacuum|pragma)\b/i

export function assertSafeSql(sql: unknown): asserts sql is string {
  if (typeof sql !== 'string' || sql.trim().length === 0) throw new Error('db: sql must be a non-empty string')
  if (FORBIDDEN_SQL.test(sql)) {
    throw new Error('db: ATTACH/DETACH/VACUUM/PRAGMA not allowed (sandboxed to egg.db)')
  }
}

// 简易探测是否已带 LIMIT。字符串字面量里出现 "limit" 会误判为真 → 少追加一层 LIMIT，
// 但 query 的收集上限（MAX_QUERY_ROWS）仍兜底，不构成风险。
export function hasLimitClause(sql: string): boolean {
  return /\blimit\b/i.test(sql)
}

// 单行经结构化克隆（IPC 传输）后的字节数。用 v8.serialize 而非 JSON.stringify：
// BLOB(Buffer) 在结构化克隆里保持紧凑，JSON 会膨胀成逐字节数组、严重高估。
export function rowBytes(row: unknown): number {
  return serialize(row).byteLength
}
