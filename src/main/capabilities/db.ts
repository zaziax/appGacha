import { utilityProcess } from 'electron'
import path from 'node:path'
import { EggContext } from '../eggs'

// db 能力的宿主侧：真正的 SQL 在 dbWorker.ts（utilityProcess 独立进程）里跑，把 better-sqlite3
// 的同步阻塞彻底隔离出主进程——恶意蛋跑 CROSS JOIN/递归 CTE 只会卡住它自己的子进程，
// 主进程与其它蛋不受影响；超时则 kill() 硬杀该进程（即使卡在原生循环，OS 也立即回收 CPU），
// 下次调用重建连接（SQLite WAL 自动恢复）。

// 单次 SQL 的超时（毫秒）。可用 APPGACHA_DB_TIMEOUT_MS 覆盖，便于测试超时路径。
const QUERY_TIMEOUT_MS = Number(process.env.APPGACHA_DB_TIMEOUT_MS) || 30_000

interface Pending {
  proc: Electron.UtilityProcess
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  timer: NodeJS.Timeout
}

const procs = new WeakMap<EggContext, Electron.UtilityProcess>()
const pending = new Map<number, Pending>()
let nextId = 1

function getProc(ctx: EggContext): Electron.UtilityProcess {
  let p = procs.get(ctx)
  if (p) return p
  const dbPath = path.join(ctx.dir, 'data', 'egg.db')
  p = utilityProcess.fork(path.join(__dirname, 'dbWorker.js'), [], {
    env: { ...process.env, APPGACHA_DB_PATH: dbPath },
  })
  p.on('message', (msg: { id: number; ok: boolean; value?: unknown; error?: string }) => {
    const pend = pending.get(msg.id)
    if (!pend) return
    pending.delete(msg.id)
    clearTimeout(pend.timer)
    if (msg.ok) pend.resolve(msg.value)
    else pend.reject(new Error(msg.error ?? 'db: process error'))
  })
  p.on('exit', () => {
    if (procs.get(ctx) === p) procs.delete(ctx)
    failProc(p, new Error('db: process exited'))
  })
  procs.set(ctx, p)
  return p
}

// 拒绝某个子进程名下所有挂起请求（进程崩溃/退出/被超时强杀时调用）
function failProc(p: Electron.UtilityProcess, err: Error): void {
  for (const [id, pend] of pending) {
    if (pend.proc !== p) continue
    pending.delete(id)
    clearTimeout(pend.timer)
    pend.reject(err)
  }
}

function call(ctx: EggContext, op: 'exec' | 'query', sql: string, params?: unknown[]): Promise<unknown> {
  const p = getProc(ctx)
  const id = nextId++
  return new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      if (procs.get(ctx) === p) procs.delete(ctx)
      p.kill() // 硬杀独立进程：即使卡在原生循环，OS 也立即回收 CPU
      reject(new Error(`db: ${op} timed out after ${QUERY_TIMEOUT_MS}ms`))
    }, QUERY_TIMEOUT_MS)
    pending.set(id, { proc: p, resolve, reject, timer })
    p.postMessage({ id, op, sql, params })
  })
}

export function exec(ctx: EggContext, sql: string, params?: unknown[]): Promise<{ changes: number; lastInsertRowid: number }> {
  return call(ctx, 'exec', sql, params) as Promise<{ changes: number; lastInsertRowid: number }>
}

export function query(ctx: EggContext, sql: string, params?: unknown[]): Promise<unknown[]> {
  return call(ctx, 'query', sql, params) as Promise<unknown[]>
}

// 关闭蛋的数据库子进程（窗口全关 / 蛋被移除时由 registry 调用）：拒绝挂起请求并硬杀进程，
// 释放 SQLite 文件句柄。WAL 已提交数据安全，下次 open 自动恢复。
export function close(ctx: EggContext): void {
  const p = procs.get(ctx)
  if (!p) return
  procs.delete(ctx)
  failProc(p, new Error('db: closed'))
  p.kill()
}
