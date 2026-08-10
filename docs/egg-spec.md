# .gacha 格式规范（草案 v1）

> `.gacha` 是主应用与扭蛋机芯之间的契约：运行时按它加载，扭蛋机芯按它生成，蛋管理器按它迁移。

## 1. 目录结构

```
背单词.gacha/                ← 运行态：一个文件夹（后缀 .gacha，类似 macOS .app）
├── manifest.json            ← 蛋的身份证
├── index.html               ← 入口，唯一约定
├── (其余 js/css/assets 随意)
└── data/
    └── egg.db               ← SQLite，运行时生成，迁移时随蛋带走

背单词.gacha                 ← 分发态：单个 ZIP 文件（同后缀），内容为蛋目录平铺
```

- 蛋是纯 HTML/CSS/JS，无 Node 环境、无 node_modules。
- `data/` 是蛋唯一可写的目录，数据与代码同居一蛋，拷贝即迁移。
- 分发态 ZIP 由收藏柜「导出」生成（含 data = 整蛋迁移）；双击 .gacha 文件即导入。

## 2. manifest.json

```json
{
  "eggId": "uuid",
  "name": "背单词",
  "version": "1.0.0",
  "hostApiVersion": "1",
  "permissions": ["ai", "db", "notify", "schedule"],
  "wish": "我想要一个背单词软件，能记住我背过哪些",
  "createdBy": { "model": "deepseek-v4", "pipelineVersion": "0.1" }
}
```

| 字段 | 说明 |
|---|---|
| `eggId` | 全局唯一，蛋的终身身份 |
| `hostApiVersion` | 蛋面向的 bridge API 版本。蛋是长寿命资产，第一天就版本化 |
| `permissions` | 申请的能力域清单，加载/导入时向用户展示，未声明的 bridge 调用被拒绝 |
| `wish` | 用户原始愿望原文。"许愿升级"时与现有代码一起喂给扭蛋机芯（决策 D5） |
| `createdBy` | 制造留档：模型与管线版本，用于统计出蛋质量 |

## 3. Bridge API v1

蛋通过 preload 注入的全局对象 `egg` 使用能力。所有接口异步（Promise）。

### egg.ai — 天生 AI

```js
egg.ai.chat(messages, { stream })      // 原始对话，聊天类功能
egg.ai.extract(text, jsonSchema)       // 结构化提取：文本进，合规 JSON 出
```

- `extract` 是重点：粘贴文本→结构化入库（记账、课表解析）全靠它，且对生成可靠性极友好——智能体写"extract 拿固定 schema JSON 然后入库"几乎不会错。
- 主应用侧：每蛋限速与消费额度；离线/欠费时返回明确错误码，蛋优雅降级。
- 蛋拿不到 key，模型通道由主应用代持（用户自配或托管）。

### egg.db — SQLite

```js
egg.db.exec(sql, params)               // 写
egg.db.query(sql, params)              // 读
```

每蛋独占 `data/egg.db`，连接由主应用代持。

### egg.storage — KV

```js
egg.storage.get(key) / set(key, value) / delete(key)
```

覆盖 80% 小应用的持久化需求。

### egg.fs — 蛋内文件

```js
egg.fs.read(path) / write(path, content) / list(dir)
```

路径严格限定在蛋的 `data/` 目录内；content 仅支持 utf-8 字符串，单文件上限 10MB。

### egg.notify + egg.schedule — 提醒类刚需

```js
egg.notify.send(title, body)
egg.schedule.set(id, cron, { title, body })   // upsert；蛋关着也会触发，点击通知打开蛋
egg.schedule.cancel(id)
egg.schedule.list()
```

- v1 为静态通知文案方案：注册时文案定死，Main 直接发系统通知（决策见 docs/runtime.md 第 4 节）
- 登记持久化在蛋的 `data/schedule.json`——**提醒随蛋迁移**；主应用启动时扫描所有蛋装弹
- 每蛋上限 20 条；蛋被删除时全部拆除

### egg.ui — 统一交互

```js
egg.ui.toast(msg) / confirm(msg)
egg.ui.pickFile(filters) / saveFile(content, defaultName)
```

`pickFile`/`saveFile` 是用户手势触发的系统文件对话框——沙箱外数据进出的唯一安全逃生口（参照浏览器 File System Access 模式）。注意 `pickFile` 返回的是 `{ name, content }` 内容本体而非路径——蛋没有资格持有沙箱外的路径。

### egg.window — 窗口控制

```js
egg.window.setAlwaysOnTop(bool)
egg.window.setSize(w, h)
```

番茄钟/桌面挂件类的刚需。

## 4. 免费赠品（webview 天然可用，写进智能体文档）

- **Web Speech API**：TTS 发音——背单词刚需，零成本
- Canvas / SVG：图表与动效
- 拖拽文件读取、`<input type="file">`

## 5. v2 候选（等愿望单逼出来再加）

`egg.http`（域名白名单）、剪贴板、托盘、全局快捷键、`egg.ai.embed`（本地知识检索）。

每加一个能力域 = 一份智能体能读的文档 + `egg.d.ts` 类型声明更新 + `hostApiVersion` 语义化递增。

## 6. 权限模型

- manifest 声明制：`permissions` 未声明的能力域，bridge 调用直接拒绝。
- 导入/加载外来蛋时向用户展示权限清单（"这个蛋想要：AI、通知、定时任务"）。
- 为将来蛋的分享/市场预留安全底座。

## 7. 生命周期约定

- **制造**：扭蛋机芯按本规范生成，经 validate（schema + 静态检查）与 test（无头运行）后入收藏柜。
- **升级**：仅通过主应用"许愿升级"入口（决策 D5），升级前自动整蛋备份，涉及 schema 变更时扭蛋机芯负责迁移脚本。
- **迁移**：拷贝 `.egg` 文件夹到任意装有主应用（hostApiVersion 兼容）的设备即可加载。
