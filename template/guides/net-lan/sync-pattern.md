# 主机权威同步范式（sync-pattern）

## 设计原则

在局域网联机蛋中，**房主（Host）是唯一真相源**。这不是建议，是铁律：

- 游戏状态（棋盘、回合、分数、胜负）**只在房主侧修改**
- 加入方永远不直接修改状态，只发"意图请求"
- 房主校验请求合法性后修改状态，再广播完整快照
- 所有客户端（含房主自己）收到快照后**整体覆盖**本地渲染

**为什么不用"各改各的再合并"？** 因为两个浏览器之间没有分布式事务，任何并发修改都会冲突。星型 + 权威节点是最简单可靠的方案。

## 消息流向

```
┌─────────┐                    ┌─────────┐
│  加入方  │                    │  房主    │
│ (白棋)  │                    │ (黑棋)  │
└────┬────┘                    └────┬────┘
     │                              │
     │  { type:'hello' }            │  ← 加入方就绪
     │ ────────────────────────────► │
     │                              │  初始化/重置状态
     │  { type:'state', ... }       │
     │ ◄──────────────────────────── │  ← 广播初始快照
     │                              │
     │  { type:'move', x:3, y:4 }  │  ← 白方落子请求
     │ ────────────────────────────► │
     │                              │  校验(轮到白?位置空?) → 修改board
     │  { type:'state', board, ...} │
     │ ◄──────────────────────────── │  ← 广播新快照（所有人渲染）
     │                              │
     │                              │  房主自己落子（黑棋）
     │  { type:'state', board, ...} │
     │ ◄──────────────────────────── │  ← 直接广播（无需请求自己）
```

## 代码骨架（以五子棋为例）

### 状态定义

```js
// 房主持有的权威状态
let gameState = {
  board: Array(15).fill(null).map(() => Array(15).fill(0)), // 0=空 1=黑 2=白
  turn: 'black',       // 当前该谁下
  winner: null,        // null | 'black' | 'white' | 'draw'
  moveCount: 0
}
```

### 房主侧逻辑

```js
let room = null

async function createGame() {
  room = await egg.net.createRoom('五子棋对战')
  bindRoom()
  showWaiting(room.code)  // UI: 显示房间码，等待加入
}

function bindRoom() {
  room.onMessage((msg, from) => {
    switch (msg.type) {
      case 'hello':
        // 加入方就绪 → 广播当前状态（可能是初始状态或中途加入）
        broadcastState()
        startGame()  // UI: 切换到对局视图
        break
      case 'move':
        handleMoveRequest(msg, from)
        break
      case 'restart-request':
        resetGame()
        broadcastState()
        break
    }
  })

  room.onPeerLeave((peerId) => {
    egg.ui.toast('对手离开了')
    showWaiting(room.code)  // 回到等待状态
  })

  room.onClosed((reason) => {
    egg.ui.toast('房间已关闭')
    showLobby()
  })
}

function handleMoveRequest(msg, from) {
  // 校验：是否轮到加入方（白棋）
  if (gameState.turn !== 'white') return
  if (gameState.winner) return
  // 校验：位置是否合法
  const { x, y } = msg
  if (gameState.board[y][x] !== 0) return

  // 修改权威状态
  gameState.board[y][x] = 2  // 白棋
  gameState.moveCount++
  gameState.winner = checkWin(x, y, 2)
  if (!gameState.winner && gameState.moveCount >= 225) gameState.winner = 'draw'
  gameState.turn = 'black'

  broadcastState()
}

// 房主自己落子（黑棋）—— 不需要发请求，直接改
function hostPlace(x, y) {
  if (gameState.turn !== 'black' || gameState.winner) return
  if (gameState.board[y][x] !== 0) return

  gameState.board[y][x] = 1
  gameState.moveCount++
  gameState.winner = checkWin(x, y, 1)
  if (!gameState.winner && gameState.moveCount >= 225) gameState.winner = 'draw'
  gameState.turn = 'white'

  broadcastState()
}

function broadcastState() {
  room.broadcast({ type: 'state', ...gameState })
}

function resetGame() {
  gameState = {
    board: Array(15).fill(null).map(() => Array(15).fill(0)),
    turn: 'black', winner: null, moveCount: 0
  }
}
```

### 加入方侧逻辑

```js
let room = null

async function joinGame(roomIdOrCode) {
  room = await egg.net.joinRoom(roomIdOrCode)
  bindRoom()
  // 发送就绪信号
  room.broadcast({ type: 'hello', peerId: room.peerId })
  showConnecting()  // UI: 连接中…
}

function bindRoom() {
  room.onMessage((msg, from) => {
    switch (msg.type) {
      case 'state':
        // 收到权威快照 → 覆盖本地渲染
        renderBoard(msg.board)
        renderTurn(msg.turn)
        if (msg.winner) showResult(msg.winner)
        break
      case 'restart':
        renderBoard(msg.board)
        hideResult()
        break
    }
  })

  room.onClosed((reason) => {
    if (reason === 'host-left') egg.ui.toast('房主解散了房间')
    else egg.ui.toast('连接断开')
    showLobby()
  })
}

// 加入方落子 → 只发请求，不修改本地状态
function joinerPlace(x, y) {
  if (!room) return
  room.broadcast({ type: 'move', x, y })
  // 注意：不在这里修改 board！等房主的 state 快照回来再渲染
}
```

## 渲染原则

```js
function renderBoard(board) {
  // 完全根据传入的 board 重绘，不保留任何本地"记忆"
  // 这保证了所有客户端显示一致
}
```

**加入方的 UI 交互**：
- 点击棋盘 → 发 move 请求 → **不做任何本地修改**
- 可以加乐观 UI（先显示半透明预览），但最终以 state 快照为准
- 如果请求被房主拒绝（不合法），快照不会变，UI 自然回退

## 扩展：N 人房间

上述骨架是 1v1，扩展到 N 人只需：

1. 房主维护 `players: Map<peerId, { seat, color }>`
2. 收到 hello → 分配座位 → 广播 state（含 players 信息）
3. move 请求带 peerId → 房主根据座位判断是否轮到该玩家
4. 快照里包含所有玩家信息，客户端根据 `room.peerId` 判断"该不该我操作"

## 注意事项

- `room.broadcast()` 是发给**所有其他人**（不含自己回显），房主自己落子后需要**本地也调一次 renderBoard**
- 消息大小限制 64KB，大状态（如大棋盘）考虑压缩或分片
- 房主校验**永远不能信任加入方的数据**——位置、回合、甚至 peerId 都要验
