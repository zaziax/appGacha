import { ipcMain, IpcMainInvokeEvent } from 'electron'
import { Permission } from '../../shared/types'
import { EggContext } from '../eggs'
import * as registry from '../registry'
import * as storage from './storage'
import * as db from './db'

type Handler = (ctx: EggContext, ...args: unknown[]) => unknown

// R2: 每个 handler 先查登记表再查 manifest permissions，永远不信任渲染进程自报身份
function handle(channel: string, permission: Permission | null, fn: Handler): void {
  ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    try {
      const ctx = registry.get(event.sender.id)
      if (!ctx) throw new Error('caller is not a registered egg')
      if (permission && !ctx.manifest.permissions.includes(permission)) {
        throw new Error(`permission denied: "${permission}" not declared in manifest`)
      }
      return { ok: true, value: await fn(ctx, ...args) }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })
}

export function registerCapabilities(): void {
  handle('egg:storage:get', 'storage', (ctx, key) => storage.get(ctx, key as string))
  handle('egg:storage:set', 'storage', (ctx, key, value) => storage.set(ctx, key as string, value))
  handle('egg:storage:delete', 'storage', (ctx, key) => storage.del(ctx, key as string))

  handle('egg:db:exec', 'db', (ctx, sql, params) => db.exec(ctx, sql as string, params as unknown[]))
  handle('egg:db:query', 'db', (ctx, sql, params) => db.query(ctx, sql as string, params as unknown[]))
}
