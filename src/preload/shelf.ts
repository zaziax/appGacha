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
  export: (eggId: string, includeData: boolean) => invoke('shelf:export', eggId, includeData),
  shortcut: (eggId: string, iconPngs?: Record<number, string>) => invoke('shelf:shortcut', eggId, iconPngs),
  trash: (eggId: string) => invoke('shelf:trash', eggId),
  getAiSettings: () => invoke('shelf:getAiSettings'),
  saveAiSettings: (s: { baseURL: string; model: string; apiKey: string; providerId?: string; contextTokens?: number; noKey?: boolean }) => invoke('shelf:saveAiSettings', s),
  fetchModels: (p?: { baseURL?: string; apiKey?: string; providerId?: string }) => invoke('shelf:fetchModels', p),
  hasProviderKey: (providerId: string) => invoke('shelf:hasProviderKey', providerId),
  clearProviderKey: (providerId: string) => invoke('shelf:clearProviderKey', providerId),
  wish: (text: string, lang: string) => invoke('shelf:wish', text, lang),
  upgrade: (eggId: string, text: string, lang: string) => invoke('shelf:upgrade', eggId, text, lang),
  cancelGacha: () => invoke('shelf:cancelGacha'),
  rollback: (eggId: string) => invoke('shelf:rollback', eggId),
  getPendingBuild: () => invoke('shelf:getPendingBuild'),
  resumeBuild: (eggId: string) => invoke('shelf:resumeBuild', eggId),
  abandonBuild: (eggId: string) => invoke('shelf:abandonBuild', eggId),
  wishChat: (messages: { role: string; content: string }[], context?: { upgradeEggId?: string }) => invoke('shelf:wishChat', messages, context),
  wishSuggest: (lang: string) => invoke('shelf:wishSuggest', lang),
  getAppSettings: () => invoke('shelf:getAppSettings'),
  setAppSettings: (s: { autoStartApp?: boolean; minimizeToTray?: boolean; soundEnabled?: boolean; autoUpdate?: boolean }) => invoke('shelf:setAppSettings', s),
  setLang: (lang: 'en' | 'zh') => invoke('shelf:setLang', lang),
  getEggAutoStart: (eggId: string) => invoke('shelf:getEggAutoStart', eggId),
  setEggAutoStart: (eggId: string, enabled: boolean) => invoke('shelf:setEggAutoStart', eggId, enabled),
  getSyncDisabled: (eggId: string) => invoke('shelf:getSyncDisabled', eggId),
  setSyncDisabled: (eggId: string, disabled: boolean) => invoke('shelf:setSyncDisabled', eggId, disabled),
  getCategories: () => invoke('shelf:getCategories'),
  saveCategory: (c: { id?: string; name: string }) => invoke('shelf:saveCategory', c),
  deleteCategory: (id: string) => invoke('shelf:deleteCategory', id),
  setEggCategory: (eggId: string, categoryId: string | null) => invoke('shelf:setEggCategory', eggId, categoryId),
  // ─── 扭蛋空间（GachaSpace）───
  spaceGet: () => invoke('space:get'),
  spaceAdd: (eggId: string) => invoke('space:add', eggId),
  spaceRemove: (eggId: string) => invoke('space:remove', eggId),
  spaceConfigure: (config: { eggs: string[]; active?: string | null }) => invoke('space:configure', config),
  spaceReorder: (ids: string[]) => invoke('space:reorder', ids),
  spaceActivate: (eggId: string) => invoke('space:activate', eggId),
  spaceSetBounds: (b: { x: number; y: number; width: number; height: number }) => invoke('space:setBounds', b),
  spaceSetVisible: (v: boolean) => invoke('space:setVisible', v),
  // 外部唤起聚焦空间：主进程推送，UI 切到空间视图
  onSpaceFocus: (cb: (p: { eggId: string }) => void) => {
    ipcRenderer.on('space:focusEgg', (_e, p) => cb(p as { eggId: string }))
  },
  // ─── Google OAuth 登录 ───
  authStatus: () => invoke('shelf:authStatus'),
  authLogin: () => invoke('shelf:authLogin'),
  authLogout: () => invoke('shelf:authLogout'),
  authProfile: () => invoke('shelf:authProfile'),
  billingSummary: () => invoke('shelf:billingSummary'),
  billingCredits: () => invoke('shelf:billingCredits'),
  openPricing: () => invoke('shelf:openPricing'),
  openAccount: () => invoke('shelf:openAccount'),
  checkout: (type: string, packId?: string) => invoke('shelf:checkout', type, packId),
  serverHealth: () => invoke('shelf:serverHealth'),
  // ─── 邮箱验证码登录 ───
  sendCode: (email: string) => invoke('shelf:sendCode', email),
  verifyCode: (email: string, code: string) => invoke('shelf:verifyCode', email, code),
  // ─── 密码登录 ───
  loginPassword: (email: string, password: string) => invoke('shelf:loginPassword', email, password),
  setPassword: (password: string, oldPassword?: string) => invoke('shelf:setPassword', password, oldPassword),
  resetPassword: (email: string, code: string, newPassword: string) => invoke('shelf:resetPassword', email, code, newPassword),
  // ─── 云同步 ───
  syncEgg: (eggId: string) => invoke('shelf:syncEgg', eggId),
  syncList: () => invoke('shelf:syncList'),
  syncDownload: (eggId: string) => invoke('shelf:syncDownload', eggId),
  syncDeleteCloud: (eggId: string) => invoke('shelf:syncDeleteCloud', eggId),
  setSyncEnabled: (v: boolean) => invoke('shelf:setSyncEnabled', v),
  onAuthChanged: (cb: (s: { loggedIn: boolean }) => void) => {
    ipcRenderer.on('auth:changed', (_e, s) => cb(s))
  },
  onGachaProgress: (cb: (p: unknown) => void) => {
    ipcRenderer.on('gacha:progress', (_e, p) => cb(p))
  },
  onGachaDone: (cb: (r: unknown) => void) => {
    ipcRenderer.on('gacha:done', (_e, r) => cb(r))
  },
  // 平台通道构建完成后的积分结算通知（本次消耗 + 剩余余额）
  onBillingSettled: (cb: (p: { spent: number; balance: number }) => void) => {
    ipcRenderer.on('billing:settled', (_e, p) => cb(p as { spent: number; balance: number }))
  },
  onDownloadProgress: (cb: (p: { eggId: string; percent: number; stage: string; error?: string }) => void) => {
    ipcRenderer.on('sync:downloadProgress', (_e, p) => cb(p as { eggId: string; percent: number; stage: string; error?: string }))
  },
  // 蛋柜变动（双击 .gacha 热导入等）：主进程推送，UI 重拉列表
  onEggsChanged: (cb: () => void) => {
    ipcRenderer.on('shelf:eggsChanged', () => cb())
  },
  // 关闭询问：主进程拦截 close 后推送，UI 弹项目风格弹窗，回传用户选择
  onClosePrompt: (cb: () => void) => {
    ipcRenderer.on('shelf:closePrompt', () => cb())
  },
  // .gacha 导入冲突：主进程推送后 UI 弹窗询问「打开现有 / 导入为新副本」
  onImportConflict: (cb: (p: { file: string; eggId: string; name: string }) => void) => {
    ipcRenderer.on('shelf:importConflict', (_e, p) => cb(p as { file: string; eggId: string; name: string }))
  },
  resolveImportConflict: (file: string, eggId: string, action: 'open' | 'import') =>
    invoke('shelf:resolveImportConflict', file, eggId, action),
  resolveCloseAction: (action: 'tray' | 'quit', remember: boolean) =>
    invoke('shelf:resolveCloseAction', action, remember),
  minimize: () => ipcRenderer.send('win:minimize'),
  maximize: () => ipcRenderer.send('win:maximize'),
  close: () => ipcRenderer.send('win:close'),
  isMaximized: () => ipcRenderer.invoke('win:isMaximized'),
  onWindowState: (cb: (s: { maximized: boolean }) => void) => {
    ipcRenderer.on('win:stateChanged', (_e, s) => cb(s))
  },
  // ─── 自动更新 ───
  checkUpdate: () => invoke('shelf:checkUpdate'),
  getUpdateStatus: () => invoke('shelf:getUpdateStatus'),
  installUpdate: () => invoke('shelf:installUpdate'),
  onUpdateStateChanged: (cb: (s: unknown) => void) => {
    ipcRenderer.on('update:stateChanged', (_e, s) => cb(s))
  }
})
