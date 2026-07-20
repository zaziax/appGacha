# EGG_GUIDE —— 扭蛋制造规范（智能体必读）

你在为 appGacha 制造一颗"扭蛋"：一个运行在沙箱里的桌面小应用。

## 世界观（不可违背）

1. 蛋是**纯 HTML/CSS/JS**，运行在 Electron 沙箱 webview 里。没有 Node、没有 npm 包、没有构建步骤。
2. 蛋**默认断网**。任何外部 http(s) 引用（CDN 脚本、字体、图片、接口）都会被拦截且导致验收失败。AI 能力一律走 `egg.ai`。
3. 宿主能力只有全局对象 `egg.*`（见 egg.d.ts）。用了 manifest 未声明的能力域会被拒绝。
4. 数据只能落在两处：`egg.storage`（KV）/ `egg.db`（SQLite）；文件用 `egg.fs`（限 data/ 目录）。不要用 localStorage（迁移时会丢）。
5. CSP 禁止内联 `<script>`，所有 JS 必须放外部文件（app.js 等）。内联 style 属性可用。

## 文件布局（保持这个结构）

```
manifest.json   ← 只允许修改 name 和 permissions 两个字段
index.html      ← 入口，引 base.css + style.css + app.js
base.css        ← 基础视觉，不要修改，直接用它的变量和样式
style.css       ← 你的自定义样式写这里
app.js          ← 你的全部逻辑写这里
```

## manifest.permissions 可选值

`storage` `db` `ai` `fs` `notify` `schedule` `window`
——按需最小声明；`egg.ui`（toast/confirm/pickFile/saveFile）免声明。

## 免费可用的 Web 能力

- Web Speech API：`speechSynthesis.speak(new SpeechSynthesisUtterance('hello'))`（TTS 发音，背单词/听写类必备）
- Canvas / SVG：图表与动效
- 拖拽事件与 `<input type="file">`：接收用户文件
- CSS 动画、flex/grid 布局

## 质量守则

- **界面必须开箱即有内容**：空状态要有引导文案，不能白屏。
- **数据必须真实持久化**：刷新/重开后数据仍在（用 egg.db 或 egg.storage，init 时建表用 `CREATE TABLE IF NOT EXISTS`）。
- **AI 能力优雅降级**：捕获 `AI_NOT_CONFIGURED` 开头的错误并 toast 提示"请在收藏柜设置里配置模型"，功能主体不能因此瘫痪。
- **`egg.ai.extract` 优先于 `egg.ai.chat`**：需要结构化结果时永远用 extract + JSON Schema。
- 全部异步调用要 `await` 并 try/catch，错误用 `egg.ui.toast` 反馈给用户。
- 中文界面，文案友好口语化。
- 使用 base.css 的 CSS 变量（--accent 等）保持视觉家族感，style.css 只写增量。

## 愿望格式（用户许愿单可能包含结构化标记）

用户愿望可能包含以下标记，**必须严格遵循**：

- `【需求细节】xxx；yyy` —— 用户确认过的功能要求，视为硬性需求，逐条实现
- `【视觉风格】xxx` —— 视觉调性（如“清爽简约”“活泼可爱”“深色沉浸”“纸质手账”），整体 UI 必须匹配该风格
- `【主色调】xxx系（#hex）` —— 主色必须用指定色值，覆盖 base.css 的 `--accent` 变量（在 style.css 中 `:root { --accent: #hex; }`）

## 验收标准（不达标会被打回）

1. validate：manifest 合法、无禁用 API（require/process/node:）、无外部 http(s) 引用、JS 语法正确
2. test：加载零 console 错误、页面非空白
3. 用户愿望的核心功能真实可用
