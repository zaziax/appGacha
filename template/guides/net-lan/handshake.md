# 就绪握手（handshake）

## 问题

加入方调 `egg.net.joinRoom()` 返回时，WebRTC DataChannel 可能还没完全打开；即使打开了，房主可能在加入方 ready 之前就广播了初始状态——这条消息就丢了。

## 解法：hello 握手

```
加入方                          房主
  │                              │
  │  joinRoom() 返回             │
  │  room.broadcast(hello)       │
  │ ────────────────────────────► │  收到 hello
  │                              │  → 确认加入方已就绪
  │  room.broadcast(state)       │  → 立即广播完整状态
  │ ◄──────────────────────────── │
  │                              │
  │  渲染初始状态，对局开始       │
```

## 实现要点

### 加入方

```js
async function joinGame(idOrCode) {
  room = await egg.net.joinRoom(idOrCode)
  bindRoom()

  // joinRoom 返回 = DataChannel 已建立，可以安全发消息
  room.broadcast({ type: 'hello', peerId: room.peerId })
}
```

### 房主

```js
room.onMessage((msg, from) => {
  if (msg.type === 'hello') {
    // 此时加入方的 DataChannel 确认双向可通
    // 广播当前完整状态（不管是初始还是中途）
    room.broadcast({ type: 'state', ...gameState })
    // 切换 UI 到对局视图
    startGameUI()
  }
})
```

## 为什么不用 onPeerJoin？

`onPeerJoin` 在房主侧触发时，加入方的 DataChannel **可能还没 open**（信令完成 ≠ 数据通道就绪）。如果房主在 `onPeerJoin` 里就广播状态，消息可能丢失。

**hello 是加入方主动发出的**——它能发出来，就证明 DataChannel 已经 open，房主回复就一定能送达。

## 中途加入（N 人场景）

如果游戏已在进行中，新玩家 hello 进来：

```js
if (msg.type === 'hello') {
  // 分配座位
  assignSeat(from)
  // 广播包含新 players 信息的完整状态
  room.broadcast({ type: 'state', ...gameState, players: [...players] })
}
```

新玩家收到 state 后直接渲染当前局面（旁观或分配到空位）。

## 超时保护

加入方发 hello 后如果 5 秒没收到 state，可以认为连接有问题：

```js
let helloAck = false
room.broadcast({ type: 'hello', peerId: room.peerId })

setTimeout(() => {
  if (!helloAck) {
    egg.ui.toast('连接超时，请重试')
    room.close()
    showLobby()
  }
}, 5000)

// 在 onMessage 里：
if (msg.type === 'state') {
  helloAck = true
  // ...正常渲染
}
```
