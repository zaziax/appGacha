// db 能力的 SQL 守卫——纯函数，不依赖 better-sqlite3，可直接单测覆盖。

export const MAX_QUERY_ROWS = 1000
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
