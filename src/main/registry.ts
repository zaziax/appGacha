import { EggContext } from './eggs'
import * as db from './capabilities/db'

const byWebContents = new Map<number, EggContext>()

export function register(webContentsId: number, ctx: EggContext): void {
  byWebContents.set(webContentsId, ctx)
}

export function get(webContentsId: number): EggContext | undefined {
  return byWebContents.get(webContentsId)
}

export function unregister(webContentsId: number): void {
  const ctx = byWebContents.get(webContentsId)
  byWebContents.delete(webContentsId)
  // 同一蛋没有其它存活窗口时关闭数据库子进程（释放 SQLite 文件句柄）
  if (ctx && ![...byWebContents.values()].some(c => c.eggId === ctx.eggId)) {
    db.close(ctx)
  }
}
