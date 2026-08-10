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
7. **语言**：蛋内所有用户可见文案（`<title>`、界面文字、提示语、按钮）必须使用**愿望的语言**——用户用英文许愿就生成英文应用，中文许愿就生成中文应用。代码内部（变量名、注释）不受此限。

## 文件布局

```
manifest.json        ← 只允许修改 name、permissions、window 三个字段
index.html           ← 入口，<script type="module" src="app.js">
app.js               ← 主模块（ES Module），可 import 其他模块
src/                 ← 可选，复杂应用自行拆分（视图、工具、状态）
style.css            ← 你的自定义样式写这里（永远单文件）
icon.svg             ← 应用图标（必须创建，收藏柜展示用）
base.css             ← 宿主设计系统，不要修改，直接用它的变量和组件 class
icons.svg            ← 宿主图标库（Lucide sprite），不要修改
icons-manifest.json  ← 全部可用图标名清单
vendor/              ← 宿主预置的第三方 ESM 库（不要修改，按需 import）
```

- 模块一律 ES Module（`import` / `export`），禁止全局变量挂载式伪模块化
- 简单应用（<500 行逻辑）鼓励单 app.js，复杂应用可拆 src/ 子模块

## 应用图标（icon.svg）——必须创建

每颗蛋必须附带一个 `icon.svg`，展示在收藏柜的扭蛋球体内，是用户区分不同应用的视觉标识。

**规格：**

- `viewBox="0 0 48 48"`，无固定 width/height（宿主控制尺寸）
- 扁平简洁的几何图形，**2~3 色以内**，主色取自应用配色（与 style.css 的 --accent 一致）
- 图形必须与应用主题相关（记账→钱袋、时钟→表盘、宠物→爪印……）
- 24px 缩小后仍可辨认——细节少、轮廓粗、留白足
- **禁止**：文字、emoji、位图嵌入（<image>）、滤镜、动画、外部引用
- 背景透明，图形居中，四周留 4px 安全边距

**示例（番茄钟）：**

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
  <circle cx="24" cy="26" r="16" fill="#E53935"/>
  <path d="M24 10c-2-4 2-7 2-7s6 2 4 7" fill="#43A047"/>
  <rect x="22" y="18" width="4" height="10" rx="2" fill="#fff"/>
  <rect x="22" y="24" width="8" height="4" rx="2" fill="#fff"/>
</svg>
```

## 应用壳布局（index.html 结构）

```html
<body class="app-shell">
  <div class="toolbar">              ← 工具栏：导航/标签页/操作按钮（禁止放应用名标题）
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

宿主会在顶部注入 38px 标题栏（含应用名 + 最小化/最大化/关闭），应用名取自 `<title>`——**`<title>` 必须写应用名；toolbar 里禁止再放 h1 应用名，名字出现两次是低级错误。** 你的 toolbar 在宿主栏下方，只承载导航与操作。**仅 standard 窗口如此；widget 窗口不注入标题栏。**

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
- **widget**：透明无边框悬浮组件。宿主不注入标题栏，整个窗口透明。**widget 内部还有两种截然不同的范式，选错范式会毁掉整个体验——务必先读下一节。**

### widget 两范式：先回答一个分水岭问题

> **把内容直接扔到任意一张壁纸上，还能看清吗？**
>
> - 看不清（文字、列表、按钮、数字）→ **容器型**：必须有一块背景承托
> - 看得清（自发光、自带轮廓的视觉实体）→ **悬浮实体型**：不该有任何背景

这不是「2D 用容器、3D 用实体」——2D 的桌面宠物是「看」的对象，照样走实体型；3D 的数据面板是「读」的信息，照样走容器型。**判断依据是「读」还是「看」，不是维度。**

#### 范式 A：容器型（要读的信息）

典型：悬浮 TODO、便签、时钟、倒计时、计算器、番茄钟。

1. **半透明毛玻璃底**：`background: rgba(...)` + `backdrop-filter: blur(...)`——文字有对比度可读，又透出底下壁纸的色调，保持悬浮感。**不要用实心不透明色块**，那是一块铁板。
2. **形状必须非矩形**：`border-radius: 50%` 圆形、`border-radius: 999px` 胶囊、`clip-path: polygon(...)` 异形。一旦容器是撑满窗口的直角矩形，它就退化成一个普通窗口，widget 的存在意义归零。
3. **光晕/阴影收敛在形状内**：box-shadow 可以加在圆角形状上，但**容器不要顶满窗口边缘**——任何贴到窗口边缘的像素都会被方形窗口裁切，暴露出「这其实是个方窗」。

#### 范式 B：悬浮实体型（要看的实体）

典型：3D 太阳系、3D 模型展示、桌面宠物、悬浮星球。**这是本项目区别于网页托管的魔法时刻——实体直接悬浮在用户壁纸上，透明区域看到桌面。** 设计哲学：桌面即背景，无界即设计。

四条铁律（违反任何一条都会杀死漂浮感）：

1. **只画愿望里的实体**：许愿太阳系就只有太阳和行星。**禁止**添加星空、粒子、渐变底色等一切「氛围装饰」——桌面壁纸是唯一的背景，你加的每一粒「星空」都是多余的。
2. **零容器**：承载 canvas 的容器必须全透明，**禁止** background、border、box-shadow（含光晕）。光晕会被方形窗口裁切，反而把窗口边界「描」出来。
3. **不贴窗口边缘**：实体居中央，四周保留透明缓冲区，**撑满或溢出窗口是大忌**（3D 取景数学见下方 three.js 避坑第一条）。贴边的像素会被窗口裁切，暴露边界。
4. **WebGL 透明**：`new THREE.WebGLRenderer({ alpha: true })` + `scene.background = null`。

three.js 避坑（你看不见渲染结果，以下每条都要靠数学在生成时自我验证）：

- **实体必须完整入画（撑满/溢出是大忌）**：对半径 R 的球体、垂直 FOV θ 的相机，相机距离需满足 **d ≥ R / sin(θ/2) × 1.4**（实体约占窗口 70%，留 30% 透明边距）。例：地球 R=1.4、FOV 28° → d ≥ 1.4/sin(14°)×1.4 ≈ 8，相机放 z≈8，**绝不是 3.2**（3.2 会让地球撑爆窗口、只剩局部表面）。非球体用包围球半径代入，渲染前务必心算一遍这个不等式。
- **光照单位变了（r155+ 物理光照）**：r155+ 默认物理光照，PointLight 按距离平方反比衰减。旧教程的 `intensity: 2.2` 在新版下照到物体上约等于 0，整个场景漆黑。必须 `decay = 0`（禁用衰减）或把强度提到 20000+。AmbientLight 强度 1~2 即可。
- **比例要风格化**：桌面展示不是天文模拟。实体要夸张放大（行星直径 ≥ 轨道半径的 1/10），别把「真实比例」塞进小窗口——那只会得到一堆看不见的点。
- **标签要可读**：名称 sprite 要足够大，颜色与壁纸有对比。

### 选型参考

| 愿望举例 | 形态 | 范式 | 尺寸建议 |
|---|---|---|---|
| 记账本、记事本、背单词 | standard | — | 900×640（默认，可省略） |
| 计算器 | standard | — | 380×520 |
| 悬浮 TODO、便签、备忘录 | widget | 容器型 | 280×380 |
| 悬浮时钟、倒计时、番茄钟、迷你计数器 | widget | 容器型 | 240×240 |
| 3D 太阳系、3D 模型、桌面宠物、悬浮星球 | widget | 悬浮实体型 | 320~480 |

### widget 通用要点（两范式都适用）

1. **body 背景必须透明**：`body { background: transparent; }`
2. **不用画窗口控制按钮**：用户悬停窗口时右上角自动浮现控制钮（关闭/置顶），这是宿主提供的安全出口，**不要移除它**
3. **悬浮类应用建议 `alwaysOnTop: true`**（时钟/计时器/宠物/星体）
4. 尺寸钳制 240~1600，越界声明会被自动纠正；widget 宁小勿大
5. widget 内容精简，一屏内呈现核心信息，不要滚动条
6. **透明度只用于「窗口的洞」，绝不用于「内容」**：
   - body/容器背景可以透明——那是让桌面透出来的洞
   - 容器型底板可以半透明毛玻璃，但 alpha 不低于 0.55（再低文字就没有承托了）
   - 文字、数字、图标、实体本身必须 `opacity: 1`（rgba 的 alpha ≥ 0.9），禁止把「透明悬浮」的设计风格泛化到内容上
   - 验收标准：把 widget 想象成放在纯黑和纯白两张壁纸上，内容都必须清晰可读

## 桌面应用设计准则（核心）

**你不是在排版网页，你是在设计一个桌面应用。** 遵守以下准则：

1. **撑满窗口**：布局占满整个视口（base.css 的 app-shell 已处理），绝不居中窄栏；toolbar/actionbar 必须矩形贴边，禁止给它们加 margin/圆角做成浮动卡片
2. **层次分明**：toolbar（导航/操作）→ content（主内容）→ actionbar（主操作），像原生应用
3. **禁止重复标题**：应用名只出现在 `<title>` 和宿主标题栏，toolbar 内不得再放 h1 应用名
4. **图标代替文字**：操作按钮用图标（+、设置、返回），不要写"添加""设置"等纯文字按钮
5. **禁止 emoji**：任何场景都不允许出现 emoji 字符，用 `<svg class="icon"><use href="icons.svg#name">` 代替
6. **即时反馈**：按钮点击有 :active 缩放、加载有 spinner、操作有 toast
7. **空状态有温度**：没有数据时展示引导插画（用图标组合）+ 行动按钮，不要白屏
8. **暗色模式兼容**：使用 base.css 的 CSS 变量（--bg、--card、--text 等），不要硬编码颜色值
9. **紧凑信息密度**：桌面应用比网页信息密度更高，善用 list-item、card、badge 组织内容

## 图标库（Lucide SVG sprite）

用法：

```html
<svg class="icon"><use href="icons.svg#clock"></use></svg>
<svg class="icon sm"><use href="icons.svg#check"></use></svg>
<svg class="icon lg"><use href="icons.svg#settings"></use></svg>
```

class 尺寸：`.icon`（20px）`.icon.sm`（16px）`.icon.lg`（24px）`.icon.xl`（32px）

高频图标（优先使用此处列表，覆盖 90% 场景。如需特殊图标，在一次 search_icon 调用中批量搜索所有关键词，如 search_icon({ keywords: ["fingerprint", "cloud-moon", "badge-check"] })；不要逐词分多次调用，不要 read_file 读 icons-manifest.json）：

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
import Chart from './vendor/chart.esm.js'           // 数据可视化（全部图表类型已自动注册，new Chart 直接可用）
import dayjs from './vendor/dayjs.esm.js'           // 日期计算（替代原生 Date）
import { marked } from './vendor/marked.esm.js'     // Markdown → HTML
import QRCode from './vendor/qrcode.esm.js'         // 二维码生成
import confetti from './vendor/canvas-confetti.esm.js' // 庆祝动效
import * as THREE from './vendor/three.module.js'   // 3D 场景
```

使用原则：
- **禁止 read_file 读取 vendor/ 下的库文件**：它们体积巨大（数百 KB 至 MB 级），读取会耗尽你的上下文窗口。上方导入写法已经宿主验证、保证可用——如果运行报错，问题在你自己的代码，不要试图通过读 vendor 文件来“研究导出模式”
- Chart.js 已自动注册所有 controllers/elements/scales，`new Chart(canvas, { type: 'doughnut' | 'bar' | 'line' | 'pie' | 'radar' | ... })` 直接生效，**不需要任何 register 调用**
- Chart.js 宿主壳内高频坑（每条都曾导致线上空白）：
  - canvas 的父容器必须有显式高度（如 `height: 220px`），否则 Chart.js 渲染 0px——页面有内容但图表区域空白
  - 切换 tab / 重绘前先 `chartInstance.destroy()`，再 new 新实例；重复 new 会抛 canvas 占用错误
  - 数据为空时不要渲染空图表——展示空状态提示（图表区域全白会被用户认为 bug）
- 日期计算**永远用 dayjs**，不要用原生 Date（月份从 0 开始、无 addDays 等坑）
- 需要图表时**永远用 Chart.js**，不要手画 canvas 图表
- 3D 场景注意性能：widget 类帧率目标 30fps，面数 ≤ 5 万，避免后处理特效栈
- CSV 解析不需要库：`text.split('\n').map(r => r.split(','))` + 首行表头映射即可

## manifest.permissions 可选值

`storage` `db` `ai` `fs` `notify` `schedule` `window` `network`
——按需最小声明；`egg.ui`（toast/confirm/pickFile/saveFile）免声明。
`network`：局域网联机（`egg.net.createRoom/findRooms/joinRoom`，房间抽象，宿主封装全部网络细节）。

## 能力指南（read_guide）

复杂能力有专属深度指南，**实现前必须先调用 `read_guide` 读取**，否则极易写错架构：

| 能力 | 指南路径 | 何时读 |
|---|---|---|
| 局域网联机 | `net-lan` | 愿望涉及多人、对战、联机、局域网、房间 |

用法：`read_guide('net-lan')` 读总纲，`read_guide('net-lan/sync-pattern')` 读具体章节。
**如果愿望涉及上表中的能力，第一个工具调用就应该是 read_guide，而不是 write_file。**

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
- `【视觉风格】xxx` —— 视觉调性建议（可能包含圆角/边框/阴影/色彩浓度等具体参数），整体 UI 必须匹配该风格描述
- `【主色调】#hex（色相 N°），配色=配方名：辅色…；派生规则` —— 主色必须用指定色值，覆盖 base.css 的 `--accent` 变量（在 style.css 中 `:root { --accent: #hex; }`）；若指定了辅色，将其用于次要元素/图标点缀/强调色（按括号内角色说明）；浅色/深色派生按分号后规则生成

## 验收标准（不达标会被打回）

1. validate：manifest 合法、无禁用 API（require/process/node:）、无外部 http(s) 引用、JS 语法正确、**无 emoji 字符**
2. test：加载零 console 错误、页面非空白
3. 用户愿望的核心功能真实可用
4. 界面像桌面应用而非网页（toolbar 贴边无重复标题、撑满窗口、使用图标而非 emoji）
