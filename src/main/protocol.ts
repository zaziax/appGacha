import { Session } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import { getEgg } from './eggs'

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

export function registerEggProtocol(ses: Session): void {
  ses.protocol.handle('egg', async (request) => {
    const url = new URL(request.url)
    const egg = getEgg(url.hostname)
    if (!egg) return new Response('egg not found', { status: 404 })

    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html'
    const abs = path.normalize(path.join(egg.dir, rel))
    const root = path.normalize(egg.dir) + path.sep
    if (!abs.startsWith(root)) return new Response('forbidden', { status: 403 })

    try {
      const body = await fs.readFile(abs)
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

// R3: 默认断网——蛋的 session 拦掉一切非 egg:// 出站请求
export function lockdownSession(ses: Session): void {
  ses.webRequest.onBeforeRequest((details, callback) => {
    const ok = details.url.startsWith('egg://') || details.url.startsWith('devtools://')
    callback({ cancel: !ok })
  })
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
}
