/**
 * appGacha Bridge API v1 (hostApiVersion: "1")
 * 蛋的全部宿主能力。调用未在 manifest.permissions 声明的能力域会被拒绝。
 */

interface EggStorage {
  /** 读取键值，不存在返回 null。权限域: storage */
  get(key: string): Promise<unknown>
  /** 写入键值（任意可 JSON 序列化的值）。权限域: storage */
  set(key: string, value: unknown): Promise<void>
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
}

interface EggBridge {
  hostApiVersion: '1'
  storage: EggStorage
  db: EggDb
  ai: EggAi
  fs: EggFs
  notify: EggNotify
  schedule: EggSchedule
  window: EggWindow
  ui: EggUi
}

declare const egg: EggBridge
