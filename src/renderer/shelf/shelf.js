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

    const upgradeBtn = document.createElement('button')
    upgradeBtn.textContent = '升级'
    upgradeBtn.title = '对着这颗蛋许愿，机芯会在原有基础上改造它'
    upgradeBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      openWishDialog({ eggId: egg.eggId, name: egg.name })
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

    actions.append(openBtn, upgradeBtn, exportBtn, trashBtn)
    if (egg.hasBackup) {
      const restoreBtn = document.createElement('button')
      restoreBtn.textContent = '还原'
      restoreBtn.title = '回到上次升级前的样子（代码和数据一起）'
      restoreBtn.addEventListener('click', async (e) => {
        e.stopPropagation()
        if (!confirm(`把「${egg.name}」还原到最近一次备份？\n（代码和数据一起回到备份时刻）`)) return
        try {
          const res = await shelf.rollback(egg.eggId)
          toast(`「${res.name}」已还原`)
          render()
        } catch (err) { toast(err.message) }
      })
      actions.appendChild(restoreBtn)
    }
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

// ---- 许愿 / 扭蛋进度 ----

const wishMask = document.getElementById('wishMask')
const wishBtn = document.getElementById('wishBtn')
const STAGE_TEXT = {
  coin: '投币…',
  crank: '旋钮转动…',
  clack: '机芯咔咔…',
  pop: '咔哒！',
  fail: '这次没扭出好蛋'
}
let lastEggId = null
// 扭蛋状态独立于弹窗存在，弹窗只是它的一个视图（支持后台挂起）
// upgrade 非空时，本次许愿是对现有蛋的升级改造
const gacha = { running: false, stage: null, detail: '', pane: 'form', upgrade: null }

function setFormWording() {
  const title = document.getElementById('wishFormTitle')
  const sub = document.getElementById('wishFormSub')
  if (gacha.upgrade) {
    title.textContent = `给「${gacha.upgrade.name}」许愿升级 ✦`
    sub.textContent = '说出想改进的地方，机芯会在原有功能和数据的基础上改造它。升级前会自动整蛋备份。'
  } else {
    title.textContent = '许个愿 ✦'
    sub.textContent = '说出你想要的小应用，机芯会为你扭一颗出来。数据、提醒、AI 它都会自带。'
  }
}

function openWishDialog(upgrade) {
  if (gacha.running) {
    toast('机芯正忙，请等这一颗出来')
    return
  }
  gacha.upgrade = upgrade || null
  setFormWording()
  showWishPane('form')
  wishMask.hidden = false
  document.getElementById('wishText').focus()
}

function updateWishBtn() {
  if (gacha.running) {
    wishBtn.textContent = `◓ ${STAGE_TEXT[gacha.stage] || '扭蛋中…'}`
    wishBtn.classList.add('spinning')
  } else {
    wishBtn.textContent = '许个愿 ✦'
    wishBtn.classList.remove('spinning')
  }
}

function updateProgressPane() {
  document.getElementById('stageTitle').textContent = STAGE_TEXT[gacha.stage] || gacha.stage || ''
  document.getElementById('stageDetail').textContent = gacha.detail || ''
}

document.getElementById('wishBtn').addEventListener('click', () => {
  if (gacha.running) {
    showWishPane('progress')
    updateProgressPane()
    wishMask.hidden = false
    return
  }
  if (gacha.pane === 'result') {
    showWishPane('result')
    wishMask.hidden = false
    return
  }
  openWishDialog(null) // 头部按钮永远是"扭新蛋"
})

function showWishPane(which) {
  gacha.pane = which
  document.getElementById('wishForm').hidden = which !== 'form'
  document.getElementById('wishProgress').hidden = which !== 'progress'
  document.getElementById('wishResult').hidden = which !== 'result'
}

document.getElementById('closeWishBtn').addEventListener('click', () => { wishMask.hidden = true })
document.getElementById('bgWishBtn').addEventListener('click', () => { wishMask.hidden = true })

document.getElementById('startWishBtn').addEventListener('click', async () => {
  const text = document.getElementById('wishText').value.trim()
  if (text.length < 2) return
  try {
    if (gacha.upgrade) {
      await shelf.upgrade(gacha.upgrade.eggId, text)
    } else {
      await shelf.wish(text)
    }
    gacha.running = true
    gacha.stage = 'coin'
    gacha.detail = ''
    updateWishBtn()
    showWishPane('progress')
    updateProgressPane()
  } catch (err) {
    toast(err.message)
  }
})

shelf.onGachaProgress((p) => {
  gacha.running = true
  gacha.stage = p.stage
  gacha.detail = p.detail || ''
  updateWishBtn()
  if (!wishMask.hidden) updateProgressPane()
})

shelf.onGachaDone((r) => {
  gacha.running = false
  updateWishBtn()
  const openBtn = document.getElementById('openNewEggBtn')
  const retryBtn = document.getElementById('retryWishBtn')
  if (r.ok) {
    document.getElementById('resultTitle').textContent = r.upgraded
      ? `咔哒！「${r.name}」升级完成 ◓`
      : `咔哒！「${r.name}」出蛋了 ◓`
    document.getElementById('resultDetail').textContent = r.upgraded
      ? '数据完好，代码焕然一新（不满意可在蛋卡片上「还原」）'
      : '已放进你的收藏柜'
    lastEggId = r.eggId
    openBtn.hidden = false
    retryBtn.hidden = true
    render()
    if (wishMask.hidden) toast(r.upgraded ? `咔哒！「${r.name}」升级完成` : `咔哒！「${r.name}」出蛋了，已入柜`)
  } else {
    document.getElementById('resultTitle').textContent = r.upgraded ? '这次升级没成…' : '这次没扭出好蛋…'
    document.getElementById('resultDetail').textContent = (r.error || '') +
      (r.upgraded ? '（蛋还是原来的样子，没有被动过）' : '')
    openBtn.hidden = true
    retryBtn.hidden = false
    if (wishMask.hidden) toast(r.upgraded ? '这次升级没成，点许愿按钮看详情' : '这次没扭出好蛋，点许愿按钮看详情')
  }
  // 结果面板就位：弹窗开着立即可见，后台挂起则下次点许愿按钮看到
  showWishPane('result')
})

document.getElementById('openNewEggBtn').addEventListener('click', () => {
  if (lastEggId) shelf.open(lastEggId).catch(err => toast(err.message))
  gacha.pane = 'form'
  gacha.upgrade = null
  wishMask.hidden = true
})

document.getElementById('retryWishBtn').addEventListener('click', () => {
  setFormWording() // 升级失败重试仍是对同一颗蛋
  showWishPane('form')
})
document.getElementById('closeResultBtn').addEventListener('click', () => {
  gacha.pane = 'form'
  gacha.upgrade = null
  wishMask.hidden = true
})

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
