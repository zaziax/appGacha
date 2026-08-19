import { getSpace, spaceAdd, spaceRemove, spaceReorder, spaceActivate, spaceSetBounds, spaceSetVisible, onSpaceFocusEvent } from '../space'
import { sendToShelf } from '../shelfWindow'
import { handle } from './ipc'

export function registerSpaceChannels(): void {
  // 空间聚焦事件 → 推送收藏柜 UI 切到空间视图（space.ts 不直依 shelfWindow）
  onSpaceFocusEvent(eggId => sendToShelf('space:focusEgg', { eggId }))

  handle('space:get', () => getSpace())

  handle('space:add', (eggId) => spaceAdd(eggId as string))

  handle('space:remove', (eggId) => spaceRemove(eggId as string))

  handle('space:reorder', (ids) => spaceReorder(ids))

  handle('space:activate', (eggId) => spaceActivate(eggId as string))

  // 右侧内容区 bounds（UI ResizeObserver 上报，窗口内容坐标）
  handle('space:setBounds', (b) => spaceSetBounds(b))

  // UI 切入/切出空间 tab
  handle('space:setVisible', (v) => spaceSetVisible(v === true))
}
