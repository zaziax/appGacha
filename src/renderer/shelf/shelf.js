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
  toast('扭蛋机芯还在建设中，很快就能许愿了 ✦')
})

render()
