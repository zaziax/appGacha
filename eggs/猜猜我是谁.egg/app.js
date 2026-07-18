/* ============================================================
   猜猜我是谁 —— 猜人游戏（Akinator 风格）
   用户心里想一个人名，AI 通过提问来猜
   权限: ai, storage
   ============================================================ */

// ─── 常量 ─────────────────────────────────────────────────────
const STORAGE_KEY = 'guess_history'

const SYSTEM_PROMPT = `你是"猜猜君"，一个猜人游戏的AI。用户心里想了一个人（真实人物、历史名人、虚构角色、动漫人物等任何知名人物），你需要通过提问来猜出这个人。

规则：
1. 每次只问一个问题，这个问题必须能用"是/否/不确定/可能是"来回答
2. 问题要层层递进，从大类别到具体细节
3. 每次提问前，回顾已经获得的所有信息，避免重复提问
4. 当你累积足够的信息、有把握时，给出你的猜测（通常3-8个问题后）
5. 如果用户连续回答"不确定"，尝试换一个方向提问

你必须严格按以下JSON格式回复（不要包含任何其他内容，不要加markdown代码块标记）：
- 如果想继续提问：{"type":"question","question":"你的问题"}
- 如果想给出猜测：{"type":"guess","name":"你猜的人名","confidence":"高/中/低","reason":"你的推理过程"}

如果是猜测，请给出具体人名（中文名），并简要说明推理。`

// ─── 状态 ─────────────────────────────────────────────────────
const state = {
  phase: 'welcome',       // welcome | playing | guessing | result
  messages: [],           // AI 对话历史 [{role, content}]
  questionCount: 0,
  aiGuess: null,          // { name, confidence, reason }
  hint: '',
  sessionId: 0,
  history: []
}

const $app = document.getElementById('app')

// ─── 初始化 ───────────────────────────────────────────────────
async function init() {
  await loadHistory()
  renderWelcome()
}

// ─── 数据持久化 ──────────────────────────────────────────────
async function loadHistory() {
  try {
    const raw = await egg.storage.get(STORAGE_KEY)
    state.history = Array.isArray(raw) ? raw : []
  } catch (_) { state.history = [] }
}

async function saveHistory() {
  try { await egg.storage.set(STORAGE_KEY, state.history) }
  catch (_) { egg.ui.toast('保存记录失败') }
}

function addHistoryRecord(record) {
  state.history.unshift(record)
  if (state.history.length > 50) state.history.pop()
  saveHistory()
}

// ─── 渲染：欢迎页 ──────────────────────────────────────────
function renderWelcome() {
  state.phase = 'welcome'
  document.getElementById('counter').textContent = ''

  $app.innerHTML = `
    <div class="card welcome-card">
      <div class="icon">🧠</div>
      <h2>心里想一个人</h2>
      <p>想一个真实或虚构的人物，我来提问猜出TA！<br>准备好了就点下面 👇</p>
      <input class="hint-input" id="hintInput" type="text"
             placeholder="可选：给个小提示（如「中国人」「动漫角色」）" maxlength="50">
      <button id="startBtn" style="font-size:18px;padding:12px 32px;margin-top:4px">
        ✅ 我准备好了！
      </button>
    </div>
    ${renderHistoryHTML()}
  `

  document.getElementById('startBtn').addEventListener('click', onStart)
  document.getElementById('hintInput')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') onStart()
  })
  setTimeout(() => document.getElementById('hintInput')?.focus(), 100)
}

// ─── 渲染：游戏进行中（对话 + 回答按钮） ─────────────────
function renderPlaying() {
  state.phase = 'playing'
  document.getElementById('counter').textContent = `已问 ${state.questionCount} 题`

  const bubbles = buildBubblesHTML()
  $app.innerHTML = `
    <div class="card" style="padding-bottom:8px">
      <div class="chat-box" id="chatBox">${bubbles}</div>
      <div class="answer-zone" id="answerZone">
        <button class="btn-yes"    data-answer="是">✅ 是</button>
        <button class="btn-no"     data-answer="不是">❌ 不是</button>
        <button class="btn-unsure" data-answer="不确定">🤷 不确定</button>
        <button class="btn-maybe"  data-answer="可能是">🧐 可能是</button>
      </div>
      <div class="action-bar">
        <button class="ghost" id="giveUpBtn" style="font-size:12px">🚫 放弃，揭晓答案</button>
      </div>
    </div>
    ${renderHistoryHTML()}
  `

  document.querySelectorAll('.answer-zone button').forEach(btn => {
    btn.addEventListener('click', () => onAnswer(btn.dataset.answer))
  })
  document.getElementById('giveUpBtn').addEventListener('click', onGiveUp)
  scrollChat()
}

// ─── 渲染：AI给出猜测，等待反馈 ──────────────────────────
function renderGuessing() {
  state.phase = 'guessing'
  const g = state.aiGuess

  $app.innerHTML = `
    <div class="card result-card">
      <div style="font-size:40px">🔮</div>
      <h2>我的猜测是...</h2>
      <div class="guess-name celebrate">${escHtml(g.name)}</div>
      <div class="confidence">${confidenceLabel(g.confidence)}</div>
      <p class="guess-reason">${escHtml(g.reason)}</p>
      <p class="muted" style="margin:12px 0 6px">猜对了吗？</p>
      <div class="feedback-zone">
        <button class="btn-right" id="correctBtn">🎉 猜对了！</button>
        <button class="btn-keep"  id="continueBtn">🔍 不对，继续问</button>
        <button class="btn-wrong" id="wrongBtn">💀 完全不对，揭晓答案</button>
      </div>
    </div>
    ${renderHistoryHTML()}
  `

  document.getElementById('correctBtn').addEventListener('click', () => onFeedback(true))
  document.getElementById('continueBtn').addEventListener('click', onContinue)
  document.getElementById('wrongBtn').addEventListener('click', () => onFeedback(false))
}

// ─── 渲染：最终结果页（猜对 / 猜错 / 放弃） ────────────
function renderResult(correct, autoName) {
  state.phase = 'result'

  let emoji, title
  if (correct === true)      { emoji = '🎉'; title = '猜对了！'; }
  else if (correct === false){ emoji = '😅'; title = '没猜中～'; }
  else                       { emoji = '👋'; title = '你放弃了'; }

  const guessName = state.aiGuess ? state.aiGuess.name : '—'

  $app.innerHTML = `
    <div class="card result-card">
      <div style="font-size:48px">${emoji}</div>
      <h2>${title}</h2>
      ${state.aiGuess ? `<div class="guess-name">${escHtml(guessName)}</div>` : ''}
      <p class="muted" style="margin:12px 0 4px">你心里想的是谁？</p>
      <input id="actualInput" type="text" placeholder="输入人名" maxlength="30"
             value="${escHtml(autoName || '')}"
             style="width:100%;max-width:240px;text-align:center;margin:0 auto 12px;display:block">
      <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
        <button id="saveBtn" style="background:var(--good);color:#fff">
          ✅ 记录 &amp; 再来一局
        </button>
        <button id="skipBtn" class="ghost">🔄 直接再来一局</button>
      </div>
    </div>
    ${renderHistoryHTML()}
  `

  document.getElementById('saveBtn').addEventListener('click', () => {
    const actual = document.getElementById('actualInput').value.trim() || guessName
    addHistoryRecord({
      id: state.sessionId,
      date: new Date().toLocaleString('zh-CN'),
      questions: state.questionCount,
      aiGuess: guessName,
      confidence: state.aiGuess ? state.aiGuess.confidence : '—',
      correct: correct,
      targetActual: actual
    })
    renderWelcome()
  })

  document.getElementById('skipBtn').addEventListener('click', renderWelcome)
  setTimeout(() => document.getElementById('actualInput')?.focus(), 100)
}

// ─── 渲染：历史记录区域 HTML ──────────────────────────────
function renderHistoryHTML() {
  if (state.history.length === 0) return ''

  let items = ''
  for (const h of state.history.slice(0, 10)) {
    let tag
    if (h.correct === true)      tag = '<span class="h-tag correct">✓ 猜中</span>'
    else if (h.correct === false)tag = '<span class="h-tag wrong">✗ 没中</span>'
    else                         tag = '<span class="h-tag">—</span>'

    items += `
      <div class="history-item">
        <div class="h-left">
          ${tag}
          <span><strong>${escHtml(h.aiGuess)}</strong></span>
          <span class="muted">${h.questions} 问</span>
        </div>
        <span class="muted">${escHtml(h.date)}</span>
      </div>`
  }

  return `
    <div class="history-title">📜 最近记录</div>
    <div class="history-list">${items}</div>
  `
}

// ─── 生成对话气泡 HTML ─────────────────────────────────────
function buildBubblesHTML() {
  let html = ''
  for (const msg of state.messages) {
    if (msg.role === 'assistant') {
      try {
        const p = JSON.parse(msg.content)
        if (p.type === 'question')
          html += `<div class="bubble bubble-ai">${escHtml(p.question)}</div>`
        else if (p.type === 'guess')
          html += `<div class="bubble bubble-ai">🤔 我想一想…<br>我的猜测是：<strong>${escHtml(p.name)}</strong></div>`
      } catch {
        html += `<div class="bubble bubble-ai">${escHtml(msg.content)}</div>`
      }
    } else if (msg.role === 'user' && msg.content !== '__init__') {
      html += `<div class="bubble bubble-user">${escHtml(getAnswerLabel(msg.content))}</div>`
    }
  }
  return html
}

// ─── 游戏逻辑 ────────────────────────────────────────────────

/** 用户点击"我准备好了" */
async function onStart() {
  const hint = (document.getElementById('hintInput')?.value || '').trim()
  state.hint = hint
  state.sessionId = Date.now()
  state.questionCount = 0
  state.messages = [{ role: 'user', content: '__init__' }]
  state.aiGuess = null

  const initMsg = hint
    ? `我想好了一个人！给个小提示：${hint}`
    : '我想好了一个人！请开始提问。'

  renderPlaying()
  showLoadingBubble()

  await askAI(initMsg)
}

/** 向 AI 提问并处理回复 */
async function askAI(userMessage) {
  const msgs = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...state.messages.slice(1).map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage }
  ]

  let reply
  try {
    reply = await egg.ai.chat(msgs, { temperature: 0.7, maxTokens: 500 })
  } catch (err) {
    hideLoadingBubble()
    const msg = String(err)
    if (msg.includes('AI_NOT_CONFIGURED')) {
      egg.ui.toast('⚠️ 请在收藏柜设置里配置 AI 模型后再玩')
      renderWelcome()
      return
    }
    egg.ui.toast('AI 出小差了，请重试')
    console.error('AI error:', err)
    renderPlaying()
    return
  }

  hideLoadingBubble()

  // 记录 AI 回复
  state.messages.push({ role: 'assistant', content: reply })

  // 解析 JSON
  let parsed
  try {
    parsed = JSON.parse(reply.trim())
  } catch {
    parsed = { type: 'question', question: reply.trim() }
  }

  if (parsed.type === 'guess') {
    state.aiGuess = {
      name: parsed.name || '未知',
      confidence: parsed.confidence || '中',
      reason: parsed.reason || ''
    }
    renderGuessing()
  } else {
    state.questionCount++
    renderPlaying()
  }

  scrollChat()
}

/** 用户回答了 AI 的问题 */
async function onAnswer(answer) {
  state.messages.push({ role: 'user', content: answer })
  renderPlaying()
  showLoadingBubble()
  await askAI(answer)
}

/** 用户反馈猜对了 / 猜错了 */
async function onFeedback(correct) {
  if (correct) {
    renderResult(true, state.aiGuess?.name || '')
  } else {
    renderResult(false, '')
  }
}

/** AI 猜错了，让 AI 继续猜（移除上一条猜测记录） */
async function onContinue() {
  // 移除 AI 最后一条猜测消息，替换为用户反馈
  if (state.messages.length > 0 &&
      state.messages[state.messages.length - 1].role === 'assistant') {
    state.messages.pop()
  }
  renderPlaying()
  showLoadingBubble()
  await askAI('不对，请换一个方向继续提问，不要重复之前问过的问题')
}

/** 用户放弃游戏 */
async function onGiveUp() {
  renderResult(null, '')
}

// ─── 辅助函数 ────────────────────────────────────────────────

function getAnswerLabel(answer) {
  const map = {
    '是': '✅ 是',
    '不是': '❌ 不是',
    '不确定': '🤷 不确定',
    '可能是': '🧐 可能是',
    '不对，请换一个方向继续提问，不要重复之前问过的问题': '🔍 不对，继续猜'
  }
  return map[answer] || answer
}

function confidenceLabel(level) {
  const map = { '高': '🟢 把握很高', '中': '🟡 有一定把握', '低': '🟠 不太确定' }
  return map[level] || `🟡 ${level}`
}

function escHtml(s) {
  if (typeof s !== 'string') return String(s || '')
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
}

function showLoadingBubble() {
  const box = document.getElementById('chatBox')
  if (!box) return
  const div = document.createElement('div')
  div.className = 'bubble bubble-ai'
  div.id = 'loadingBubble'
  div.innerHTML = '🤔 让我想想<span class="loading-dots"></span>'
  box.appendChild(div)
  scrollChat()
}

function hideLoadingBubble() {
  document.getElementById('loadingBubble')?.remove()
}

function scrollChat() {
  requestAnimationFrame(() => {
    document.getElementById('chatBox')?.scrollTo({ top: 9999, behavior: 'smooth' })
  })
}

// ─── 启动 ─────────────────────────────────────────────────────
init()
