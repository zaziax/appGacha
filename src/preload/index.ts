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

// ---- bridge 暴露：hostApiVersion 1 ----

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
    list: (path?: string) => invoke('egg:fs:list', path)
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
  ui: {
    toast: (message: string) => { toast(message) },
    confirm: (message: string) => Promise.resolve(window.confirm(String(message))),
    pickFile: (filters?: { name: string; extensions: string[] }[]) => invoke('egg:ui:pickFile', filters),
    saveFile: (content: string, defaultName?: string) => invoke('egg:ui:saveFile', content, defaultName)
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

  const bar = document.createElement('div')
  bar.id = '__egg_titlebar'
  bar.innerHTML = `
    <style>
      #__egg_titlebar {
        position: fixed; top: 0; left: 0; right: 0; z-index: 2147483646;
        height: 38px; display: flex; align-items: center; justify-content: space-between;
        padding: 0 8px;
        background: rgba(255,255,255,0.85); backdrop-filter: blur(8px);
        border-bottom: 1px solid #e8e4dc;
        font-family: system-ui, "Microsoft YaHei", sans-serif;
        -webkit-app-region: drag; user-select: none;
      }
      #__egg_titlebar .tb-left {
        display: flex; align-items: center; gap: 6px; padding-left: 4px;
        font-size: 13px; font-weight: 600; color: #2b2b30;
      }
      #__egg_titlebar .tb-right {
        display: flex; align-items: center; gap: 2px;
        -webkit-app-region: no-drag;
      }
      #__egg_titlebar .tb-right button {
        width: 34px; height: 26px; border: none; background: none;
        border-radius: 6px; cursor: pointer; display: flex; align-items: center;
        justify-content: center; color: #8a8a92; font-size: 16px;
        line-height: 1; transition: background 0.15s, color 0.15s;
        font-family: inherit; padding: 0;
      }
      #__egg_titlebar .tb-right button:hover { background: #f2f0ec; color: #2b2b30; }
      #__egg_titlebar .tb-right button.tb-close:hover { background: #c0574f; color: #fff; }
      #__egg_titlebar .tb-right button svg {
        width: 14px; height: 14px; display: block;
      }
      /* 给 body 留出标题栏空间 */
      body.__egg-frameless { padding-top: 38px !important; }
    </style>
    <div class="tb-left">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#e8843c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/>
        <path d="M8 12c0-2.5 1.5-4 4-4s4 1.5 4 4"/>
      </svg>
      <span class="tb-title">${escapeHtml(document.title || '扭蛋')}</span>
    </div>
    <div class="tb-right">
      <button title="最小化" id="__tb_min">${minIcon}</button>
      <button title="最大化" id="__tb_max">${maxIcon}</button>
      <button title="关闭" class="tb-close" id="__tb_close">${closeIcon}</button>
    </div>
  `

  document.body.prepend(bar)
  document.body.classList.add('__egg-frameless')

  // 按钮事件
  document.getElementById('__tb_min')!.addEventListener('click', () => ipcRenderer.send('win:minimize'))
  document.getElementById('__tb_max')!.addEventListener('click', () => ipcRenderer.send('win:maximize'))
  document.getElementById('__tb_close')!.addEventListener('click', () => ipcRenderer.send('win:close'))

  // 最大化状态切换图标
  ipcRenderer.on('win:stateChanged', (_e, s: any) => {
    const btn = document.getElementById('__tb_max')
    if (btn) btn.innerHTML = s.maximized ? restoreIcon : maxIcon
  })
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// SVG icons (inline to avoid external deps)
const minIcon = '<svg viewBox="0 0 16 16"><line x1="3" y1="8" x2="13" y2="8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
const maxIcon = '<svg viewBox="0 0 16 16"><rect x="3" y="3" width="10" height="10" rx="1" stroke="currentColor" stroke-width="2" fill="none"/></svg>'
const restoreIcon = '<svg viewBox="0 0 16 16"><rect x="5" y="2" width="9" height="9" rx="1" stroke="currentColor" stroke-width="2" fill="none"/><rect x="2" y="5" width="9" height="9" rx="1" stroke="currentColor" stroke-width="2" fill="white"/></svg>'
const closeIcon = '<svg viewBox="0 0 16 16"><line x1="4" y1="4" x2="12" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="12" y1="4" x2="4" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'

// DOM ready 时注入
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectTitleBar)
} else {
  injectTitleBar()
}
