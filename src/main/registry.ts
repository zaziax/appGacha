import { EggContext } from './eggs'
import * as db from './capabilities/db'

const byWebContents = new Map<number, EggContext>()

export function register(webContentsId: number, ctx: EggContext): void {
  byWebContents.set(webContentsId, ctx)
}

export function get(webContentsId: number): EggContext | undefined {
  return byWebContents.get(webContentsId)
}

/** 同一蛋仍有窗口或空间视图存活时，不允许云端包替换其文件。 */
export function isEggActive(eggId: string): boolean {
  return [...byWebContents.values()].some(ctx => ctx.eggId === eggId)
}

export function unregister(webContentsId: number): void {
  const ctx = byWebContents.get(webContentsId)
  byWebContents.delete(webContentsId)
  // 同一蛋没有其它存活窗口时关闭数据库子进程（释放 SQLite 文件句柄）
  if (ctx && ![...byWebContents.values()].some(c => c.eggId === ctx.eggId)) {
    db.close(ctx)
  }
}
