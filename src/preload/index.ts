import { contextBridge, ipcRenderer } from 'electron'

interface BridgeResult {
  ok: boolean
  value?: unknown
  error?: string
}

async function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const res = (await ipcRenderer.invoke(channel, ...args)) as BridgeResult
  if (!res.ok) throw new Error(res.error ?? 'bridge error')
  return res.value
}

// ---- egg.ui.toast：preload 内直接操作 DOM，无需走 Main ----

let toastBox: HTMLElement | null = null

function ensureToastBox(): HTMLElement {
  if (toastBox && document.body.contains(toastBox)) return toastBox
  toastBox = document.createElement('div')
  toastBox.style.cssText =
    'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);' +
    'display:flex;flex-direction:column;gap:8px;align-items:center;z-index:2147483647;pointer-events:none'
  document.body.appendChild(toastBox)
  return toastBox
}

function toast(message: string): void {
  const box = ensureToastBox()
  const el = document.createElement('div')
  el.textContent = String(message)
  el.style.cssText =
    'background:rgba(30,30,36,.92);color:#fff;padding:9px 18px;border-radius:99px;' +
    'font:13px/1.4 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.25);' +
    'opacity:0;transition:opacity .18s ease;max-width:70vw'
  box.appendChild(el)
  requestAnimationFrame(() => { el.style.opacity = '1' })
  setTimeout(() => {
    el.style.opacity = '0'
    setTimeout(() => el.remove(), 250)
  }, 2400)
}

// ---- 风格化确认弹窗（替代原生 window.confirm，跟随蛋的 base.css 变量） ----

function styledConfirm(message: string): Promise<boolean> {
  return new Promise(resolve => {
    const overlay = document.createElement('div')
    overlay.id = '__egg_confirm'
    overlay.innerHTML = `
      <style>
        #__egg_confirm {
          position: fixed; inset: 0; z-index: 2147483647;
          background: rgba(0,0,0,.32); backdrop-filter: blur(2px);
          display: flex; align-items: center; justify-content: center;
          opacity: 0; transition: opacity .16s ease;
          font-family: system-ui, "Microsoft YaHei", sans-serif;
        }
        #__egg_confirm .cf-card {
          background: var(--card, #fff); color: var(--text, #2b2b30);
          border: 1px solid var(--border, #e5e5e5); border-radius: 16px;
          padding: 22px 24px 18px; width: 320px; max-width: 86vw;
          box-shadow: 0 12px 40px rgba(0,0,0,.22);
          transform: scale(.92) translateY(8px); transition: transform .18s cubic-bezier(.2,.9,.3,1.2);
        }
        #__egg_confirm.show { opacity: 1; }
        #__egg_confirm.show .cf-card { transform: scale(1) translateY(0); }
        #__egg_confirm .cf-msg {
          font-size: 14px; font-weight: 600; line-height: 1.55;
          white-space: pre-wrap; word-break: break-word; margin: 0 0 18px;
        }
        #__egg_confirm .cf-actions { display: flex; justify-content: flex-end; gap: 8px; }
        #__egg_confirm .cf-btn {
          border: none; border-radius: 10px; padding: 8px 18px;
          font-size: 13px; font-weight: 700; cursor: pointer;
          transition: background .15s, transform .1s; font-family: inherit;
        }
        #__egg_confirm .cf-btn:active { transform: scale(.96); }
        #__egg_confirm .cf-cancel {
          background: var(--bg-inset, #f2f2f2); color: var(--text-2, #666);
        }
        #__egg_confirm .cf-cancel:hover { background: var(--border, #e5e5e5); }
        #__egg_confirm .cf-ok {
          background: var(--accent, #4a7dff); color: #fff;
        }
        #__egg_confirm .cf-ok:hover { filter: brightness(1.08); }
      </style>
      <div class="cf-card">
        <p class="cf-msg"></p>
        <div class="cf-actions">
          <button class="cf-btn cf-cancel">取消</button>
          <button class="cf-btn cf-ok">确定</button>
        </div>
      </div>
    `
    overlay.querySelector('.cf-msg')!.textContent = String(message)

    const close = (ok: boolean) => {
      overlay.style.opacity = '0'
      setTimeout(() => { overlay.remove(); resolve(ok) }, 150)
      document.removeEventListener('keydown', onKey)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(false)
      if (e.key === 'Enter') close(true)
    }
    overlay.addEventListener('click', e => { if (e.target === overlay) close(false) })
    overlay.querySelector('.cf-cancel')!.addEventListener('click', () => close(false))
    overlay.querySelector('.cf-ok')!.addEventListener('click', () => close(true))
    document.addEventListener('keydown', onKey)

    document.body.appendChild(overlay)
    requestAnimationFrame(() => overlay.classList.add('show'))
    ;(overlay.querySelector('.cf-ok') as HTMLElement).focus()
  })
}

// ---- bridge 暴露：hostApiVersion 1 ----

// ---- P2 局域网联机：egg.net 房间代理 ----
// 注意：contextBridge 从 invoke 返回的对象是“快照代理”，页面属性赋值不会穿透回 preload。
// 因此回调用「函数注册式」（room.onMessage(fn)）而非「属性赋值式」（room.onMessage = fn）。

interface RoomCallbacks {
  message?: (msg: unknown, peerId: string) => void
  peerJoin?: (peerId: string) => void
  peerLeave?: (peerId: string) => void
  closed?: (reason: string) => void
}

const roomCallbacks = new Map<string, RoomCallbacks>()
const activeRoomIds = new Set<string>()

function makeRoomProxy(snap: { roomId: string; code: string; peerId: string; isHost: boolean; peers: string[] }) {
  activeRoomIds.add(snap.roomId)
  roomCallbacks.set(snap.roomId, {})
  return {
    id: snap.roomId,
    code: snap.code,
    peerId: snap.peerId,
    isHost: snap.isHost,
    peers: snap.peers,
    broadcast: (msg: unknown) => invoke('egg:net:broadcast', snap.roomId, msg) as Promise<void>,
    close: () => {
      activeRoomIds.delete(snap.roomId)
      roomCallbacks.delete(snap.roomId)
      return invoke('egg:net:close', snap.roomId) as Promise<void>
    },
    /** 注册收到消息回调 */
    onMessage: (fn: (msg: unknown, peerId: string) => void) => {
      const cb = roomCallbacks.get(snap.roomId)
      if (cb) cb.message = fn
    },
    /** 注册新玩家加入回调 */
    onPeerJoin: (fn: (peerId: string) => void) => {
      const cb = roomCallbacks.get(snap.roomId)
      if (cb) cb.peerJoin = fn
    },
    /** 注册玩家离开回调 */
    onPeerLeave: (fn: (peerId: string) => void) => {
      const cb = roomCallbacks.get(snap.roomId)
      if (cb) cb.peerLeave = fn
    },
    /** 注册房间关闭回调 */
    onClosed: (fn: (reason: string) => void) => {
      const cb = roomCallbacks.get(snap.roomId)
      if (cb) cb.closed = fn
    }
  }
}

// 主进程推送房间事件 → 分发到对应 RoomProxy 回调
ipcRenderer.on('egg:net:event', (_e, roomId: string, type: string, payload: any) => {
  const cb = roomCallbacks.get(roomId)
  if (!cb) return
  switch (type) {
    case 'message':
      cb.message?.(payload.msg, payload.from)
      break
    case 'peer-join':
      cb.peerJoin?.(payload.peerId)
      break
    case 'peer-leave':
      cb.peerLeave?.(payload.peerId)
      break
    case 'closed':
      roomCallbacks.delete(roomId)
      activeRoomIds.delete(roomId)
      cb.closed?.(payload.reason)
      break
  }
})

contextBridge.exposeInMainWorld('egg', {
  hostApiVersion: '1',
  storage: {
    get: (key: string) => invoke('egg:storage:get', key),
    set: (key: string, value: unknown) => invoke('egg:storage:set', key, value),
    delete: (key: string) => invoke('egg:storage:delete', key)
  },
  db: {
    exec: (sql: string, params?: unknown[]) => invoke('egg:db:exec', sql, params),
    query: (sql: string, params?: unknown[]) => invoke('egg:db:query', sql, params)
  },
  ai: {
    chat: (messages: unknown[], opts?: { temperature?: number; maxTokens?: number }) =>
      invoke('egg:ai:chat', messages, opts),
    extract: (text: string, schema: object) => invoke('egg:ai:extract', text, schema)
  },
  fs: {
    read: (path: string) => invoke('egg:fs:read', path),
    write: (path: string, content: string) => invoke('egg:fs:write', path, content),
    list: (path?: string) => invoke('egg:fs:list', path),
    readBytes: (path: string) => invoke('egg:fs:readBytes', path),
    writeBytes: (path: string, bytes: Uint8Array) => invoke('egg:fs:writeBytes', path, bytes)
  },
  zip: {
    create: (entries: { name: string; data: Uint8Array }[]) => invoke('egg:zip:create', entries),
    extract: (data: Uint8Array) => invoke('egg:zip:extract', data)
  },
  notify: {
    send: (title: string, body: string) => invoke('egg:notify:send', title, body)
  },
  schedule: {
    set: (id: string, cron: string, notification: { title: string; body: string }) =>
      invoke('egg:schedule:set', id, cron, notification),
    cancel: (id: string) => invoke('egg:schedule:cancel', id),
    list: () => invoke('egg:schedule:list')
  },
  window: {
    setAlwaysOnTop: (flag: boolean) => invoke('egg:window:setAlwaysOnTop', flag),
    setSize: (width: number, height: number) => invoke('egg:window:setSize', width, height)
  },
  net: {
    createRoom: (name: string) =>
      invoke('egg:net:createRoom', name).then(snap => makeRoomProxy(snap as any)),
    findRooms: () => invoke('egg:net:findRooms'),
    joinRoom: (idOrCode: string) =>
      invoke('egg:net:joinRoom', idOrCode).then(snap => makeRoomProxy(snap as any))
  },
  ui: {
    toast: (message: string) => { toast(message) },
    confirm: (message: string) => styledConfirm(String(message)),
    pickFile: (filters?: { name: string; extensions: string[] }[]) => invoke('egg:ui:pickFile', filters),
    saveFile: (content: string, defaultName?: string) => invoke('egg:ui:saveFile', content, defaultName),
    pickBinary: (filters?: { name: string; extensions: string[] }[]) => invoke('egg:ui:pickBinary', filters),
    saveBinary: (bytes: Uint8Array, defaultName?: string) => invoke('egg:ui:saveBinary', bytes, defaultName)
  },
  // 窗口控制（供蛋代码主动调用）
  minimize: () => ipcRenderer.send('win:minimize'),
  maximize: () => ipcRenderer.send('win:maximize'),
  close: () => ipcRenderer.send('win:close'),
  isMaximized: () => ipcRenderer.invoke('win:isMaximized')
})

// ---- 注入自定义标题栏（frameless 窗口） ----

function injectTitleBar(): void {
  if (document.getElementById('__egg_titlebar')) return

  const isMac = process.platform === 'darwin'

  const bar = document.createElement('div')
  bar.id = '__egg_titlebar'
  bar.innerHTML = `
    <style>
      :root { --titlebar-h: 38px; }   /* 标题栏高度，供沉浸式布局避开：calc(var(--titlebar-h) + …) */
      #__egg_titlebar {
        position: fixed; top: 0; left: 0; right: 0; z-index: 2147483646;
        height: 38px; display: flex; align-items: center; justify-content: space-between;
        padding: 0 8px;
        background: var(--card, #fff);
        border-bottom: 1px solid var(--border, #e8e4dc);
        font-family: system-ui, "Microsoft YaHei", sans-serif;
        -webkit-app-region: drag; user-select: none;
      }
      #__egg_titlebar .tb-left {
        display: flex; align-items: center; gap: 6px; padding-left: ${isMac ? '62px' : '4px'};
        font-size: 13px; font-weight: 600; color: var(--text, #2b2b30);
      }
      #__egg_titlebar .tb-right {
        display: flex; align-items: center; gap: 2px;
        -webkit-app-region: no-drag;
      }
      #__egg_titlebar .tb-right button {
        width: 34px; height: 26px; border: none; background: none;
        border-radius: 6px; cursor: pointer; display: flex; align-items: center;
        justify-content: center; color: var(--text-3, #8a8a92); font-size: 16px;
        line-height: 1; transition: background 0.15s, color 0.15s;
        font-family: inherit; padding: 0;
      }
      #__egg_titlebar .tb-right button:hover { background: var(--bg-inset, #f2f0ec); color: var(--text, #2b2b30); }
      #__egg_titlebar .tb-right button.tb-close:hover { background: var(--bad, #c0574f); color: #fff; }
      #__egg_titlebar .tb-right button svg {
        width: 14px; height: 14px; display: block;
      }
      /* 给 body 留出标题栏空间 */
      body.__egg-frameless { padding-top: 38px !important; }
    </style>
    <div class="tb-left">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style="stroke:var(--accent, #e8843c)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/>
        <path d="M8 12c0-2.5 1.5-4 4-4s4 1.5 4 4"/>
      </svg>
      <span class="tb-title">${escapeHtml(document.title || '扭蛋')}</span>
    </div>
    ${
      isMac ? '' : `
    <div class="tb-right">
      <button title="最小化" id="__tb_min">${minIcon}</button>
      <button title="最大化" id="__tb_max">${maxIcon}</button>
      <button title="关闭" class="tb-close" id="__tb_close">${closeIcon}</button>
    </div>`
    }
  `

  document.body.prepend(bar)
  document.body.classList.add('__egg-frameless')

  // 按钮事件（macOS 用原生交通灯，不注入自定义按钮）
  if (!isMac) {
    document.getElementById('__tb_min')!.addEventListener('click', () => ipcRenderer.send('win:minimize'))
    document.getElementById('__tb_max')!.addEventListener('click', () => ipcRenderer.send('win:maximize'))
    document.getElementById('__tb_close')!.addEventListener('click', () => ipcRenderer.send('win:close'))
  }

  // 最大化状态切换图标
  if (!isMac) {
    ipcRenderer.on('win:stateChanged', (_e, s: any) => {
      const btn = document.getElementById('__tb_max')
      if (btn) btn.innerHTML = s.maximized ? restoreIcon : maxIcon
    })
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// ---- widget hover 事件上报（D11：安全出口改为独立卫星控制窗，由主进程管理，不在蛋 DOM 内） ----

function setupWidgetHover(): void {
  document.documentElement.addEventListener('mouseenter', () => ipcRenderer.send('widget:hover'))
  document.documentElement.addEventListener('mouseleave', () => ipcRenderer.send('widget:leave'))
}

// SVG icons (inline to avoid external deps)
const minIcon = '<svg viewBox="0 0 16 16"><line x1="3" y1="8" x2="13" y2="8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
const maxIcon = '<svg viewBox="0 0 16 16"><rect x="3" y="3" width="10" height="10" rx="1" stroke="currentColor" stroke-width="2" fill="none"/></svg>'
const restoreIcon = '<svg viewBox="0 0 16 16"><rect x="5" y="2" width="9" height="9" rx="1" stroke="currentColor" stroke-width="2" fill="none"/><rect x="2" y="5" width="9" height="9" rx="1" stroke="currentColor" stroke-width="2" fill="white"/></svg>'
const closeIcon = '<svg viewBox="0 0 16 16"><line x1="4" y1="4" x2="12" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="12" y1="4" x2="4" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'

// 窗口类型（主进程经 additionalArguments 传入 process.argv）：
// standard = 独立窗（注入标题栏）；widget = 悬浮窗（hover 上报）；space = 扭蛋空间内嵌（宿主已有 chrome，啥都不注入）
const eggWindowType = process.argv.find(a => a.startsWith('--egg-window-type='))?.split('=')[1] ?? 'standard'

// DOM ready 时注入：standard 标题栏 / widget hover 事件上报 / space 不注入
if (eggWindowType !== 'space') {
  const inject = () => eggWindowType === 'widget' ? setupWidgetHover() : injectTitleBar()
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject)
  } else {
    inject()
  }
}
