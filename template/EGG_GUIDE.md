# EGG_GUIDE —— 扭蛋制造规范（智能体必读）

你在为 appGacha 制造一颗"扭蛋"：一个运行在沙箱里的**桌面小应用**。
注意：你设计的是**桌面应用**，不是网页。它有自己的窗口、工具栏、操作区，像原生应用一样撑满整个窗口。

## 世界观（不可违背）

1. 蛋是**纯 HTML/CSS/JS（ES Module）**，运行在 Electron 沙箱 webview 里。没有 Node、没有 npm、没有构建步骤。
2. 蛋**默认断网**。任何外部 http(s) 引用（CDN 脚本、字体、图片、接口）都会被拦截且导致验收失败。AI 能力一律走 `egg.ai`。
3. 宿主能力只有全局对象 `egg.*`（见 egg.d.ts）。用了 manifest 未声明的能力域会被拒绝。
4. 数据只能落在两处：`egg.storage`（KV）/ `egg.db`（SQLite）；文件用 `egg.fs`（限 data/ 目录）。不要用 localStorage（迁移时会丢）。
5. CSP 禁止内联 `<script>`，所有 JS 必须放外部文件。内联 style 属性可用。
6. **禁止使用 emoji**。所有图标一律使用内置 Lucide 图标库（见下文）。

## 文件布局

```
manifest.json        ← 只允许修改 name、permissions、window 三个字段
index.html           ← 入口，<script type="module" src="app.js">
app.js               ← 主模块（ES Module），可 import 其他模块
src/                 ← 可选，复杂应用自行拆分（视图、工具、状态）
style.css            ← 你的自定义样式写这里（永远单文件）
base.css             ← 宿主设计系统，不要修改，直接用它的变量和组件 class
icons.svg            ← 宿主图标库（Lucide sprite），不要修改
icons-manifest.json  ← 全部可用图标名清单
vendor/              ← 宿主预置的第三方 ESM 库（不要修改，按需 import）
```

- 模块一律 ES Module（`import` / `export`），禁止全局变量挂载式伪模块化
- 简单应用（<500 行逻辑）鼓励单 app.js，复杂应用可拆 src/ 子模块

## 应用壳布局（index.html 结构）

```html
<body class="app-shell">
  <div class="toolbar">              ← 顶栏：标题 + 操作按钮
    <h1 id="appTitle">应用名</h1>
    <div class="spacer"></div>
    <button class="icon-btn">…</button>
  </div>
  <div class="content" id="app">     ← 唯一滚动区域：你的全部界面
    …
  </div>
  <div class="actionbar">            ← 可选底栏：主操作按钮
    …
  </div>
</body>
```

宿主会在顶部注入 38px 标题栏（含最小化/最大化/关闭），你的 toolbar 在它下方。**仅 standard 窗口如此；widget 窗口不注入标题栏。**

## 窗口形态（manifest.window）—— 桌面应用的核心差异

在 manifest.json 用 `window` 字段声明窗口形态。**这是你区别于网页生成器的关键能力——主动为应用选择合适的窗口，而不是千篇一律的大方窗。**

```json
{
  "window": {
    "type": "widget",
    "width": 240,
    "height": 240,
    "alwaysOnTop": true
  }
}
```

### 两种形态

- **standard**（默认，可省略）：带标题栏的常规窗口，布局撑满窗口（用上面的应用壳结构）。适合大多数应用。
- **widget**：透明无边框悬浮组件。宿主不注入标题栏，整个窗口透明——**你要用 CSS 自绘形状**（圆、胶囊、clip-path 异形）。适合悬浮时钟、倒计时、桌面宠物、迷你计时器。

### 选型参考

| 愿望举例 | 形态 | 尺寸建议 |
|---|---|---|
| 记账本、记事本、背单词 | standard | 900×640（默认，可省略） |
| 计算器 | standard | 380×520 |
| 悬浮时钟、倒计时、番茄钟 | widget | 240×240 |
| 桌面宠物、迷你计数器 | widget | 240~320 |

### widget 设计要点

1. **body 背景必须透明**：`body { background: transparent; }`，给你的主体容器加背景色/圆角/阴影形成形状
2. **形状自由**：`border-radius: 50%` 圆形、`border-radius: 999px` 胶囊、`clip-path: polygon(...)` 异形
3. **不用画窗口控制按钮**：用户悬停窗口时右上角自动浮现控制钮（关闭/置顶），这是宿主提供的安全出口，**不要移除它**
4. **悬浮类应用建议 `alwaysOnTop: true`**（时钟/计时器/宠物）
5. 尺寸钳制 240~1600，越界声明会被自动纠正；widget 宁小勿大
6. widget 内容精简，一屏内呈现核心信息，不要滚动条

## 桌面应用设计准则（核心）

**你不是在排版网页，你是在设计一个桌面应用。** 遵守以下准则：

1. **撑满窗口**：布局占满整个视口（base.css 的 app-shell 已处理），绝不居中窄栏
2. **层次分明**：toolbar（标题/导航）→ content（主内容）→ actionbar（主操作），像原生应用
3. **图标代替文字**：操作按钮用图标（+、设置、返回），不要写"添加""设置"等纯文字按钮
4. **禁止 emoji**：任何场景都不允许出现 emoji 字符，用 `<svg class="icon"><use href="icons.svg#name">` 代替
5. **即时反馈**：按钮点击有 :active 缩放、加载有 spinner、操作有 toast
6. **空状态有温度**：没有数据时展示引导插画（用图标组合）+ 行动按钮，不要白屏
7. **暗色模式兼容**：使用 base.css 的 CSS 变量（--bg、--card、--text 等），不要硬编码颜色值
8. **紧凑信息密度**：桌面应用比网页信息密度更高，善用 list-item、card、badge 组织内容

## 图标库（Lucide SVG sprite）

用法：

```html
<svg class="icon"><use href="icons.svg#clock"></use></svg>
<svg class="icon sm"><use href="icons.svg#check"></use></svg>
<svg class="icon lg"><use href="icons.svg#settings"></use></svg>
```

class 尺寸：`.icon`（20px）`.icon.sm`（16px）`.icon.lg`（24px）`.icon.xl`（32px）

高频图标（完整清单见 icons-manifest.json，可 read_file 查询）：

- 导航：home settings menu arrow-left arrow-right chevron-down chevron-up external-link
- 操作：plus minus x check pencil trash-2 copy download upload search refresh-cw
- 状态：check-circle alert-triangle info x-circle loader clock bell
- 文件数据：file folder image camera database save hard-drive
- 媒体：play pause skip-forward volume-2 music mic video
- 通信：message-circle mail phone send share-2
- 工具：calendar sun moon star heart eye eye-off lock unlock key qr-code
- 图表：bar-chart-3 pie-chart trending-up activity
- 用户：user users log-in log-out
- 其他：zap flame gift coffee sun cloud cloud-rain leaf

## 预置库（vendor/）

按需 import，未使用的库不会打包进最终蛋：

```js
import Chart from './vendor/chart.esm.js'           // 数据可视化
import dayjs from './vendor/dayjs.esm.js'           // 日期计算（替代原生 Date）
import { marked } from './vendor/marked.esm.js'     // Markdown → HTML
import QRCode from './vendor/qrcode.esm.js'         // 二维码生成
import confetti from './vendor/canvas-confetti.esm.js' // 庆祝动效
import * as THREE from './vendor/three.module.js'   // 3D 场景
```

使用原则：
- 日期计算**永远用 dayjs**，不要用原生 Date（月份从 0 开始、无 addDays 等坑）
- 需要图表时**永远用 Chart.js**，不要手画 canvas 图表
- 3D 场景注意性能：widget 类帧率目标 30fps，面数 ≤ 5 万，避免后处理特效栈
- CSV 解析不需要库：`text.split('\n').map(r => r.split(','))` + 首行表头映射即可

## manifest.permissions 可选值

`storage` `db` `ai` `fs` `notify` `schedule` `window`
——按需最小声明；`egg.ui`（toast/confirm/pickFile/saveFile）免声明。

## 免费可用的 Web 能力

- Web Speech API：`speechSynthesis.speak(new SpeechSynthesisUtterance('hello'))`（TTS 发音）
- Canvas / SVG：图表与动效
- 拖拽事件与 `<input type="file">`：接收用户文件
- CSS 动画、flex/grid 布局

## 质量守则

- **界面必须开箱即有内容**：空状态要有引导文案和图标，不能白屏
- **数据必须真实持久化**：刷新/重开后数据仍在（用 egg.db 或 egg.storage，init 时建表用 `CREATE TABLE IF NOT EXISTS`）
- **AI 能力优雅降级**：捕获 `AI_NOT_CONFIGURED` 开头的错误并 toast 提示"请在收藏柜设置里配置模型"，功能主体不能因此瘫痪
- **`egg.ai.extract` 优先于 `egg.ai.chat`**：需要结构化结果时永远用 extract + JSON Schema
- 全部异步调用要 `await` 并 try/catch，错误用 `egg.ui.toast` 反馈给用户
- 中文界面，文案友好口语化
- 使用 base.css 的 CSS 变量和组件 class（toolbar、card、list-item、segment、switch、fab、badge 等），style.css 只写增量

## 愿望格式（用户许愿单可能包含结构化标记）

用户愿望可能包含以下标记，**必须严格遵循**：

- `【需求细节】xxx；yyy` —— 用户确认过的功能要求，视为硬性需求，逐条实现
- `【视觉风格】xxx` —— 视觉调性（如"清爽简约""活泼可爱""深色沉浸""纸质手账"），整体 UI 必须匹配该风格
- `【主色调】xxx系（#hex）` —— 主色必须用指定色值，覆盖 base.css 的 `--accent` 变量（在 style.css 中 `:root { --accent: #hex; }`）

## 验收标准（不达标会被打回）

1. validate：manifest 合法、无禁用 API（require/process/node:）、无外部 http(s) 引用、JS 语法正确、**无 emoji 字符**
2. test：加载零 console 错误、页面非空白
3. 用户愿望的核心功能真实可用
4. 界面像桌面应用而非网页（有 toolbar、撑满窗口、使用图标而非 emoji）
