import { app, BrowserWindow, nativeImage, session, type NativeImage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

const pending = new Map<string, Promise<NativeImage | undefined>>()

/** Render local SVG as an image, never executable inline markup. No network or scripts. */
export function loadEggWindowIcon(dir: string): Promise<NativeImage | undefined> {
  try {
    const source = path.join(dir, 'icon.svg')
    if (!fs.existsSync(source) || fs.statSync(source).size > 16 * 1024) return Promise.resolve(undefined)
    const svg = fs.readFileSync(source)
    const hash = createHash('sha256').update(svg).digest('hex')
    const cached = path.join(app.getPath('userData'), 'window-icons', `${hash}.png`)
    if (fs.existsSync(cached)) return Promise.resolve(nativeImage.createFromPath(cached))
    if (pending.has(hash)) return pending.get(hash)!
    const job = render(svg, cached).catch(() => undefined).finally(() => pending.delete(hash))
    pending.set(hash, job)
    return job
  } catch { return Promise.resolve(undefined) }
}

async function render(svg: Buffer, cached: string): Promise<NativeImage> {
  const ses = session.fromPartition('egg-window-icons')
  ses.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith('data:') }))
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  const win = new BrowserWindow({
    width: 256, height: 256, show: false, frame: false, transparent: true,
    backgroundColor: '#00000000', skipTaskbar: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, session: ses, offscreen: true },
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      (async () => {
        const html = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><style>html,body{margin:0;background:transparent}img{width:256px;height:256px;display:block}</style><img src="data:image/svg+xml;base64,${svg.toString('base64')}">`
        await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
        const image = await win.webContents.capturePage()
        if (image.isEmpty()) throw new Error('Empty icon')
        fs.mkdirSync(path.dirname(cached), { recursive: true })
        fs.writeFileSync(cached, image.toPNG())
        return image
      })(),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Icon timeout')), 4000) }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
    if (!win.isDestroyed()) win.destroy()
  }
}
