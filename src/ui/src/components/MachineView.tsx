import { useState, useEffect, useSyncExternalStore, useCallback, useRef, forwardRef } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Sparkles, Egg, ArrowLeft, ArrowRight, Loader2, Wand2, Brain, Wrench, PenLine, CheckCircle2, AlertTriangle, RefreshCw, ClipboardList, Dices, Palette, Bot, X, ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { shelf, GachaProgress, GachaResult, GachaActivity, WishQuestion, PendingBuild } from '../shelf'
import { getGachaState, subscribeGacha, beginGacha, clearGachaResult, dismissResult, setGachaUpgrade } from '../gachaStore'
import { AppAssemblyStage } from './AppAssemblyStage'
import { sfx } from '../sound'
import { tr } from '../i18n'

const SPRING = { type: 'spring' as const, stiffness: 200, damping: 20, mass: 0.8 }

// ---- 色相工具 ----

/** HSL → #hex（用于 wish 文本中的精确色值） */
function hslToHex(h: number, s: number, l: number): string {
  const sn = s / 100, ln = l / 100
  const a = sn * Math.min(ln, 1 - ln)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const c = ln - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)
    return Math.round(255 * c).toString(16).padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`.toUpperCase()
}

/** 精选色相起点（对应经典配色），点选即跳转色相环到该位置 */
const HUE_PRESETS = [
  { h: 150, key: 'mint' },
  { h: 8, key: 'coral' },
  { h: 215, key: 'sky' },
  { h: 270, key: 'lavender' },
  { h: 40, key: 'amber' },
  { h: 340, key: 'sakura' },
]

// ---- 配色配方（色相环上的关系公式） ----
type SchemeId = 'mono' | 'analogous' | 'complement' | 'triadic'

const SCHEMES: { id: SchemeId; offsets: number[]; roles: string }[] = [
  { id: 'mono', offsets: [0], roles: '同色相明暗梯度' },
  { id: 'analogous', offsets: [0, -35, 35], roles: '辅色用于次要元素与图标点缀' },
  { id: 'complement', offsets: [0, 180], roles: '互补色作强调色' },
  { id: 'triadic', offsets: [0, 120, 240], roles: '三色均衡点缀' },
]

// ---- 步骤定义 ----
type Step = 'wish' | 'clarify' | 'visual' | 'confirm'

interface QARecord { question: string; answer: string }

/** 聊天流消息：AI 问题 + 用户回答交替 */
interface ChatMsg { kind: 'q' | 'a'; text: string; options?: string[] }

interface Props { onToast: (msg: string) => void; onEggCreated: () => void }

export function MachineView({ onToast, onEggCreated }: Props) {
  const { t, i18n } = useTranslation()
  const gacha = useSyncExternalStore(subscribeGacha, getGachaState)

  // 向导状态
  const [step, setStep] = useState<Step>('wish')
  const [wishText, setWishText] = useState('')
  const [qaHistory, setQaHistory] = useState<QARecord[]>([])
  const [questions, setQuestions] = useState<WishQuestion[]>([])
  const [chatLog, setChatLog] = useState<ChatMsg[]>([])
  const [chatIndex, setChatIndex] = useState(0) // 当前待回答的问题索引（全局，跨轮次）
  const [roundStart, setRoundStart] = useState(0) // 当前轮次在 chatIndex 中的起始偏移
  const [clarifyRound, setClarifyRound] = useState(0)
  const [aiLoading, setAiLoading] = useState(false)
  const [styleNote, setStyleNote] = useState<string | null>(null) // AI 风格建议
  const [styleOverride, setStyleOverride] = useState('') // 用户补充/覆盖
  const [hue, setHue] = useState<number | null>(null)
  const [scheme, setScheme] = useState<SchemeId>('analogous')
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [suggestLoading, setSuggestLoading] = useState(false)

  // 断点续建
  const [pendingBuild, setPendingBuild] = useState<PendingBuild | null>(null)
  const [resuming, setResuming] = useState(false)

  // 扭蛋结果
  const [revealed, setRevealed] = useState(true)
  const resultReady = !!(gacha.result && !revealed && !gacha.running)

  useEffect(() => {
    if (gacha.result && !gacha.running) setRevealed(false)
    // 每轮完成后检查是否有断点（可能接连失败产生新断点）
    if (!gacha.running && !gacha.result) {
      shelf.getPendingBuild().then(setPendingBuild).catch(() => setPendingBuild(null))
    }
  }, [gacha.result, gacha.running])

  // 初始挂载时也检查一次
  useEffect(() => {
    if (!gacha.running && !gacha.result) {
      shelf.getPendingBuild().then(setPendingBuild).catch(() => setPendingBuild(null))
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const isUpgrade = !!gacha.upgrade

  // 重置向导
  const resetWizard = useCallback(() => {
    setStep('wish'); setWishText(''); setQaHistory([]); setQuestions([])
    setChatLog([]); setChatIndex(0); setRoundStart(0); setClarifyRound(0); setAiLoading(false)
    setStyleNote(null); setStyleOverride(''); setHue(null); setScheme('mono'); setRevealed(true)
    setSuggestions([]); setSuggestLoading(false)
  }, [])

  // 取消升级：清掉升级目标并重置向导，回到普通许愿流程（不再卡死在升级态）
  const cancelUpgrade = useCallback(() => {
    sfx.blip()
    setGachaUpgrade(null)
    resetWizard()
  }, [resetWizard])

  // 灵感骰子：AI 生成随机愿望建议，失败时降级到本地预置池
  const fetchSuggestions = async () => {
    if (suggestLoading) return
    setSuggestLoading(true)
    try {
      const lang = i18n.language.startsWith('zh') ? 'zh' : 'en'
      const res = await shelf.wishSuggest(lang)
      if (res.suggestions.length > 0) { setSuggestions(res.suggestions); setSuggestLoading(false); return }
    } catch { /* AI 不可用 → 降级 */ }
    // 本地预置池（覆盖工具/趣味/生活三类，体现桌面独有优势）
    const isZh = i18n.language.startsWith('zh')
    const pool = isZh
      ? ['悬浮在桌面的番茄钟 widget', '能和室友联机下的五子棋', '每天提醒我喝水并记录杯数',
         '用 3D 星球展示今日待办', '随机生成菜谱的今晚吃什么', '带 AI 解签的每日运势筒',
         '记录植物浇水日程的小花园', '本地记账本月花销饼图', '双人联机猜词对战']
      : ['A floating pomodoro widget on my desktop', 'Online Gomoku I can play with my roommate',
         'Remind me to drink water and track my cups', 'A 3D planet showing today\'s todos',
         'Random recipe picker for dinner', 'Daily fortune sticks with AI interpretation',
         'A tiny garden tracking plant watering', 'Local expense tracker with pie charts',
         'Two-player word guessing battle']
    // 随机抽 3 条（Fisher-Yates 取前 3）
    const arr = [...pool]
    for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]] }
    setSuggestions(arr.slice(0, 3))
    setSuggestLoading(false)
  }

  // 步骤①：提交愿望 → 调 AI 追问
  const submitWish = async () => {
    const text = wishText.trim()
    if (text.length < 2) return
    setAiLoading(true)
    try {
      // 升级场景把目标蛋带给引导 AI（主进程据此注入蛋档案：名称/原始愿望/能力域）
      const ctx = isUpgrade ? { upgradeEggId: gacha.upgrade!.eggId } : undefined
      const result = await shelf.wishChat([{ role: 'user', content: text }], ctx)
      if (result.done || result.questions.length === 0) {
        if (result.styleNote) setStyleNote(result.styleNote)
        setStep(isUpgrade ? 'confirm' : 'visual')
      } else {
        setQuestions(result.questions)
        setChatLog([]); setChatIndex(0); setRoundStart(0)
        setClarifyRound(1)
        setStep('clarify')
      }
    } catch (e) {
      // AI 不可用：提示用户，留在愿望输入步骤不跳过
      console.error('[wishChat] submitWish failed:', e)
      onToast((e as Error).message || t('wish.aiUnavailable'))
    } finally {
      setAiLoading(false)
    }
  }

  // 步骤②：聊天流——逐条回答，答完自动触发下一轮或进入下一步
  const submitOneAnswer = (answer: string) => {
    const qi = chatIndex - roundStart
    const q = questions[qi]
    if (!q) return
    const ans = answer.trim() || t('wish.decideAnswer')
    const log = [...chatLog, { kind: 'q' as const, text: q.text, options: q.options }, { kind: 'a' as const, text: ans }]
    setChatLog(log)
    setQaHistory(h => [...h, { question: q.text, answer: ans }])
    const next = chatIndex + 1
    setChatIndex(next)
    if (next - roundStart >= questions.length) {
      void followUpRound(log)
    }
  }
  
  // 跳过剩余所有问题
  const skipAllQuestions = () => {
    sfx.blip()
    goStep(isUpgrade ? 'confirm' : 'visual')
  }
  
  // 当前轮答完 → 尝试第二轮追问，否则进入下一步
  const followUpRound = async (log: ChatMsg[]) => {
    if (clarifyRound >= 2) {
      setStep(isUpgrade ? 'confirm' : 'visual')
      return
    }
    setAiLoading(true)
    try {
      const qas = log.filter(m => m.kind === 'q').map((m, i) => {
        const a = log.filter(x => x.kind === 'a')[i]
        return `问：${m.text}\n答：${a?.text ?? ''}`
      }).join('\n')
      const result = await shelf.wishChat([
        { role: 'user', content: wishText },
        { role: 'assistant', content: JSON.stringify({ done: false, questions }) },
        { role: 'user', content: `我的回答：\n${qas}` }
      ], isUpgrade ? { upgradeEggId: gacha.upgrade!.eggId } : undefined)
      if (!result.done && result.questions.length > 0) {
        setQuestions(result.questions)
        setChatIndex(log.length) // 新一轮问题在 chatLog 中的起始位置
        setRoundStart(log.length)
        setClarifyRound(r => r + 1)
        setAiLoading(false)
        return
      }
      if (result.styleNote) setStyleNote(result.styleNote)
    } catch (e) {
      // 追问失败：提示用户但不阻塞流程
      console.error('[wishChat] followUpRound failed:', e)
      onToast((e as Error).message || t('wish.aiUnavailable'))
    }
    setAiLoading(false)
    setStep(isUpgrade ? 'confirm' : 'visual')
  }

  // 组装最终 wish 文本
  const buildFinalWish = (): string => {
    let wish = wishText.trim()
    if (qaHistory.length > 0) {
      const details = qaHistory.map(qa => qa.answer).filter(a => a !== t('wish.decideAnswer')).join('；')
      if (details) wish += `\n【需求细节】${details}`
    }
    if (!isUpgrade) {
      const styleParts: string[] = []
      if (styleNote) styleParts.push(styleNote)
      if (styleOverride.trim()) styleParts.push(styleOverride.trim())
      if (styleParts.length > 0) wish += `\n【视觉风格】${styleParts.join('；')}`
      if (hue !== null) {
        const hex = hslToHex(hue, 60, 50)
        const sc = SCHEMES.find(s => s.id === scheme)!
        const derived = sc.offsets.filter(o => o !== 0).map(o => {
          const hh = ((hue + o) % 360 + 360) % 360
          return `${hslToHex(hh, 55, 52)}（色相 ${hh}°）`
        })
        const schemeLabel = t(`wish.schemes.${scheme}`)
        wish += `\n【主色调】强调色 ${hex}（色相 ${hue}°）— 用于按钮/链接/焦点，占比 ≤25%`
        if (derived.length > 0) {
          wish += `\n  配色=${schemeLabel}：辅色 ${derived.join('、')} — ${sc.roles}`
        } else {
          wish += `\n  配色=${schemeLabel}，${sc.roles}`
        }
        wish += `\n  浅色派生 hsl(${hue},40%,96%)、深色派生 hsl(${hue},55%,32%)`
        wish += `\n  中性色使用 base.css 变量（--bg/--card/--text等），中性色构成 UI 主体，强调色只做点睛之笔`
      }
    }
    return wish
  }

  // 投币开扭
  const launchGacha = async () => {
    const finalWish = buildFinalWish()
    const lang = i18n.language.startsWith('zh') ? 'zh' : 'en'
    try {
      if (isUpgrade) await shelf.upgrade(gacha.upgrade!.eggId, finalWish, lang)
      else await shelf.wish(finalWish, lang)
      beginGacha(gacha.upgrade)
      onEggCreated()
    } catch (err) { onToast((err as Error).message) }
  }

  // 左侧机器持续呈现同一颗“愿望蛋”从点亮到成形，而不是复制右侧的文字进度。
  const heroActive = wishText.trim().length >= 2
  const heroColor = hue === null ? '#FFC857' : hslToHex(hue, 60, 50)
  const selectedScheme = SCHEMES.find(s => s.id === scheme) ?? SCHEMES[0]
  const machinePalette = hue === null
    ? []
    : selectedScheme.offsets.slice(0, 3).map(offset => {
        const derivedHue = ((hue + offset) % 360 + 360) % 360
        return hslToHex(derivedHue, 58, 54)
      })
  const journeyProgress = step === 'wish'
    ? (heroActive ? 0.18 : 0)
    : step === 'clarify'
      ? Math.min(0.64, 0.3 + qaHistory.length * 0.09)
      : step === 'visual'
        ? 0.78
        : 0.94

  // 如果正在扭蛋或已有结果，显示进度/结果面板
  if (gacha.running || gacha.result) {
    return (
      <div className="h-full bg-cream">
        <div className="machine-stage mx-auto flex h-full w-full max-w-[1280px]">
          <div className="machine-rail w-[clamp(240px,38vw,360px)] shrink-0 flex flex-col items-center justify-center overflow-hidden bg-cream">
            <AppAssemblyStage
              stage={gacha.running ? gacha.stage : null}
              running={gacha.running}
              resultReady={resultReady}
              icon={gacha.result?.icon}
              onReveal={() => setRevealed(true)}
              journeyProgress={1}
              heroActive={true}
              heroColor={heroColor}
              palette={machinePalette}
              revealLabel={t('progress.reveal')}
            />
          </div>
          <div className="w-px shrink-0 bg-[#D8CCBB]" />
          <div className="machine-workflow flex-1 flex flex-col min-w-0 bg-cream">
            <ProgressPanel
              gacha={gacha} revealed={revealed} resultReady={resultReady}
              onOpen={() => { if (gacha.result?.eggId) shelf.open(gacha.result.eggId).catch(e => onToast(e.message)); clearGachaResult(); resetWizard(); onEggCreated() }}
              onRetry={() => { dismissResult(); resetWizard() }}
              onClose={() => { clearGachaResult(); resetWizard(); onEggCreated() }}
            />
          </div>
        </div>
      </div>
    )
  }

  // 步骤向导
  const steps: Step[] = isUpgrade ? ['wish', 'clarify', 'confirm'] : ['wish', 'clarify', 'visual', 'confirm']
  const stepIndex = steps.indexOf(step)

  const goStep = (s: Step) => { sfx.pop(); setStep(s) }

  return (
    <div className="h-full bg-cream">
      <div className="machine-stage mx-auto flex h-full w-full max-w-[1280px]">
        {/* Left: Wish state visual — 始终保留双栏；窄窗只缩放舞台，不折叠为单栏 */}
        <div className="machine-rail w-[clamp(240px,38vw,360px)] shrink-0 flex flex-col items-center justify-center gap-4 overflow-hidden bg-cream">
          <AppAssemblyStage
            stage={null}
            running={false}
            resultReady={false}
            onReveal={() => {}}
            journeyProgress={journeyProgress}
            heroActive={heroActive}
            heroColor={heroColor}
            palette={machinePalette}
            thinking={aiLoading}
            revealLabel={t('progress.reveal')}
          />
        </div>

        <div className="w-px shrink-0 bg-[#D8CCBB]" />

        {/* Right: Step Wizard */}
        <div className="machine-workflow flex-1 flex flex-col min-w-0 bg-cream">
        {/* 断点续建提示 */}
        {pendingBuild && !gacha.running && !gacha.result && (
          <div className="px-6 pt-4">
            <motion.div className="mx-auto w-full max-w-[800px] p-4 rounded-xl bg-[#FFF8E7] border border-[#E6D5A8] flex items-center gap-3"
              initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} transition={SPRING}>
              <RefreshCw className="w-5 h-5 text-[#B8860B] shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-extrabold text-[#5c4033]">{t('checkpoint.title')}</div>
                <div className="text-[12px] text-[#8B7355] mt-0.5 leading-relaxed">
                  {t('checkpoint.desc', { wish: pendingBuild.wish.length > 40 ? pendingBuild.wish.slice(0, 40) + '…' : pendingBuild.wish, turns: pendingBuild.turns })}
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                <button className="px-3 py-1.5 rounded-lg bg-[#B8860B] text-white text-[12px] font-extrabold
                  hover:bg-[#9A7209] transition-colors disabled:opacity-60"
                  disabled={resuming}
                  onClick={async () => {
                    setResuming(true)
                    try {
                      await shelf.resumeBuild(pendingBuild.eggId)
                      beginGacha(pendingBuild.isUpgrade
                        ? { eggId: pendingBuild.realEggId, name: pendingBuild.upgradeName }
                        : null)
                      setPendingBuild(null)
                    } catch (e) { onToast((e as Error).message) }
                    finally { setResuming(false) }
                  }}>
                  {resuming ? <Loader2 className="w-4 h-4 animate-spin" /> : t('checkpoint.resume')}
                </button>
                <button className="px-3 py-1.5 rounded-lg text-[12px] font-extrabold text-[#8B7355]
                  hover:bg-[#F0E6D2] transition-colors"
                  onClick={async () => {
                    await shelf.abandonBuild(pendingBuild.eggId)
                    setPendingBuild(null)
                  }}>
                  {t('checkpoint.discard')}
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {/* Progress header */}
        <div className="px-6 pt-5 pb-3">
          <div className="mx-auto w-full max-w-[800px]">
            <div className="flex items-center gap-2 mb-3">
              <Egg className="w-5 h-5 text-brand" strokeWidth={2.5} />
              <span className="text-[14px] font-extrabold text-text">
                {isUpgrade ? t('wish.upgradeTitle', { name: gacha.upgrade?.name }) : t('wish.wishTitle')}
              </span>
              {isUpgrade && (
                <button onClick={cancelUpgrade} title={t('wish.cancelUpgrade')}
                  className="ml-auto flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-extrabold text-muted border-2 border-transparent hover:text-red-600 hover:bg-red-50 hover:border-red-200 transition-all">
                  <X className="w-3.5 h-3.5" strokeWidth={2.8} /> {t('wish.cancelUpgrade')}
                </button>
              )}
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
        </div>

        {/* Step content */}
        <div className={`flex-1 px-6 pt-4 pb-1 chat-scroll ${step === 'clarify' ? 'overflow-hidden' : 'overflow-y-auto'}`}>
          <div className={`mx-auto w-full ${step === 'clarify' ? 'max-w-[800px] h-full' : 'max-w-[760px]'}`}>
            <AnimatePresence mode="wait">
              {step === 'wish' && (
                <StepWish key="wish" wishText={wishText} setWishText={setWishText}
                  aiLoading={aiLoading} onSubmit={submitWish} isUpgrade={isUpgrade}
                  suggestions={suggestions} suggestLoading={suggestLoading} onDice={fetchSuggestions} />
              )}
              {step === 'clarify' && (
                <StepClarify key="clarify" questions={questions} chatLog={chatLog}
                  chatIndex={chatIndex} roundStart={roundStart} aiLoading={aiLoading}
                  onAnswer={submitOneAnswer} onSkipAll={skipAllQuestions} />
              )}
              {step === 'visual' && (
                <StepVisual key="visual" styleNote={styleNote} override={styleOverride}
                  onOverride={setStyleOverride} hue={hue} onHue={setHue}
                  scheme={scheme} onScheme={setScheme} onNext={() => goStep('confirm')} />
              )}
              {step === 'confirm' && (
                <StepConfirm key="confirm" wishText={wishText} qaHistory={qaHistory}
                  styleNote={styleNote} styleOverride={styleOverride} hue={hue} scheme={scheme}
                  isUpgrade={isUpgrade} onLaunch={launchGacha} />
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Back button */}
        {stepIndex > 0 && (
          <div className="px-6 pt-1.5 pb-3">
            <div className="mx-auto w-full max-w-[800px]">
              <button onClick={() => {
                sfx.blip()
                const prev = steps[stepIndex - 1]
                setStep(prev)
                if (prev === 'wish') { setQuestions([]); setQaHistory([]); setChatLog([]); setChatIndex(0); setRoundStart(0); setClarifyRound(0) }
              }}
                className="flex items-center gap-1.5 text-[13px] font-bold text-muted hover:text-text transition-colors">
                <ArrowLeft className="w-3.5 h-3.5" /> {t('wish.back')}
              </button>
            </div>
          </div>
        )}
        </div>
      </div>
    </div>
  )
}

// ================================================================
//  Step ① 需求输入 + 灵感骰子（AI 生成随机愿望建议）
// ================================================================
function StepWish({ wishText, setWishText, aiLoading, onSubmit, isUpgrade, suggestions, suggestLoading, onDice }: {
  wishText: string; setWishText: (v: string) => void; aiLoading: boolean; onSubmit: () => void; isUpgrade: boolean
  suggestions: string[]; suggestLoading: boolean; onDice: () => void
}) {
  const { t } = useTranslation()
  return (
    <motion.div {...fadeSlide}>
      <div className="flex items-center justify-between mb-1">
        <p className="text-[14px] font-extrabold text-text">
          {isUpgrade ? t('wish.stepWishTitleUpgrade') : t('wish.stepWishTitle')}
        </p>
        {/* 灵感骰子：仅新愿望场景 */}
        {!isUpgrade && (
          <button onClick={onDice} disabled={suggestLoading}
            title={t('wish.diceHint')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-extrabold border-2 border-text/15 bg-white text-muted hover:border-brand/50 hover:text-brand transition-all active:translate-y-0.5 disabled:opacity-40"
            style={{ boxShadow: '2px 2px 0 rgba(92,64,51,0.1)' }}>
            {suggestLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Dices className="w-3.5 h-3.5" strokeWidth={2.5} />}
            {t('wish.dice')}
          </button>
        )}
      </div>
      <p className="text-[12px] font-bold text-muted mb-4">
        {isUpgrade ? t('wish.stepWishHintUpgrade') : t('wish.stepWishHint')}
      </p>

      {/* AI 生成的灵感建议 chips */}
      <AnimatePresence>
        {suggestions.length > 0 && (
          <motion.div className="flex flex-wrap gap-2 mb-3"
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
            {suggestions.map((s, i) => (
              <motion.button key={s}
                initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.08, type: 'spring', stiffness: 300, damping: 20 }}
                onClick={() => { sfx.tick(); setWishText(s) }}
                className="px-3 py-1.5 rounded-xl text-[12px] font-extrabold border-2 border-brand/25 bg-brand/5 text-brand hover:bg-brand/10 hover:border-brand/50 transition-all active:translate-y-0.5">
                {s}
              </motion.button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <textarea
        rows={4} value={wishText} onChange={e => setWishText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSubmit() } }}
        placeholder={isUpgrade
          ? t('wish.stepWishPlaceholderUpgrade')
          : t('wish.stepWishPlaceholder')}
        className="w-full resize-none rounded-2xl px-4 py-3 text-[14px] leading-relaxed outline-none bg-white font-bold placeholder:text-muted/40 border-[3px] border-text/10 focus:border-brand/40 transition-colors"
        style={{ boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.04)' }}
      />

      <button onClick={onSubmit} disabled={aiLoading || wishText.trim().length < 2}
        className="mt-3 flex items-center gap-2 px-5 py-3 bg-brand text-white rounded-2xl font-extrabold text-[14px] hover:bg-brand-hover active:translate-y-0.5 transition-all disabled:opacity-40 border-[3px] border-text"
        style={{ boxShadow: '4px 4px 0 rgba(92,64,51,0.2)' }}>
        {aiLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" strokeWidth={2.5} />}
        <span>{aiLoading ? t('wish.thinking') : t('wish.next')}</span>
      </button>
    </motion.div>
  )
}

// ================================================================
//  Step ② AI 追问 —— 聊天流范式：逐条释放 + 固定底部输入栏 + typing 指示
// ================================================================
function StepClarify({ questions, chatLog, chatIndex, roundStart, aiLoading, onAnswer, onSkipAll }: {
  questions: WishQuestion[]; chatLog: ChatMsg[]; chatIndex: number; roundStart: number
  aiLoading: boolean; onAnswer: (answer: string) => void; onSkipAll: () => void
}) {
  const { t } = useTranslation()
  const [input, setInput] = useState('')
  const [selected, setSelected] = useState<string[]>([]) // 多选中的参考方向（每个问题独立）
  const [revealedIdx, setRevealedIdx] = useState(-1) // 已浮现的问题索引（高水位）
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // 输入框自动增高（内容撑高，超过上限才滚动）
  const autoGrow = () => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 88) + 'px'
  }
  useEffect(() => { autoGrow() }, [input])
  useEffect(() => { setSelected([]) }, [chatIndex]) // 切到新问题时清空选中

  const currentQ = chatIndex - roundStart < questions.length
    ? questions[chatIndex - roundStart]
    : undefined
  const waiting = aiLoading || (currentQ !== undefined && revealedIdx < chatIndex)

  // 逐条释放：当前问题延迟浮现（“对方正在输入…”体感）
  useEffect(() => {
    if (aiLoading || !currentQ || revealedIdx >= chatIndex) return
    const timer = setTimeout(() => setRevealedIdx(chatIndex), 550)
    return () => clearTimeout(timer)
  }, [chatIndex, aiLoading, revealedIdx, currentQ])

  // 自动滚到底部
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [chatLog.length, revealedIdx, aiLoading])

  const send = () => {
    if (waiting) return
    // 多选参考方向 + 自由输入合并成一条答案
    const parts = [...selected, input.trim()].filter(s => s && s.trim())
    onAnswer(parts.join('、'))
    setInput('')
    setSelected([])
  }

  return (
    <motion.div {...fadeSlide} className="flex h-full flex-col">
      {/* 消息区固定占满剩余高度、内部滚动，输入栏始终沉底，问题多寡不再撑动布局 */}
      <div className="flex-1 min-h-0 overflow-y-auto chat-scroll pr-1 flex flex-col gap-3 pb-2">
        {chatLog.map((m, i) => m.kind === 'q' ? (
          <motion.div key={i} className="flex items-start gap-2.5"
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 22 }}>
            <div className="w-6 h-6 rounded-full bg-brand/10 flex items-center justify-center shrink-0 mt-0.5">
              <Bot className="w-3.5 h-3.5 text-brand" strokeWidth={2.5} />
            </div>
            <div className="px-3.5 py-2.5 rounded-2xl rounded-tl-md bg-white border-2 border-text/10 text-[13px] font-bold text-text leading-relaxed max-w-[85%]"
              style={{ boxShadow: '2px 2px 0 rgba(92,64,51,0.06)' }}>
              {m.text}
            </div>
          </motion.div>
        ) : (
          <motion.div key={i} className="flex justify-end"
            initial={{ opacity: 0, y: 8, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ type: 'spring', stiffness: 300, damping: 24 }}>
            <div className="px-3.5 py-2.5 rounded-2xl rounded-br-md bg-brand text-white text-[13px] font-bold leading-relaxed max-w-[85%]"
              style={{ boxShadow: '2px 2px 0 rgba(217,83,79,0.25)' }}>
              {m.text}
            </div>
          </motion.div>
        ))}

        {/* “对方正在输入…”指示器 */}
        {waiting && (
          <motion.div className="flex items-start gap-2.5"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="w-6 h-6 rounded-full bg-brand/10 flex items-center justify-center shrink-0 mt-0.5">
              <Bot className="w-3.5 h-3.5 text-brand" strokeWidth={2.5} />
            </div>
            <div className="px-4 py-3 rounded-2xl rounded-tl-md bg-white border-2 border-text/10 flex items-center gap-1">
              {[0, 1, 2].map(d => (
                <motion.span key={d} className="w-1.5 h-1.5 rounded-full bg-muted/50"
                  animate={{ y: [0, -4, 0] }}
                  transition={{ repeat: Infinity, duration: 0.7, delay: d * 0.15, ease: 'easeInOut' }} />
              ))}
            </div>
          </motion.div>
        )}

        {/* 当前问题（typing 结束后浮现） */}
        {currentQ && !waiting && revealedIdx >= chatIndex && (
          <motion.div className="flex items-start gap-2.5"
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 22 }}>
            <div className="w-6 h-6 rounded-full bg-brand/10 flex items-center justify-center shrink-0 mt-0.5">
              <Bot className="w-3.5 h-3.5 text-brand" strokeWidth={2.5} />
            </div>
            <div className="px-3.5 py-2.5 rounded-2xl rounded-tl-md bg-white border-2 border-text/10 text-[13px] font-bold text-text leading-relaxed max-w-[85%]"
              style={{ boxShadow: '2px 2px 0 rgba(92,64,51,0.06)' }}>
              {currentQ.text}
            </div>
          </motion.div>
        )}
        <div ref={endRef} />
      </div>

      {/* 参考方向 chips（当前问题的，填入输入栏） */}
      {currentQ && !waiting && currentQ.options.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 pb-2 shrink-0">
          <span className="text-[11px] font-bold text-muted/50">{t('wish.reference')}</span>
          {currentQ.options.map(opt => {
            const on = selected.includes(opt)
            return (
              <button key={opt}
                onClick={() => { sfx.tick(); setSelected(prev => prev.includes(opt) ? prev.filter(x => x !== opt) : [...prev, opt]) }}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-extrabold border-2 transition-all active:translate-y-0.5 ${on ? 'border-brand bg-brand/10 text-brand' : 'border-text/15 bg-white/70 text-muted hover:border-brand/40 hover:text-brand'}`}>
                {on ? '✓ ' : ''}{opt}
              </button>
            )
          })}
        </div>
      )}

      {/* 固定底部输入栏 */}
      <div className="shrink-0 pt-2 border-t-2 border-text/8">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
            placeholder={t('wish.clarifyPlaceholder')}
            className="chat-scroll flex-1 px-3.5 py-2.5 rounded-xl text-[13px] font-bold outline-none bg-white border-2 border-text/10 focus:border-brand/40 transition-colors placeholder:text-muted/35 resize-none overflow-y-auto"
            style={{ maxHeight: 88 }}
          />
          <button onClick={send} disabled={waiting}
            className="px-4 py-2.5 bg-brand text-white rounded-xl font-extrabold text-[13px] hover:bg-brand-hover active:translate-y-0.5 transition-all disabled:opacity-40 border-2 border-text shrink-0"
            style={{ boxShadow: '3px 3px 0 rgba(92,64,51,0.18)' }}>
            {t('wish.send')}
          </button>
        </div>
        <div className="flex items-center gap-4 mt-1.5">
          <button onClick={() => { sfx.tick(); onAnswer('') }} disabled={waiting}
            className="text-[11px] font-extrabold text-muted/60 hover:text-brand transition-colors disabled:opacity-40">
            {t('wish.skipThis')}
          </button>
          <button onClick={onSkipAll} disabled={waiting}
            className="text-[11px] font-extrabold text-muted/60 hover:text-brand transition-colors disabled:opacity-40">
            {t('wish.skipAll')}
          </button>
        </div>
      </div>
    </motion.div>
  )
}

// ================================================================
//  Step ③ 视觉调性 —— AI 风格建议 + 色相环 + 配色配方
// ================================================================
function StepVisual({ styleNote, override, onOverride, hue, onHue, scheme, onScheme, onNext }: {
  styleNote: string | null; override: string; onOverride: (v: string) => void
  hue: number | null; onHue: (h: number) => void
  scheme: SchemeId; onScheme: (s: SchemeId) => void; onNext: () => void
}) {
  const { t } = useTranslation()
  const hasChoice = hue !== null || override.trim().length > 0
  const schemesRef = useRef<HTMLDivElement>(null)

  // 配方区展开后滚入视野（最小位移），避免 sticky CTA 遮挡芯片
  useEffect(() => {
    if (hue === null) return
    const timer = setTimeout(() => schemesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 160)
    return () => clearTimeout(timer)
  }, [hue === null])

  return (
    <motion.div {...fadeSlide}>
      <div className="flex items-center gap-2 mb-1">
        <Palette className="w-4 h-4 text-brand" strokeWidth={2.5} />
        <p className="text-[14px] font-extrabold text-text">{t('wish.visualTitle')}</p>
      </div>
      <p className="text-[12px] font-bold text-muted mb-4">{t('wish.visualHint')}</p>

      {/* AI 风格建议卡 */}
      {styleNote && (
        <div className="rounded-2xl border-[3px] border-brand/25 bg-brand/5 p-3.5 mb-4">
          <p className="text-[11px] font-extrabold text-brand uppercase tracking-wide mb-1">{t('wish.machineSuggest')}</p>
          <p className="text-[13px] font-bold text-text leading-relaxed">{styleNote}</p>
        </div>
      )}

      {/* 换个方向（可选补充/覆盖） */}
      <input value={override} onChange={e => onOverride(e.target.value)}
        placeholder={t('wish.styleOverridePh')}
        className="w-full px-3.5 py-2.5 rounded-xl text-[13px] font-bold outline-none bg-white border-2 border-text/10 focus:border-brand/40 transition-colors placeholder:text-muted/35 mb-5" />

      {/* 主色调：色相环 + 糖球快捷锚点 */}
      <p className="text-[13px] font-extrabold text-text mb-3">{t('wish.primaryHue')}</p>
      <div className="flex items-center gap-5">
        <HueRing hue={hue} onHue={onHue} />
        <div className="flex flex-col gap-2">
          {[HUE_PRESETS.slice(0, 3), HUE_PRESETS.slice(3)].map((row, ri) => (
            <div key={ri} className="flex gap-2">
              {row.map(p => (
                <Gumball key={p.h} h={p.h} selected={hue === p.h}
                  onClick={() => { sfx.tick(); onHue(p.h) }} title={t(`wish.hues.${p.key}`)} />
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* 配色配方：选色后展开（渐进披露，避免初始信息过载） */}
      <AnimatePresence>
        {hue !== null && (
          <motion.div key="schemes" ref={schemesRef}
            initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}>
            <p className="text-[13px] font-extrabold text-text mt-5 mb-2.5">{t('wish.schemeTitle')}</p>
            <div className="flex flex-wrap gap-2 pb-16">
              {SCHEMES.map(sc => (
                <SchemeChip key={sc.id} def={sc} hue={hue} selected={scheme === sc.id}
                  label={t(`wish.schemes.${sc.id}`)}
                  onClick={() => { sfx.tick(); onScheme(sc.id) }} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* sticky CTA：永远可见，底部渐变融入背景 */}
      <div className="sticky bottom-0 pt-4 pb-1 -mx-2 px-2"
        style={{ background: 'linear-gradient(to bottom, transparent, #F4EBE1 32%)' }}>
        <button onClick={onNext}
          className="flex items-center gap-2 px-5 py-3 bg-brand text-white rounded-2xl font-extrabold text-[14px] hover:bg-brand-hover active:translate-y-0.5 transition-all border-[3px] border-text"
          style={{ boxShadow: '4px 4px 0 rgba(92,64,51,0.2)' }}>
          <ArrowRight className="w-4 h-4" strokeWidth={2.5} />
          <span>{hasChoice ? t('wish.nextStep') : t('wish.skipVisual')}</span>
        </button>
      </div>
    </motion.div>
  )
}

/** 色相环：360° 连续拖拽 + 30° 刻度音效 + 中心实时预览球 */
function HueRing({ hue, onHue }: { hue: number | null; onHue: (h: number) => void }) {
  const ringRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  // 连续角度（不 wrap 360）避免跨 0° 动画绕远路
  const contRef = useRef<number | null>(null)
  const [anim, setAnim] = useState<number | null>(null)

  const norm = (a: number) => ((a % 360) + 360) % 360
  const display = anim !== null ? norm(anim) : hue

  // 糖球点选 → 旋钮沿最短路径弹跳
  useEffect(() => {
    if (hue === null || dragging.current) return
    const cur = contRef.current
    if (cur === null) { contRef.current = hue; setAnim(hue); return }
    let delta = hue - norm(cur)
    if (delta > 180) delta -= 360
    if (delta < -180) delta += 360
    const target = cur + delta
    contRef.current = target
    setAnim(target)
  }, [hue])

  const hueAt = (clientX: number, clientY: number): number => {
    const rect = ringRef.current!.getBoundingClientRect()
    const dx = clientX - (rect.left + rect.width / 2)
    const dy = clientY - (rect.top + rect.height / 2)
    return norm(Math.atan2(dx, -dy) * 180 / Math.PI)
  }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = true
    ;(e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId)
    const h = hueAt(e.clientX, e.clientY)
    contRef.current = h
    setAnim(null)
    sfx.tick()
    onHue(Math.round(h))
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return
    const h = hueAt(e.clientX, e.clientY)
    const prev = contRef.current ?? h
    // 30° 软刻度：跨过扇区边界时轻响一声
    if (Math.floor(norm(prev) / 30) !== Math.floor(h / 30)) sfx.tick()
    contRef.current = h
    setAnim(null)
    onHue(Math.round(h))
  }

  const onPointerUp = () => {
    if (!dragging.current) return
    dragging.current = false
    sfx.pop()
  }

  const knobAngle = anim ?? (hue !== null ? hue : 0)

  return (
    <div className="flex flex-col items-center gap-1.5 shrink-0">
      <div ref={ringRef}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
        className="relative w-[148px] h-[148px] rounded-full cursor-pointer select-none"
        style={{ touchAction: 'none' }}>
        {/* 彩虹环带 */}
        <div className="absolute inset-0 rounded-full" style={{
          background: 'conic-gradient(from 0deg, hsl(0,72%,58%), hsl(45,72%,55%), hsl(90,62%,50%), hsl(135,62%,48%), hsl(180,66%,46%), hsl(225,68%,56%), hsl(270,66%,58%), hsl(315,70%,56%), hsl(360,72%,58%))',
          boxShadow: 'inset 0 2px 6px rgba(0,0,0,0.12), 3px 3px 0 rgba(92,64,51,0.10)'
        }} />
        {/* 内圆（中心预览区） */}
        <div className="absolute inset-[24px] rounded-full bg-cream border-[3px] border-white flex items-center justify-center"
          style={{ boxShadow: 'inset 0 2px 5px rgba(0,0,0,0.06)' }}>
          {display !== null && display !== undefined ? (
            <motion.div key="ball" initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 400, damping: 18 }}
              className="w-14 h-14 rounded-full relative overflow-hidden border-[3px] border-white/80"
              style={{
                background: `radial-gradient(circle at 35% 28%, hsl(${display}, 72%, 82%), hsl(${display}, 64%, 54%) 52%, hsl(${display}, 60%, 38%))`,
                boxShadow: '3px 3px 0 rgba(92,64,51,0.18)'
              }}>
              <span className="absolute w-3 h-3 rounded-full bg-white/70 blur-[1px]" style={{ top: '16%', left: '20%' }} />
            </motion.div>
          ) : (
            <span className="text-[11px] font-extrabold text-muted/40">?</span>
          )}
        </div>
        {/* 旋钮 */}
        <motion.div
          animate={{ rotate: knobAngle }}
          transition={dragging.current ? { duration: 0 } : { type: 'spring', stiffness: 300, damping: 24 }}
          className="absolute inset-0 pointer-events-none">
          <div className="absolute left-1/2 -translate-x-1/2 w-[22px] h-[22px] rounded-full border-[3px] border-white"
            style={{
              top: 3,
              background: display !== null && display !== undefined ? `hsl(${display}, 64%, 52%)` : '#ccc',
              boxShadow: '0 2px 5px rgba(0,0,0,0.28)'
            }} />
        </motion.div>
      </div>
      {/* hex 读数 */}
      <div className="h-4">
        {hue !== null && (
          <motion.span initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }}
            className="text-[11px] font-extrabold text-muted">{hslToHex(hue, 60, 50)}</motion.span>
        )}
      </div>
    </div>
  )
}

/** 糖球：光泽感彩色球（径向渐变高光） */
function Gumball({ h, selected, onClick, title }: { h: number; selected: boolean; onClick: () => void; title: string }) {
  return (
    <motion.button onClick={onClick} title={title}
      whileTap={{ scale: 0.72, y: 2 }}
      animate={selected ? { scale: 1.18, y: -3 } : { scale: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 500, damping: 18 }}
      className={`w-8 h-8 rounded-full border-[3px] relative overflow-hidden ${
        selected ? 'border-text' : 'border-white/70 hover:scale-105'
      }`}
      style={{
        background: `radial-gradient(circle at 35% 28%, hsl(${h}, 72%, 82%), hsl(${h}, 64%, 54%) 52%, hsl(${h}, 60%, 38%))`,
        boxShadow: selected ? '3px 3px 0 rgba(92,64,51,0.22)' : '2px 2px 0 rgba(92,64,51,0.12)'
      }}>
      {/* 高光点 */}
      <span className="absolute w-2 h-2 rounded-full bg-white/75 blur-[1px]" style={{ top: '18%', left: '22%' }} />
    </motion.button>
  )
}

/** 配方芯片：展示当前色相下的派生色点 */
function SchemeChip({ def, hue, selected, label, onClick }: {
  def: { id: SchemeId; offsets: number[] }; hue: number; selected: boolean; label: string; onClick: () => void
}) {
  return (
    <motion.button onClick={onClick} whileTap={{ scale: 0.93 }}
      className={`flex items-center gap-2 px-3 py-2 rounded-xl border-[3px] transition-colors ${
        selected ? 'border-text bg-white' : 'border-text/12 bg-white/60 hover:border-text/30'
      }`}
      style={{ boxShadow: selected ? '2px 2px 0 rgba(92,64,51,0.15)' : 'none' }}>
      <span className="flex -space-x-1">
        {def.offsets.map(o => {
          const hh = ((hue + o) % 360 + 360) % 360
          return <span key={o} className="w-3.5 h-3.5 rounded-full border-2 border-white" style={{ background: `hsl(${hh}, 62%, 52%)` }} />
        })}
      </span>
      <span className={`text-[12px] font-extrabold ${selected ? 'text-text' : 'text-muted'}`}>{label}</span>
    </motion.button>
  )
}

// ================================================================
//  Step ④ 汇总确认
// ================================================================
function StepConfirm({ wishText, qaHistory, styleNote, styleOverride, hue, scheme, isUpgrade, onLaunch }: {
  wishText: string; qaHistory: QARecord[]; styleNote: string | null; styleOverride: string
  hue: number | null; scheme: SchemeId; isUpgrade: boolean; onLaunch: () => void
}) {
  const { t } = useTranslation()
  const details = qaHistory.map(qa => qa.answer).filter(a => a !== t('wish.decideAnswer'))
  const hasVisual = !isUpgrade && (styleNote || styleOverride.trim() || hue !== null)

  return (
    <motion.div {...fadeSlide}>
      <div className="flex items-center gap-2 mb-4">
        <ClipboardList className="w-4 h-4 text-brand" strokeWidth={2.5} />
        <p className="text-[14px] font-extrabold text-text">{t('wish.confirmTitle')}</p>
      </div>

      <div className="rounded-2xl border-[3px] border-text bg-white p-4 space-y-3"
        style={{ boxShadow: '4px 4px 0 rgba(92,64,51,0.12)' }}>
        {/* 核心需求 */}
        <div>
          <p className="text-[11px] font-extrabold text-muted uppercase tracking-wide mb-1">{t('wish.labelWish')}</p>
          <p className="text-[13px] font-bold text-text leading-relaxed">{wishText}</p>
        </div>
        {/* 细节 */}
        {details.length > 0 && (
          <div>
            <p className="text-[11px] font-extrabold text-muted uppercase tracking-wide mb-1">{t('wish.labelDetails')}</p>
            <div className="flex flex-wrap gap-1.5">
              {details.map((d, i) => (
                <span key={i} className="px-2.5 py-1 rounded-lg bg-cream text-[12px] font-bold text-text border border-text/10">{d}</span>
              ))}
            </div>
          </div>
        )}
        {/* 风格 & 配色 */}
        {hasVisual && (
          <div className="space-y-2">
            {(styleNote || styleOverride.trim()) && (
              <div>
                <p className="text-[11px] font-extrabold text-muted uppercase tracking-wide mb-1">{t('wish.labelStyle')}</p>
                <p className="text-[13px] font-bold text-text leading-relaxed">
                  {styleNote}{styleNote && styleOverride.trim() && '；'}{styleOverride.trim()}
                </p>
              </div>
            )}
            {hue !== null && (
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-[11px] font-extrabold text-muted uppercase tracking-wide">{t('wish.labelPalette')}</p>
                <span className="flex -space-x-1">
                  {SCHEMES.find(s => s.id === scheme)!.offsets.map(o => {
                    const hh = ((hue + o) % 360 + 360) % 360
                    return <span key={o} className="inline-block w-4 h-4 rounded-full border-2 border-white" style={{ background: `hsl(${hh}, 62%, 52%)`, boxShadow: '0 1px 2px rgba(0,0,0,0.15)' }} />
                  })}
                </span>
                <span className="text-[13px] font-bold text-text">{hslToHex(hue, 60, 50)} · {t(`wish.schemes.${scheme}`)}</span>
              </div>
            )}
          </div>
        )}
      </div>

      <button onClick={onLaunch}
        className="mt-5 flex items-center gap-2 px-6 py-3.5 bg-brand text-white rounded-2xl font-extrabold text-[15px] hover:bg-brand-hover active:translate-y-0.5 transition-all border-[3px] border-text"
        style={{ boxShadow: '5px 5px 0 rgba(92,64,51,0.25)' }}>
        <Sparkles className="w-5 h-5" strokeWidth={2.5} />
        <span>{t('wish.launch')}</span>
      </button>
    </motion.div>
  )
}

// ================================================================
//  扭蛋进度 / 结果面板（机芯实况 live feed）
// ================================================================

const ACTIVITY_META: Record<GachaActivity['type'], { icon: typeof Brain; cls: string; badge: string }> = {
  think: { icon: Brain, cls: 'text-violet-600', badge: 'bg-violet-100' },
  tool: { icon: Wrench, cls: 'text-sky-600', badge: 'bg-sky-100' },
  write: { icon: PenLine, cls: 'text-emerald-600', badge: 'bg-emerald-100' },
  check: { icon: CheckCircle2, cls: 'text-amber-600', badge: 'bg-amber-100' },
  retry: { icon: RefreshCw, cls: 'text-orange-500', badge: 'bg-orange-100' },
  error: { icon: AlertTriangle, cls: 'text-red-500', badge: 'bg-red-100' },
}

// ---- 思考光标：尾部 2px 竖条，明暗闪烁 ----
function BlinkingCursor() {
  return (
    <motion.span
      className="inline-block w-[2px] h-[13px] rounded-full bg-violet-500 shrink-0"
      animate={{ opacity: [1, 1, 0, 0] }}
      transition={{ duration: 1, repeat: Infinity, times: [0, 0.5, 0.5, 1], ease: 'linear' }}
    />
  )
}

// ---- 光效扫略：斜向高光带周期性扫过胶囊表面 ----
function ShineSweep() {
  return (
    <motion.span
      aria-hidden
      className="pointer-events-none absolute inset-y-0 left-0 w-1/3 -skew-x-12"
      initial={{ x: '-130%' }}
      animate={{ x: '460%' }}
      transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut', repeatDelay: 0.4 }}
      style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.65), transparent)' }}
    />
  )
}

// ---- 丝滑打字机：把目标文本按恒定速率逐字揭示，与流响应到达节奏解耦 ----
// 流是突发式的（token 成批到达），这里把完整内容缓冲下来，以固定速度吐字，保证平滑
const CHARS_PER_SEC = 80
function useTypewriter(target: string, active: boolean): string {
  const [count, setCount] = useState(0)
  const targetRef = useRef(target)
  targetRef.current = target
  const floatRef = useRef(0)

  useEffect(() => {
    if (!active) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(now - last, 100) // 切后台/卡顿后不要大步跳
      last = now
      floatRef.current = Math.min(targetRef.current.length, floatRef.current + CHARS_PER_SEC * dt / 1000)
      const next = Math.floor(floatRef.current)
      setCount(prev => (prev === next ? prev : next))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [active])

  if (!active) return target
  return target.slice(0, count)
}

// ---- 思考行：进行中折叠为「思考中」状态，点击展开看实时详情 ----
const ThinkRow = forwardRef<HTMLDivElement, {
  text: GachaActivity['text']; active: boolean; expanded: boolean; onToggle: () => void
  t: (key: string, params?: Record<string, unknown>) => string
}>(function ThinkRow({ text, active, expanded, onToggle, t }, ref) {
  const content = tr(t, text)
  const revealed = useTypewriter(content, active)
  const thinking = t('feed.thinking')
  // 展开后实时跟随：新内容落到尾部时滚入视野
  const tailRef = useRef<HTMLSpanElement>(null)
  // 展开实时跟随：节流 + 平滑，避免打字机逐字推进时每帧 scrollIntoView 造成的高频抖动
  const lastFollow = useRef(0)
  useEffect(() => {
    if (!active || !expanded) return
    const now = performance.now()
    if (now - lastFollow.current < 120) return
    lastFollow.current = now
    tailRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }, [revealed, active, expanded])

  return (
    <motion.div
      ref={ref}
      layout="position"
      initial={{ opacity: 0, y: 8, scale: 0.94 }}
      animate={{ opacity: active ? 1 : 0.55, y: 0, scale: active && !expanded ? 1.02 : 1 }}
      transition={SPRING}
      onClick={onToggle}
      className={`relative flex ${expanded ? 'items-start' : 'items-center'} gap-2.5 rounded-xl px-3 py-2 cursor-pointer select-none overflow-hidden ${
        active ? 'bg-violet-100' : 'bg-transparent hover:bg-violet-100/50'
      }`}
    >
      {active && !expanded && <ShineSweep />}
      {/* 思考中：图标呼吸；完成：静止 */}
      <motion.span
        animate={active ? { scale: [1, 1.14, 1] } : { scale: 1 }}
        transition={active ? { duration: 1.5, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.2 }}
        className="shrink-0"
      >
        <Brain className={`w-4 h-4 ${active ? 'text-violet-600' : 'text-violet-400'}`} strokeWidth={2.5} />
      </motion.span>

      {expanded ? (
        <div className="flex-1 min-w-0">
          <p className="text-[12px] leading-relaxed font-bold text-text whitespace-pre-wrap break-words">
            {active ? revealed : content}
            {active && <BlinkingCursor />}
          </p>
          <span ref={tailRef} className="block h-px" aria-hidden />
        </div>
      ) : active ? (
        <div className="flex-1 min-w-0 flex items-center gap-1.5">
          <span className="text-[12px] font-bold text-violet-700">{thinking}</span>
          <span className="flex items-center gap-[3px]">
            {[0, 1, 2].map(d => (
              <motion.span key={d}
                className="w-1 h-1 rounded-full bg-violet-500"
                animate={{ opacity: [0.25, 1, 0.25], y: [0, -2, 0] }}
                transition={{ duration: 0.9, repeat: Infinity, delay: d * 0.16, ease: 'easeInOut' }} />
            ))}
          </span>
        </div>
      ) : (
        <p className="flex-1 min-w-0 truncate text-[12px] font-bold text-muted">{content}</p>
      )}

      <motion.span animate={{ rotate: expanded ? 180 : 0 }} transition={SPRING} className="shrink-0">
        <ChevronDown className={`w-3.5 h-3.5 ${expanded ? 'text-violet-500' : active ? 'text-violet-400' : 'text-muted/50'}`} />
      </motion.span>
    </motion.div>
  )
})

// ---- 动作行：彩色图标徽章 + 单行文字，无背景 ----
const ActionRow = forwardRef<HTMLDivElement, {
  type: GachaActivity['type']; text: GachaActivity['text']; active: boolean
  t: (key: string, params?: Record<string, unknown>) => string
}>(function ActionRow({ type, text, active, t }, ref) {
  const meta = ACTIVITY_META[type] ?? ACTIVITY_META.tool
  const Icon = meta.icon
  return (
    <motion.div
      ref={ref}
      layout
      initial={{ opacity: 0, y: 8, scale: 0.94 }}
      animate={{ opacity: active ? 1 : 0.6, y: 0, scale: active ? 1 : 0.98 }}
      transition={SPRING}
      className="flex items-center gap-2.5 px-3 py-1.5"
    >
      <div className={`w-6 h-6 shrink-0 flex items-center justify-center rounded-md ${meta.badge}`}>
        <Icon className={`w-3.5 h-3.5 ${meta.cls}`} strokeWidth={2.5} />
      </div>
      <p className="flex-1 min-w-0 truncate text-[12px] font-bold text-text">{tr(t, text)}</p>
    </motion.div>
  )
})

function ProgressPanel({ gacha, revealed, resultReady, onOpen, onRetry, onClose }: {
  gacha: ReturnType<typeof getGachaState>; revealed: boolean; resultReady: boolean
  onOpen: () => void; onRetry: () => void; onClose: () => void
}) {
  const { t } = useTranslation()
  const [elapsed, setElapsed] = useState(0)
  // 已展开的思考条目（按稳定 key 记录，允许多条独立展开）
  const [expandedThinks, setExpandedThinks] = useState<Set<string>>(new Set())
  const toggleThink = (key: string) => setExpandedThinks(prev => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })
  // 正在进行的条目（列表最后一条）居中滚动
  const activeRef = useRef<HTMLDivElement>(null)
  const lastIdx = gacha.activities.length - 1
  const lastAct = gacha.activities[lastIdx]
  const activeKey = gacha.activities.length ? (lastAct.id ?? `${lastAct.type}-${lastIdx}`) : null
  useEffect(() => {
    if (!activeKey || !gacha.running) return
    activeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [activeKey, gacha.running])

  // 耗时计时器：每秒刷新
  useEffect(() => {
    if (!gacha.running || !gacha.startedAt) { setElapsed(0); return }
    const tick = () => setElapsed(Math.floor((Date.now() - gacha.startedAt) / 1000))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [gacha.running, gacha.startedAt])

  const fmtElapsed = (s: number): string => {
    if (s < 60) return `${s}s`
    const m = Math.floor(s / 60)
    const sec = s % 60
    return `${m}m ${sec}s`
  }

  const handleCancel = () => {
    shelf.cancelGacha().catch(() => {})
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Stage header */}
      <div className="mx-auto w-full max-w-[920px] px-6 pt-5 pb-3 flex items-center gap-3">
        {gacha.running ? (
          <motion.div animate={{ rotate: 360 }} transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}>
            <Sparkles className="w-5 h-5 text-brand" strokeWidth={2.5} />
          </motion.div>
        ) : (
          <Egg className="w-5 h-5 text-brand" strokeWidth={2.5} />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-extrabold text-text leading-tight">
            {gacha.running ? progressLabel(gacha.stage, t) : resultReady ? t('progress.done') : ''}
          </p>
          {gacha.running && gacha.detail && (
            <p className="text-[12px] font-bold text-muted truncate mt-0.5">{tr(t, gacha.detail)}</p>
          )}
          {/* 进度量化：步骤 + 轮次 + 耗时 */}
          {gacha.running && gacha.metrics && (
            <p className="text-[11px] font-bold text-muted/60 mt-0.5">
              {t('progress.step', { turn: gacha.metrics.turn, maxTurns: gacha.metrics.maxTurns })} · {t('progress.round', { round: gacha.metrics.round, maxRounds: gacha.metrics.maxRounds })} · {fmtElapsed(elapsed)}
            </p>
          )}
          {gacha.running && !gacha.metrics && elapsed > 0 && (
            <p className="text-[11px] font-bold text-muted/60 mt-0.5">{fmtElapsed(elapsed)}</p>
          )}
          {resultReady && (
            <p className="text-[12px] font-bold text-brand mt-0.5">{t('progress.reveal')}</p>
          )}
        </div>
        {/* 取消按钮 */}
        {gacha.running && (
          <button onClick={handleCancel}
            className="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-xl text-[12px] font-extrabold border-2 border-red-200 bg-white text-red-500 hover:bg-red-50 hover:border-red-400 active:translate-y-0.5 transition-all"
            style={{ boxShadow: '2px 2px 0 rgba(220,80,60,0.12)' }}>
            <X className="w-3.5 h-3.5" strokeWidth={2.8} /> {t('progress.cancel')}
          </button>
        )}
      </div>

      {/* Live feed（去白盒：动态直接浮在奶油背景上） */}
      {(gacha.running || resultReady) && (
        <div className="flex-1 min-h-0 w-full max-w-[920px] mx-auto px-4 mb-4 overflow-y-auto overflow-x-hidden chat-scroll">
          <div className="px-2 py-3 flex flex-col gap-1.5">
            {gacha.activities.length === 0 && gacha.running && (
              <div className="flex items-center gap-2 px-3 py-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-muted" />
                <span className="text-[12px] font-bold text-muted">{t('progress.starting')}</span>
              </div>
            )}
            {gacha.activities.map((a, i) => {
              const isActive = gacha.running && i === lastIdx
              const key = a.id ?? `${a.type}-${i}`
              if (a.type === 'think') {
                return (
                  <ThinkRow key={key} ref={isActive ? activeRef : undefined}
                    text={a.text} active={isActive}
                    expanded={expandedThinks.has(key)} onToggle={() => toggleThink(key)} t={t} />
                )
              }
              return (
                <ActionRow key={key} ref={isActive ? activeRef : undefined}
                  type={a.type} text={a.text} active={isActive} t={t} />
              )
            })}
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
  const { t } = useTranslation()
  const ok = result.ok
  return (
    <div className="bg-white rounded-2xl overflow-hidden border-[4px] border-text"
      style={{ boxShadow: '5px 5px 0 rgba(92,64,51,0.18)', borderLeft: ok ? '6px solid #5ac08a' : '6px solid #f0c040' }}>
      <div className="px-5 py-4">
        <p className="text-[15px] font-extrabold text-text">
          {ok ? (result.upgraded ? t('result.okUpgraded', { name: result.name }) : t('result.ok', { name: result.name }))
              : (result.upgraded ? t('result.failUpgraded') : t('result.fail'))}
        </p>
        <p className="text-[13px] font-bold text-muted mt-1.5">
          {ok ? (result.upgraded ? t('result.okUpgradedHint') : t('result.okHint'))
              : `${tr(t, result.error)}${result.upgraded ? t('result.failUpgradedHint') : ''}`}
        </p>
      </div>
      <div className="flex gap-2 px-5 py-3">
        {ok && result.eggId && <Btn primary onClick={onOpen}>{t('result.open')}</Btn>}
        {!ok && <Btn primary onClick={onRetry}>{t('result.retry')}</Btn>}
        <Btn onClick={onClose}>{t('result.okBtn')}</Btn>
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

function progressLabel(s: GachaProgress['stage'] | null, t: (key: string) => string): string {
  switch (s) {
    case 'coin': return t('progress.coin')
    case 'crank': return t('progress.crank')
    case 'clack': return t('progress.clack')
    case 'pop': return t('progress.pop')
    case 'fail': return t('progress.fail')
    case 'cancelled': return t('progress.cancelled')
    default: return t('progress.default')
  }
}

const fadeSlide = {
  initial: { opacity: 0, x: 16 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -12 },
  transition: SPRING
}
