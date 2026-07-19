import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { shelf } from '../shelf'

interface Props {
  onClose: () => void
  onToast: (msg: string) => void
}

export function SettingsDialog({ onClose, onToast }: Props) {
  const [baseURL, setBaseURL] = useState('')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [hasKey, setHasKey] = useState(false)
  const [status, setStatus] = useState<{ text: string; cls: '' | 'ok' | 'err' }>({ text: '', cls: '' })

  useEffect(() => {
    shelf.getAiSettings().then(s => {
      if (s) { setBaseURL(s.baseURL); setModel(s.model); setHasKey(s.hasKey) }
    }).catch(() => {})
  }, [])

  return (
    <div className="fixed inset-0 bg-black/35 flex items-center justify-center z-[100]" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-2xl p-6 w-[440px] max-w-[92vw] shadow-xl">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold text-text">模型设置</h2>
          <button onClick={onClose} className="w-7 h-7 rounded-full bg-[#f0ede8] text-[#888] hover:bg-[#e5e0d8] hover:text-[#555] flex items-center justify-center transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-xs text-muted mb-4">OpenAI 兼容接口（DeepSeek / Kimi / Qwen 等均可）。Key 加密存储在本机，蛋永远接触不到。</p>

        <label className="block text-xs text-[#55555c] mb-3">
          接口地址 Base URL
          <input value={baseURL} onChange={e => setBaseURL(e.target.value)}
            placeholder="https://api.deepseek.com/v1" spellCheck={false}
            className="block w-full mt-1 px-3 py-2 border border-[#ddd9d2] rounded-xl text-[13px] outline-none focus:border-brand transition-colors font-[system-ui,'Microsoft_YaHei',sans-serif]" />
        </label>
        <label className="block text-xs text-[#55555c] mb-3">
          模型名 Model
          <input value={model} onChange={e => setModel(e.target.value)}
            placeholder="deepseek-chat" spellCheck={false}
            className="block w-full mt-1 px-3 py-2 border border-[#ddd9d2] rounded-xl text-[13px] outline-none focus:border-brand transition-colors font-[system-ui,'Microsoft_YaHei',sans-serif]" />
        </label>
        <label className="block text-xs text-[#55555c] mb-4">
          API Key
          <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)}
            placeholder={hasKey ? '已保存（留空沿用）' : 'sk-…'} spellCheck={false}
            className="block w-full mt-1 px-3 py-2 border border-[#ddd9d2] rounded-xl text-[13px] outline-none focus:border-brand transition-colors font-[system-ui,'Microsoft_YaHei',sans-serif]" />
        </label>

        <div className="flex gap-2 items-center justify-end">
          <span className={`flex-1 text-xs truncate ${status.cls === 'ok' ? 'text-green-600' : status.cls === 'err' ? 'text-danger' : 'text-muted'}`}>
            {status.text}
          </span>
          <button onClick={async () => {
            setStatus({ text: '测试中…', cls: '' })
            try {
              const res = await shelf.testAi()
              setStatus({ text: `连接成功：${res.reply}`, cls: 'ok' })
            } catch (err) { setStatus({ text: (err as Error).message, cls: 'err' }) }
          }} className="px-4 py-2 border border-[#ddd9d2] rounded-xl text-sm hover:border-[#c9c4bb] active:scale-95 transition-all">测试连接</button>
          <button onClick={async () => {
            try {
              await shelf.saveAiSettings({ baseURL, model, apiKey })
              setStatus({ text: '已保存', cls: 'ok' })
              setHasKey(true)
              onToast('模型配置已保存')
            } catch (err) { setStatus({ text: (err as Error).message, cls: 'err' }) }
          }} className="px-4 py-2 bg-brand text-white rounded-xl text-sm font-medium hover:bg-brand-hover active:scale-95 transition-all">保存</button>
        </div>
      </div>
    </div>
  )
}
