import { contextBridge, ipcRenderer } from 'electron'

interface BridgeResult {
  ok: boolean
  value?: unknown
  error?: string
}

async function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  const res = (await ipcRenderer.invoke(channel, ...args)) as BridgeResult
  if (!res.ok) throw new Error(res.error ?? 'shelf bridge error')
  return res.value
}

contextBridge.exposeInMainWorld('shelf', {
  list: () => invoke('shelf:list'),
  open: (eggId: string) => invoke('shelf:open', eggId),
  import: () => invoke('shelf:import'),
  export: (eggId: string) => invoke('shelf:export', eggId),
  trash: (eggId: string) => invoke('shelf:trash', eggId),
  getAiSettings: () => invoke('shelf:getAiSettings'),
  saveAiSettings: (s: { baseURL: string; model: string; apiKey: string }) => invoke('shelf:saveAiSettings', s),
  testAi: () => invoke('shelf:testAi'),
  wish: (text: string) => invoke('shelf:wish', text),
  onGachaProgress: (cb: (p: unknown) => void) => {
    ipcRenderer.on('gacha:progress', (_e, p) => cb(p))
  },
  onGachaDone: (cb: (r: unknown) => void) => {
    ipcRenderer.on('gacha:done', (_e, r) => cb(r))
  }
})
