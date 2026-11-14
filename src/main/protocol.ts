import type { Session, WebContents } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import { getEgg, type EggContext } from './eggs'

// R1: egg:// 只从蛋文件夹供文件，路径穿越在协议层掐死，响应头统一注入 CSP
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "media-src 'self' data:",
  "connect-src 'self'"
].join('; ')

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.txt': 'text/plain; charset=utf-8'
}

export function registerEggProtocol(ses: Session, context: EggContext): void {
  const eggId = context.manifest.eggId
  ses.protocol.handle('egg', async (request) => {
    const url = new URL(request.url)
    if (url.hostname !== eggId) return new Response('egg not found', { status: 404 })
    // Test copies keep the original origin. Published eggs resolve their current
    // registration so a reused partition can reopen a later install of the same ID.
    const egg = context.testMode ? context : getEgg(eggId)
    if (!egg) return new Response('egg not found', { status: 404 })

    try {
      const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html'
      const abs = path.resolve(egg.dir, rel)
      if (!isInside(egg.dir, abs)) return new Response('forbidden', { status: 403 })
      const root = await fs.realpath(egg.dir)
      const realPath = await fs.realpath(abs)
      if (!isInside(root, realPath)) return new Response('forbidden', { status: 403 })
      const body = await fs.readFile(realPath)
      const mime = MIME[path.extname(abs).toLowerCase()] ?? 'application/octet-stream'
      return new Response(new Uint8Array(body), {
        status: 200,
        headers: {
          'Content-Type': mime,
          'Content-Security-Policy': CSP,
          'X-Content-Type-Options': 'nosniff'
        }
      })
    } catch {
      return new Response('not found', { status: 404 })
    }
  })
}

function isInside(root: string, file: string): boolean {
  const relative = path.relative(root, file)
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

export function restrictEggNavigation(contents: WebContents, eggId: string): void {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('will-frame-navigate', event => {
    if (isEggUrl(event.url, eggId)) return
    if (!event.isMainFrame && (event.url === 'about:blank' || event.url === 'about:srcdoc')) return
    event.preventDefault()
  })
}

export function isEggUrl(rawUrl: string, eggId: string): boolean {
  const url = URL.parse(rawUrl)
  return url?.protocol === 'egg:' && url.hostname === eggId
}

// R3: 默认断网——蛋的 session 拦掉一切非 egg:// 出站请求
export function lockdownSession(ses: Session, eggId: string): void {
  ses.webRequest.onBeforeRequest((details, callback) => {
    const ok = isEggUrl(details.url, eggId) || details.url.startsWith('devtools://')
    callback({ cancel: !ok })
  })
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
}
