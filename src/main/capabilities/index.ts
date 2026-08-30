import { BrowserWindow, dialog, ipcMain, IpcMainInvokeEvent } from 'electron'
import fs from 'node:fs'
import { Permission } from '../../shared/types'
import { EggContext } from '../eggs'
import * as registry from '../registry'
import * as storage from './storage'
import * as db from './db'
import * as ai from './ai'
import * as fsx from './fsx'
import * as zip from './zip'
import * as schedule from '../schedule'
import { showNotification } from '../schedule'
import * as coordinator from '../net/coordinator'

type Handler = (ctx: EggContext, args: unknown[], event: IpcMainInvokeEvent) => unknown

// R2: 每个 handler 先查登记表再查 manifest permissions，永远不信任渲染进程自报身份
function handle(channel: string, permission: Permission | null, fn: Handler): void {
  ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
    try {
      const ctx = registry.get(event.sender.id)
      if (!ctx) throw new Error('caller is not a registered egg')
      if (permission && !ctx.manifest.permissions.includes(permission)) {
        throw new Error(`permission denied: "${permission}" not declared in manifest`)
      }
      return { ok: true, value: await fn(ctx, args, event) }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })
}

function senderWindow(event: IpcMainInvokeEvent): BrowserWindow {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) throw new Error('no window for caller')
  return win
}

// 系统对话框是沙箱内数据进出的唯一逃生口；进出两侧都封顶，防恶意蛋预填超大内容撑爆磁盘
const MAX_DIALOG_BYTES = 10 * 1024 * 1024

export function registerCapabilities(): void {
  handle('egg:storage:get', 'storage', (ctx, [key]) => storage.get(ctx, key as string))
  handle('egg:storage:set', 'storage', (ctx, [key, value]) => storage.set(ctx, key as string, value))
  handle('egg:storage:setMany', 'storage', (ctx, [entries]) => storage.setMany(ctx, entries as Record<string, unknown>))
  handle('egg:storage:delete', 'storage', (ctx, [key]) => storage.del(ctx, key as string))

  handle('egg:db:exec', 'db', (ctx, [sql, params]) => db.exec(ctx, sql as string, params as unknown[]))
  handle('egg:db:query', 'db', (ctx, [sql, params]) => db.query(ctx, sql as string, params as unknown[]))

  handle('egg:ai:chat', 'ai', (ctx, [messages, opts]) =>
    ai.chat(ctx, messages, opts as { temperature?: number; maxTokens?: number } | undefined))
  handle('egg:ai:extract', 'ai', (ctx, [text, schema]) => ai.extract(ctx, text, schema))

  handle('egg:fs:read', 'fs', (ctx, [rel]) => fsx.read(ctx, rel as string))
  handle('egg:fs:write', 'fs', (ctx, [rel, content]) => fsx.write(ctx, rel as string, content))
  handle('egg:fs:list', 'fs', (ctx, [rel]) => fsx.list(ctx, rel as string | undefined))
  handle('egg:fs:readBytes', 'fs', (ctx, [rel]) => fsx.readBytes(ctx, rel as string))
  handle('egg:fs:writeBytes', 'fs', (ctx, [rel, bytes]) => fsx.writeBytes(ctx, rel as string, bytes))

  handle('egg:zip:create', 'zip', (_ctx, [entries]) => zip.create(entries))
  handle('egg:zip:extract', 'zip', (_ctx, [data]) => zip.extract(data))

  handle('egg:notify:send', 'notify', (ctx, [title, body]) => {
    if (typeof title !== 'string' || typeof body !== 'string') {
      throw new Error('notify: title and body must be strings')
    }
    showNotification(ctx.eggId, title, body)
  })

  handle('egg:schedule:set', 'schedule', (ctx, [id, cron, n]) => schedule.set(ctx, id, cron, n))
  handle('egg:schedule:cancel', 'schedule', (ctx, [id]) => schedule.cancel(ctx, id))
  handle('egg:schedule:list', 'schedule', (ctx) => schedule.list(ctx))

  // ui 对话框免权限：用户手势触发的系统对话框是沙箱外数据进出的唯一逃生口
  handle('egg:ui:pickFile', null, async (_ctx, [filters], event) => {
    const res = await dialog.showOpenDialog(senderWindow(event), {
      properties: ['openFile'],
      filters: Array.isArray(filters) ? filters : undefined
    })
    if (res.canceled || res.filePaths.length === 0) return null
    const file = res.filePaths[0]
    if (fs.statSync(file).size > MAX_DIALOG_BYTES) throw new Error(`pickFile: file exceeds ${MAX_DIALOG_BYTES} bytes`)
    return { name: file.split(/[\\/]/).pop(), content: fs.readFileSync(file, 'utf-8') }
  })

  handle('egg:ui:saveFile', null, async (_ctx, [content, defaultName], event) => {
    if (typeof content !== 'string') throw new Error('saveFile: content must be a string')
    if (Buffer.byteLength(content) > MAX_DIALOG_BYTES) throw new Error(`saveFile: content exceeds ${MAX_DIALOG_BYTES} bytes`)
    const res = await dialog.showSaveDialog(senderWindow(event), {
      defaultPath: typeof defaultName === 'string' ? defaultName : undefined
    })
    if (res.canceled || !res.filePath) return { saved: false }
    fs.writeFileSync(res.filePath, content, 'utf-8')
    return { saved: true }
  })

  handle('egg:ui:pickBinary', null, async (_ctx, [filters], event) => {
    const res = await dialog.showOpenDialog(senderWindow(event), {
      properties: ['openFile'],
      filters: Array.isArray(filters) ? filters : undefined
    })
    if (res.canceled || res.filePaths.length === 0) return null
    const file = res.filePaths[0]
    if (fs.statSync(file).size > MAX_DIALOG_BYTES) throw new Error(`pickBinary: file exceeds ${MAX_DIALOG_BYTES} bytes`)
    return { name: file.split(/[\\/]/).pop(), bytes: fs.readFileSync(file) }
  })

  handle('egg:ui:saveBinary', null, async (_ctx, [bytes, defaultName], event) => {
    if (!(bytes instanceof Uint8Array)) throw new Error('saveBinary: content must be a Uint8Array')
    if (bytes.byteLength > MAX_DIALOG_BYTES) throw new Error(`saveBinary: content exceeds ${MAX_DIALOG_BYTES} bytes`)
    const res = await dialog.showSaveDialog(senderWindow(event), {
      defaultPath: typeof defaultName === 'string' ? defaultName : undefined
    })
    if (res.canceled || !res.filePath) return { saved: false }
    fs.writeFileSync(res.filePath, bytes)
    return { saved: true }
  })

  // R4: 窗口能力是"申请"不是"操作"，Main 校验后代为执行
  handle('egg:window:setAlwaysOnTop', 'window', (_ctx, [flag], event) => {
    senderWindow(event).setAlwaysOnTop(flag === true)
  })

  handle('egg:window:setSize', 'window', (ctx, [w, h], event) => {
    const width = Math.round(Number(w))
    const height = Math.round(Number(h))
    if (!Number.isFinite(width) || !Number.isFinite(height)) throw new Error('setSize: width/height must be numbers')
    const isWidget = ctx.manifest.window?.type === 'widget'
    senderWindow(event).setSize(
      Math.min(Math.max(width, isWidget ? 96 : 200), isWidget ? 1600 : 2400),
      Math.min(Math.max(height, isWidget ? 96 : 150), 1600)
    )
  })

  // ---- P2 局域网联机：蛋不懂网络，蛋只懂房间 ----
  handle('egg:net:createRoom', 'network', (ctx, [name], event) =>
    coordinator.createRoom(name as string, ctx.eggId, event.sender.id))
  handle('egg:net:findRooms', 'network', () => coordinator.findRooms())
  handle('egg:net:joinRoom', 'network', (ctx, [idOrCode], event) =>
    coordinator.joinRoom(idOrCode as string, ctx.eggId, event.sender.id))
  handle('egg:net:broadcast', 'network', (_ctx, [roomId, msg], event) =>
    coordinator.broadcast(roomId as string, event.sender.id, msg))
  handle('egg:net:close', 'network', (_ctx, [roomId], event) =>
    coordinator.closeRoom(roomId as string, event.sender.id))
}
