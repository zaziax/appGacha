import { useEffect, useState } from 'react'
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
      if (s) {
        setBaseURL(s.baseURL)
        setModel(s.model)
        setHasKey(s.hasKey)
      }
    }).catch(() => { /* 首次无配置 */ })
  }, [])

  return (
    <div className="mask" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="dialog">
        <h2>模型设置</h2>
        <p className="dialog-sub">OpenAI 兼容接口（DeepSeek / Kimi / Qwen 等均可）。Key 加密存储在本机，蛋永远接触不到。</p>
        <label>接口地址 Base URL
          <input value={baseURL} onChange={e => setBaseURL(e.target.value)}
            placeholder="https://api.deepseek.com/v1" spellCheck={false} />
        </label>
        <label>模型名 Model
          <input value={model} onChange={e => setModel(e.target.value)}
            placeholder="deepseek-chat" spellCheck={false} />
        </label>
        <label>API Key
          <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)}
            placeholder={hasKey ? '已保存（留空沿用）' : 'sk-…'} spellCheck={false} />
        </label>
        <div className="dialog-actions">
          <span id="aiStatus" className={status.cls}>{status.text}</span>
          <button onClick={async () => {
            setStatus({ text: '测试中…', cls: '' })
            try {
              const res = await shelf.testAi()
              setStatus({ text: `连接成功：${res.reply}`, cls: 'ok' })
            } catch (err) { setStatus({ text: (err as Error).message, cls: 'err' }) }
          }}>测试连接</button>
          <button className="primary" onClick={async () => {
            try {
              await shelf.saveAiSettings({ baseURL, model, apiKey })
              setStatus({ text: '已保存', cls: 'ok' })
              setHasKey(true)
              onToast('模型配置已保存')
            } catch (err) { setStatus({ text: (err as Error).message, cls: 'err' }) }
          }}>保存</button>
          <button onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  )
}
