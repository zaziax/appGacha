# 断线与解散处理（disconnect）

## 三种关闭场景

| 场景 | 触发方式 | 对方收到 |
|---|---|---|
| 房主解散 | 房主关窗 / `room.close()` | 加入方 `onClosed('host-left')` |
| 加入方离开 | 加入方关窗 / `room.close()` | 房主 `onPeerLeave(peerId)` |
| 网络异常 | WiFi 断、进程崩溃 | 双方 `onClosed('network')` |

## 加入方处理

```js
room.onClosed((reason) => {
  switch (reason) {
    case 'host-left':
      egg.ui.toast('房主解散了房间')
      break
    case 'network':
      egg.ui.toast('网络连接断开')
      break
    case 'closed':
      // 自己主动关的，不需要提示
      break
  }
  // 统一：清理对局 UI，退回大厅
  room = null
  showLobby()
})
```

## 房主处理

```js
room.onPeerLeave((peerId) => {
  egg.ui.toast('对手离开了')
  // 选项 A：回到等待状态，等新玩家加入
  resetGame()
  showWaiting(room.code)
  // 选项 B：如果是 N 人房，从 players 里移除该 peerId，广播新状态
})

room.onClosed((reason) => {
  // 房主侧 onClosed 只在自己 close 或网络异常时触发
  if (reason === 'network') egg.ui.toast('网络异常，房间已关闭')
  room = null
  showLobby()
})
```

## UI 状态机

```
大厅(lobby) ──创建──► 等待(waiting) ──hello──► 对局(playing) ──结束──► 结算(result)
    │                     │                        │                      │
    │◄── host-left ───────┘                        │◄── peerLeave ────────┘
    │◄── network ──────────────────────────────────┘
    │◄── 用户关闭 ─────────────────────────────────────────────────────────┘
```

**关键**：任何断线事件都要能把 UI 从当前状态拉回大厅，不能卡死在"等待"或"对局"。

## 关窗自动清理

宿主在蛋窗口关闭时会自动调用 `room.close()`（如果蛋没手动关），所以：

- 房主关窗 → 宿主自动解散房间 → 加入方收到 host-left
- 加入方关窗 → 宿主自动离开 → 房主收到 peerLeave

蛋代码**不需要**在 `beforeunload` 里手动 close（宿主已处理），但**必须**在 onClosed/onPeerLeave 里清理 UI 状态。

## 防御性编程

```js
// 所有 room 操作前检查 room 是否还存在
function safeBroadcast(msg) {
  if (room) room.broadcast(msg).catch(() => {})
}

// onMessage 里忽略已关闭房间的消息（理论上不会收到，但防御性处理）
room.onMessage((msg, from) => {
  if (!room) return
  // ...正常处理
})
```
