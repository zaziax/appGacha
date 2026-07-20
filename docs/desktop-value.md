# 桌面差异化价值纲领

> 本文档是 appGacha 的产品方向决策记录，指导后续一切功能开发与智能体文档编写。
> 定论日期：2026-07-20

## 核心定位

```
AI 网页生成器（v0 / bolt）= 生成一个"你去看"的页面
appGacha                = 生成一个"活在你桌面上"的应用
```

差异化三支柱：

1. **桌面形态自由** —— 窗口尺寸/透明/异形/置顶，形态本身就不是网页
2. **持续存在感** —— 常驻托盘、开机自启、schedule 主动找用户，不需要"打开浏览器"
3. **数据长在机器上** —— 蛋的 data/ 随蛋走，拷贝即迁移（已实现）

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
- **widget**：`transparent: true` + `frame: false` + 不注入标题栏；蛋用 CSS 自绘形状（圆、胶囊、clip-path 异形）
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
- 生态缺口的解法：**vendor 预置库**——预打包的单文件 ESM（chart.js、marked 等）放入 `template/vendor/`，蛋直接 `import X from './vendor/x.esm.js'`，零构建、离线可用
- 架构上不排除未来新增 `build` 权限域的可能，但等真实愿望逼出来再做

## 实施优先级（建议）

1. **P0 视觉地基**：base.css 重写 + icons.svg + EGG_GUIDE 设计准则 → 立即提升所有新蛋的视觉品质
2. **P1 窗口形态**：manifest window 字段 + widget 透明窗口 + hover 浮钮 → 解锁悬浮组件品类
3. **P2 生命周期**：托盘常驻 + 自启动 → 完成"活在桌面上"的闭环
4. **P3 工程结构**：ES Module 支持验证 + vendor 预置库 → 提升复杂应用上限

## 验收标准（方向性）

- 新生成的蛋**一眼看去不是网页**：无 emoji、有应用壳布局、有工具栏/操作区层次
- 用户许愿"桌面悬浮时钟/小组件"时，产出的蛋是透明异形窗口 + hover 浮钮可退出
- 重启电脑后，自启动的蛋直接出现在桌面上，schedule 提醒不中断
