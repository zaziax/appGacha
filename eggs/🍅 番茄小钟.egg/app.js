/* ──────────────────────────────────────────
   🍅 番茄小钟 · 待办 — 全部逻辑
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

// ── Todo 状态 ──
let todoItems = []         // 内存中的待办列表
let todoDbReady = false    // 数据库是否就绪

// ──────────────────────────────────────────
//   初始化
// ──────────────────────────────────────────
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

  // 初始化 Todo 数据库
  await initTodoDb()

  // 加载 Todo 列表
  await loadTodos()

  // 事件绑定
  mainBtn.addEventListener('click', handleMainBtn)
  resetBtn.addEventListener('click', handleReset)
  $('settingsToggle').addEventListener('click', toggleSettings)
  $('saveSettingsBtn').addEventListener('click', saveSettings)
  $('addTodoBtn').addEventListener('click', handleAddTodo)
  $('todoInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleAddTodo()
  })
}

// ──────────────────────────────────────────
//   Todo 数据库
// ──────────────────────────────────────────
async function initTodoDb() {
  try {
    // 建表（CREATE TABLE IF NOT EXISTS 自动兼容新旧结构）
    await egg.db.exec(
      `CREATE TABLE IF NOT EXISTS todos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        text TEXT NOT NULL,
        done INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
      )`
    )

    // 尝试迁移：旧版本可能没有 done 字段（虽然初始就有，但安全起见检查）
    // 如果旧表有但类型不对，ALTER 会抛异常，catch 里忽略即可
    try {
      // 添加 sort_order 列 — 如果有旧表需要迁移排序能力
      await egg.db.exec(`ALTER TABLE todos ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0`)
    } catch (_) { /* 列已存在，忽略 */ }

    todoDbReady = true
  } catch (err) {
    console.warn('Todo 数据库初始化失败:', err)
    egg.ui.toast('⚠️ 待办数据加载失败')
  }
}

// ── 从数据库加载 Todo 列表 ──
async function loadTodos() {
  if (!todoDbReady) return
  try {
    const rows = await egg.db.query(
      'SELECT id, text, done FROM todos ORDER BY sort_order ASC, id ASC'
    )
    todoItems = rows.map(r => ({
      id: r.id,
      text: r.text,
      done: !!r.done
    }))
    renderTodos()
  } catch (err) {
    console.warn('加载待办失败:', err)
    egg.ui.toast('⚠️ 加载待办失败')
  }
}

// ── 添加待办 ──
async function handleAddTodo() {
  const input = $('todoInput')
  const text = input.value.trim()
  if (!text) {
    egg.ui.toast('📝 请输入待办内容')
    return
  }

  try {
    // 获取当前最大 sort_order
    const maxRow = await egg.db.query('SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_sort FROM todos')
    const nextSort = maxRow[0]?.next_sort || 1

    const result = await egg.db.exec(
      'INSERT INTO todos (text, done, sort_order) VALUES (?, 0, ?)',
      [text, nextSort]
    )

    todoItems.push({
      id: result.lastInsertRowid,
      text: text,
      done: false
    })

    input.value = ''
    input.focus()
    renderTodos()
    egg.ui.toast('✅ 已添加待办')
  } catch (err) {
    console.warn('添加待办失败:', err)
    egg.ui.toast('⚠️ 添加失败')
  }
}

// ── 切换完成状态 ──
async function toggleTodoDone(id) {
  const item = todoItems.find(t => t.id === id)
  if (!item) return

  const newDone = item.done ? 0 : 1
  try {
    await egg.db.exec('UPDATE todos SET done = ? WHERE id = ?', [newDone, id])
    item.done = !!newDone
    renderTodos()
  } catch (err) {
    console.warn('更新待办状态失败:', err)
    egg.ui.toast('⚠️ 更新失败')
  }
}

// ── 删除待办 ──
async function deleteTodoItem(id) {
  const confirmed = await egg.ui.confirm('确定要删除这条待办吗？')
  if (!confirmed) return

  try {
    await egg.db.exec('DELETE FROM todos WHERE id = ?', [id])
    todoItems = todoItems.filter(t => t.id !== id)
    renderTodos()
    egg.ui.toast('🗑️ 已删除')
  } catch (err) {
    console.warn('删除待办失败:', err)
    egg.ui.toast('⚠️ 删除失败')
  }
}

// ── 渲染 Todo 列表 ──
function renderTodos() {
  const list = $('todoList')
  const count = $('todoCount')

  if (todoItems.length === 0) {
    list.innerHTML = '<li class="todo-empty">还没有待办，添加一条吧 📝</li>'
    count.textContent = '0 项'
    return
  }

  const doneCount = todoItems.filter(t => t.done).length
  count.textContent = `${doneCount}/${todoItems.length} 项`

  list.innerHTML = todoItems.map(item => {
    const checkedClass = item.done ? 'checked' : ''
    const doneTextClass = item.done ? 'done' : ''
    return `
      <li class="todo-item" data-id="${item.id}">
        <span class="todo-check ${checkedClass}" data-action="toggle" data-id="${item.id}"></span>
        <span class="todo-text ${doneTextClass}">${escapeHtml(item.text)}</span>
        <button class="todo-delete" data-action="delete" data-id="${item.id}" title="删除">✕</button>
      </li>
    `
  }).join('')

  // 事件委托：点击复选框 / 删除按钮
  list.addEventListener('click', async (e) => {
    const target = e.target.closest('[data-action]')
    if (!target) return
    const id = Number(target.dataset.id)
    const action = target.dataset.action
    if (action === 'toggle') {
      await toggleTodoDone(id)
    } else if (action === 'delete') {
      await deleteTodoItem(id)
    }
  })
}

// ── 简单的防 XSS 转义 ──
function escapeHtml(str) {
  const div = document.createElement('div')
  div.textContent = str
  return div.innerHTML
}

// ──────────────────────────────────────────
//   番茄钟核心逻辑（完全保留不改）
// ──────────────────────────────────────────

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
