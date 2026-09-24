import React from 'react'
import { createRoot } from 'react-dom/client'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

const wait = () => new Promise(resolve => setTimeout(resolve, 40))
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message) }
const host = document.createElement('div')
host.style.transform = 'translateX(0)'
document.body.append(host)
const root = createRoot(host)
const button = (text: string) => {
  const found = [...document.querySelectorAll('button')].find(el => el.textContent === text)
  assert(found, `Missing button: ${text}`)
  return found
}
const key = (value: string, shiftKey = false) => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: value, shiftKey, bubbles: true, cancelable: true }))

;(window as any).runDialogTests = async () => {
  await i18n.use(initReactI18next).init({ lng: 'en', resources: { en: { translation: { confirm: { cancel: 'Cancel', ok: 'OK' } } } } })
  let discarded = 0, openedSettings = 0, parentEscapes = 0
  let storageError = ''
  let failDiscard = false
  const status = { enabled: true, running: true, connections: [], drafts: [{ id: 'draft-1', name: 'Focus timer', state: 'draft' }] }
  ;(window as any).shelf = {
    mcpStatus: async () => status, onMcpChanged: () => () => {},
    mcpDiscard: async (id: string) => { assert(id === 'draft-1', 'Wrong draft'); discarded++; if (failDiscard) throw new Error('Draft locked'); return { ...status, drafts: [] } },
    eggStorageStatus: async () => ({ error: storageError, available: !storageError }),
  }
  window.confirm = () => { throw new Error('Native confirm called') }
  window.alert = () => { throw new Error('Native alert called') }
  const { McpPanel } = await import('../src/ui/src/components/McpPanel')
  const { EggStorageNotice } = await import('../src/ui/src/components/EggStorageNotice')
  const { ConfirmDialog } = await import('../src/ui/src/components/ConfirmDialog')
  async function render(node: React.ReactNode) { root.render(node); await wait() }
  const passed: string[] = []
  await render(<McpPanel />)
  await wait()
  const trigger = button('Remove draft'); trigger.focus(); trigger.click(); await wait()
  assert(discarded === 0, 'Opening confirmation deleted draft')
  assert(document.querySelector('[data-appgacha-confirm]')?.parentElement === document.body, 'Dialog trapped inside Settings transform/scroll layer')
  assert(document.querySelector('[role="alertdialog"]')?.textContent?.includes('Focus timer'), 'Draft not identified')
  const parentKey = (e: KeyboardEvent) => { if (e.key === 'Escape') parentEscapes++ }
  window.addEventListener('keydown', parentKey)
  key('Tab'); assert(document.activeElement?.textContent === 'Cancel', 'Focus did not wrap inside dialog')
  key('Tab', true); assert(document.activeElement?.textContent === 'Remove draft', 'Reverse focus trap failed')
  key('Escape'); await wait()
  assert(!document.querySelector('[role="alertdialog"]') && !parentEscapes && !discarded, 'Escape closed Settings or deleted draft')
  assert(document.activeElement === trigger, 'Focus not restored')
  passed.push('MCP dialog portal, keyboard focus and Escape isolation')
  trigger.click(); await wait(); button('Cancel').click(); await wait()
  assert(!discarded, 'Cancel deleted draft')
  trigger.click(); await wait()
  ;(document.querySelector('[data-appgacha-confirm]') as HTMLElement).click(); await wait()
  assert(!discarded && !document.querySelector('[role="alertdialog"]'), 'Backdrop cancellation failed')
  trigger.click(); await wait()
  ;(document.querySelector('[role="alertdialog"] button:last-child') as HTMLButtonElement).click(); await wait()
  assert(discarded === 1 && !document.querySelector('[role="alertdialog"]'), 'Confirmed deletion did not run exactly once')
  passed.push('MCP cancel/backdrop preserve draft; confirm deletes exactly once')
  await render(null); failDiscard = true
  await render(<McpPanel />); await wait(); button('Remove draft').click(); await wait()
  ;(document.querySelector('[role="alertdialog"] button:last-child') as HTMLButtonElement).click(); await wait()
  assert(document.querySelector('[role="alert"]')?.textContent === 'Draft locked', 'Async failure not shown')
  passed.push('MCP deletion errors remain in application UI')
  await render(null)
  await render(<EggStorageNotice onOpenSettings={() => openedSettings++} />); await wait()
  assert(!document.querySelector('[role="alertdialog"]'), 'Healthy storage showed warning')
  await render(null); storageError = 'Library unavailable: ' + 'long/path/'.repeat(50)
  await render(<EggStorageNotice onOpenSettings={() => openedSettings++} />); await wait()
  button('Open Settings').click(); await wait()
  assert(openedSettings === 1 && !document.querySelector('[role="alertdialog"]'), 'Warning did not open Settings')
  passed.push('Storage warning is pulled after mount and opens Settings; healthy startup is silent')
  await render(null)
  await i18n.changeLanguage('zh')
  await render(<EggStorageNotice onOpenSettings={() => openedSettings++} />); await wait()
  button('稍后处理').click(); await wait()
  assert(openedSettings === 1 && !document.querySelector('[role="alertdialog"]'), 'Later opened Settings')
  passed.push('Chinese storage warning and Later dismissal')
  // Parent rerenders must not reset the currently focused Cancel button.
  await render(<ConfirmDialog title="Test" message="Long detail" onConfirm={() => {}} onCancel={() => {}} />)
  const cancel = document.querySelector('[role="alertdialog"] button') as HTMLButtonElement
  cancel.focus()
  await render(<ConfirmDialog title="Test updated" message="Long detail" onConfirm={() => {}} onCancel={() => {}} />)
  assert(document.activeElement === cancel, 'Background polling stole focus')
  passed.push('Background rerender does not steal keyboard focus')
  await render(null)
  window.removeEventListener('keydown', parentKey)
  return passed
}
