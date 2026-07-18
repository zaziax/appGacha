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
  ui: {
    toast: (message: string) => { toast(message) },
    confirm: (message: string) => Promise.resolve(window.confirm(String(message)))
  }
})
