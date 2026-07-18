import { EggContext } from './eggs'

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
  // 同一蛋没有其它存活窗口时关闭数据库连接
  if (ctx?.db && ![...byWebContents.values()].some(c => c.eggId === ctx.eggId)) {
    ctx.db.close()
    ctx.db = undefined
  }
}
