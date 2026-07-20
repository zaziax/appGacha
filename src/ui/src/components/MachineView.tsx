import { useState, useEffect, useSyncExternalStore, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Sparkles, Egg, ArrowLeft, ArrowRight, Loader2, Wand2, Brain, Wrench, PenLine, CheckCircle2, AlertTriangle, RefreshCw } from 'lucide-react'
import { shelf, GachaProgress, GachaResult, GachaActivity, WishQuestion } from '../shelf'
import { getGachaState, subscribeGacha, beginGacha, clearGachaResult, dismissResult } from '../gachaStore'
import { GachaVisual } from './GachaVisual'

const SPRING = { type: 'spring' as const, stiffness: 200, damping: 20, mass: 0.8 }

// ---- 预设数据 ----

const INSPIRE_CARDS = [
  { label: '番茄钟', prompt: '我想要一个番茄钟，25分钟专注+5分钟休息，结束时提醒我，统计每天完成了几个番茄' },
  { label: '每日记账', prompt: '我想要一个每日记账本，能分类记录支出，按月统计，支持导出' },
  { label: '待办清单', prompt: '我想要一个待办清单，支持拖拽排序、设置到期时间和提醒' },
  { label: '每日诗词', prompt: '我想要一个每日诗词推荐，每天随机展示一首古诗，附带注释和赏析' },
  { label: '背单词', prompt: '我想要一个背单词应用，支持导入词库、艾宾浩斯复习曲线、AI生成例句助记' },
  { label: '习惯打卡', prompt: '我想要一个习惯打卡应用，每天记录完成情况，连续打卡天数统计' },
]

const STYLE_OPTIONS = [
  { id: 'clean', label: '清爽简约', desc: '大量留白、细线条、低饱和', emoji: '🧊' },
  { id: 'cute', label: '活泼可爱', desc: '圆角、糖果色、趣味动效', emoji: '🍬' },
  { id: 'dark', label: '深色沉浸', desc: '暗色背景、霓虹点缀、专注感', emoji: '🌙' },
  { id: 'paper', label: '纸质手账', desc: '纸张纹理、手写风、贴纸装饰', emoji: '📔' },
]

const COLOR_PALETTES = [
  { id: 'mint', label: '薄荷绿', colors: ['#50C878', '#E8F8F0', '#2D8B5E'] },
  { id: 'coral', label: '珊瑚橘', colors: ['#FF7F6B', '#FFF0ED', '#D9534F'] },
  { id: 'sky', label: '天空蓝', colors: ['#6DA3F0', '#EDF4FF', '#3B72C4'] },
  { id: 'lavender', label: '薰衣草', colors: ['#B18CE0', '#F5EFFF', '#7C5CB0'] },
  { id: 'amber', label: '琥珀金', colors: ['#F0A830', '#FFF8E8', '#C07D10'] },
  { id: 'sakura', label: '樱花粉', colors: ['#F0A0B8', '#FFF0F4', '#C06080'] },
]

// ---- 步骤定义 ----
type Step = 'wish' | 'clarify' | 'style' | 'color' | 'confirm'

interface QARecord { question: string; answer: string }

interface Props { onToast: (msg: string) => void; onEggCreated: () => void }

export function MachineView({ onToast, onEggCreated }: Props) {
  const gacha = useSyncExternalStore(subscribeGacha, getGachaState)

  // 向导状态
  const [step, setStep] = useState<Step>('wish')
  const [wishText, setWishText] = useState('')
  const [qaHistory, setQaHistory] = useState<QARecord[]>([])
  const [questions, setQuestions] = useState<WishQuestion[]>([])
  const [answers, setAnswers] = useState<Record<number, string>>({})
  const [clarifyRound, setClarifyRound] = useState(0)
  const [aiLoading, setAiLoading] = useState(false)
  const [styleId, setStyleId] = useState<string | null>(null)
  const [colorId, setColorId] = useState<string | null>(null)

  // 扭蛋结果
  const [revealed, setRevealed] = useState(true)
  const resultReady = !!(gacha.result && !revealed && !gacha.running)

  useEffect(() => {
    if (gacha.result && !gacha.running) setRevealed(false)
  }, [gacha.result, gacha.running])

  const isUpgrade = !!gacha.upgrade

  // 重置向导
  const resetWizard = useCallback(() => {
    setStep('wish'); setWishText(''); setQaHistory([]); setQuestions([])
    setAnswers({}); setClarifyRound(0); setAiLoading(false)
    setStyleId(null); setColorId(null); setRevealed(true)
  }, [])

  // 步骤①：提交愿望 → 调 AI 追问
  const submitWish = async () => {
    const text = wishText.trim()
    if (text.length < 2) return
    setAiLoading(true)
    try {
      const result = await shelf.wishChat([{ role: 'user', content: text }])
      if (result.done || result.questions.length === 0) {
        setStep(isUpgrade ? 'confirm' : 'style')
      } else {
        setQuestions(result.questions)
        setAnswers({})
        setClarifyRound(1)
        setStep('clarify')
      }
    } catch {
      // AI 不可用时跳过追问，直接进下一步
      setStep(isUpgrade ? 'confirm' : 'style')
    } finally {
      setAiLoading(false)
    }
  }

  // 步骤②：提交追问答案
  const submitClarify = async () => {
    const newQA: QARecord[] = questions.map((q, i) => ({
      question: q.text,
      answer: answers[i] || '由你决定'
    }))
    const allQA = [...qaHistory, ...newQA]
    setQaHistory(allQA)

    // 第二轮追问（最多2轮）
    if (clarifyRound < 2) {
      setAiLoading(true)
      try {
        const summary = allQA.map(qa => `问：${qa.question}\n答：${qa.answer}`).join('\n')
        const result = await shelf.wishChat([
          { role: 'user', content: wishText },
          { role: 'assistant', content: JSON.stringify({ done: false, questions }) },
          { role: 'user', content: `我的回答：\n${summary}` }
        ])
        if (!result.done && result.questions.length > 0) {
          setQuestions(result.questions)
          setAnswers({})
          setClarifyRound(r => r + 1)
          setAiLoading(false)
          return
        }
      } catch { /* 追问失败不阻塞 */ }
      setAiLoading(false)
    }
    setStep(isUpgrade ? 'confirm' : 'style')
  }

  // 组装最终 wish 文本
  const buildFinalWish = (): string => {
    let wish = wishText.trim()
    if (qaHistory.length > 0) {
      const details = qaHistory.map(qa => qa.answer).filter(a => a !== '由你决定').join('；')
      if (details) wish += `\n【需求细节】${details}`
    }
    if (!isUpgrade) {
      const style = STYLE_OPTIONS.find(s => s.id === styleId)
      if (style) wish += `\n【视觉风格】${style.label}（${style.desc}）`
      const palette = COLOR_PALETTES.find(c => c.id === colorId)
      if (palette) wish += `\n【主色调】${palette.label}系（${palette.colors[0]}）`
    }
    return wish
  }

  // 投币开扭
  const launchGacha = async () => {
    const finalWish = buildFinalWish()
    try {
      if (isUpgrade) await shelf.upgrade(gacha.upgrade!.eggId, finalWish)
      else await shelf.wish(finalWish)
      beginGacha(gacha.upgrade)
      onEggCreated()
    } catch (err) { onToast((err as Error).message) }
  }

  // 如果正在扭蛋或已有结果，显示进度/结果面板
  if (gacha.running || gacha.result) {
    return (
      <div className="flex h-full">
        <div className="w-[38%] min-w-[280px] max-w-[340px] flex items-center justify-center overflow-hidden bg-cream">
          <GachaVisual stage={gacha.running ? gacha.stage : null} running={gacha.running} resultReady={resultReady} onReveal={() => setRevealed(true)} />
        </div>
        <div className="w-px bg-[#D8CCBB]" />
        <div className="flex-1 flex flex-col min-w-0 bg-cream">
          <ProgressPanel
            gacha={gacha} revealed={revealed} resultReady={resultReady}
            onOpen={() => { if (gacha.result?.eggId) shelf.open(gacha.result.eggId).catch(e => onToast(e.message)); clearGachaResult(); resetWizard(); onEggCreated() }}
            onRetry={() => { dismissResult(); resetWizard() }}
            onClose={() => { clearGachaResult(); resetWizard(); onEggCreated() }}
          />
        </div>
      </div>
    )
  }

  // 步骤向导
  const steps: Step[] = isUpgrade ? ['wish', 'clarify', 'confirm'] : ['wish', 'clarify', 'style', 'color', 'confirm']
  const stepIndex = steps.indexOf(step)

  return (
    <div className="flex h-full">
      {/* Left: Gacha Visual */}
      <div className="w-[38%] min-w-[280px] max-w-[340px] flex items-center justify-center overflow-hidden bg-cream">
        <GachaVisual stage={null} running={false} resultReady={false} onReveal={() => {}} />
      </div>

      <div className="w-px bg-[#D8CCBB]" />

      {/* Right: Step Wizard */}
      <div className="flex-1 flex flex-col min-w-0 bg-cream">
        {/* Progress header */}
        <div className="px-6 pt-5 pb-3">
          <div className="flex items-center gap-2 mb-3">
            <Egg className="w-5 h-5 text-brand" strokeWidth={2.5} />
            <span className="text-[14px] font-extrabold text-text">
              {isUpgrade ? `升级「${gacha.upgrade?.name}」` : '许个愿望'}
            </span>
          </div>
          {/* Step dots */}
          <div className="flex items-center gap-1.5">
            {steps.map((s, i) => (
              <div key={s} className="flex items-center gap-1.5">
                <div className={`h-2 rounded-full transition-all duration-300 ${i === stepIndex ? 'w-6 bg-brand' : i < stepIndex ? 'w-2 bg-brand/50' : 'w-2 bg-text/15'}`} />
              </div>
            ))}
          </div>
        </div>

        {/* Step content */}
        <div className="flex-1 overflow-y-auto px-6 py-4 chat-scroll">
          <AnimatePresence mode="wait">
            {step === 'wish' && (
              <StepWish key="wish" wishText={wishText} setWishText={setWishText}
                aiLoading={aiLoading} onSubmit={submitWish} isUpgrade={isUpgrade} />
            )}
            {step === 'clarify' && (
              <StepClarify key="clarify" questions={questions} answers={answers}
                setAnswers={setAnswers} aiLoading={aiLoading}
                onSubmit={submitClarify} onSkip={() => setStep(isUpgrade ? 'confirm' : 'style')} />
            )}
            {step === 'style' && (
              <StepStyle key="style" selected={styleId} onSelect={setStyleId}
                onNext={() => setStep('color')} />
            )}
            {step === 'color' && (
              <StepColor key="color" selected={colorId} onSelect={setColorId}
                onNext={() => setStep('confirm')} />
            )}
            {step === 'confirm' && (
              <StepConfirm key="confirm" wishText={wishText} qaHistory={qaHistory}
                styleId={styleId} colorId={colorId} isUpgrade={isUpgrade}
                onLaunch={launchGacha} />
            )}
          </AnimatePresence>
        </div>

        {/* Back button */}
        {stepIndex > 0 && (
          <div className="px-6 py-3">
            <button onClick={() => {
              const prev = steps[stepIndex - 1]
              setStep(prev)
              if (prev === 'wish') { setQuestions([]); setQaHistory([]); setClarifyRound(0) }
            }}
              className="flex items-center gap-1.5 text-[13px] font-bold text-muted hover:text-text transition-colors">
              <ArrowLeft className="w-3.5 h-3.5" /> 上一步
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ================================================================
//  Step ① 需求输入
// ================================================================
function StepWish({ wishText, setWishText, aiLoading, onSubmit, isUpgrade }: {
  wishText: string; setWishText: (v: string) => void; aiLoading: boolean; onSubmit: () => void; isUpgrade: boolean
}) {
  return (
    <motion.div {...fadeSlide}>
      <p className="text-[14px] font-extrabold text-text mb-1">
        {isUpgrade ? '想怎么改进它？' : '你想要什么样的应用？'}
      </p>
      <p className="text-[12px] font-bold text-muted mb-4">
        {isUpgrade ? '描述你想添加或修改的功能' : '用一句话描述，我会帮你确认细节'}
      </p>

      <textarea
        rows={3} value={wishText} onChange={e => setWishText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSubmit() } }}
        placeholder={isUpgrade ? '例如：加个夜间模式、增加数据导出…' : '例如：我想要一个记账本，能分类记录支出…'}
        className="w-full resize-none rounded-2xl px-4 py-3 text-[14px] leading-relaxed outline-none bg-white font-bold placeholder:text-muted/40 border-[3px] border-text/10 focus:border-brand/40 transition-colors"
        style={{ boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.04)' }}
      />

      <button onClick={onSubmit} disabled={aiLoading || wishText.trim().length < 2}
        className="mt-3 flex items-center gap-2 px-5 py-3 bg-brand text-white rounded-2xl font-extrabold text-[14px] hover:bg-brand-hover active:translate-y-0.5 transition-all disabled:opacity-40 border-[3px] border-text"
        style={{ boxShadow: '4px 4px 0 rgba(92,64,51,0.2)' }}>
        {aiLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" strokeWidth={2.5} />}
        <span>{aiLoading ? '正在理解你的需求…' : '确认，下一步'}</span>
      </button>

      {/* Inspiration cards — grid, no horizontal scroll */}
      {!isUpgrade && (
        <div className="mt-6">
          <p className="text-[12px] font-extrabold text-muted mb-3">💡 没想好？试试这些：</p>
          <div className="grid grid-cols-2 gap-2.5">
            {INSPIRE_CARDS.map(c => (
              <button key={c.label} onClick={() => setWishText(c.prompt)}
                className="px-3.5 py-3 rounded-2xl border-[3px] border-text bg-white hover:bg-cream transition-colors text-left active:translate-y-0.5"
                style={{ boxShadow: '3px 3px 0 rgba(92,64,51,0.12)' }}>
                <p className="text-[13px] font-extrabold text-text">{c.label}</p>
                <p className="text-[11px] font-bold text-muted mt-1 line-clamp-2 leading-relaxed">{c.prompt}</p>
              </button>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  )
}

// ================================================================
//  Step ② AI 追问
// ================================================================
function StepClarify({ questions, answers, setAnswers, aiLoading, onSubmit, onSkip }: {
  questions: WishQuestion[]; answers: Record<number, string>; setAnswers: (a: Record<number, string>) => void
  aiLoading: boolean; onSubmit: () => void; onSkip: () => void
}) {
  return (
    <motion.div {...fadeSlide}>
      <div className="flex items-center gap-2 mb-4">
        <Sparkles className="w-4 h-4 text-brand" strokeWidth={2.5} />
        <p className="text-[14px] font-extrabold text-text">帮你确认几个细节</p>
      </div>

      <div className="flex flex-col gap-5">
        {questions.map((q, qi) => (
          <div key={qi}>
            <p className="text-[13px] font-extrabold text-text mb-2">{q.text}</p>
            <div className="flex flex-wrap gap-2">
              {q.options.map(opt => (
                <button key={opt}
                  onClick={() => setAnswers({ ...answers, [qi]: opt })}
                  className={`px-3.5 py-2 rounded-xl text-[13px] font-extrabold border-[3px] transition-all active:translate-y-0.5 ${
                    answers[qi] === opt
                      ? 'border-brand bg-brand text-white'
                      : 'border-text/20 bg-white text-text hover:border-text/50'
                  }`}
                  style={{ boxShadow: answers[qi] === opt ? '3px 3px 0 rgba(217,83,79,0.2)' : '2px 2px 0 rgba(92,64,51,0.08)' }}>
                  {opt}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 mt-6">
        <button onClick={onSubmit} disabled={aiLoading}
          className="flex items-center gap-2 px-5 py-3 bg-brand text-white rounded-2xl font-extrabold text-[14px] hover:bg-brand-hover active:translate-y-0.5 transition-all disabled:opacity-40 border-[3px] border-text"
          style={{ boxShadow: '4px 4px 0 rgba(92,64,51,0.2)' }}>
          {aiLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" strokeWidth={2.5} />}
          <span>{aiLoading ? '思考中…' : '确认'}</span>
        </button>
        <button onClick={onSkip}
          className="px-4 py-3 rounded-2xl text-[13px] font-extrabold text-muted hover:text-text transition-colors">
          你帮我决定就好
        </button>
      </div>
    </motion.div>
  )
}

// ================================================================
//  Step ③ 风格选择
// ================================================================
function StepStyle({ selected, onSelect, onNext }: {
  selected: string | null; onSelect: (id: string) => void; onNext: () => void
}) {
  return (
    <motion.div {...fadeSlide}>
      <p className="text-[14px] font-extrabold text-text mb-1">选个感觉</p>
      <p className="text-[12px] font-bold text-muted mb-4">你的蛋想要什么视觉调性？</p>

      <div className="grid grid-cols-2 gap-3">
        {STYLE_OPTIONS.map(s => (
          <button key={s.id} onClick={() => onSelect(s.id)}
            className={`px-4 py-4 rounded-2xl border-[3px] text-left transition-all active:translate-y-0.5 ${
              selected === s.id ? 'border-brand bg-white' : 'border-text/15 bg-white hover:border-text/40'
            }`}
            style={{ boxShadow: selected === s.id ? '4px 4px 0 rgba(217,83,79,0.18)' : '3px 3px 0 rgba(92,64,51,0.08)' }}>
            <span className="text-2xl">{s.emoji}</span>
            <p className="text-[14px] font-extrabold text-text mt-2">{s.label}</p>
            <p className="text-[11px] font-bold text-muted mt-1 leading-relaxed">{s.desc}</p>
          </button>
        ))}
      </div>

      <button onClick={onNext}
        className="mt-5 flex items-center gap-2 px-5 py-3 bg-brand text-white rounded-2xl font-extrabold text-[14px] hover:bg-brand-hover active:translate-y-0.5 transition-all border-[3px] border-text"
        style={{ boxShadow: '4px 4px 0 rgba(92,64,51,0.2)' }}>
        <ArrowRight className="w-4 h-4" strokeWidth={2.5} />
        <span>{selected ? '下一步' : '跳过，你帮我选'}</span>
      </button>
    </motion.div>
  )
}

// ================================================================
//  Step ④ 配色选择
// ================================================================
function StepColor({ selected, onSelect, onNext }: {
  selected: string | null; onSelect: (id: string) => void; onNext: () => void
}) {
  return (
    <motion.div {...fadeSlide}>
      <p className="text-[14px] font-extrabold text-text mb-1">选个颜色</p>
      <p className="text-[12px] font-bold text-muted mb-4">给你的蛋定个主色调</p>

      <div className="grid grid-cols-3 gap-3">
        {COLOR_PALETTES.map(p => (
          <button key={p.id} onClick={() => onSelect(p.id)}
            className={`px-3 py-3.5 rounded-2xl border-[3px] text-center transition-all active:translate-y-0.5 ${
              selected === p.id ? 'border-brand bg-white' : 'border-text/15 bg-white hover:border-text/40'
            }`}
            style={{ boxShadow: selected === p.id ? '4px 4px 0 rgba(217,83,79,0.18)' : '3px 3px 0 rgba(92,64,51,0.08)' }}>
            <div className="flex justify-center gap-1 mb-2">
              {p.colors.map((c, i) => (
                <div key={i} className="w-5 h-5 rounded-full border-2 border-text/20" style={{ background: c }} />
              ))}
            </div>
            <p className="text-[12px] font-extrabold text-text">{p.label}</p>
          </button>
        ))}
      </div>

      <button onClick={onNext}
        className="mt-5 flex items-center gap-2 px-5 py-3 bg-brand text-white rounded-2xl font-extrabold text-[14px] hover:bg-brand-hover active:translate-y-0.5 transition-all border-[3px] border-text"
        style={{ boxShadow: '4px 4px 0 rgba(92,64,51,0.2)' }}>
        <ArrowRight className="w-4 h-4" strokeWidth={2.5} />
        <span>{selected ? '下一步' : '跳过，你帮我选'}</span>
      </button>
    </motion.div>
  )
}

// ================================================================
//  Step ⑤ 汇总确认
// ================================================================
function StepConfirm({ wishText, qaHistory, styleId, colorId, isUpgrade, onLaunch }: {
  wishText: string; qaHistory: QARecord[]; styleId: string | null; colorId: string | null
  isUpgrade: boolean; onLaunch: () => void
}) {
  const style = STYLE_OPTIONS.find(s => s.id === styleId)
  const palette = COLOR_PALETTES.find(c => c.id === colorId)
  const details = qaHistory.map(qa => qa.answer).filter(a => a !== '由你决定')

  return (
    <motion.div {...fadeSlide}>
      <p className="text-[14px] font-extrabold text-text mb-4">确认你的许愿单 📋</p>

      <div className="rounded-2xl border-[3px] border-text bg-white p-4 space-y-3"
        style={{ boxShadow: '4px 4px 0 rgba(92,64,51,0.12)' }}>
        {/* 核心需求 */}
        <div>
          <p className="text-[11px] font-extrabold text-muted uppercase tracking-wide mb-1">需求</p>
          <p className="text-[13px] font-bold text-text leading-relaxed">{wishText}</p>
        </div>
        {/* 细节 */}
        {details.length > 0 && (
          <div>
            <p className="text-[11px] font-extrabold text-muted uppercase tracking-wide mb-1">细节</p>
            <div className="flex flex-wrap gap-1.5">
              {details.map((d, i) => (
                <span key={i} className="px-2.5 py-1 rounded-lg bg-cream text-[12px] font-bold text-text border border-text/10">{d}</span>
              ))}
            </div>
          </div>
        )}
        {/* 风格 & 配色 */}
        {!isUpgrade && (style || palette) && (
          <div className="flex items-center gap-4">
            {style && (
              <div>
                <p className="text-[11px] font-extrabold text-muted uppercase tracking-wide mb-1">风格</p>
                <p className="text-[13px] font-bold text-text">{style.emoji} {style.label}</p>
              </div>
            )}
            {palette && (
              <div>
                <p className="text-[11px] font-extrabold text-muted uppercase tracking-wide mb-1">配色</p>
                <div className="flex items-center gap-1.5">
                  <div className="flex gap-0.5">
                    {palette.colors.map((c, i) => (
                      <div key={i} className="w-4 h-4 rounded-full border border-text/20" style={{ background: c }} />
                    ))}
                  </div>
                  <span className="text-[13px] font-bold text-text">{palette.label}</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <button onClick={onLaunch}
        className="mt-5 flex items-center gap-2 px-6 py-3.5 bg-brand text-white rounded-2xl font-extrabold text-[15px] hover:bg-brand-hover active:translate-y-0.5 transition-all border-[3px] border-text"
        style={{ boxShadow: '5px 5px 0 rgba(92,64,51,0.25)' }}>
        <Sparkles className="w-5 h-5" strokeWidth={2.5} />
        <span>投币，开扭！</span>
      </button>
    </motion.div>
  )
}

// ================================================================
//  扭蛋进度 / 结果面板（机芯实况 live feed）
// ================================================================

const ACTIVITY_META: Record<GachaActivity['type'], { icon: typeof Brain; cls: string }> = {
  think: { icon: Brain, cls: 'text-violet-500' },
  tool: { icon: Wrench, cls: 'text-sky-600' },
  write: { icon: PenLine, cls: 'text-emerald-600' },
  check: { icon: CheckCircle2, cls: 'text-amber-600' },
  retry: { icon: RefreshCw, cls: 'text-orange-500' },
  error: { icon: AlertTriangle, cls: 'text-red-500' },
}

function ProgressPanel({ gacha, revealed, resultReady, onOpen, onRetry, onClose }: {
  gacha: ReturnType<typeof getGachaState>; revealed: boolean; resultReady: boolean
  onOpen: () => void; onRetry: () => void; onClose: () => void
}) {
  const feedEnd = useRef<HTMLDivElement>(null)
  useEffect(() => { feedEnd.current?.scrollIntoView({ behavior: 'smooth' }) }, [gacha.activities.length])

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Stage header */}
      <div className="px-6 pt-5 pb-3 flex items-center gap-3">
        {gacha.running ? (
          <motion.div animate={{ rotate: 360 }} transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}>
            <Sparkles className="w-5 h-5 text-brand" strokeWidth={2.5} />
          </motion.div>
        ) : (
          <span className="text-xl">🥚</span>
        )}
        <div className="min-w-0">
          <p className="text-[15px] font-extrabold text-text leading-tight">
            {gacha.running ? progressLabel(gacha.stage) : resultReady ? '蛋扭好了！' : ''}
          </p>
          {gacha.running && gacha.detail && (
            <p className="text-[12px] font-bold text-muted truncate mt-0.5">{gacha.detail}</p>
          )}
          {resultReady && (
            <p className="text-[12px] font-bold text-muted mt-0.5">转动左侧旋钮，看看扭出了什么</p>
          )}
        </div>
      </div>

      {/* Live feed */}
      {(gacha.running || resultReady) && (
        <div className="flex-1 min-h-0 overflow-y-auto mx-5 mb-4 rounded-2xl border-[3px] border-text/15 bg-white/70 chat-scroll">
          <div className="px-4 py-3 flex flex-col gap-2.5">
            {gacha.activities.length === 0 && gacha.running && (
              <div className="flex items-center gap-2 py-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-muted" />
                <span className="text-[12px] font-bold text-muted">机芯启动中…</span>
              </div>
            )}
            {gacha.activities.map((a, i) => {
              const meta = ACTIVITY_META[a.type] ?? ACTIVITY_META.tool
              const Icon = meta.icon
              return (
                <motion.div key={i} className="flex gap-2.5 items-start"
                  initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2 }}>
                  <Icon className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${meta.cls}`} strokeWidth={2.5} />
                  <p className={`text-[12px] leading-relaxed font-bold min-w-0 ${
                    a.type === 'think' ? 'text-muted italic' : 'text-text'
                  }`}>
                    {a.type === 'think' ? a.text : a.text}
                  </p>
                </motion.div>
              )
            })}
            <div ref={feedEnd} />
          </div>
        </div>
      )}

      {/* Result */}
      <AnimatePresence>
        {gacha.result && revealed && (
          <motion.div key="result" className="px-6 pb-6 flex justify-center" {...fadeSlide}>
            <div className="w-full max-w-[320px]">
              <ResultCard result={gacha.result} onOpen={onOpen} onRetry={onRetry} onClose={onClose} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ================================================================
//  Result card
// ================================================================
function ResultCard({ result, onOpen, onRetry, onClose }: {
  result: GachaResult; onOpen: () => void; onRetry: () => void; onClose: () => void
}) {
  const ok = result.ok
  return (
    <div className="bg-white rounded-2xl overflow-hidden border-[4px] border-text"
      style={{ boxShadow: '5px 5px 0 rgba(92,64,51,0.18)', borderLeft: ok ? '6px solid #5ac08a' : '6px solid #f0c040' }}>
      <div className="px-5 py-4">
        <p className="text-[15px] font-extrabold text-text">
          {ok ? (result.upgraded ? `咔哒！「${result.name}」升级完成` : `咔哒！「${result.name}」出蛋了`)
              : (result.upgraded ? '这次升级没成…' : '这次没扭出好蛋…')}
        </p>
        <p className="text-[13px] font-bold text-muted mt-1.5">
          {ok ? (result.upgraded ? '数据完好，代码焕然一新' : '已放进你的收藏柜')
              : `${result.error ?? ''}${result.upgraded ? '（蛋还是原来的样子）' : ''}`}
        </p>
      </div>
      <div className="flex gap-2 px-5 py-3">
        {ok && result.eggId && <Btn primary onClick={onOpen}>打开看看</Btn>}
        {!ok && <Btn primary onClick={onRetry}>再来一发</Btn>}
        <Btn onClick={onClose}>好的</Btn>
      </div>
    </div>
  )
}

function Btn({ children, primary, onClick }: { children: React.ReactNode; primary?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="px-4 py-2 rounded-xl text-[13px] font-extrabold active:translate-y-0.5 transition-all border-[3px] border-text"
      style={{
        background: primary ? '#D9534F' : '#fff',
        color: primary ? '#fff' : '#5C4033',
        boxShadow: '3px 3px 0 rgba(92,64,51,0.18)'
      }}>
      {children}
    </button>
  )
}

function progressLabel(s: GachaProgress['stage'] | null): string {
  switch (s) {
    case 'coin': return '投币成功，机芯启动…'
    case 'crank': return '旋钮转动，机芯正在构思…'
    case 'clack': return '机芯咔咔作响，代码生成中…'
    case 'pop': return '咔哒！蛋已扭好'
    case 'fail': return '这次没扭出好蛋'
    default: return '扭蛋中…'
  }
}

const fadeSlide = {
  initial: { opacity: 0, x: 16 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -12 },
  transition: SPRING
}
