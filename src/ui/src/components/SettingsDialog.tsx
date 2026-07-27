import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { shelf } from '../shelf'

interface Props { onClose: () => void; onToast: (msg: string) => void }

export function SettingsDialog({ onClose, onToast }: Props) {
  const [baseURL, setBaseURL] = useState('')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [hasKey, setHasKey] = useState(false)
  const [status, setStatus] = useState<{ text: string; cls: '' | 'ok' | 'err' }>({ text: '', cls: '' })
  const [autoStartApp, setAutoStartApp] = useState(false)
  const [minimizeToTray, setMinimizeToTray] = useState(true)

  useEffect(() => {
    shelf.getAiSettings().then(s => { if (s) { setBaseURL(s.baseURL); setModel(s.model); setHasKey(s.hasKey) } }).catch(() => {})
    shelf.getAppSettings().then(s => { setAutoStartApp(s.autoStartApp); setMinimizeToTray(s.minimizeToTray) }).catch(() => {})
  }, [])

  const inputCls = 'block w-full mt-1.5 px-4 py-3 border-[3px] border-text rounded-2xl text-[14px] font-bold outline-none focus:border-brand transition-colors bg-white'

  return (
    <div className="fixed inset-0 bg-black/25 flex items-center justify-center z-[100]" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      {/* Dialog — GACHAGO card style */}
      <div className="bg-white border-[4px] border-text rounded-2xl p-6 w-[440px] max-w-[92vw]" style={{ boxShadow: '6px 6px 0 rgba(92,64,51,0.2)' }}>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-extrabold text-text">模型设置</h2>
          <button onClick={onClose}
            className="w-9 h-9 rounded-xl border-[3px] border-text flex items-center justify-center text-text hover:bg-cream active:translate-y-0.5 transition-all font-extrabold"
            style={{ boxShadow: '2px 2px 0 rgba(92,64,51,0.15)' }}>
            <X className="w-4 h-4" strokeWidth={3} />
          </button>
        </div>
        <p className="text-xs font-bold text-muted mb-5">OpenAI 兼容接口（DeepSeek / Kimi / Qwen 等均可）。Key 加密存储在本机，蛋永远接触不到。</p>

        {/* P3 应用设置 */}
        <div className="flex gap-4 mb-5">
          <Toggle label="登录自启动" checked={autoStartApp} onChange={async v => {
            setAutoStartApp(v)
            await shelf.setAppSettings({ autoStartApp: v })
            onToast(v ? '开机自启动已开启' : '开机自启动已关闭')
          }} />
          <Toggle label="关窗缩到托盘" checked={minimizeToTray} onChange={async v => {
            setMinimizeToTray(v)
            await shelf.setAppSettings({ minimizeToTray: v })
          }} />
        </div>

        <label className="block text-xs font-extrabold text-text mb-4">
          接口地址 Base URL
          <input value={baseURL} onChange={e => setBaseURL(e.target.value)} placeholder="https://api.deepseek.com/v1" spellCheck={false} className={inputCls} />
        </label>
        <label className="block text-xs font-extrabold text-text mb-4">
          模型名 Model
          <input value={model} onChange={e => setModel(e.target.value)} placeholder="deepseek-chat" spellCheck={false} className={inputCls} />
        </label>
        <label className="block text-xs font-extrabold text-text mb-5">
          API Key
          <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder={hasKey ? '已保存（留空沿用）' : 'sk-…'} spellCheck={false} className={inputCls} />
        </label>

        <div className="flex gap-3 items-center justify-end">
          <span className={`flex-1 text-xs font-bold truncate ${status.cls === 'ok' ? 'text-emerald-600' : status.cls === 'err' ? 'text-danger' : 'text-muted'}`}>{status.text}</span>
          <Btn onClick={async () => {
            setStatus({ text: '测试中…', cls: '' })
            try { const res = await shelf.testAi(); setStatus({ text: `连接成功：${res.reply}`, cls: 'ok' }) }
            catch (err) { setStatus({ text: (err as Error).message, cls: 'err' }) }
          }}>测试连接</Btn>
          <Btn primary onClick={async () => {
            try { await shelf.saveAiSettings({ baseURL, model, apiKey }); setStatus({ text: '已保存', cls: 'ok' }); setHasKey(true); onToast('模型配置已保存') }
            catch (err) { setStatus({ text: (err as Error).message, cls: 'err' }) }
          }}>保存</Btn>
        </div>
      </div>
    </div>
  )
}

function Btn({ children, primary, onClick }: { children: React.ReactNode; primary?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="px-5 py-2.5 rounded-xl text-sm font-extrabold active:translate-y-0.5 transition-all border-[3px] border-text"
      style={{
        background: primary ? '#D9534F' : '#fff',
        color: primary ? '#fff' : '#5C4033',
        boxShadow: '3px 3px 0 rgba(92,64,51,0.18)'
      }}>{children}</button>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none">
      <div
        className={`w-10 h-6 rounded-full border-[2.5px] border-text relative transition-colors ${checked ? 'bg-emerald-400' : 'bg-gray-200'}`}
        onClick={() => onChange(!checked)}
      >
        <div className={`absolute top-[2px] w-4 h-4 rounded-full bg-white border-2 border-text transition-all ${checked ? 'left-[20px]' : 'left-[2px]'}`} />
      </div>
      <span className="text-xs font-extrabold text-text">{label}</span>
    </label>
  )
}
