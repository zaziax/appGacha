/* AppGacha Widget Shell：固定画布内的轻量页面栈。 */

export function createWidgetShell(root = document.querySelector('[data-widget-shell]')) {
  if (!(root instanceof HTMLElement)) return null
  if (root.dataset.widgetReady === 'true') return root.__widgetShell ?? null

  const pages = new Map()
  root.querySelectorAll('[data-widget-page]').forEach(page => {
    if (page instanceof HTMLElement && page.dataset.widgetPage) pages.set(page.dataset.widgetPage, page)
  })
  if (pages.size === 0) return null

  const initial = [...pages.values()].find(page => page.dataset.active === 'true')?.dataset.widgetPage
    ?? pages.keys().next().value
  const stack = [initial]

  const render = () => {
    const current = stack[stack.length - 1]
    for (const [name, page] of pages) {
      const active = name === current
      page.dataset.active = String(active)
      page.setAttribute('aria-hidden', String(!active))
      if (active) page.removeAttribute('inert')
      else page.setAttribute('inert', '')
    }
    root.dataset.widgetCurrentPage = current
    root.dispatchEvent(new CustomEvent('widget:pagechange', { detail: { page: current } }))
  }

  const go = name => {
    if (!pages.has(name) || stack[stack.length - 1] === name) return false
    stack.push(name)
    render()
    return true
  }

  const back = () => {
    if (stack.length <= 1) return false
    stack.pop()
    render()
    return true
  }

  const home = () => {
    stack.splice(1)
    render()
  }

  root.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target : null
    const goButton = target?.closest('[data-widget-go]')
    if (goButton instanceof HTMLElement) {
      event.preventDefault()
      go(goButton.dataset.widgetGo)
      return
    }
    if (target?.closest('[data-widget-back]')) {
      event.preventDefault()
      back()
    }
  })

  const onKeyDown = event => {
    if (event.key === 'Escape') back()
  }
  window.addEventListener('keydown', onKeyDown)

  const api = { go, back, home, pages: () => [...pages.keys()], current: () => stack[stack.length - 1] }
  Object.defineProperty(root, '__widgetShell', { value: api, configurable: true })
  root.dataset.widgetReady = 'true'
  render()
  return api
}

const boot = () => document.querySelectorAll('[data-widget-shell]').forEach(root => createWidgetShell(root))
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true })
else boot()

