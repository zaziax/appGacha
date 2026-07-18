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

  render()
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
    card.append(word, meaning, hint, actions)
    card.addEventListener('click', () => {
      openId = openId === row.id ? null : row.id
      render()
    })
    list.appendChild(card)
  }
}

init()
