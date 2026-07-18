/* 收藏柜渲染层 —— 素颜版，只做陈列/打开/导入/导出/删除 */

let toastTimer = null

function toast(msg) {
  const el = document.getElementById('toast')
  el.textContent = msg
  el.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { el.hidden = true }, 2600)
}

async function render() {
  const eggs = await shelf.list()
  const grid = document.getElementById('grid')
  grid.innerHTML = ''
  document.getElementById('emptyState').hidden = eggs.length > 0

  for (const egg of eggs) {
    const card = document.createElement('div')
    card.className = 'egg-card'
    card.title = `双击打开「${egg.name}」`

    const top = document.createElement('div')
    top.className = 'egg-top'

    const icon = document.createElement('div')
    icon.className = 'egg-icon'
    icon.textContent = egg.name.slice(0, 1)

    const nameBox = document.createElement('div')
    const name = document.createElement('div')
    name.className = 'egg-name'
    name.textContent = egg.name
    const version = document.createElement('div')
    version.className = 'egg-version'
    version.textContent = `v${egg.version} · ${egg.folder}`
    nameBox.append(name, version)
    top.append(icon, nameBox)

    const wish = document.createElement('div')
    wish.className = 'egg-wish'
    wish.textContent = egg.wish || '（这颗蛋没有留下愿望）'

    const perms = document.createElement('div')
    perms.className = 'egg-perms'
    for (const p of egg.permissions) {
      const chip = document.createElement('span')
      chip.className = 'perm'
      chip.textContent = p
      perms.appendChild(chip)
    }

    const actions = document.createElement('div')
    actions.className = 'egg-actions'

    const openBtn = document.createElement('button')
    openBtn.textContent = '打开'
    openBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      shelf.open(egg.eggId).catch(err => toast(err.message))
    })

    const exportBtn = document.createElement('button')
    exportBtn.textContent = '导出'
    exportBtn.addEventListener('click', async (e) => {
      e.stopPropagation()
      try {
        const res = await shelf.export(egg.eggId)
        if (res.exported) toast(`「${egg.name}」已导出，拷给朋友吧`)
      } catch (err) { toast(err.message) }
    })

    const trashBtn = document.createElement('button')
    trashBtn.className = 'danger'
    trashBtn.textContent = '删除'
    trashBtn.addEventListener('click', async (e) => {
      e.stopPropagation()
      if (!confirm(`把「${egg.name}」放进回收站？\n（蛋和它的数据一起，可从回收站找回）`)) return
      try {
        await shelf.trash(egg.eggId)
        toast(`「${egg.name}」已放进回收站`)
        render()
      } catch (err) { toast(err.message) }
    })

    actions.append(openBtn, exportBtn, trashBtn)
    card.append(top, wish, perms, actions)
    card.addEventListener('dblclick', () => {
      shelf.open(egg.eggId).catch(err => toast(err.message))
    })
    grid.appendChild(card)
  }
}

document.getElementById('importBtn').addEventListener('click', async () => {
  try {
    const res = await shelf.import()
    if (res.imported) {
      toast(`「${res.name}」已入柜！`)
      render()
    }
  } catch (err) { toast(err.message) }
})

document.getElementById('wishBtn').addEventListener('click', () => {
  showWishPane('form')
  wishMask.hidden = false
  document.getElementById('wishText').focus()
})

// ---- 许愿 / 扭蛋进度 ----

const wishMask = document.getElementById('wishMask')
const STAGE_TEXT = {
  coin: '投币…',
  crank: '旋钮转动…',
  clack: '机芯咔咔…',
  pop: '咔哒！',
  fail: '这次没扭出好蛋'
}
let lastEggId = null

function showWishPane(which) {
  document.getElementById('wishForm').hidden = which !== 'form'
  document.getElementById('wishProgress').hidden = which !== 'progress'
  document.getElementById('wishResult').hidden = which !== 'result'
}

document.getElementById('closeWishBtn').addEventListener('click', () => { wishMask.hidden = true })

document.getElementById('startWishBtn').addEventListener('click', async () => {
  const text = document.getElementById('wishText').value.trim()
  if (text.length < 2) return
  try {
    await shelf.wish(text)
    showWishPane('progress')
    document.getElementById('stageTitle').textContent = STAGE_TEXT.coin
    document.getElementById('stageDetail').textContent = ''
  } catch (err) {
    toast(err.message)
  }
})

shelf.onGachaProgress((p) => {
  if (wishMask.hidden) return
  document.getElementById('stageTitle').textContent = STAGE_TEXT[p.stage] || p.stage
  document.getElementById('stageDetail').textContent = p.detail || ''
})

shelf.onGachaDone((r) => {
  showWishPane('result')
  const openBtn = document.getElementById('openNewEggBtn')
  const retryBtn = document.getElementById('retryWishBtn')
  if (r.ok) {
    document.getElementById('resultTitle').textContent = `咔哒！「${r.name}」出蛋了 ◓`
    document.getElementById('resultDetail').textContent = '已放进你的收藏柜'
    lastEggId = r.eggId
    openBtn.hidden = false
    retryBtn.hidden = true
    render()
  } else {
    document.getElementById('resultTitle').textContent = '这次没扭出好蛋…'
    document.getElementById('resultDetail').textContent = r.error || ''
    openBtn.hidden = true
    retryBtn.hidden = false
  }
})

document.getElementById('openNewEggBtn').addEventListener('click', () => {
  if (lastEggId) shelf.open(lastEggId).catch(err => toast(err.message))
  wishMask.hidden = true
})

document.getElementById('retryWishBtn').addEventListener('click', () => showWishPane('form'))
document.getElementById('closeResultBtn').addEventListener('click', () => { wishMask.hidden = true })

// ---- 模型设置弹窗 ----

const mask = document.getElementById('settingsMask')
const statusEl = document.getElementById('aiStatus')

function setStatus(text, cls) {
  statusEl.textContent = text
  statusEl.className = cls || ''
}

document.getElementById('settingsBtn').addEventListener('click', async () => {
  setStatus('')
  document.getElementById('aiKey').value = ''
  try {
    const s = await shelf.getAiSettings()
    if (s) {
      document.getElementById('aiBaseURL').value = s.baseURL
      document.getElementById('aiModel').value = s.model
      document.getElementById('aiKey').placeholder = s.hasKey ? '已保存（留空沿用）' : 'sk-…'
    }
  } catch { /* 首次无配置 */ }
  mask.hidden = false
})

document.getElementById('closeSettingsBtn').addEventListener('click', () => { mask.hidden = true })
mask.addEventListener('click', (e) => { if (e.target === mask) mask.hidden = true })

document.getElementById('saveAiBtn').addEventListener('click', async () => {
  try {
    await shelf.saveAiSettings({
      baseURL: document.getElementById('aiBaseURL').value,
      model: document.getElementById('aiModel').value,
      apiKey: document.getElementById('aiKey').value
    })
    setStatus('已保存', 'ok')
    toast('模型配置已保存')
  } catch (err) { setStatus(err.message, 'err') }
})

document.getElementById('testAiBtn').addEventListener('click', async () => {
  setStatus('测试中…')
  try {
    const res = await shelf.testAi()
    setStatus(`连接成功：${res.reply}`, 'ok')
  } catch (err) { setStatus(err.message, 'err') }
})

render()
