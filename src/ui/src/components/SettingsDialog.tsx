import { useCallback, useEffect, useMemo, useState } from 'react'
import { X, ExternalLink, Plug, Settings2, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { shelf, type UpdateStatus } from '../shelf'
import { sfx, setSoundEnabled } from '../sound'
import { getLangPref, setLangPref, type LangPref } from '../i18n'
import { providerIcon } from '../config/providerIcons'
import providersData from '../../../shared/ai-providers.json'

/* ─── 类型 ─── */
interface ProviderModel { id: string; context: number }
interface Provider {
  id: string
  icon: string
  name: string
  nameZh?: string
  baseUrl: string
  models: ProviderModel[]
  defaultModel: string
  keyUrl: string
  noKey?: boolean
  /** 平台积分通道（AppGacha）：无需 Key/URL，选中即走代理扣积分 */
  useProxy?: boolean
  hint?: string
}

const providers = providersData.providers as Provider[]
const CUSTOM_MODEL = '__custom__'

type NavId = 'general' | string // 'general' 或 provider id

interface Props { onClose: () => void; onToast: (msg: string) => void }

export function SettingsDialog({ onClose, onToast }: Props) {
  const { t, i18n } = useTranslation()
  const zh = i18n.language?.startsWith('zh')

  /* ─── 导航 ─── */
  const [nav, setNav] = useState<NavId>('general')

  /* ─── 通用设置 state ─── */
  const [autoStartApp, setAutoStartApp] = useState(false)
  const [minimizeToTray, setMinimizeToTray] = useState(true)
  const [soundOn, setSoundOn] = useState(true)
  const [autoUpdate, setAutoUpdate] = useState(true)
  const [appVersion, setAppVersion] = useState('')
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ stage: 'idle' })
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [lang, setLang] = useState<LangPref>(getLangPref)

  /* ─── AI 模型 state ─── */
  const [providerId, setProviderId] = useState('')
  const [baseURL, setBaseURL] = useState('')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [hasKey, setHasKey] = useState(false)
  const [liveModels, setLiveModels] = useState<string[]>([])
  const [testing, setTesting] = useState(false)
  const [status, setStatus] = useState<{ text: string; cls: '' | 'ok' | 'warn' | 'err' }>({ text: '', cls: '' })
  const [loggedUser, setLoggedUser] = useState<string | null>(null)

  const provider = useMemo(() => providers.find(p => p.id === nav) ?? null, [nav])

  /** 模型选项：优先用接口拉取的真实列表，未验证时回退内置预设 */
  const availableModels = useMemo(() => {
    if (liveModels.length > 0) return liveModels
    return provider?.models.map(m => m.id) ?? []
  }, [liveModels, provider])

  /** 模型下拉当前值：在可用列表中 → 对应 id，否则 → CUSTOM_MODEL */
  const modelSelect = useMemo(() => {
    if (availableModels.length === 0) return CUSTOM_MODEL
    return availableModels.includes(model) ? model : CUSTOM_MODEL
  }, [availableModels, model])

  useEffect(() => {
    shelf.getAiSettings().then(s => {
      if (!s) return
      setBaseURL(s.baseURL)
      setModel(s.model)
      setHasKey(s.hasKey)
      if (s.providerId && providers.some(p => p.id === s.providerId)) {
        setProviderId(s.providerId)
        setNav(s.providerId)
      } else {
        const match = providers.find(p => p.baseUrl && s.baseURL.startsWith(p.baseUrl.replace(/\/$/, '').split('/').slice(0, 3).join('/')))
        const id = match?.id ?? 'custom'
        setProviderId(id)
        setNav(id)
      }
    }).catch(() => {})
    shelf.getAppSettings().then(s => { setAutoStartApp(s.autoStartApp); setMinimizeToTray(s.minimizeToTray); setSoundOn(s.soundEnabled); setAutoUpdate(s.autoUpdate); setAppVersion(s.version ?? '') }).catch(() => {})
    shelf.authStatus().then(s => setLoggedUser(s.loggedIn ? (s.user?.name || s.user?.email || '') : null)).catch(() => {})
    // 更新状态
    shelf.getUpdateStatus().then(setUpdateStatus).catch(() => {})
    shelf.onUpdateStateChanged(s => {
      setUpdateStatus(s as UpdateStatus)
      setCheckingUpdate(false)
    })
  }, [])

  /** 切换左侧导航 */
  function switchNav(id: NavId) {
    sfx.tick()
    setNav(id)
    // Key 输入框始终随平台重置，绝不跨平台残留
    setApiKey('')
    if (id !== 'general') {
      const p = providers.find(x => x.id === id)
      if (p) {
        setProviderId(p.id)
        // 切平台时：若当前 baseURL 不属于该平台则自动填充
        if (p.baseUrl && !baseURL.startsWith(p.baseUrl.slice(0, 20))) {
          setBaseURL(p.baseUrl)
          if (p.defaultModel) setModel(p.defaultModel)
        }
        setLiveModels([])
        // 查询该平台是否已存 Key（决定 placeholder 提示）
        shelf.hasProviderKey(p.id).then(r => setHasKey(r.hasKey)).catch(() => setHasKey(false))
      }
    }
    setStatus({ text: '', cls: '' })
  }

  /** 当前选中模型的 contextTokens（自定义模型 → undefined，机芯用默认值） */
  const contextTokens = useMemo(() => {
    if (!provider) return undefined
    return provider.models.find(x => x.id === model)?.context
  }, [provider, model])

  const inputCls = 'block w-full mt-1.5 px-4 py-3 border-[3px] border-text rounded-2xl text-[14px] font-bold outline-none focus:border-brand transition-colors bg-white'

  return (
    <div className="fixed inset-0 flex items-center justify-center z-[100]" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white border-[4px] border-text rounded-2xl w-[720px] max-w-[94vw] h-[560px] max-h-[90vh] flex flex-col" style={{ boxShadow: '6px 6px 0 rgba(92,64,51,0.2)' }}>
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-7 pt-6 pb-4">
          <h2 className="text-xl font-extrabold text-text">{t('settings.title')}</h2>
          <button onClick={onClose}
            className="w-9 h-9 rounded-xl border-[3px] border-text flex items-center justify-center text-text hover:bg-cream active:translate-y-0.5 transition-all font-extrabold"
            style={{ boxShadow: '2px 2px 0 rgba(92,64,51,0.15)' }}>
            <X className="w-4 h-4" strokeWidth={3} />
          </button>
        </div>

        {/* 主体：左导航 + 右内容 */}
        <div className="flex flex-1 min-h-0 border-t-[3px] border-text/10">
          {/* 左侧导航 */}
          <div className="w-[180px] shrink-0 border-r-[3px] border-text/10 bg-cream/60 rounded-b-[14px] py-4 px-3 flex flex-col gap-1 overflow-y-auto">
            <NavBtn active={nav === 'general'} onClick={() => switchNav('general')}>
              <Settings2 className="w-[18px] h-[18px]" strokeWidth={2.5} />
              <span>{t('settings.tabGeneral')}</span>
            </NavBtn>

            <div className="my-2 border-t-2 border-text/10" />

            {providers.map(p => {
              const icon = providerIcon(p.icon)
              return (
                <NavBtn key={p.id} active={nav === p.id} onClick={() => switchNav(p.id)}>
                  {icon
                    ? <img src={icon} alt={p.name} className="w-[18px] h-[18px]" draggable={false} />
                    : <Plug className="w-[18px] h-[18px]" strokeWidth={2.5} />}
                  <span>{zh && p.nameZh ? p.nameZh : p.name}</span>
                </NavBtn>
              )
            })}
          </div>

          {/* 右侧内容 */}
          <div className="flex-1 min-w-0 flex flex-col">
            <div className="flex-1 overflow-y-auto px-7 py-5">
              {nav === 'general' ? (
                <GeneralPanel
                  autoStartApp={autoStartApp} setAutoStartApp={setAutoStartApp}
                  minimizeToTray={minimizeToTray} setMinimizeToTray={setMinimizeToTray}
                  soundOn={soundOn} setSoundOn={setSoundOn}
                  autoUpdate={autoUpdate} setAutoUpdate={setAutoUpdate}
                  appVersion={appVersion}
                  updateStatus={updateStatus}
                  checkingUpdate={checkingUpdate}
                  onCheckUpdate={() => { setCheckingUpdate(true); shelf.checkUpdate() }}
                  lang={lang} setLang={setLang}
                  onToast={onToast}
                />
              ) : provider && (
                <>
                  {/* 平台提示 */}
                  {(provider.id === 'ollama' || provider.id === 'custom') && (
                    <p className="text-xs font-bold text-muted bg-cream border-2 border-text/10 rounded-xl px-3.5 py-2.5 mb-4">
                      {t(`settings.hints.${provider.id}`, { defaultValue: provider.hint ?? '' })}
                    </p>
                  )}

                  {provider.useProxy ? (
                    /* AppGacha 平台积分通道：无表单，选中即用 */
                    <div className="flex flex-col gap-4">
                      <div className="flex items-center gap-3 bg-cream border-2 border-text/10 rounded-xl px-4 py-3.5">
                        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${loggedUser !== null ? 'bg-emerald-500' : 'bg-danger'}`} />
                        <span className="text-[13px] font-extrabold text-text">
                          {loggedUser !== null
                            ? t('settings.appgachaLoggedIn', { name: loggedUser })
                            : t('settings.appgachaNotLoggedIn')}
                        </span>
                      </div>
                      <p className="text-[13px] font-bold text-text/80 leading-relaxed whitespace-pre-line">
                        {t('settings.appgachaDesc')}
                      </p>
                    </div>
                  ) : (
                  <>

                  {/* 模型选择 */}
                  <label className="block text-sm font-extrabold text-text mb-4">
                    {t('settings.model')}
                    {availableModels.length > 0 ? (
                      <>
                        <select value={modelSelect}
                          onChange={e => {
                            const v = e.target.value
                            if (v === CUSTOM_MODEL) { setModel('') } else { setModel(v) }
                          }}
                          className={inputCls + ' cursor-pointer'}>
                          {availableModels.map(id => (
                            <option key={id} value={id}>{id}</option>
                          ))}
                          <option value={CUSTOM_MODEL}>{t('settings.customModel')}</option>
                        </select>
                        {modelSelect === CUSTOM_MODEL && (
                          <input value={model} onChange={e => setModel(e.target.value)}
                            placeholder={t('settings.customModelPh')} spellCheck={false}
                            className={inputCls + ' mt-2'} autoFocus />
                        )}
                      </>
                    ) : (
                      <input value={model} onChange={e => setModel(e.target.value)}
                        placeholder={provider.id === 'ollama' ? 'qwen3:8b' : 'model-name'} spellCheck={false} className={inputCls} />
                    )}
                  </label>

                  {/* API Key */}
                  {!(provider.noKey) && (
                    <label className="block text-sm font-extrabold text-text mb-2">
                      {t('settings.apiKey')}
                      <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)}
                        placeholder={hasKey ? t('settings.keySaved') : 'sk-…'} spellCheck={false} className={inputCls} />
                    </label>
                  )}
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-[11px] font-bold text-muted">{t('settings.keyNote')}</span>
                    <span className="flex items-center gap-3">
                      {hasKey && (
                        <button onClick={async () => {
                          await shelf.clearProviderKey(provider!.id)
                          setHasKey(false)
                          setApiKey('')
                          setStatus({ text: t('settings.keyCleared'), cls: 'ok' })
                        }} className="text-xs font-extrabold text-muted hover:text-danger transition-colors">{t('settings.clearKey')}</button>
                      )}
                      {provider.keyUrl && (
                        <a href={provider.keyUrl} target="_blank" rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs font-extrabold text-brand hover:underline">
                          {t('settings.getKey')} <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      )}
                    </span>
                  </div>

                  {/* Base URL */}
                  <label className="block text-sm font-extrabold text-text">
                    {t('settings.baseUrl')}
                    <input value={baseURL} onChange={e => setBaseURL(e.target.value)}
                      placeholder="https://api.example.com/v1" spellCheck={false} className={inputCls} />
                  </label>
                  </>
                  )}
                </>
              )}
            </div>

            {/* 底部操作行（仅平台配置） */}
            {nav !== 'general' && (
              <div className="flex gap-3 items-center justify-end px-7 py-4 border-t-[3px] border-text/10">
                <span className={`flex-1 text-sm font-bold truncate ${status.cls === 'ok' ? 'text-emerald-600' : status.cls === 'warn' ? 'text-amber-600' : status.cls === 'err' ? 'text-danger' : 'text-muted'}`}>{status.text}</span>
                <Btn onClick={async () => {
                  setTesting(true)
                  setStatus({ text: t('settings.verifying'), cls: '' })
                  try {
                    const res = await shelf.fetchModels({ baseURL, apiKey, providerId: nav })
                    setLiveModels(res.models)
                    if (res.models.length > 0 && (!model || !res.models.includes(model))) {
                      const def = provider?.defaultModel
                      setModel(def && res.models.includes(def) ? def : res.models[0])
                    }
                    setStatus({ text: res.models.length > 0
                      ? t('settings.testModelsOk', { count: res.models.length })
                      : t('settings.testKeyOk'), cls: 'ok' })
                  } catch (err) {
                    setLiveModels([])
                    setStatus({ text: (err as Error).message, cls: 'err' })
                  } finally { setTesting(false) }
                }}>{testing ? t('settings.verifying') : t('settings.test')}</Btn>
                <Btn primary onClick={async () => {
                  try {
                    await shelf.saveAiSettings({
                      baseURL, model, apiKey,
                      providerId: providerId || 'custom',
                      contextTokens,
                      noKey: provider?.noKey
                    })
                    setStatus({ text: t('settings.saved'), cls: 'ok' })
                    setHasKey(true)
                    onToast(t('settings.savedToast'))
                  } catch (err) { setStatus({ text: (err as Error).message, cls: 'err' }) }
                }}>{t('settings.save')}</Btn>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ─── 左侧导航按钮 ─── */
function NavBtn({ children, active, onClick }: { children: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className={`flex items-center gap-2.5 w-full px-3.5 py-2.5 rounded-xl text-[13px] font-extrabold transition-all text-left ${
        active
          ? 'bg-white text-brand border-[2.5px] border-brand/40 shadow-sm'
          : 'text-text/70 hover:text-text hover:bg-white/60 border-[2.5px] border-transparent'}`}>
      {children}
    </button>
  )
}

/* ─── 通用面板 ─── */
function GeneralPanel({ autoStartApp, setAutoStartApp, minimizeToTray, setMinimizeToTray, soundOn, setSoundOn, autoUpdate, setAutoUpdate, appVersion, updateStatus, checkingUpdate, onCheckUpdate, lang, setLang, onToast }: {
  autoStartApp: boolean; setAutoStartApp: (v: boolean) => void
  minimizeToTray: boolean; setMinimizeToTray: (v: boolean) => void
  soundOn: boolean; setSoundOn: (v: boolean) => void
  autoUpdate: boolean; setAutoUpdate: (v: boolean) => void
  appVersion: string
  updateStatus: UpdateStatus
  checkingUpdate: boolean
  onCheckUpdate: () => void
  lang: LangPref; setLang: (v: LangPref) => void
  onToast: (msg: string) => void
}) {
  const { t } = useTranslation()
  return (
    <>
      <div className="flex flex-col gap-4 mb-7">
        <Toggle label={t('settings.autoStart')} checked={autoStartApp} onChange={async v => {
          setAutoStartApp(v)
          await shelf.setAppSettings({ autoStartApp: v })
          onToast(v ? t('settings.autoStartOn') : t('settings.autoStartOff'))
        }} />
        <Toggle label={t('settings.minimizeToTray')} checked={minimizeToTray} onChange={async v => {
          setMinimizeToTray(v)
          await shelf.setAppSettings({ minimizeToTray: v })
        }} />
        <Toggle label={t('settings.sound')} checked={soundOn} onChange={async v => {
          setSoundOn(v)
          setSoundEnabled(v)
          if (v) sfx.pop()
          await shelf.setAppSettings({ soundEnabled: v })
        }} />
      </div>
      <div className="flex items-center gap-3 mb-7">
        <span className="text-sm font-extrabold text-text">{t('settings.language')}</span>
        <div className="flex gap-1 bg-cream rounded-full p-1 border-2 border-text/10">
          {(['auto', 'en', 'zh'] as const).map(v => (
            <button key={v}
              onClick={() => { sfx.tick(); setLang(v); setLangPref(v); const resolved = v === 'auto' ? (navigator.language.toLowerCase().startsWith('zh') ? 'zh' as const : 'en' as const) : v; window.shelf.setLang(resolved) }}
              className={`px-3.5 py-1.5 rounded-full text-xs font-extrabold transition-colors ${
                lang === v ? 'bg-text text-white' : 'text-muted hover:text-text'}`}>
              {v === 'auto' ? t('settings.langAuto') : v === 'en' ? 'English' : '中文'}
            </button>
          ))}
        </div>
      </div>

      {/* ─── 更新区块 ─── */}
      <div className="border-t-[3px] border-text/10 pt-4 mt-2">
        <h3 className="text-sm font-extrabold text-text mb-3">{t('settings.updates')}</h3>
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-extrabold text-text">{t('settings.version')}</span>
            <span className="text-xs font-bold text-muted">v{appVersion || '—'}</span>
          </div>
          <Toggle label={t('settings.autoUpdate')} checked={autoUpdate} onChange={async v => {
            setAutoUpdate(v)
            await shelf.setAppSettings({ autoUpdate: v })
          }} />
          <div className="flex items-center gap-3">
            <button
              onClick={onCheckUpdate}
              disabled={checkingUpdate || updateStatus.stage === 'checking' || updateStatus.stage === 'downloading'}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-extrabold text-text border-[2.5px] border-text active:translate-y-0.5 transition-all disabled:opacity-50"
              style={{ boxShadow: '2px 2px 0 rgba(92,64,51,0.12)' }}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${checkingUpdate || updateStatus.stage === 'checking' || updateStatus.stage === 'downloading' ? 'animate-spin' : ''}`} strokeWidth={3} />
              {checkingUpdate || updateStatus.stage === 'checking' ? t('settings.checking')
                : updateStatus.stage === 'downloading' ? `${t('settings.updateDownloading')} ${updateStatus.percent ?? 0}%`
                : t('settings.checkUpdates')}
            </button>
            {updateStatus.stage === 'downloaded' && (
              <button
                onClick={() => shelf.installUpdate()}
                className="px-4 py-2 rounded-xl text-xs font-extrabold text-white border-[2.5px] border-text active:translate-y-0.5 transition-all"
                style={{ background: '#D9534F', boxShadow: '2px 2px 0 rgba(92,64,51,0.18)' }}
              >
                {t('settings.restartToInstall')}
              </button>
            )}
          </div>
          {updateStatus.stage === 'error' && (
            <span className="text-xs font-bold text-danger">{updateStatus.error}</span>
          )}
          {updateStatus.stage === 'idle' && (
            <span className="text-xs font-bold text-emerald-600">{t('settings.upToDate')}</span>
          )}
          {updateStatus.stage === 'available' && (
            <span className="text-xs font-bold text-brand">{t('settings.updateAvailable', { version: updateStatus.version ?? '' })}</span>
          )}
        </div>
      </div>
    </>
  )
}

/* ─── 子组件 ─── */

function Btn({ children, primary, onClick }: { children: React.ReactNode; primary?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="px-6 py-3 rounded-xl text-sm font-extrabold active:translate-y-0.5 transition-all border-[3px] border-text"
      style={{
        background: primary ? '#D9534F' : '#fff',
        color: primary ? '#fff' : '#5C4033',
        boxShadow: '3px 3px 0 rgba(92,64,51,0.18)'
      }}>{children}</button>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2.5 cursor-pointer select-none">
      <div
        className={`w-11 h-[26px] rounded-full border-[2.5px] border-text relative transition-colors ${checked ? 'bg-emerald-400' : 'bg-gray-200'}`}
        onClick={() => onChange(!checked)}
      >
        <div className={`absolute top-[2.5px] w-4 h-4 rounded-full bg-white border-2 border-text transition-all ${checked ? 'left-[22px]' : 'left-[3px]'}`} />
      </div>
      <span className="text-sm font-extrabold text-text">{label}</span>
    </label>
  )
}
