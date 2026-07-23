# 局域网联机指南（net-lan）

> 权限域：`network`。API 入口：`egg.net`（见 egg.d.ts 的 EggNet / EggRoom）。

## 核心架构

```
房主（Host）          加入方（Joiner）
  │                      │
  │  egg.net.createRoom  │  egg.net.findRooms / joinRoom
  │                      │
  └──── WebRTC DataChannel（宿主封装，你无需关心） ────┘
  │                      │
  │  room.broadcast()    │  room.broadcast()
  │  room.onMessage(fn)  │  room.onMessage(fn)
  └──────────────────────┘
```

- **星型拓扑**：房主是中心节点，持有权威游戏状态；加入方是叶节点
- **宿主封装全部网络细节**：UDP 发现、TCP 信令、WebRTC 握手、ICE 穿透——蛋代码完全不碰这些
- **蛋只管两件事**：`broadcast(msg)` 发消息、`onMessage(fn)` 收消息

## 房主权威范式（最重要的设计原则）

**永远不要**让双方各自维护独立状态再"同步"——那会导致不一致。正确做法：

1. **房主 = 唯一真相源**：游戏状态只在房主侧修改
2. **加入方发"请求"**：加入方想落子 → broadcast 一个 `{ type: 'move', ... }` 请求
3. **房主校验 + 修改 + 广播快照**：房主收到请求 → 校验合法性 → 修改权威状态 → broadcast 完整状态快照
4. **所有客户端用快照覆盖本地渲染**：收到 state 消息 → 直接替换本地显示

```
加入方                     房主
  │  { type:'move', x, y }  │
  │ ──────────────────────► │  校验 → 修改状态
  │                         │
  │  { type:'state', board, │
  │    turn, winner, ... }  │
  │ ◄────────────────────── │  广播快照（给所有人）
  │                         │
  渲染新状态                 渲染新状态
```

## 消息协议设计

所有消息都是 JSON 对象，用 `type` 字段区分：

```js
// 加入方 → 房主
{ type: 'move', x: 3, y: 4 }        // 落子请求
{ type: 'restart-request' }          // 请求再来一局

// 房主 → 所有人
{ type: 'state', board: [...], turn: 'black', winner: null }  // 状态快照
{ type: 'restart', board: [...], turn: 'black' }              // 新一局开始
```

**原则**：消息尽量小（只发增量请求），快照保证最终一致。

## 生命周期事件

```js
room.onPeerJoin((peerId) => { /* 新成员加入 */ })
room.onPeerLeave((peerId) => { /* 成员离开 */ })
room.onClosed((reason) => {
  // reason: 'host-left' | 'closed' | 'network'
  // host-left = 房主关了房间（解散）
  // closed = 自己调了 room.close()
  // network = 连接异常断开
})
```

## 就绪握手（hello）—— 防初始状态丢失

加入方 DataChannel 打开后，房主可能已经广播过初始状态了。解法：

1. 加入方 `onPeerJoin` 后（或自己 joinRoom 返回后）发 `{ type: 'hello', peerId }`
2. 房主收到 hello → 立即广播当前完整状态快照
3. 加入方收到 state → 渲染，对局正式开始

**详细实现见**：`read_guide('net-lan/handshake')`

## 断线与解散处理

- 房主关窗 / 调 `room.close()` → 所有加入方收到 `onClosed('host-left')`
- 加入方关窗 / 调 `room.close()` → 房主收到 `onPeerLeave(peerId)`
- 网络异常 → 双方收到 `onClosed('network')`

**详细处理见**：`read_guide('net-lan/disconnect')`

## 完整代码骨架

**详细同步范式 + 代码模板见**：`read_guide('net-lan/sync-pattern')`

## UI 设计要点

1. **大厅 → 对局 两阶段**：创建/加入前显示大厅（创建按钮 + 房间列表），进入对局后切换视图
2. **房间列表用 findRooms() 刷新**：按钮触发，展示房间名 + 人数 + 房间码
3. **等待状态有反馈**：房主创建后显示"等待对手加入…" + 房间码；加入方显示"连接中…"
4. **对局结束可再来**：胜负判定后显示结果 + "再来一局"按钮
5. **断线有提示**：onClosed 时 toast 提示并退回大厅

## 常见错误

| 错误 | 后果 | 正确做法 |
|---|---|---|
| 双方各自维护状态 | 不一致、冲突 | 房主权威，快照覆盖 |
| 不等 hello 就开始 | 加入方错过初始状态 | 房主收到 hello 才广播 |
| 用 onMessage 属性赋值 | 回调不生效（contextBridge 限制） | 用 `room.onMessage(fn)` 函数注册 |
| 忘记处理 host-left | 加入方卡在"等待" | onClosed 退回大厅 |
| broadcast 发非 JSON 数据 | 静默失败 | 只发 JSON 可序列化对象 |
