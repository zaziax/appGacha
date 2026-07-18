/* 背单词 —— appGacha 手写样例蛋，只使用 egg.* bridge 与标准 Web API */

let filter = 'all'
let openId = null

async function init() {
  await egg.db.exec(`CREATE TABLE IF NOT EXISTS words (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    word TEXT NOT NULL,
    meaning TEXT NOT NULL,
    mastered INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  )`)
  try { await egg.db.exec('ALTER TABLE words ADD COLUMN ai_note TEXT') } catch { /* 列已存在 */ }

  filter = (await egg.storage.get('filter')) || 'all'
  document.querySelectorAll('#filters button').forEach(b => {
    b.classList.toggle('active', b.dataset.filter === filter)
    b.addEventListener('click', async () => {
      filter = b.dataset.filter
      await egg.storage.set('filter', filter)
      document.querySelectorAll('#filters button').forEach(x =>
        x.classList.toggle('active', x === b))
      render()
    })
  })

  document.getElementById('addForm').addEventListener('submit', async (e) => {
    e.preventDefault()
    const word = document.getElementById('wordInput').value.trim()
    const meaning = document.getElementById('meaningInput').value.trim()
    if (!word || !meaning) return
    await egg.db.exec('INSERT INTO words (word, meaning) VALUES (?, ?)', [word, meaning])
    e.target.reset()
    document.getElementById('wordInput').focus()
    egg.ui.toast(`「${word}」已收进词库`)
    render()
  })

  await initReminder()

  render()
}

// ---- 每日提醒（egg.schedule，蛋关着也会响）----

async function initReminder() {
  const toggle = document.getElementById('reminderToggle')
  const time = document.getElementById('reminderTime')

  const entries = await egg.schedule.list()
  const existing = entries.find(e => e.id === 'daily-review')
  if (existing) {
    toggle.checked = true
    const [m, h] = existing.cron.split(' ')
    if (/^\d+$/.test(m) && /^\d+$/.test(h)) {
      time.value = `${h.padStart(2, '0')}:${m.padStart(2, '0')}`
    }
  }

  const apply = async () => {
    try {
      if (!toggle.checked) {
        await egg.schedule.cancel('daily-review')
        egg.ui.toast('每日提醒已关闭')
        return
      }
      const [h, m] = time.value.split(':').map(Number)
      await egg.schedule.set('daily-review', `${m} ${h} * * *`, {
        title: '背单词时间到啦',
        body: '今天的单词还等着你，开柜翻两张卡片吧～'
      })
      egg.ui.toast(`每天 ${time.value} 提醒你背单词`)
    } catch (err) {
      egg.ui.toast(err.message)
    }
  }

  toggle.addEventListener('change', apply)
  time.addEventListener('change', () => { if (toggle.checked) apply() })
}

function renderAiNote(box, note) {
  const sentence = document.createElement('div')
  sentence.className = 'ai-sentence'
  sentence.textContent = note.sentence

  const sentenceCn = document.createElement('div')
  sentenceCn.className = 'ai-sentence-cn'
  sentenceCn.textContent = note.sentence_cn

  const mnemonic = document.createElement('div')
  mnemonic.className = 'ai-mnemonic'
  mnemonic.textContent = `💡 ${note.mnemonic}`

  box.append(sentence, sentenceCn, mnemonic)
}

async function render() {
  const where = filter === 'learning' ? 'WHERE mastered = 0'
    : filter === 'mastered' ? 'WHERE mastered = 1' : ''
  const rows = await egg.db.query(`SELECT * FROM words ${where} ORDER BY id DESC`)
  const [{ total, done }] = await egg.db.query(
    'SELECT COUNT(*) AS total, SUM(mastered) AS done FROM words')
  document.getElementById('stats').textContent =
    total ? `${total} 词 · 已掌握 ${done || 0}` : '词库为空'

  const list = document.getElementById('list')
  list.innerHTML = ''
  document.getElementById('empty').hidden = rows.length > 0

  for (const row of rows) {
    const card = document.createElement('div')
    card.className = 'card' + (row.mastered ? ' mastered' : '') + (row.id === openId ? ' open' : '')

    const word = document.createElement('div')
    word.className = 'word'
    word.textContent = row.word
    if (row.mastered) {
      const badge = document.createElement('span')
      badge.className = 'badge'
      badge.textContent = '已掌握'
      word.appendChild(badge)
    }

    const meaning = document.createElement('div')
    meaning.className = 'meaning'
    meaning.textContent = row.meaning

    const aiBox = document.createElement('div')
    aiBox.className = 'ai-note'
    if (row.ai_note) {
      renderAiNote(aiBox, JSON.parse(row.ai_note))
    } else {
      const aiBtn = document.createElement('button')
      aiBtn.className = 'ai-btn'
      aiBtn.textContent = '✦ AI 例句·助记'
      aiBtn.addEventListener('click', async (e) => {
        e.stopPropagation()
        aiBtn.disabled = true
        aiBtn.textContent = '思考中…'
        try {
          const note = await egg.ai.extract(
            `请为英语单词 "${row.word}"（中文释义：${row.meaning}）生成学习卡片内容。`,
            {
              type: 'object',
              properties: {
                sentence: { type: 'string', description: '一句地道且贴近日常的英文例句，包含该单词' },
                sentence_cn: { type: 'string', description: '例句的中文翻译' },
                mnemonic: { type: 'string', description: '一条简短有趣的中文助记（谐音、词根或联想均可）' }
              },
              required: ['sentence', 'sentence_cn', 'mnemonic']
            }
          )
          await egg.db.exec('UPDATE words SET ai_note = ? WHERE id = ?', [JSON.stringify(note), row.id])
          render()
        } catch (err) {
          aiBtn.disabled = false
          aiBtn.textContent = '✦ AI 例句·助记'
          egg.ui.toast(err.message.startsWith('AI_NOT_CONFIGURED')
            ? '主人还没配置 AI，去收藏柜设置里填一下吧'
            : `AI 开小差了：${err.message}`)
        }
      })
      aiBox.appendChild(aiBtn)
    }

    const hint = document.createElement('div')
    hint.className = 'hint'
    hint.textContent = row.id === openId ? '' : '点击查看释义'

    const actions = document.createElement('div')
    actions.className = 'actions'

    const toggle = document.createElement('button')
    toggle.className = row.mastered ? 'unmaster' : 'master'
    toggle.textContent = row.mastered ? '重新背' : '记住了'
    toggle.addEventListener('click', async (e) => {
      e.stopPropagation()
      await egg.db.exec('UPDATE words SET mastered = ? WHERE id = ?', [row.mastered ? 0 : 1, row.id])
      if (!row.mastered) egg.ui.toast(`掌握「${row.word}」，+1！`)
      render()
    })

    const remove = document.createElement('button')
    remove.className = 'remove'
    remove.textContent = '删除'
    remove.addEventListener('click', async (e) => {
      e.stopPropagation()
      if (!(await egg.ui.confirm(`删除「${row.word}」？`))) return
      await egg.db.exec('DELETE FROM words WHERE id = ?', [row.id])
      render()
    })

    actions.append(toggle, remove)
    card.append(word, meaning, aiBox, hint, actions)
    card.addEventListener('click', () => {
      openId = openId === row.id ? null : row.id
      render()
    })
    list.appendChild(card)
  }
}

init()
