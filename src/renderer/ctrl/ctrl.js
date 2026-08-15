// widget 卫星控制窗的页面脚本。跑在沙箱渲染层，只能通过 preload 暴露的 window.ctrl
// 这几个窄动作与主进程通信——没有 require、没有 Node，与蛋代码享受同一套隔离约束。
'use strict'

const pin = document.getElementById('pin')
const close = document.getElementById('close')
const grip = document.getElementById('grip')

pin.addEventListener('click', () => window.ctrl.pin())
close.addEventListener('click', () => window.ctrl.close())
window.ctrl.onPinState(onTop => pin.classList.toggle('pinned', !!onTop))

document.documentElement.addEventListener('mouseenter', () => window.ctrl.enter())
document.documentElement.addEventListener('mouseleave', () => window.ctrl.leave())

// 握把自定义拖动：pointerdown 上报开始（指针捕获保证松手事件不丢），pointerup 上报结束
grip.addEventListener('pointerdown', e => {
  e.preventDefault()
  grip.setPointerCapture(e.pointerId)
  grip.classList.add('dragging')
  window.ctrl.dragStart()
})
const endDrag = e => {
  if (!grip.classList.contains('dragging')) return
  grip.classList.remove('dragging')
  if (grip.hasPointerCapture(e.pointerId)) grip.releasePointerCapture(e.pointerId)
  window.ctrl.dragEnd()
}
grip.addEventListener('pointerup', endDrag)
grip.addEventListener('pointercancel', endDrag)
