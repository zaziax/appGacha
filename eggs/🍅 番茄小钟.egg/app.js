/* ──────────────────────────────────────────
   🍅 番茄小钟 - 全部逻辑
   ────────────────────────────────────────── */

// ── 状态常量 ──
const S = {
  FOCUS_READY:  'focus-ready',
  FOCUS:        'focus',
  FOCUS_PAUSED: 'focus-paused',
  BREAK_READY:  'break-ready',
  BREAK:        'break',
  BREAK_PAUSED: 'break-paused'
}

// ── DOM 缓存 ──
const $ = id => document.getElementById(id)
const statusLabel   = $('statusLabel')
const timeText      = $('timeText')
const phaseLabel    = $('phaseLabel')
const progressRing  = $('progressRing')
const timerDisplay  = $('timerDisplay')
const mainBtn       = $('mainBtn')
const resetBtn      = $('resetBtn')
const tomatoCount   = $('tomatoCount')
const ringWrapper   = $('timerRingWrapper')

// ── 状态 ──
let config   = { focusTime: 25, breakTime: 5 }
let state    = S.FOCUS_READY
let remaining = 0   // 剩余秒
let total    = 0    // 总秒数
let timerId  = null

// 圆环周长（启动时计算）
let circumference = 0

// ── 初始化 ──
async function init() {
  // 计算圆环周长
  const r = progressRing.r.baseVal.value
  circumference = 2 * Math.PI * r
  progressRing.style.strokeDasharray = circumference

  // 加载持久化配置
  try {
    const saved = await egg.storage.get('pomodoro_config')
    if (saved && saved.focusTime && saved.breakTime) {
      config = saved
    }
  } catch (_) { /* 用默认值 */ }

  $('focusTime').value = config.focusTime
  $('breakTime').value = config.breakTime

  // 初始化状态
  resetToFocus()

  // 加载番茄计数
  await refreshTomatoCount()

  // 事件绑定
  mainBtn.addEventListener('click', handleMainBtn)
  resetBtn.addEventListener('click', handleReset)
  $('settingsToggle').addEventListener('click', toggleSettings)
  $('saveSettingsBtn').addEventListener('click', saveSettings)
}

// ── 重置到专注就绪 ──
function resetToFocus() {
  stopTimer()
  state = S.FOCUS_READY
  total = config.focusTime * 60
  remaining = total
  updateUI()
}

// ── 重置到休息就绪 ──
function resetToBreak() {
  stopTimer()
  state = S.BREAK_READY
  total = config.breakTime * 60
  remaining = total
  updateUI()
}

// ── 停止计时器 ──
function stopTimer() {
  if (timerId !== null) {
    clearInterval(timerId)
    timerId = null
  }
}

// ── 更新 UI ──
function updateUI() {
  const mins = Math.floor(remaining / 60)
  const secs = remaining % 60
  timeText.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`

  // 圆环进度
  const progress = total > 0 ? remaining / total : 0
  const offset = circumference * (1 - progress)
  progressRing.style.strokeDashoffset = offset

  // 移除旧状态类
  statusLabel.className = 'status-label'
  progressRing.className = 'timer-ring-progress'
  timerDisplay.classList.remove('pulse')
  mainBtn.classList.remove('break-mode', 'pause-mode')
  timeText.style.color = ''

  const isRunning = (state === S.FOCUS || state === S.BREAK)
  const isLast10 = isRunning && remaining > 0 && remaining <= 10

  switch (state) {
    case S.FOCUS_READY:
      statusLabel.textContent = '🍅 准备专注'
      statusLabel.className = 'status-label'
      phaseLabel.textContent = '点击开始专注'
      mainBtn.textContent = '开始专注'
      break

    case S.FOCUS:
      statusLabel.textContent = '🎯 专注中'
      statusLabel.className = 'status-label focus'
      phaseLabel.textContent = '保持专注 · 加油！'
      mainBtn.textContent = '暂停'
      if (isLast10) {
        progressRing.className = 'timer-ring-progress caution'
        timerDisplay.classList.add('pulse')
      }
      break

    case S.FOCUS_PAUSED:
      statusLabel.textContent = '⏸️ 已暂停'
      statusLabel.className = 'status-label paused'
      phaseLabel.textContent = '专注已暂停'
      mainBtn.textContent = '继续'
      mainBtn.classList.add('pause-mode')
      break

    case S.BREAK_READY:
      statusLabel.textContent = '☕ 休息一下'
      statusLabel.className = 'status-label break'
      phaseLabel.textContent = '点击开始休息'
      mainBtn.textContent = '开始休息'
      mainBtn.classList.add('break-mode')
      progressRing.className = 'timer-ring-progress break'
      break

    case S.BREAK:
      statusLabel.textContent = '☕ 休息中'
      statusLabel.className = 'status-label break'
      phaseLabel.textContent = '放松一下吧～'
      mainBtn.textContent = '暂停'
      mainBtn.classList.add('break-mode')
      progressRing.className = 'timer-ring-progress break'
      if (isLast10) {
        timerDisplay.classList.add('pulse')
      }
      break

    case S.BREAK_PAUSED:
      statusLabel.textContent = '⏸️ 已暂停'
      statusLabel.className = 'status-label paused'
      phaseLabel.textContent = '休息已暂停'
      mainBtn.textContent = '继续'
      mainBtn.classList.add('pause-mode')
      progressRing.className = 'timer-ring-progress break'
      break
  }

  // 最后 10 秒文字变色
  if (isLast10) {
    timeText.style.color = 'var(--bad)'
  }

  // 标题也同步显示时间
  document.title = `🍅 ${timeText.textContent}`
}

// ── 主按钮 ──
function handleMainBtn() {
  switch (state) {
    case S.FOCUS_READY:  startTimer(S.FOCUS);       break
    case S.FOCUS:        pauseTimer(S.FOCUS_PAUSED); break
    case S.FOCUS_PAUSED: startTimer(S.FOCUS);       break
    case S.BREAK_READY:  startTimer(S.BREAK);       break
    case S.BREAK:        pauseTimer(S.BREAK_PAUSED); break
    case S.BREAK_PAUSED: startTimer(S.BREAK);       break
  }
}

function startTimer(newState) {
  state = newState
  if (timerId === null) {
    timerId = setInterval(tick, 1000)
  }
  updateUI()
}

function pauseTimer(newState) {
  state = newState
  stopTimer()
  updateUI()
}

// ── 重置按钮 ──
function handleReset() {
  stopTimer()
  if (state === S.FOCUS || state === S.FOCUS_PAUSED || state === S.FOCUS_READY) {
    resetToFocus()
  } else {
    resetToBreak()
  }
}

// ── 每秒滴答 ──
function tick() {
  remaining--
  if (remaining <= 0) {
    remaining = 0
    updateUI()
    stopTimer()
    onTimerComplete()
    return
  }
  updateUI()
}

// ── 倒计时完成 ──
async function onTimerComplete() {
  if (state === S.FOCUS) {
    // 专注完成 🎉
    playBeep()
    speak('专注时间到，该休息啦')

    try {
      await egg.notify.send('🍅 番茄小钟', '🎉 专注完成！休息一下吧！')
    } catch (_) { /* 通知可能不支持 */ }

    // 加一个番茄
    await incrementTomato()

    // 切换到休息就绪
    resetToBreak()
    statusLabel.textContent = '🎉 专注完成'
    statusLabel.className = 'status-label break'

  } else if (state === S.BREAK) {
    // 休息完成
    playBeep()
    speak('休息时间到，该专注啦')

    try {
      await egg.notify.send('🍅 番茄小钟', '⏰ 休息结束！开始新的一轮吧！')
    } catch (_) { /* 忽略 */ }

    resetToFocus()
    statusLabel.textContent = '☕ 休息结束'
    statusLabel.className = 'status-label'
  }
}

// ── 音效 ──
function playBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'sine'
    osc.frequency.setValueAtTime(880, ctx.currentTime)
    osc.frequency.setValueAtTime(660, ctx.currentTime + 0.15)
    gain.gain.setValueAtTime(0.25, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.5)
  } catch (_) { /* 音频不可用，静默降级 */ }
}

// ── 语音播报 ──
function speak(text) {
  try {
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'zh-CN'
    u.rate = 1.0
    speechSynthesis.speak(u)
  } catch (_) { /* 语音不可用 */ }
}

// ── 番茄统计 ──
async function loadStats() {
  try {
    const data = await egg.storage.get('pomodoro_stats') || {}
    const today = new Date().toISOString().split('T')[0]
    if (data.date !== today) {
      return { date: today, tomatoes: 0 }
    }
    return data
  } catch (_) {
    return { date: new Date().toISOString().split('T')[0], tomatoes: 0 }
  }
}

async function refreshTomatoCount() {
  const stats = await loadStats()
  tomatoCount.textContent = stats.tomatoes
}

async function incrementTomato() {
  const stats = await loadStats()
  stats.tomatoes = (stats.tomatoes || 0) + 1
  try {
    await egg.storage.set('pomodoro_stats', stats)
  } catch (_) { /* 存储失败时本地计数仍可展示 */ }
  tomatoCount.textContent = stats.tomatoes
  // 弹跳动画
  tomatoCount.classList.remove('bounce')
  void tomatoCount.offsetWidth // 触发回流
  tomatoCount.classList.add('bounce')
}

// ── 设置面板 ──
function toggleSettings() {
  $('settingsPanel').classList.toggle('hidden')
}

async function saveSettings() {
  const focus = parseInt($('focusTime').value) || 25
  const brk   = parseInt($('breakTime').value)   || 5
  config.focusTime = Math.max(1, Math.min(120, focus))
  config.breakTime = Math.max(1, Math.min(60, brk))

  try {
    await egg.storage.set('pomodoro_config', config)
    egg.ui.toast('✅ 设置已保存')
  } catch (_) {
    egg.ui.toast('⚠️ 设置保存失败')
  }

  // 如果当前在就绪状态，刷新显示
  if (state === S.FOCUS_READY) {
    total = config.focusTime * 60
    remaining = total
    updateUI()
  } else if (state === S.BREAK_READY) {
    total = config.breakTime * 60
    remaining = total
    updateUI()
  }
}

// ── 启动 ──
document.addEventListener('DOMContentLoaded', init)
