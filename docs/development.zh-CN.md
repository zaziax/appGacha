# 开发指南

[← 产品介绍](../README.zh-CN.md) · [English](development.md)

以下命令均在仓库根目录执行。此文档集中保留原 README 中的技术参考；源码目录用于导航，不是完整文件清单。新增子系统参见 [MCP](mcp.md)、[存储](egg-storage.md)和[生成质量设计](generation-quality.md)。

## 扭蛋开发能力

- **`.gacha` 开放规范** — 纯 HTML/CSS/JS（ES Module），零构建工具。任何人都能手写一颗蛋。详见 [egg-spec.md](egg-spec.md)
- **Bridge API v1** — 9 个需授权的能力域 + 2 个免授权 UI 操作，全部异步，`egg.d.ts` 提供完整类型声明：

  | 域 | 权限 | API |
  |---|---|---|
  | AI | `ai` | `egg.ai.chat()` / `egg.ai.extract()` |
  | 数据库 | `db` | `egg.db.query()` / `egg.db.exec()`（SQLite） |
  | 存储 | `storage` | `egg.storage.get()` / `set()` / `delete()`（JSON KV） |
  | 文件 | `fs` | `egg.fs.read()` / `write()` / `list()` / `readBytes()` / `writeBytes()`（限 data/ 目录） |
  | 压缩 | `zip` | `egg.zip.create()` / `egg.zip.extract()` |
  | 通知 | `notify` | `egg.notify.send()` |
  | 定时 | `schedule` | `egg.schedule.set()` / `cancel()` / `list()`（cron，最多 20 条） |
  | 窗口 | `window` | `egg.window.setAlwaysOnTop()` / `setSize()` |
  | 联机 | `network` | `egg.net.createRoom()` / `findRooms()` / `joinRoom()` / `broadcast()` / `close()`（WebRTC P2P） |
  | UI（免授权） | — | `egg.ui.toast()` / `confirm()` / `pickFile()` / `saveFile()` / `pickBinary()` / `saveBinary()` |
  | 窗口控制（免授权） | — | `egg.minimize()` / `maximize()` / `close()` |

- **蛋模板 + 脚手架** — 智能体从模板起步，模板自带桌面应用壳设计系统（`base.css`）、Lucide 图标精灵图和预置 vendor ESM 库（无需网络）：

  | 分类 | 库 |
  |---|---|
  | 3D / 图形 | Three.js、p5.js、matter.js |
  | 图表 / 文档 | Chart.js、KaTeX、ExcelJS、pdfmake |
  | 工具类 | marked、qrcode、canvas-confetti、dayjs、anime.js、js-yaml、jsdiff、Tone.js |

- **验证机制** — 静态检查与隔离运行检查覆盖结构、启动和已提交的交互场景，资源裁剪后还会重新验证实际交付目录。检查通过不是全部业务正确性的保证。详见[生成质量设计](generation-quality.md)。

- **自研机芯** — 内置生成使用 `fcDriver` 完成计划、实时索引读取、搜索、写入、哈希校验编辑、检查与收尾，支持流式输出、上下文压缩、断点与有限截断恢复。当前单次运行护栏为 60 轮、累计输出 300,000 tokens 和 15 分钟；输入 tokens 不计入这项输出护栏。计费与恢复边界详见[生成质量设计](generation-quality.md)。

## 快速开始

### 前置要求

- **Node.js** ≥ 20
- **npm** ≥ 10
- **Windows 10/11 x64** 或 **Apple 芯片 macOS**

### 安装运行

```powershell
git clone https://github.com/zaziax/appGacha.git
cd appGacha
npm install
npm start              # 完整构建（tsc + vite）→ 启动 Electron（Windows）
npm run start:mac      # macOS
```

### 开发模式

```powershell
npm run dev:ui         # 终端一：Vite dev server（收藏柜热更新）
npm run dev            # 终端二：Electron 连 dev server
```

### 冒烟测试与金标愿望集

```powershell
npm run smoke          # 无头验收：蛋 bridge 全链路 + 收藏柜 + 失败/升级管线
npm run test           # 单元测试（Vitest）
npm run typecheck      # 主进程、UI 和测试的 TypeScript 检查
npm run test:runtime   # 隔离 Electron 运行时检查
npm run test:dialogs   # 应用内确认弹窗交互
npm run test:mcp       # 真实 stdio MCP 创建、检查与入柜链路
npm run golden:fake    # 金标愿望回归——全链路出蛋→探针（假 AI）
npm run golden         # 金标愿望回归（真 AI）
```

### 打包

```powershell
npm run pack           # 未打包目录构建（Windows）
npm run dist           # 未签名 NSIS 安装程序（Windows x64）
npm run dist:mac       # 本地签名 + 公证的 DMG/ZIP（Apple 芯片 macOS）
```

`dist:mac` 需要 macOS 钥匙串中已有 Developer ID Application 证书，并在 `.env` 中配置 Apple 公证 API 凭据。命令只在 `release/` 生成本地产物，不会自动上传 GitHub。

### 国内网络镜像

```powershell
# Electron 二进制 — 手动下载后跳过 install.js 的下载步骤：
# https://npmmirror.com/mirrors/electron/37.2.0/electron-v37.2.0-win32-x64.zip

# better-sqlite3（需要 Electron ABI 136）— 下载对应版本解压覆盖：
# https://registry.npmmirror.com/-/binary/better-sqlite3/v<版本>/better-sqlite3-v<版本>-electron-v136-win32-x64.tar.gz
```

## 系统架构

```
┌────────────────── AppGacha (Electron) ───────────────────────────┐
│                                                                  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │  收藏柜 UI       │  │  扭蛋空间        │  │  独立蛋窗口      │  │
│  │  React + Vite    │  │  多 tab 视图     │  │  BrowserWindow  │  │
│  │                  │  │  WebContentsView │  │                  │  │
│  └────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘ │
│           │                     │                      │          │
│  ┌────────┴─────────────────────┴──────────────────────┴────────┐ │
│  │                    preload + Bridge API 能力层                 │ │
│  │  ai · db (SQLite) · storage · fs · zip · notify · schedule    │ │
│  │  window · network (WebRTC P2P) · ui (toast/对话框)            │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────┐  ┌────────────────┐  ┌───────────────────┐  │
│  │  扭蛋机芯       │  │  蛋管理器       │  │  账户              │  │
│  │  fcDriver       │  │  安装          │  │  Google OAuth     │  │
│  │  validate_egg   │  │  导出/导入     │  │  邮箱验证码登录    │  │
│  │  test_egg       │  │  升级          │  │                    │  │
│  │  pipeline       │  │  回滚          │  │                    │  │
│  └────────────────┘  └────────────────┘  └───────────────────┘  │
│                                                                  │
│  ┌────────────────┐  ┌────────────────┐  ┌───────────────────┐  │
│  │  定时调度       │  │  Widget 控制器  │  │  自动更新          │  │
│  │  cron 提醒      │  │  卫星控制窗     │  │  electron-updater │  │
│  │  点击通知打开   │  │  拖拽/固定/关闭 │  │  GitHub Releases  │  │
│  └────────────────┘  └────────────────┘  └───────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
         │                                                   │
         ▼                                                   ▼
   ┌──────────┐                                  ┌──────────────────┐
   │  .gacha 目录│                                  │  AppGacha Server  │
   │  本地文件  │                                  │  FastAPI + PG 16  │
   └──────────┘                                  │  api.appgacha.com │
                                                 └──────────────────┘
```

### 扭蛋生成管线

1. 将模板复制到隔离的暂存工作区。
2. 使用实时项目索引与工作区工具构建应用。
3. 执行静态、启动和已提交的交互检查，把诊断返回模型修复。
4. 裁剪资源后重新验证实际交付目录，通过后再入柜。
5. 可恢复中断保留断点，不把中断当成成功。

外部 MCP 使用独立编排，但共享工作区安全与验证机制。当前行为与限制详见 [MCP](mcp.md) 和[生成质量设计](generation-quality.md)。

### AI 模型通道

AppGacha 提供两条 AI 通道：通过可选账户服务使用托管 AI，或者自带 API Key 连接 DeepSeek、OpenAI、Kimi、Qwen 等 OpenAI 兼容服务。BYOK 凭据通过 Electron `safeStorage` 在设备上加密（Windows DPAPI / macOS Keychain），不会上传到 AppGacha。

## 项目结构

```
appGacha/
├── src/
│   ├── main/                    # Electron 主进程
│   │   ├── index.ts             #   入口、单实例锁、启动参数路由、退出同步
│   │   ├── pipeline.ts          #   扭蛋管线（投币→旋钮→咔咔→咔哒）
│   │   ├── fcDriver.ts          #   自研 function calling 循环（工作区工具 + SSE + 上下文压缩）
│   │   ├── validate.ts          #   静态验收（schema、禁用 API、emoji、外部 URL、CSP、JS 语法）
│   │   ├── test.ts              #   运行时测试（离屏 + 截图 + console 收集）
│   │   ├── aiChannel.ts         #   托管 AI + BYOK 通道（safeStorage 加密凭据）
│   │   ├── auth.ts              #   Google OAuth + 邮箱验证码 + 密码登录，JWT 管理
│   │   ├── api.ts               #   统一 HTTP 客户端，自动 token 刷新
│   │   ├── eggs.ts              #   蛋注册表（发现、注册、移除、加载 manifest）
│   │   ├── eggWindow.ts         #   蛋窗口工厂（无边框、沙箱、独立 partition）
│   │   ├── eggDoc.ts            #   蛋结构快照（Markdown），供升级时 AI 快速理解蛋结构
│   │   ├── space.ts             #   扭蛋空间：WebContentsView 多 tab 工作区
│   │   ├── shelf.ts             #   IPC 注册聚合入口——re-export channels/ 各域注册器
│   │   ├── shelfWindow.ts       #   收藏柜窗口生命周期
│   │   ├── protocol.ts          #   egg:// 自定义协议 + session 断网锁定
│   │   ├── settings.ts          #   持久化设置（AI key、单蛋标记、分类、空间配置）
│   │   ├── gachaPkg.ts          #   .gacha ZIP 打包/解包 + 路径穿越防护
│   │   ├── schedule.ts          #   cron 定时提醒（cron-parser，每蛋最多 20 条）
│   │   ├── widgetControls.ts    #   Widget 卫星控制窗（拖拽把手/固定/关闭）
│   │   ├── widgetPlacement.ts   #   Widget 窗口位置持久化
│   │   ├── tray.ts              #   系统托盘图标 + 右键菜单
│   │   ├── menu.ts              #   macOS 最小原生菜单
│   │   ├── updater.ts           #   自动更新（electron-updater，GitHub Releases）
│   │   ├── smoke.ts             #   冒烟测试（bridge + 收藏柜 + 管线 + 升级）
│   │   ├── golden.ts            #   金标愿望集回归基准
│   │   ├── wishGuide.ts         #   愿望聊天的 AI prompt 组装
│   │   ├── assoc.ts             #   文件关联 + 协议注册（Windows）
│   │   ├── registry.ts          #   WebContents → egg 映射，权限检查依据
│   │   ├── log.ts               #   日志 + 崩溃报告
│   │   ├── i18n.ts              #   主进程 i18n（托盘菜单、窗口标题：zh/en）
│   │   ├── paths.ts             #   路径工具（dataRoot、appRoot）
│   │   ├── fsutil.ts            #   copyDir（规避 Node 22 fs.cpSync emoji 路径崩溃）
│   │   ├── ico.ts               #   ICO 编码，生成蛋专属图标
│   │   ├── channels/            #   收藏柜 IPC 注册器，按域拆分
│   │   │   ├── ipc.ts           #     共享 handle() 包装（发送者门控 + {ok,value}/{ok,error} 契约）
│   │   │   ├── eggChannels.ts   #     蛋 列表/打开/导入/导出/回收站/回滚
│   │   │   ├── gachaChannels.ts #     许愿/升级/取消/续跑 + wishChat AI
│   │   │   ├── settingsChannels.ts #  AI 设置 / 模型 / 应用设置 / 分类
│   │   │   ├── spaceChannels.ts #     空间 增/删/排序/激活/边界
│   │   │   ├── authChannels.ts  #     认证 状态/登录/登出/验证码/密码
│   │   │   ├── updateChannels.ts #    检查/状态/安装更新
│   │   │   └── windowChannels.ts #   窗口控制 + 状态事件
│   │   ├── capabilities/        #   Bridge API 能力实现
│   │   │   ├── index.ts         #     IPC handler 注册 + 权限校验
│   │   │   ├── storage.ts       #     JSON KV 存储（文件后端）
│   │   │   ├── db.ts            #     SQLite（better-sqlite3）
│   │   │   ├── dbGuard.ts       #     SQL 安全守卫（禁用危险 SQL、行数/字节上限）
│   │   │   ├── dbWorker.ts      #     SQLite worker 线程
│   │   │   ├── ai.ts            #     AI chat + extract（限速：20 次/分钟/蛋）
│   │   │   ├── fsx.ts           #     沙箱文件 I/O（仅 data/ 目录）
│   │   │   └── zip.ts           #     内存 ZIP 创建/解压
│   │   └── net/                 #   局域网联机（P2P WebRTC）
│   │       ├── coordinator.ts   #     房间管理（创建/加入/广播/关闭）
│   │       ├── discovery.ts     #     UDP 多播发现
│   │       ├── rtcHost.ts       #     隐藏 BrowserWindow 承载 WebRTC 连接
│   │       └── signaling.ts     #     信令协议
│   ├── preload/                 # preload 脚本（bridge 注入 + UI chrome）
│   │   ├── index.ts             #   桥接 API 暴露、标题栏注入、toast/confirm UI
│   │   └── shelf.ts             #   收藏柜专用 bridge
│   ├── shared/                  # 主进程 ↔ 渲染进程共享类型
│   └── ui/                      # 收藏柜 UI（React + Vite + Tailwind CSS）
│       ├── src/
│       │   ├── App.tsx          #   根组件：状态管理、i18n
│       │   ├── config/          #   常量配置（provider 图标）
│       │   ├── i18n/            #   i18next 资源（zh / en）
│       │   └── components/
│       │       ├── EggCard.tsx          # 蛋卡片（3D 胶囊）
│       │       ├── Capsule3D.tsx        # Three.js 扭蛋 3D 场景
│       │       ├── GachaMachine3D.tsx   # 3D 扭蛋机（许愿界面）
│       │       ├── GachaMachineV5.tsx   # 扭蛋机变体
│       │       ├── MachineView.tsx      # 扭蛋机视图布局
│       │       ├── GachaShowcase3D.tsx  # 3D 展示场景
│       │       ├── AppAssemblyStage.tsx # 应用装配进度台
│       │       ├── SpaceView.tsx        # 扭蛋空间多 tab 工作区
│       │       ├── ShelfToolbar.tsx     # 工具栏（搜索、筛选、设置）
│       │       ├── LoginDialog.tsx      # OAuth + 邮箱登录
│       │       ├── SettingsDialog.tsx   # AI key、应用偏好设置
│       │       ├── ExportDialog.tsx     # 导出 .gacha 文件
│       │       ├── UpdateDialog.tsx     # 更新提示 / 进度
│       │       ├── ConfirmDialog.tsx    # 风格化确认弹窗
│       │       ├── ClosePromptDialog.tsx # 关闭行为提示（托盘 vs 退出）
│       │       ├── ErrorBoundary.tsx    # 渲染错误边界
│       │       ├── Toast.tsx            # Toast 通知
│       │       ├── TitleBar.tsx         # 自定义无边框标题栏
│       │       └── UserPanel.tsx        # 用户账户面板
│       └── vite.config.ts
├── template/                    # 蛋模板（生成时复制到装配舱）
│   ├── manifest.json            #   占位 manifest
│   ├── index.html               #   入口 HTML 骨架
│   ├── app.js                   #   空白入口模块
│   ├── style.css                #   自定义样式占位
│   ├── base.css                 #   桌面应用壳设计系统（CSS 变量 + 组件 class）
│   ├── widget.css               #   Widget 形态样式
│   ├── widget.js                #   Widget 形态入口
│   ├── egg.d.ts                 #   Bridge API TypeScript 类型声明
│   ├── EGG_GUIDE.md             #   智能体必读手册：规则、布局、图标规范、vendor 库
│   ├── icons.svg                #   图标精灵图
│   ├── icons-manifest.json      #   可用图标名清单
│   ├── vendor/                  #   预置 ESM 库（无需网络）
│   │   ├── three.module.js      #     Three.js
│   │   ├── chart.esm.js         #     Chart.js
│   │   ├── marked.esm.js        #     Markdown 解析
│   │   ├── qrcode.esm.js        #     二维码生成
│   │   ├── canvas-confetti.esm.js #   庆祝撒花特效
│   │   ├── dayjs.esm.js         #     日期工具
│   │   ├── anime.esm.js         #     Anime.js
│   │   ├── jsyaml.esm.js        #     YAML 解析
│   │   ├── p5.esm.js            #     p5.js
│   │   ├── katex.esm.js         #     KaTeX 数学渲染
│   │   ├── exceljs.esm.js       #     ExcelJS
│   │   ├── math.esm.js          #     Math.js
│   │   ├── pdfmake.esm.js       #     pdfmake
│   │   ├── jsdiff.esm.js        #     文本 diff
│   │   ├── matter.esm.js        #     Matter.js 物理引擎
│   │   └── tone.esm.js          #     Tone.js 音频
│   └── guides/                  #   专题指南（read_guide 工具加载）
│       └── net-lan/             #     局域网联机模式指南（给 AI 智能体参考）
├── assets/                      # 应用图标 + 静态资源
├── docs/                        # 设计文档
│   ├── design.md                #   设计总览与决策记录（D1–D10）
│   ├── egg-spec.md              #   .gacha 格式规范 & Bridge API
│   ├── gacha-core.md            #   扭蛋机芯设计
│   ├── runtime.md               #   蛋运行时：沙箱、协议、安全
│   ├── desktop-value.md         #   桌面差异化价值纲领
│   ├── server-architecture.md   #   服务端架构方案（不开源）
│   ├── threat-model.md          #   安全威胁模型与缓解措施
│   ├── vendor-roadmap.md        #   Vendor 库路线图
│   └── project-assessment-report.md # 项目评估报告
├── package.json
└── LICENSE
```

## 技术栈

| 层 | 技术 |
|---|---|
| 桌面框架 | Electron 37 |
| 收藏柜 UI | React 19 + TypeScript 5.5 + Vite 8 + Tailwind CSS 4 |
| 3D 渲染 | Three.js + @react-three/fiber + @react-three/drei |
| 动画 | Motion (Framer Motion) |
| 本地数据库 | better-sqlite3 |
| 国际化 | i18next + react-i18next |
| Cron 解析 | cron-parser |
| 打包压缩 | yazl + yauzl（ZIP） |
| 测试 | Vitest |
| 自动更新 | electron-updater |
| 图标 | Lucide React |
| 服务端（不开源） | Python FastAPI + PostgreSQL 16 + Docker Compose |

## 窗口类型

扭蛋在 `manifest.json` 的 `window.type` 字段声明窗口形态。manifest 支持两种值：

| 类型 | 说明 | 标题栏 | 适用场景 |
|---|---|---|---|
| **standard** | 无边框窗口，自动注入自定义标题栏 | ✅ 自动注入 | 大多数扭蛋 |
| **widget** | 透明无边框置顶，独立卫星控制窗（拖拽/固定/关闭） | ❌ 无 | 番茄钟、便签、时钟 |

此外，固定到**扭蛋空间**的蛋以内嵌 `WebContentsView` 形式渲染在收藏柜窗口内——这是宿主级功能，不是 manifest 的 `window.type` 值。

## 延伸阅读

- [设计决策](design.md)
- [扭蛋规范与桥接 API](egg-spec.md)
- [运行时](runtime.md)与[安全边界](threat-model.md)
- [机芯设计](gacha-core.md)与[生成质量设计](generation-quality.md)
- [桌面差异化价值](desktop-value.md)
- [托管后端架构](server-architecture.md)（后端不开源）
- [预置库路线图](vendor-roadmap.md)
- [项目评估](project-assessment-report.md)
- [发布清单](release-manual-checklist.md)
