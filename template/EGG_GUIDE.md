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

宿主在 standard 窗口顶部注入 38px 标题栏（含应用名 + 窗口控制），应用名取自 `<title>`。**`<title>` 必须写应用名；但不要在应用内容区重复显示应用名。**

**经典三段式**（推荐，适合大多数工具型应用）：

```html
<body class="app-shell">
  <div class="toolbar">              ← 操作区：导航/标签页/操作按钮
    <div class="spacer"></div>
    <button class="icon-btn">…</button>
  </div>
  <div class="content" id="app">     ← 主内容区
    …
  </div>
  <div class="actionbar">            ← 可选底栏：主操作按钮
    …
  </div>
</body>
```

**这不是唯一答案。** 根据应用的实际需要，你有权做不同的结构选择：

- **游戏**：body 直接作为画布容器，UI 控件（暂停/分数/重来）overlay 在画布上——不需要 toolbar
- **简洁工具**（计算器、番茄钟）：可以只有 content + 底部操作按钮——不需要 toolbar
- **桌面时钟/widget**：完全不携带 chrome——窗口即内容
- 无论你选什么结构，操作入口清晰、信息层次分明即可

**沉浸式布局避开标题栏（游戏/3D/全屏画布必读）**

standard 窗口的 38px 标题栏是 `position: fixed` 覆盖在顶部，`body` 的 `padding-top` 只对文档流生效——**`position: fixed/absolute`、`100vh`、`window.innerHeight` 都锚定视口、无视 padding，会把顶部控件和画布顶到标题栏底下。**

- 全屏画布/场景容器：套 `.fullscreen`（base.css 已提供），或 `position: fixed; top: var(--titlebar-h, 38px); right: 0; bottom: 0; left: 0`
- 顶部悬浮控件（计分/HUD/工具栏）：`top: calc(var(--titlebar-h, 38px) + 12px)`，**禁止裸 `top: 12px`**
- 画布尺寸：JS 里取容器 `clientWidth` / `clientHeight`，**禁止用 `window.innerHeight` 或 `100vh` 当内容高度**
- widget 窗口无标题栏（无 `--titlebar-h`），以上规则不适用

**硬要求（不可违背）**：`<title>` 写应用名、禁止在 toolbar/content 标题区重复应用名、standard 窗口宿主栏自动提供关闭/退出机制。**仅 standard 窗口如此；widget 窗口不注入标题栏。**

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
- **widget**：透明无边框悬浮组件。宿主不注入标题栏，整个窗口的物理画布仍是矩形，但用户只能看到你有意绘制的实体。**形状和长宽比例自由，边界与交互行为严格受限。**

### widget 的成功标准：隐藏物理窗口，服从有限画布

widget 可以是圆形时钟、纵向 TODO、横向状态条、不规则宠物或 3D 实体。不要从形状判断它是不是 widget；判断标准是它是否常驻、可扫视、可直接操作，并且所有状态完整生活在固定画布内。

四项行为契约（任何 widget 都必须满足）：

1. **边界契约**：所有可见像素（实体、阴影、光晕、动画）完整位于窗口内；禁止在矩形边缘突然截断。
2. **可读性契约**：信息区域在纯黑、纯白、复杂壁纸和文字页面上都清晰；透明只用于实体外的「洞」，不穿透需要阅读的内容。
3. **交互可达契约**：每个按钮、菜单和设置项都能完整显示或通过受控滚动抵达；`body` 和根容器绝不溢出。
4. **状态契约**：次级功能优先原位换页；不能保证完整入画的 popover、下拉菜单和 dialog 一律禁止。

### 必须使用 Widget Shell（形状无关）

模板已提供受保护的 `widget.css` 和 `widget.js`。创建 widget 时必须：

```html
<link rel="stylesheet" href="base.css">
<link rel="stylesheet" href="widget.css">
<link rel="stylesheet" href="style.css">
...
<body class="widget-body">
  <main class="widget-shell" data-widget-shell>
    <div class="widget-surface" data-widget-surface>
      <section class="widget-page" data-widget-page="main" data-active="true">
        <!-- 核心信息与直接操作 -->
        <button data-widget-go="settings" aria-label="设置">...</button>
      </section>
      <section class="widget-page" data-widget-page="settings">
        <header class="widget-page-header">
          <button class="widget-back" data-widget-back aria-label="返回">...</button>
          <span class="widget-page-title">设置</span>
        </header>
        <div class="widget-scroll"><!-- 设置项，可受控滚动 --></div>
      </section>
    </div>
  </main>
  <script type="module" src="widget.js"></script>
  <script type="module" src="app.js"></script>
</body>
```

- `widget-shell` 固定并裁切在透明 BrowserWindow 内。
- `widget-surface` 默认与窗口边缘相距 14px，这是透明安全带；通过 CSS 变量可以增加，禁止减到 8px 以下。
- `widget-page` 是固定画布内的页面；`data-widget-go` / `data-widget-back` 由 `widget.js` 管理换页，Esc 也会返回。
- `widget-scroll` 是唯一推荐的溢出方式。列表可以滚动，整个窗口和 surface 不滚动。
- 可自由覆盖 `--widget-surface-radius`、宽高、`clip-path`、颜色和布局；模板不限制最终形状。
- 悬浮实体给 `widget-surface` 加 `widget-entity`，取消默认底板，但继续使用安全边界与页面能力。
- manifest 必须明确声明 width / height；widget 只有 96px 的宿主技术下限，不使用形状模板限制比例。
- **禁止修改 `widget.css` / `widget.js`**；个性化样式全部写在 `style.css`。

### 信息容器与悬浮实体

先问：把内容直接放到任意壁纸上还能看清吗？

- 文字、列表、按钮、数字等需要阅读 → 使用有底板的 `widget-surface`。
- 宠物、3D 模型、星球等主要是观看的实体 → 使用 `widget-entity`，实体外全透明。

信息容器要求：

- 主底板默认接近不透明，alpha 建议 `0.92~0.98`；**禁止将「透明窗口」误解成「内容半透明」**。
- 不依赖 `backdrop-filter` 保证可读性；它在透明 Electron 窗口上不能跨平台可靠模糊桌面。
- 文字、数字、图标与实体本身 `opacity: 1`，文字颜色 alpha ≥ 0.9。
- 圆、方、长方形、条状和自定义 `clip-path` 都合法；长方形 TODO 是完全合理的 widget。

悬浮实体要求：

- 只画愿望里的实体，不添加假背景、星空或铺满画布的氛围层。
- canvas 和容器全透明，禁止 background、border、外部阴影。
- WebGL 使用 `new THREE.WebGLRenderer({ alpha: true })` 和 `scene.background = null`。

### 阴影与透明安全带

- widget 默认禁止大范围外部 `box-shadow` 和 `filter: drop-shadow()`；优先使用细描边、内阴影和实体内部渐变。
- 必须使用外阴影时：blur ≤ 8px、alpha ≤ 0.18，并把 `--widget-safe-inset` 提高到至少 18px。
- 可见实体大小不等于 BrowserWindow 大小。希望看到 240px 实体时，应申请约 276~288px 的窗口，为透明安全带预留空间。
- 动画的最大缩放、位移和粒子也计入可见边界，不能只验证静止帧。

### 有限画布的交互哲学

- 第一页只呈现一个主要价值和少量直接操作（glance first）。
- 设置优先替换当前页面，不在实体外另弹矩形面板。
- 小量设置用原位页面；较多设置放进 `.widget-scroll`；复杂文本输入或深层管理应改用 standard 窗口。
- 菜单不是绝对禁止，但只有能证明在所有位置、所有状态下完整位于安全区域内时才可使用；否则换页。
- 根页面禁止滚动条；受控滚动区域必须有足够的视觉暗示，并能滚到最后一个操作项。
- widget 保持稳定占位，`egg.window.setSize()` 不得用于补救设计不下的菜单。

three.js 避坑（你看不见渲染结果，以下每条都要靠数学在生成时自我验证）：

- **实体必须完整入画（撑满/溢出是大忌）**：对半径 R 的球体、垂直 FOV θ 的相机，相机距离需满足 **d ≥ R / sin(θ/2) × 1.4**（实体约占窗口 70%，留 30% 透明边距）。例：地球 R=1.4、FOV 28° → d ≥ 1.4/sin(14°)×1.4 ≈ 8，相机放 z≈8，**绝不是 3.2**（3.2 会让地球撑爆窗口、只剩局部表面）。非球体用包围球半径代入，渲染前务必心算一遍这个不等式。
- **光照单位变了（r155+ 物理光照）**：r155+ 默认物理光照，PointLight 按距离平方反比衰减。旧教程的 `intensity: 2.2` 在新版下照到物体上约等于 0，整个场景漆黑。必须 `decay = 0`（禁用衰减）或把强度提到 20000+。AmbientLight 强度 1~2 即可。
- **比例要风格化**：桌面展示不是天文模拟。实体要夸张放大（行星直径 ≥ 轨道半径的 1/10），别把「真实比例」塞进小窗口——那只会得到一堆看不见的点。
- **标签要可读**：名称 sprite 要足够大，颜色与壁纸有对比。

### 选型参考（只是建议，不是形状或尺寸许可表）

| 愿望举例 | 形态 | 表面 | 尺寸建议 |
|---|---|---|---|
| 记账本、记事本、背单词 | standard | — | 900×640（默认，可省略） |
| 计算器 | standard | — | 380×520 |
| 悬浮 TODO、便签、备忘录 | widget | 信息容器 | 300×420～380×560，列表内部滚动 |
| 悬浮时钟、倒计时、番茄钟 | widget | 信息容器 | 260×260～320×320 |
| 横向状态、快捷控制 | widget | 信息容器 | 320×100～520×160 |
| 3D 模型、桌面宠物、悬浮星球 | widget | 悬浮实体 | 320～520 |

### widget 通用要点

1. `body` 使用 `widget-body`，背景由 `widget.css` 强制透明。
2. 不用画关闭、置顶和拖动按钮；宿主 hover 控制条负责这些安全出口。
3. 悬浮类应用建议 `alwaysOnTop: true`。
4. 尺寸按内容自由选择；不要过度放大，但必须为透明安全带留足空间。
5. 第一屏精简；长列表放进 `.widget-scroll`，不是强塞进一屏。
6. 验收前必须逐个进入所有 `data-widget-page`，确认没有内容不可达或边界裁切。

## 桌面应用设计准则

**你不是在排版网页，你是在设计一个桌面应用。** 以下原则帮助你摆脱「网页感」，但具体执行由你判断：

1. **图标优先于文字按钮**：操作按钮尽量用图标（+、设置、返回），文字按钮只在空间充裕或含义必须明确时使用
2. **禁止 emoji**：任何场景都不允许出现 emoji 字符，用 `<svg class="icon"><use href="icons.svg#name">` 代替
3. **空状态有温度**：没有数据时展示引导插画（用图标组合）+ 行动按钮，不要白屏
4. **暗色模式兼容**：使用 base.css 的 CSS 变量（--bg、--card、--text 等），不要硬编码颜色值
5. **即时反馈**：按钮点击有反馈、加载有状态、操作有结果提示
6. **结构服务于功能**：游戏不需要 toolbar，时钟不需要三段式——让应用类型决定结构，而非模板决定一切

## 色彩哲学

**`【主色调】` 是强调色，不是唯一色。** 这是当前色彩系统最容易被误解的地方。

- **强调色占比**：按钮、链接、图标焦点、品牌点缀——约占 UI 面积的 10~25%。不要用强调色涂满每一个像素
- **中性色是主体**：≥60% 的 UI 面积应该是中性色（白色面板、浅灰底色、深色文字）。base.css 的 --bg、--card、--text 等变量已经提供了完整的中性色体系
- **内容自有其颜色**：天空是蓝的、草地是绿的、图表需要多种颜色来区分数据——不要让强调色覆盖内容的自然色彩。Flappy Bird 的小鸟不需要是用户选的主色调
- **语义色独立于主色调**：成功 ≈ 绿色、警告 ≈ 橙黄、错误 ≈ 红色、信息 ≈ 蓝色——这些有独立的功能含义，不应被主色调覆盖
- **游戏和创意类应用**：色彩自由度最高。内容的美学需求优先于上述比例约束——如果一款太空射击游戏需要霓虹紫激光，那就用霓虹紫

`--accent` 是起点，不是终点。

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
import * as math from './vendor/math.esm.js'        // 数学计算（公式求值、单位换算、矩阵）
import * as Diff from './vendor/jsdiff.esm.js'      // 文本对比
import { load as loadYaml, dump as dumpYaml } from './vendor/jsyaml.esm.js' // YAML 解析/格式化
import ExcelJS from './vendor/exceljs.esm.js'       // Excel(.xlsx)/CSV 读写
import pdfMake from './vendor/pdfmake.esm.js'       // PDF 生成（已内置默认字体）
import Matter from './vendor/matter.esm.js'         // 2D 物理引擎
import { animate } from './vendor/anime.esm.js'     // 补间动画
import * as Tone from './vendor/tone.esm.js'        // Web Audio 合成/播放
import p5 from './vendor/p5.esm.js'                 // 生成艺术 / 创意编程
import katex from './vendor/katex.esm.js'           // LaTeX 公式渲染（样式自动注入，无需 <link>）
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
- 需要数学公式时**永远用 KaTeX** 渲染（`katex.render(tex, el)`），不要用纯文本数学符号（`x^2`、`lim`、`∫`）或图片
- 3D 场景注意性能：widget 类帧率目标 30fps，面数 ≤ 5 万，避免后处理特效栈
- CSV 解析不需要库：`text.split('\n').map(r => r.split(','))` + 首行表头映射即可（复杂 CSV 含引号/换行/转义时改用 ExcelJS）

**文件类库（ExcelJS / pdfmake）必须走二进制 I/O**：用 `egg.ui.pickBinary()` 拿 `{ name, bytes }`、`egg.ui.saveBinary(bytes, name)` 存回；蛋内用 `egg.fs.readBytes/writeBytes`。不要用文本版 `pickFile/saveFile/fs.read/write`——它们按 utf-8 处理，会破坏 xlsx/pdf 字节。

**压缩/解压走 `egg.zip`（权限域 `zip`）**：沙箱里没有 Node zlib/stream，需要打包/拆包（比如把多张导出图片打成一个包、或解一个用户上传的 zip）时用宿主桥接，别自己找库实现。

```js
// 打包：内存进出，返回 zip 字节，再用 saveBinary 存到用户选的位置
const bytes = await egg.zip.create([
  { name: 'report.xlsx', data: xlsxBytes },
  { name: 'images/chart.png', data: pngBytes }
])
await egg.ui.saveBinary(bytes, 'export.zip')

// 解包：pickBinary 拿到的 zip 字节 → 一组 { name, data }
const picked = await egg.ui.pickBinary([{ name: 'Zip', extensions: ['zip'] }])
if (picked) {
  const entries = await egg.zip.extract(picked.bytes)
  for (const e of entries) await egg.fs.writeBytes(e.name, e.data)
}
```

- `create` 的 `name` 用 `/` 分隔路径（反斜杠会被自动规整）；目录条目在 `extract` 时自动跳过，只返回文件。
- 上限：单条目 ≤10MB，解压后总量 ≤50MB，条目数 ≤1000——超出会抛错（防压缩炸弹）。

各新库 API 要点：

- **ExcelJS**：`const wb = new ExcelJS.Workbook(); await wb.xlsx.load(bytes);` 读入，`await wb.xlsx.writeBuffer()` 导出（结果转 `new Uint8Array(buf)` 交给 saveBinary）。CSV 走 `wb.csv.readFile/writeFile`。工作表/单元格（`ws.addRow`、`cell.value`、样式）见官方文档，模型按需用。
- **pdfmake**：`pdfMake.createPdf({ content: [...] }).download('a.pdf')`，或 `.getBlob()` 后 `saveBinary`。**内置 Roboto 字体不含中文字形**——中文内容导出会空白/方块，中文场景要么告知用户限制、要么改用「canvas 画图 → 图片」方案。
- **math.js**：`math.evaluate('2 + 3')`、`math.unit('5 cm').to('m')`、`math.format(x, { notation: 'fixed', precision: 2 })`。高精度用 `math.bignumber('...')`。没有 default 导出，务必 `import * as math`。
- **js-yaml**：`loadYaml(str)` / `dumpYaml(obj)`（对应 import 别名）。配置文件读写首选，别手写正则解析。
- **jsdiff**：`Diff.diffLines(a, b)` 返回 `[{ value, added?, removed? }]` 逐段着色；`Diff.createTwoFilesPatch(oldName, newName, oldStr, newStr)` 出补丁；`Diff.applyPatch(oldStr, patch)` 应用。
- **matter.js**：物理引擎**不含渲染**——`Matter.Engine.create()` 算物理，用 canvas 自己按 `Matter.Bodies.*` 的 position/angle 画图形。每帧 `Matter.Engine.update(engine, 16.67)` 推进，碰撞回调用 `Matter.Events.on(engine, 'collisionStart', ...)`。
- **anime.js**：v4 命名导出 `animate`（**不是 default**）。`animate(targets, { translateX: 100, scale: 1.2, duration: 800, easing: 'spring(1, 80, 10, 0)' })`，多元素用 `stagger`。
- **Tone.js**：音频必须先经**用户手势**启动——首次发声前 `await Tone.start()`，否则浏览器自动播放策略会静音。`const s = new Tone.Synth().toDestination(); s.triggerAttackRelease('C4', '8n');`；和弦用 `Tone.PolySynth`，采样用 `Tone.Sampler`。
- **p5.js**：用**实例模式**（不要依赖全局 `window.setup/draw`）：`new p5(sk => { sk.setup = () => sk.createCanvas(w, h); sk.draw = () => { ... } })`。专用于生成艺术/创意编程，常规 UI 别用它。
- **KaTeX**：`katex.render(tex, el, { throwOnError: false })` 把公式填进元素，或 `katex.renderToString(tex, { throwOnError: false })` 返回 HTML 字符串再插入。样式由库自动注入（无需 `<link>`）。文本里的 `$…$` / `$$…$$` 定界符需自行拆分并逐条渲染（库不自动扫全文）。

## manifest.permissions 可选值

`storage` `db` `ai` `fs` `zip` `notify` `schedule` `window` `network`
——按需最小声明；`egg.ui`（toast/confirm/pickFile/saveFile）免声明。
`zip`：压缩/解压（`egg.zip.create/extract`，内存进出不落盘）。
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

用户愿望可能包含以下标记：

- `【需求细节】xxx；yyy` —— 用户确认过的功能要求，视为硬性需求，逐条实现
- `【视觉风格】xxx` —— 视觉调性建议，整体 UI 应匹配该风格描述的方向（具体执行由你根据应用类型灵活把握）
- `【主色调】#hex（色相 N°），配色=配方名：辅色…；派生规则` —— **这是强调色，不是唯一色**。覆盖 base.css 的 `--accent` 变量（在 style.css 中 `:root { --accent: #hex; }`）。强调色用于按钮/链接/图标焦点等 ≤25% 的 UI 面积。辅色用于次要元素/图标/图表。中性色（白/灰/深色面板）构成 UI 主体——参考上方「色彩哲学」段落。游戏和创意类应用不受比例上限约束
- `【中性色参考】深底 #xxx、浅底 #xxx、文字 #xxx …` —— 可选，为中性色提供基准值。若缺省，使用 base.css 变量自行构建中性色体系

## 验收标准（不达标会被打回）

1. validate：manifest 合法、无禁用 API（require/process/node:）、无外部 http(s) 引用、JS 语法正确、**无 emoji 字符**
2. test：加载零 console 错误、页面非空白
3. 用户愿望的核心功能真实可用
4. 界面有桌面应用气质：信息密度合理、操作反馈即时、图标而非 emoji、避免「居中窄栏网页排版」感
