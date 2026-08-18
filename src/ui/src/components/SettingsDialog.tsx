import { useEffect, useMemo, useState } from 'react'
import {
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  KeyRound,
  Plug,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { shelf, type UpdateStatus } from '../shelf'
import { sfx, setSoundEnabled } from '../sound'
import { getLangPref, setLangPref, type LangPref } from '../i18n'
import { providerIcon } from '../config/providerIcons'
import providersData from '../../../shared/ai-providers.json'

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
  useProxy?: boolean
  hint?: string
}

const providers = providersData.providers as Provider[]
const managedProvider = providers.find(p => p.useProxy)!
const ownKeyProviders = providers.filter(p => !p.useProxy)
const DEFAULT_OWN_PROVIDER = ownKeyProviders.find(p => p.id === 'deepseek')?.id ?? ownKeyProviders[0]?.id ?? 'custom'
const CUSTOM_MODEL = '__custom__'

type SettingsSection = 'general' | 'ai'
type AiMode = 'managed' | 'own'
type Status = { text: string; cls: '' | 'ok' | 'warn' | 'err' }

interface Props { onClose: () => void; onToast: (msg: string) => void }

export function SettingsDialog({ onClose, onToast }: Props) {
  const { t, i18n } = useTranslation()
  const zh = i18n.language?.startsWith('zh')

  const [section, setSection] = useState<SettingsSection>('general')

  const [autoStartApp, setAutoStartApp] = useState(false)
  const [minimizeToTray, setMinimizeToTray] = useState(true)
  const [soundOn, setSoundOn] = useState(true)
  const [autoUpdate, setAutoUpdate] = useState(true)
  const [appVersion, setAppVersion] = useState('')
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ stage: 'idle' })
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [lang, setLang] = useState<LangPref>(getLangPref)

  const [mode, setMode] = useState<AiMode>('managed')
  const [providerId, setProviderId] = useState(DEFAULT_OWN_PROVIDER)
  const [lastOwnProviderId, setLastOwnProviderId] = useState(DEFAULT_OWN_PROVIDER)
  const [baseURL, setBaseURL] = useState('')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [hasKey, setHasKey] = useState(false)
  const [editingKey, setEditingKey] = useState(true)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [liveModels, setLiveModels] = useState<string[]>([])
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<Status>({ text: '', cls: '' })
  const [loggedUser, setLoggedUser] = useState<string | null>(null)

  const provider = useMemo(
    () => ownKeyProviders.find(p => p.id === providerId) ?? ownKeyProviders[0] ?? null,
    [providerId],
  )

  const availableModels = useMemo(() => {
    if (liveModels.length > 0) return liveModels
    return provider?.models.map(m => m.id) ?? []
  }, [liveModels, provider])

  const modelSelect = useMemo(() => {
    if (availableModels.length === 0) return CUSTOM_MODEL
    return availableModels.includes(model) ? model : CUSTOM_MODEL
  }, [availableModels, model])

  const contextTokens = useMemo(() => {
    if (!provider) return undefined
    return provider.models.find(x => x.id === model)?.context
  }, [provider, model])

  useEffect(() => {
    shelf.getAiSettings().then(s => {
      if (!s) return
      setSection('ai')
      if (s.providerId === managedProvider.id) {
        setMode('managed')
        return
      }

      const matched = s.providerId && ownKeyProviders.some(p => p.id === s.providerId)
        ? s.providerId
        : ownKeyProviders.find(p => p.baseUrl && s.baseURL.startsWith(new URL(p.baseUrl).origin))?.id ?? 'custom'
      const initialProvider = ownKeyProviders.find(p => p.id === matched)
      setMode('own')
      setProviderId(matched)
      setLastOwnProviderId(matched)
      setBaseURL(s.baseURL)
      setModel(s.model)
      setHasKey(s.hasKey)
      setEditingKey(!s.hasKey && !initialProvider?.noKey)
      setAdvancedOpen(initialProvider?.id === 'custom' || initialProvider?.id === 'ollama' || (!!initialProvider?.baseUrl && s.baseURL !== initialProvider.baseUrl))
    }).catch(() => {})

    shelf.getAppSettings().then(s => {
      setAutoStartApp(s.autoStartApp)
      setMinimizeToTray(s.minimizeToTray)
      setSoundOn(s.soundEnabled)
      setAutoUpdate(s.autoUpdate)
      setAppVersion(s.version ?? '')
    }).catch(() => {})
    shelf.authStatus().then(s => setLoggedUser(s.loggedIn ? (s.user?.name || s.user?.email || '') : null)).catch(() => {})
    shelf.getUpdateStatus().then(setUpdateStatus).catch(() => {})
    shelf.onUpdateStateChanged(s => {
      setUpdateStatus(s as UpdateStatus)
      setCheckingUpdate(false)
    })
  }, [])

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  function switchSection(next: SettingsSection) {
    sfx.tick()
    setSection(next)
    setStatus({ text: '', cls: '' })
  }

  async function selectOwnProvider(id: string) {
    const next = ownKeyProviders.find(p => p.id === id)
    if (!next) return
    sfx.tick()
    setMode('own')
    setProviderId(id)
    setLastOwnProviderId(id)
    setBaseURL(next.baseUrl)
    setModel(next.defaultModel)
    setApiKey('')
    setLiveModels([])
    setStatus({ text: '', cls: '' })
    setAdvancedOpen(next.id === 'custom' || next.id === 'ollama')

    if (next.noKey) {
      setHasKey(false)
      setEditingKey(false)
      return
    }
    try {
      const result = await shelf.hasProviderKey(id)
      setHasKey(result.hasKey)
      setEditingKey(!result.hasKey)
    } catch {
      setHasKey(false)
      setEditingKey(true)
    }
  }

  function selectMode(next: AiMode) {
    if (next === mode) return
    sfx.tick()
    setStatus({ text: '', cls: '' })
    setLiveModels([])
    setApiKey('')
    if (next === 'managed') {
      setMode('managed')
      return
    }
    void selectOwnProvider(lastOwnProviderId)
  }

  async function testConnection() {
    setTesting(true)
    setStatus({ text: t('settings.verifying'), cls: '' })
    try {
      const res = await shelf.fetchModels({
        baseURL: mode === 'own' ? baseURL : '',
        apiKey: mode === 'own' ? apiKey : '',
        providerId: mode === 'managed' ? managedProvider.id : providerId,
      })
      if (mode === 'own') {
        setLiveModels(res.models)
        if (res.models.length > 0 && (!model || !res.models.includes(model))) {
          const fallback = provider?.defaultModel
          setModel(fallback && res.models.includes(fallback) ? fallback : res.models[0])
        }
      }
      setStatus({
        text: res.models.length > 0
          ? t('settings.testModelsOk', { count: res.models.length })
          : t('settings.testKeyOk'),
        cls: 'ok',
      })
    } catch (error) {
      setLiveModels([])
      setStatus({ text: (error as Error).message, cls: 'err' })
    } finally {
      setTesting(false)
    }
  }

  async function saveConfiguration() {
    setSaving(true)
    try {
      if (mode === 'managed') {
        await shelf.saveAiSettings({
          baseURL: '', model: '', apiKey: '', providerId: managedProvider.id, noKey: true,
        })
      } else {
        await shelf.saveAiSettings({
          baseURL,
          model,
          apiKey,
          providerId,
          contextTokens,
          noKey: provider?.noKey,
        })
        if (!provider?.noKey && (apiKey.trim() || hasKey)) {
          setHasKey(true)
          setEditingKey(false)
          setApiKey('')
        }
      }
      setStatus({ text: t('settings.saved'), cls: 'ok' })
      onToast(t('settings.savedToast'))
    } catch (error) {
      setStatus({ text: (error as Error).message, cls: 'err' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[#3a241c]/25 p-4 backdrop-blur-[1.5px]"
      onClick={event => { if (event.target === event.currentTarget) onClose() }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className="flex h-[520px] max-h-[90vh] w-[680px] max-w-[94vw] flex-col overflow-hidden rounded-[20px] border-[3px] border-text bg-white shadow-[6px_6px_0_rgba(92,64,51,0.18)]"
      >
        <div className="flex items-center justify-between border-b border-text/10 px-6 py-4">
          <div>
            <h2 id="settings-title" className="text-lg font-extrabold text-text">{t('settings.title')}</h2>
            <p className="mt-0.5 text-[11px] font-semibold text-muted/75">{t('settings.subtitle')}</p>
          </div>
          <button
            onClick={onClose}
            aria-label={t('common.close', { defaultValue: '关闭' })}
            className="flex h-8 w-8 items-center justify-center rounded-[10px] border-2 border-text/25 text-text transition-colors hover:border-text/50 hover:bg-cream"
          >
            <X className="h-4 w-4" strokeWidth={2.7} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          <aside className="w-[148px] shrink-0 border-r border-text/10 bg-cream/55 px-3 py-4">
            <p className="mb-2 px-3 text-[10px] font-extrabold uppercase tracking-[0.16em] text-muted/60">
              {t('settings.preferences')}
            </p>
            <div className="space-y-1.5">
              <NavBtn active={section === 'general'} onClick={() => switchSection('general')}>
                <Settings2 className="h-[17px] w-[17px]" strokeWidth={2.3} />
                <span>{t('settings.tabGeneral')}</span>
              </NavBtn>
              <NavBtn active={section === 'ai'} onClick={() => switchSection('ai')}>
                <Sparkles className="h-[17px] w-[17px]" strokeWidth={2.3} />
                <span>{t('settings.tabAi')}</span>
              </NavBtn>
            </div>
          </aside>

          <div className="flex min-w-0 flex-1 flex-col">
            <div className="shelf-scroll flex-1 overflow-y-auto px-6 py-5">
              {section === 'general' ? (
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
              ) : (
                <AiPanel
                  mode={mode}
                  onModeChange={selectMode}
                  provider={provider}
                  providerId={providerId}
                  onProviderChange={id => { void selectOwnProvider(id) }}
                  zh={zh}
                  availableModels={availableModels}
                  model={model}
                  modelSelect={modelSelect}
                  setModel={setModel}
                  baseURL={baseURL}
                  setBaseURL={setBaseURL}
                  apiKey={apiKey}
                  setApiKey={setApiKey}
                  hasKey={hasKey}
                  editingKey={editingKey}
                  setEditingKey={setEditingKey}
                  advancedOpen={advancedOpen}
                  setAdvancedOpen={setAdvancedOpen}
                  loggedUser={loggedUser}
                  onClearKey={async () => {
                    if (!provider) return
                    await shelf.clearProviderKey(provider.id)
                    setHasKey(false)
                    setEditingKey(true)
                    setApiKey('')
                    setStatus({ text: t('settings.keyCleared'), cls: 'ok' })
                  }}
                />
              )}
            </div>

            {section === 'ai' && (
              <div className="border-t border-text/10 bg-white px-6 py-3.5">
                {status.text && (
                  <div className={`mb-2.5 flex items-start gap-2 text-xs font-bold leading-relaxed ${
                    status.cls === 'ok' ? 'text-emerald-700' : status.cls === 'warn' ? 'text-amber-700' : status.cls === 'err' ? 'text-danger' : 'text-muted'
                  }`}>
                    {status.cls === 'ok' && <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2.5} />}
                    <span>{status.text}</span>
                  </div>
                )}
                <div className="flex items-center justify-end gap-2.5">
                  <button
                    onClick={testConnection}
                    disabled={testing || saving}
                    className="rounded-xl border-2 border-text/25 bg-white px-4 py-2.5 text-xs font-extrabold text-text transition-colors hover:border-text/50 hover:bg-cream disabled:opacity-50"
                  >
                    {testing ? t('settings.verifying') : t('settings.testOptional')}
                  </button>
                  <button
                    onClick={saveConfiguration}
                    disabled={testing || saving}
                    className="rounded-xl border-[2.5px] border-text bg-brand px-5 py-2.5 text-xs font-extrabold text-white shadow-[2px_2px_0_rgba(92,64,51,0.16)] transition-colors hover:bg-brand-hover active:translate-y-0.5 disabled:opacity-50"
                  >
                    {saving
                      ? t('settings.saving')
                      : mode === 'managed' ? t('settings.useManaged') : t('settings.useOwnKey')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function NavBtn({ children, active, onClick }: { children: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left text-[12px] font-extrabold transition-all ${
        active
          ? 'border-brand/25 bg-white text-brand shadow-sm'
          : 'border-transparent text-text/65 hover:bg-white/65 hover:text-text'
      }`}
    >
      {children}
    </button>
  )
}

function AiPanel({
  mode, onModeChange, provider, providerId, onProviderChange, zh,
  availableModels, model, modelSelect, setModel,
  baseURL, setBaseURL, apiKey, setApiKey,
  hasKey, editingKey, setEditingKey,
  advancedOpen, setAdvancedOpen, loggedUser, onClearKey,
}: {
  mode: AiMode
  onModeChange: (mode: AiMode) => void
  provider: Provider | null
  providerId: string
  onProviderChange: (id: string) => void
  zh: boolean
  availableModels: string[]
  model: string
  modelSelect: string
  setModel: (value: string) => void
  baseURL: string
  setBaseURL: (value: string) => void
  apiKey: string
  setApiKey: (value: string) => void
  hasKey: boolean
  editingKey: boolean
  setEditingKey: (value: boolean) => void
  advancedOpen: boolean
  setAdvancedOpen: (value: boolean) => void
  loggedUser: string | null
  onClearKey: () => Promise<void>
}) {
  const { t } = useTranslation()
  const inputCls = 'mt-1.5 block w-full rounded-xl border-2 border-text/20 bg-white px-3.5 py-2.5 text-[13px] font-bold text-text outline-none transition-colors placeholder:text-muted/55 focus:border-brand'

  return (
    <div>
      <SectionHeading title={t('settings.aiTitle')} description={t('settings.aiDesc')} />

      <div className="mt-4 grid grid-cols-2 gap-3">
        <ModeCard
          active={mode === 'managed'}
          onClick={() => onModeChange('managed')}
          icon={<Sparkles className="h-4 w-4" strokeWidth={2.5} />}
          title={t('settings.managedTitle')}
          description={t('settings.managedDesc')}
          badge={t('settings.recommended')}
        />
        <ModeCard
          active={mode === 'own'}
          onClick={() => onModeChange('own')}
          icon={<KeyRound className="h-4 w-4" strokeWidth={2.5} />}
          title={t('settings.ownKeyTitle')}
          description={t('settings.ownKeyDesc')}
        />
      </div>

      {mode === 'managed' ? (
        <div className="mt-4 rounded-2xl border border-text/10 bg-cream/45 p-4">
          <div className="flex items-center gap-3">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${loggedUser !== null ? 'bg-emerald-500' : 'bg-danger'}`} />
            <div className="min-w-0">
              <p className="text-[13px] font-extrabold text-text">
                {loggedUser !== null
                  ? t('settings.appgachaLoggedIn', { name: loggedUser })
                  : t('settings.appgachaNotLoggedIn')}
              </p>
              <p className="mt-1 text-[11px] font-semibold leading-relaxed text-muted">
                {t('settings.managedDetail')}
              </p>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2 border-t border-text/10 pt-3 text-[11px] font-bold text-muted">
            <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600" strokeWidth={2.3} />
            {t('settings.managedSecurity')}
          </div>
        </div>
      ) : provider && (
        <div className="mt-4 space-y-4">
          <label className="block text-xs font-extrabold text-text">
            {t('settings.provider')}
            <div className="relative mt-1.5">
              <select
                value={providerId}
                onChange={event => onProviderChange(event.target.value)}
                className="block w-full appearance-none rounded-xl border-2 border-text/20 bg-white py-2.5 pl-10 pr-10 text-[13px] font-extrabold text-text outline-none transition-colors focus:border-brand"
              >
                {ownKeyProviders.map(item => (
                  <option key={item.id} value={item.id}>{zh && item.nameZh ? item.nameZh : item.name}</option>
                ))}
              </select>
              <ProviderMark provider={provider} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2" />
              <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" strokeWidth={2.2} />
            </div>
          </label>

          {!provider.noKey && (
            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-extrabold text-text">{t('settings.apiKey')}</span>
                {provider.keyUrl && (
                  <a href={provider.keyUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] font-extrabold text-brand hover:underline">
                    {t('settings.getKey')} <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>

              {hasKey && !editingKey ? (
                <div className="mt-1.5 flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50/70 px-3.5 py-2.5">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" strokeWidth={2.5} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] font-extrabold text-emerald-800">{t('settings.keyConfigured')}</p>
                    <p className="text-[10px] font-semibold text-emerald-700/70">{t('settings.keyConfiguredHint')}</p>
                  </div>
                  <button onClick={() => setEditingKey(true)} className="text-[11px] font-extrabold text-text/70 hover:text-brand">
                    {t('settings.replaceKey')}
                  </button>
                  <button onClick={() => { void onClearKey() }} className="text-[11px] font-extrabold text-muted hover:text-danger">
                    {t('settings.clearKey')}
                  </button>
                </div>
              ) : (
                <div>
                  <input
                    type="password"
                    value={apiKey}
                    onChange={event => setApiKey(event.target.value)}
                    placeholder="sk-…"
                    spellCheck={false}
                    autoFocus={editingKey && hasKey}
                    className={inputCls}
                  />
                  <div className="mt-1.5 flex items-center justify-between gap-3">
                    <span className="text-[10px] font-semibold text-muted">{t('settings.keyNote')}</span>
                    {hasKey && (
                      <button onClick={() => { setEditingKey(false); setApiKey('') }} className="shrink-0 text-[10px] font-extrabold text-muted hover:text-text">
                        {t('settings.cancelReplace')}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          <label className="block text-xs font-extrabold text-text">
            {t('settings.model')}
            {availableModels.length > 0 ? (
              <>
                <div className="relative">
                  <select
                    value={modelSelect}
                    onChange={event => setModel(event.target.value === CUSTOM_MODEL ? '' : event.target.value)}
                    className={inputCls + ' cursor-pointer appearance-none pr-9'}
                  >
                    {availableModels.map(id => <option key={id} value={id}>{id}</option>)}
                    <option value={CUSTOM_MODEL}>{t('settings.customModel')}</option>
                  </select>
                  <ChevronDown className="pointer-events-none absolute bottom-3 right-3.5 h-4 w-4 text-muted" strokeWidth={2.2} />
                </div>
                {modelSelect === CUSTOM_MODEL && (
                  <input
                    value={model}
                    onChange={event => setModel(event.target.value)}
                    placeholder={t('settings.customModelPh')}
                    spellCheck={false}
                    className={inputCls + ' mt-2'}
                  />
                )}
              </>
            ) : (
              <input
                value={model}
                onChange={event => setModel(event.target.value)}
                placeholder={provider.id === 'ollama' ? 'qwen3:8b' : 'model-name'}
                spellCheck={false}
                className={inputCls}
              />
            )}
          </label>

          <div className="rounded-xl border border-text/10 bg-cream/30">
            <button
              onClick={() => setAdvancedOpen(!advancedOpen)}
              className="flex w-full items-center justify-between px-3.5 py-2.5 text-left"
            >
              <span>
                <span className="block text-[11px] font-extrabold text-text">{t('settings.advanced')}</span>
                <span className="block text-[10px] font-semibold text-muted">{t('settings.advancedHint')}</span>
              </span>
              <ChevronDown className={`h-4 w-4 text-muted transition-transform ${advancedOpen ? 'rotate-180' : ''}`} strokeWidth={2.2} />
            </button>
            {advancedOpen && (
              <div className="border-t border-text/10 px-3.5 pb-3.5 pt-2.5">
                {(provider.id === 'ollama' || provider.id === 'custom') && (
                  <p className="mb-2 text-[10px] font-semibold leading-relaxed text-muted">
                    {t(`settings.hints.${provider.id}`, { defaultValue: provider.hint ?? '' })}
                  </p>
                )}
                <label className="block text-[11px] font-extrabold text-text">
                  {t('settings.baseUrl')}
                  <input
                    value={baseURL}
                    onChange={event => setBaseURL(event.target.value)}
                    placeholder="https://api.example.com/v1"
                    spellCheck={false}
                    className={inputCls}
                  />
                </label>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function ModeCard({ active, onClick, icon, title, description, badge }: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  title: string
  description: string
  badge?: string
}) {
  return (
    <button
      onClick={onClick}
      className={`relative min-h-[86px] rounded-2xl border-2 p-3.5 text-left transition-all ${
        active
          ? 'border-brand bg-brand/[0.055] shadow-[0_0_0_1px_rgba(217,83,79,0.08)]'
          : 'border-text/12 bg-white hover:border-text/25 hover:bg-cream/25'
      }`}
    >
      {badge && <span className="absolute right-2.5 top-2.5 rounded-full bg-brand/10 px-2 py-0.5 text-[9px] font-extrabold text-brand">{badge}</span>}
      <div className={`mb-2 flex h-7 w-7 items-center justify-center rounded-lg ${active ? 'bg-brand text-white' : 'bg-cream text-muted'}`}>
        {icon}
      </div>
      <p className="text-[12px] font-extrabold text-text">{title}</p>
      <p className="mt-0.5 pr-1 text-[10px] font-semibold leading-relaxed text-muted">{description}</p>
    </button>
  )
}

function ProviderMark({ provider, className = '' }: { provider: Provider; className?: string }) {
  const icon = providerIcon(provider.icon)
  return icon
    ? <img src={icon} alt="" className={`h-[17px] w-[17px] ${className}`} draggable={false} />
    : <Plug className={`h-[17px] w-[17px] text-muted ${className}`} strokeWidth={2.3} />
}

function SectionHeading({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h3 className="text-[15px] font-extrabold text-text">{title}</h3>
      <p className="mt-1 text-[11px] font-semibold leading-relaxed text-muted">{description}</p>
    </div>
  )
}

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
    <div>
      <SectionHeading title={t('settings.generalTitle')} description={t('settings.generalDesc')} />

      <div className="mt-4 overflow-hidden rounded-2xl border border-text/10 bg-white">
        <SettingRow label={t('settings.autoStart')} description={t('settings.autoStartDesc')}>
          <Toggle checked={autoStartApp} onChange={async value => {
            setAutoStartApp(value)
            await shelf.setAppSettings({ autoStartApp: value })
            onToast(value ? t('settings.autoStartOn') : t('settings.autoStartOff'))
          }} />
        </SettingRow>
        <SettingRow label={t('settings.minimizeToTray')} description={t('settings.minimizeToTrayDesc')}>
          <Toggle checked={minimizeToTray} onChange={async value => {
            setMinimizeToTray(value)
            await shelf.setAppSettings({ minimizeToTray: value })
          }} />
        </SettingRow>
        <SettingRow label={t('settings.sound')} description={t('settings.soundDesc')} last>
          <Toggle checked={soundOn} onChange={async value => {
            setSoundOn(value)
            setSoundEnabled(value)
            if (value) sfx.pop()
            await shelf.setAppSettings({ soundEnabled: value })
          }} />
        </SettingRow>
      </div>

      <div className="mt-4 flex items-center justify-between rounded-2xl border border-text/10 bg-white px-4 py-3.5">
        <div>
          <p className="text-[12px] font-extrabold text-text">{t('settings.language')}</p>
          <p className="mt-0.5 text-[10px] font-semibold text-muted">{t('settings.languageDesc')}</p>
        </div>
        <div className="flex gap-1 rounded-full bg-cream p-1">
          {(['auto', 'en', 'zh'] as const).map(value => (
            <button
              key={value}
              onClick={() => {
                sfx.tick()
                setLang(value)
                setLangPref(value)
                const resolved = value === 'auto'
                  ? (navigator.language.toLowerCase().startsWith('zh') ? 'zh' as const : 'en' as const)
                  : value
                window.shelf.setLang(resolved)
              }}
              className={`rounded-full px-3 py-1.5 text-[10px] font-extrabold transition-colors ${lang === value ? 'bg-text text-white' : 'text-muted hover:text-text'}`}
            >
              {value === 'auto' ? t('settings.langAuto') : value === 'en' ? 'English' : '中文'}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5">
        <div className="flex items-end justify-between">
          <div>
            <h3 className="text-[13px] font-extrabold text-text">{t('settings.updates')}</h3>
            <p className="mt-0.5 text-[10px] font-semibold text-muted">{t('settings.version')} v{appVersion || '—'}</p>
          </div>
          <Toggle checked={autoUpdate} onChange={async value => {
            setAutoUpdate(value)
            await shelf.setAppSettings({ autoUpdate: value })
          }} label={t('settings.autoUpdate')} />
        </div>
        <div className="mt-3 flex items-center gap-3 rounded-xl bg-cream/45 px-3.5 py-3">
          <button
            onClick={onCheckUpdate}
            disabled={checkingUpdate || updateStatus.stage === 'checking' || updateStatus.stage === 'downloading'}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-text/20 bg-white px-3 py-2 text-[10px] font-extrabold text-text transition-colors hover:border-text/40 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${checkingUpdate || updateStatus.stage === 'checking' || updateStatus.stage === 'downloading' ? 'animate-spin' : ''}`} strokeWidth={2.5} />
            {checkingUpdate || updateStatus.stage === 'checking' ? t('settings.checking')
              : updateStatus.stage === 'downloading' ? `${t('settings.updateDownloading')} ${updateStatus.percent ?? 0}%`
                : t('settings.checkUpdates')}
          </button>
          {updateStatus.stage === 'downloaded' && (
            <button onClick={() => shelf.installUpdate()} className="rounded-lg bg-brand px-3 py-2 text-[10px] font-extrabold text-white">
              {t('settings.restartToInstall')}
            </button>
          )}
          <span className={`min-w-0 text-[10px] font-bold leading-relaxed ${
            updateStatus.stage === 'error' ? 'text-danger'
              : updateStatus.stage === 'available' ? 'text-brand'
                : 'text-emerald-700'
          }`}>
            {updateStatus.stage === 'error' ? updateStatus.error
              : updateStatus.stage === 'available' ? t('settings.updateAvailable', { version: updateStatus.version ?? '' })
                : updateStatus.stage === 'idle' ? t('settings.upToDate') : ''}
          </span>
        </div>
      </div>
    </div>
  )
}

function SettingRow({ label, description, children, last = false }: {
  label: string
  description: string
  children: React.ReactNode
  last?: boolean
}) {
  return (
    <div className={`flex items-center justify-between gap-4 px-4 py-3 ${last ? '' : 'border-b border-text/8'}`}>
      <div>
        <p className="text-[12px] font-extrabold text-text">{label}</p>
        <p className="mt-0.5 text-[10px] font-semibold text-muted">{description}</p>
      </div>
      {children}
    </div>
  )
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label?: string }) {
  return (
    <label className="flex shrink-0 cursor-pointer select-none items-center gap-2">
      {label && <span className="text-[10px] font-bold text-muted">{label}</span>}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-10 rounded-full border-2 transition-colors ${checked ? 'border-emerald-600/25 bg-emerald-500' : 'border-text/15 bg-text/10'}`}
      >
        <span className={`absolute top-[2px] h-4 w-4 rounded-full bg-white shadow-sm transition-all ${checked ? 'left-[18px]' : 'left-[2px]'}`} />
      </button>
    </label>
  )
}
