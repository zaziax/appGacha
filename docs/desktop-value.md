# 桌面差异化价值纲领

> 本文档是 appGacha 的产品方向决策记录，指导后续一切功能开发与智能体文档编写。
> 定论日期：2026-07-20

## 核心定位

```
AI 网页生成器（v0 / bolt）= 生成一个"你去看"的页面
appGacha                = 生成一个"活在你桌面上"的应用
```

差异化四支柱：

1. **桌面形态自由** —— 窗口尺寸/透明/异形/置顶，形态本身就不是网页
2. **持续存在感** —— 常驻托盘、开机自启、schedule 主动找用户，不需要"打开浏览器"
3. **数据长在机器上** —— 蛋的 data/ 随蛋走，拷贝即迁移（已实现）
4. **局域网联机** —— 蛋与蛋自动发现、P2P 实时对战/协作，目前没有任何 AI 应用生成器能生成"可以联机的应用"

## 决策清单

### D10 视觉去网页化

**问题**：生成的蛋大量使用 emoji、居中文章布局，视觉上与 AI 生成的网页无异。

**决策**：

- 全项目禁止 emoji（含主应用 UI、蛋模板、EGG_GUIDE），一律使用图标
- 内置 **Lucide SVG sprite** 图标库（`template/icons.svg`），蛋通过 `<svg><use href="icons.svg#icon-name">` 引用
  - 收录策略：宁多勿少（本地运行，几十~几百 KB 无所谓），覆盖小应用全场景
  - 配套 `template/icons-manifest.json` 列出全部可用图标名，EGG_GUIDE 收录高频 ~80 个，其余智能体按需 read_file 查询
  - 备选方案：若 Lucide 覆盖不足，可追加其他 MIT 协议图标集合并入 sprite
- 重写 `template/base.css` 为**桌面应用壳设计系统**：
  - 应用壳布局（toolbar / scrollable content / action bar），撑满窗口而非居中文章
  - 组件级 class（list-item、segment、switch、fab 等）
  - 暗色模式变量（prefers-color-scheme 自动切换）
- EGG_GUIDE 新增「桌面应用设计准则」章节：像设计原生应用一样设计界面，禁止 emoji，布局撑满窗口

**不采用 Tailwind CSS**：蛋无构建步骤，Tailwind JIT 不可用（CDN 版被断网拦截，预构建全量 ~350KB 且浪费）；AI 写原生 CSS 能力强；widget 异形窗口需要精确 CSS 控制。投资 base.css 设计系统是正确路径。

### D11 窗口形态系统

**问题**：所有蛋窗口固定 900×640 + 统一标题栏，无法产出悬浮小组件类应用——这是与 AI 网页生成服务的本质区别之一。

**决策**：

manifest 新增 `window` 字段：

```json
{
  "window": {
    "type": "standard | widget",
    "width": 380,
    "height": 520,
    "alwaysOnTop": false,
    "autoStart": false
  }
}
```

- **standard**（默认）：现有行为，注入标题栏，尺寸取 manifest 声明（钳制 240~1600）
- **widget**：`transparent: true` + `frame: false` + 不注入标题栏；尺寸比例自由（仅保留 96px 技术下限），蛋用 Widget Shell 在透明安全带内自绘形状
- **widget 安全退出（定论）**：宿主注入 **hover 浮钮**——鼠标悬停窗口时角落浮现半透明控制钮（关闭/置顶开关），z-index 最高，蛋代码无法覆盖或移除
- 智能体根据应用类型自主决定窗口形态与尺寸（计算器 380×520、悬浮时钟 220×220、记账本 900×640）
- 后续可扩展：`setShape` / `setClickThrough` 等运行时微调 API，等愿望逼出来再加

### D12 生命周期：常驻与自启动

**问题**：关闭所有窗口 = 应用退出，schedule 提醒全部失效；蛋无法开机自启。

**决策**：

| 层 | 行为 |
|---|---|
| 主应用常驻 | 关窗口 ≠ 退出，缩到系统托盘；仅托盘菜单可退出 |
| 主应用自启动 | 设置里一个开关，`app.setLoginItemSettings({ openAtLogin })` |
| 蛋自启动 | manifest `window.autoStart` 为出厂默认值；**收藏柜提供逐蛋开关**（用户粒度控制，定论） |

- 主应用启动时扫描 autoStart 蛋并自动打开窗口
- 蛋自启动典型场景：番茄钟 widget、桌面便签、今日待办

### D13 蛋的工程结构

**问题**：三件套（index.html/style.css/app.js）对复杂应用过于局促；现代模型有能力组织多文件项目。

**决策**：有限度放开，入口约定不变——

```
manifest.json        ← 身份证（window 字段新增）
index.html           ← 唯一入口约定，<script type="module" src="app.js">
app.js               ← 主模块，可 import 其他模块
src/                 ← 可选，复杂应用自行拆分（视图、工具、状态）
style.css            ← 样式永远单文件
base.css / icons.svg ← 宿主资产，不可修改
vendor/              ← 宿主预置的第三方 ESM 库（按需扩充）
```

- **不强制限制文件数量**——如果多文件导致质量问题，问题在智能体服务构建不到位，应从提示词/验收侧解决，而非用约束阉割能力上限
- 模块一律 ES Module（`<script type="module">`），禁止全局变量挂载式伪模块化
- 简单应用鼓励单 app.js（省 token、快验收），但不强制

### D14 不引入构建步骤

**问题**：是否给智能体 npm install + 构建打包能力（v0/bolt 模式）？

**决策：不引入。**

- v0/bolt 必须构建是因为产出物要部署到 web；我们的蛋运行在本地 Chromium，原生 ESM 直接执行，浏览器就是最好的运行时
- 构建的真实代价：每次修复循环 +30~60s、npm 网络依赖、依赖冲突成为新失败模式、node_modules 破坏蛋的可移植性（几十 KB → 几百 MB）
- 生态缺口的解法：**vendor 预置库**——预打包的单文件 ESM 放入 `template/vendor/`，蛋直接 `import X from './vendor/x.esm.js'`，零构建、离线可用（具体清单见 D15）
- 架构上不排除未来新增 `build` 权限域的可能，但等真实愿望逼出来再做

### D15 vendor 预置库定案

**问题**：蛋离线、无构建、无 npm——生态库缺口用什么补？放哪些库？怎么交付？

**决策**：

**定案清单**（`template/vendor/`）：

| 库 | 体积 | 覆盖场景 |
|---|---|---|
| three.module.js | ~650KB | 3D 场景——桌面 3D 时钟、鱼缸、粒子艺术；widget + 3D 是"桌面活物"的核武器 |
| chart.esm.js | ~200KB | 数据可视化——记账趋势、习惯统计、体重曲线 |
| dayjs.esm.js | ~3KB | 日期计算——追踪/倒计时/日历类应用基石，原生 Date 是 AI 高频出错点 |
| marked.esm.js | ~40KB | Markdown 渲染——笔记/日记/阅读类许愿热门 |
| qrcode.esm.js | ~30KB | 二维码生成——WiFi 分享、联机房间码扫码加入 |
| canvas-confetti.esm.js | ~6KB | 庆祝动效——抽奖开奖、打卡达成、番茄完成的情绪价值 |

**交付机制**：vendor 随模板复制到装配舱（现有流程零改动），AI 直接 import 引用；**finish 后管线自动剥离未被 import 的 vendor 文件**——蛋保持自包含可移植，不用的库不占体积。

**不引入的**：
- xlsx/SheetJS：当前 `egg.ui.pickFile` 仅返回 utf-8 文本，xlsx 是二进制 ZIP 读不进来；80% 的"导入 Excel"场景 CSV 可覆盖（EGG_GUIDE 提供 CSV 解析范例）。等真实需求出现后再做 pickFile 二进制化 + xlsx 引入
- 图像处理库：Canvas 原生 API 覆盖压缩/转格式/裁剪/缩放/滤镜/水印，缺的是 EGG_GUIDE 范例章节而非库
- 富文本编辑器：contenteditable + marked 覆盖笔记场景
- Tailwind CSS（见 D10）

**3D 性能准则**（写入 EGG_GUIDE）：widget 类 3D 应用帧率目标 30fps，面数不超过 5 万，避免后处理特效栈。

### D16 P2P 局域网联机

**问题**：用户许愿"做个五子棋"，期望能和局域网里的朋友联机对战——蛋与蛋之间的对等发现与实时通信。

**战略判断**：目前没有任何 AI 应用生成器能生成"可以联机的应用"。v0/bolt 的产品形态里没有"两台设备上的应用互相发现"这个概念。联机能力是社交传播的引爆点——"我电脑上这个 AI 做的小游戏居然能跟你对战"。

**核心设计原则：蛋不懂网络，蛋只懂房间。** 所有网络复杂度（UDP 广播、WebRTC 信令、DataChannel 建立）沉到宿主封装，蛋只拿到消息进/消息出的房间抽象——这恰恰是 AI 生成质量最有保障的模式。

**蛋侧 API**（需声明 `network` 权限）：

```js
const room = await egg.net.createRoom('五子棋对战')  // 创建房间，局域网广播存在
room.code                                           // 4 位房间码，可配合 qrcode 生成扫码加入
const rooms = await egg.net.findRooms()             // 发现局域网内所有房间
const room = await egg.net.joinRoom(roomId)         // 加入

room.broadcast({ type: 'move', x: 7, y: 8 })        // 发消息给所有玩家
room.onMessage = (msg, peerId) => { ... }           // 收消息
room.onPeerJoin = (peerId) => { ... }
room.onPeerLeave = (peerId) => { ... }
room.close()
```

**宿主侧架构**：

- 发现：UDP 广播（局域网天然支持，零配置零服务器）
- 连接：WebRTC DataChannel（Chromium 原生，同 LAN 直连延迟 <1ms，有序可靠交付）
- 信令：复用 UDP 广播通道交换 SDP，**全程不依赖互联网**

**定论**：

- 发现机制：**自动发现 + 房间码并存**——自动发现是惊喜感（打开蛋就看到局域网里的房间），房间码是确定性（朋友不在同一广播域时手动输入）
- **收藏柜即大厅**：蛋卡片上直接显示"局域网内有 N 个房间可加入"，蛋还没打开联机入口已经在那了
- 不限制同款蛋：room API 只管传消息，协议由蛋自定义；不同版本的同款蛋只要消息协议兼容即可联机
- 状态同步范式：EGG_GUIDE 提供「主机权威」同步模式（创建者为准、断线重连、状态快照），AI 按范式生成而非自由发挥
- 支持 N 人房间（不只 1v1）：派对问答、多人投票等场景天然成立

## 实施优先级

1. **P0 视觉地基**：base.css 重写 + icons.svg + vendor 目录 + EGG_GUIDE 设计准则 → 立即提升所有新蛋的视觉品质与能力上限
2. **P1 窗口形态**：manifest window 字段 + widget 透明窗口 + hover 浮钮 → 解锁悬浮组件品类
3. **P2 局域网联机**：UDP 发现 + WebRTC 信令 + room bridge API + network 权限门控 → 解锁"可以联机的应用"品类（widget + 联机 = 完整故事）
4. **P3 生命周期**：托盘常驻 + 自启动 → 完成"活在桌面上"的闭环
5. **P4 工程结构**：ES Module 支持验证 + 多文件项目 → 提升复杂应用上限

## 验收标准（方向性）

- 新生成的蛋**一眼看去不是网页**：无 emoji、有应用壳布局、有工具栏/操作区层次
- 用户许愿"桌面悬浮时钟/小组件"时，产出的蛋是透明异形窗口 + hover 浮钮可退出
- 用户许愿"做个五子棋"时，产出的蛋包含联机能力：两台电脑打开后自动发现对方房间，加入即可对战
- 重启电脑后，自启动的蛋直接出现在桌面上，schedule 提醒不中断
