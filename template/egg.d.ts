/**
 * appGacha Bridge API v1 (hostApiVersion: "1")
 * 蛋的全部宿主能力。调用未在 manifest.permissions 声明的能力域会被拒绝。
 */

interface EggStorage {
  /** 读取键值，不存在返回 null。权限域: storage */
  get(key: string): Promise<unknown>
  /** 写入键值（任意可 JSON 序列化的值）。权限域: storage */
  set(key: string, value: unknown): Promise<void>
  /** 原子批量写入多个键；初始化多项数据时优先使用。权限域: storage */
  setMany(entries: Record<string, unknown>): Promise<void>
  /** 删除键。权限域: storage */
  delete(key: string): Promise<void>
}

interface EggDb {
  /** 执行写语句（CREATE/INSERT/UPDATE/DELETE），? 占位参数。权限域: db */
  exec(sql: string, params?: unknown[]): Promise<{ changes: number; lastInsertRowid: number }>
  /** 执行查询，返回行对象数组。权限域: db */
  query(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]>
}

interface EggAi {
  /**
   * 对话补全，返回助手回复文本。权限域: ai
   * 注意处理错误：AI_NOT_CONFIGURED（用户未配置模型）时应优雅降级。
   */
  chat(
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
    opts?: { temperature?: number; maxTokens?: number }
  ): Promise<string>
  /**
   * 结构化提取：输入文本 + JSON Schema，返回符合 schema 的对象。权限域: ai
   * 这是最稳的 AI 用法，优先于让模型自由输出后自行解析。
   */
  extract(text: string, schema: object): Promise<unknown>
}

interface EggFs {
  /** 读取蛋内 data/ 下的文本文件。权限域: fs */
  read(path: string): Promise<string>
  /** 写入蛋内 data/ 下的文本文件，自动建目录。权限域: fs */
  write(path: string, content: string): Promise<void>
  /** 列出 data/ 下目录。权限域: fs */
  list(path?: string): Promise<{ name: string; isDir: boolean }[]>
  /** 读取蛋内 data/ 下的文件为字节数组。权限域: fs */
  readBytes(path: string): Promise<Uint8Array>
  /** 写入字节到蛋内 data/ 下的文件，自动建目录。权限域: fs */
  writeBytes(path: string, bytes: Uint8Array): Promise<void>
}

interface EggZip {
  /** 把一组 { name, data } 打成 zip 字节（内存进出，不落盘）。权限域: zip。name 用 / 分隔。 */
  create(entries: { name: string; data: Uint8Array }[]): Promise<Uint8Array>
  /** 解压 zip 字节为一组 { name, data }。权限域: zip。目录条目自动跳过。 */
  extract(data: Uint8Array): Promise<{ name: string; data: Uint8Array }[]>
}

interface EggNotify {
  /** 立即发送系统通知。权限域: notify */
  send(title: string, body: string): Promise<void>
}

interface EggSchedule {
  /**
   * 注册/覆盖定时提醒（标准 5 段 cron，本地时区）。蛋关闭也会触发，点击通知会打开蛋。
   * 权限域: schedule。每蛋最多 20 条。
   * 例：每天 20:30 → set('daily', '30 20 * * *', { title: '...', body: '...' })
   */
  set(id: string, cron: string, notification: { title: string; body: string }): Promise<void>
  /** 取消提醒。权限域: schedule */
  cancel(id: string): Promise<void>
  /** 列出全部提醒。权限域: schedule */
  list(): Promise<{ id: string; cron: string; title: string; body: string }[]>
}

interface EggWindow {
  /** 窗口置顶开关。权限域: window */
  setAlwaysOnTop(flag: boolean): Promise<void>
  /** 调整窗口尺寸（会被夹逼到合理范围）。权限域: window */
  setSize(width: number, height: number): Promise<void>
}

interface EggUi {
  /** 轻提示，自动消失。免权限 */
  toast(message: string): void
  /** 确认框，返回用户选择。免权限 */
  confirm(message: string): Promise<boolean>
  /**
   * 系统文件选择框（用户手势触发）。返回 { name, content } 或用户取消时 null。
   * 返回内容本体而非路径。免权限，10MB 上限，仅文本文件。
   */
  pickFile(filters?: { name: string; extensions: string[] }[]): Promise<{ name: string; content: string } | null>
  /** 系统保存框，把文本内容存到用户选择的位置。免权限 */
  saveFile(content: string, defaultName?: string): Promise<{ saved: boolean }>
  /** 系统文件选择框，返回二进制内容 { name, bytes }。免权限，10MB 上限。表格/图片文件进出的入口 */
  pickBinary(filters?: { name: string; extensions: string[] }[]): Promise<{ name: string; bytes: Uint8Array } | null>
  /** 系统保存框，把字节写到你选择的位置（图片/表格导出等）。免权限 */
  saveBinary(bytes: Uint8Array, defaultName?: string): Promise<{ saved: boolean }>
}

/** 局域网房间发现信息 */
interface EggRoomInfo {
  id: string
  /** 4 位房间码（防混淆字符集） */
  code: string
  name: string
  peerCount: number
}

/** 已加入的房间。事件通过函数注册式订阅（room.onMessage(fn)）。 */
interface EggRoom {
  id: string
  code: string
  /** 本机在此房间的身份 */
  peerId: string
  isHost: boolean
  /** 当前已连接的其它成员（实时维护） */
  peers: string[]
  /** 广播 JSON 可序列化消息给房间所有其他成员（不含自己回显）。单条 ≤64KB */
  broadcast(msg: unknown): Promise<void>
  /** 关闭/离开房间。房主关闭 = 房间解散 */
  close(): Promise<void>
  /** 注册「收到他人广播的消息」回调 */
  onMessage(fn: (msg: unknown, peerId: string) => void): void
  /** 注册「新成员加入」回调 */
  onPeerJoin(fn: (peerId: string) => void): void
  /** 注册「成员离开」回调 */
  onPeerLeave(fn: (peerId: string) => void): void
  /** 注册「房间关闭」回调：host-left=房主解散，closed=自己关闭，network=连接断开 */
  onClosed(fn: (reason: 'host-left' | 'closed' | 'network') => void): void
}

interface EggNet {
  /**
   * 创建房间（本机为房主）。房间自动对局域网可见。
   * 权限域: network。每房最多 8 人。
   */
  createRoom(name: string): Promise<EggRoom>
  /** 发现局域网内的房间列表。权限域: network */
  findRooms(): Promise<EggRoomInfo[]>
  /** 加入房间（房间 id 或 4 位房间码均可）。权限域: network */
  joinRoom(idOrCode: string): Promise<EggRoom>
}

interface EggBridge {
  hostApiVersion: '1'
  storage: EggStorage
  db: EggDb
  ai: EggAi
  fs: EggFs
  zip: EggZip
  notify: EggNotify
  schedule: EggSchedule
  window: EggWindow
  ui: EggUi
  net: EggNet
}

declare const egg: EggBridge
