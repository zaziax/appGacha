# 威胁模型

> 一句话：隔离的强度 =「AI 写的代码碰不到 Node、碰不到别的蛋、碰不到网络，只能走白名单窄桥」；
> 隔离的天花板 =「所有进程是同一个 OS 用户，一个 Chromium/Electron 0-day 就破功」。
> 我们做的是**缩小蛋代码的作恶面**，不是**用 VM 把蛋关起来**。

## 1. 威胁源

| # | 威胁源 | 说明 |
|---|---|---|
| T1 | AI 生成的蛋代码（不可信） | 每个蛋的 HTML/JS 都是 AI 写的，默认当它可能作恶 |
| T2 | 提示词注入（prompt injection） | 蛋内容里可能藏"指令"，诱导 AI 或后续生成做坏事 |
| T3 | 恶意愿望（malicious wish） | 用户（或被诱导的用户）输入一个愿望，让 AI 生成偷数据/搞破坏的代码 |

**明确不防的**（诚实边界）：
- 蛋窗口的操作用户本人——他本来就拥有这台机器。
- Chromium / V8 / Electron / better-sqlite3 的 0-day——见 §5 残余风险。

## 2. 信任边界

- **Main 进程 = 唯一的特权层**。能力实现（ai / db / fs / storage / notify / schedule / window / net）全在 Main。
- 其余一切一律不可信：蛋渲染层、preload、db 的 utilityProcess 子进程、widget 卫星控制窗。
- **preload 只是转发层，不做判断**（R2）——它把页面调用原样转发给 Main，由 Main 查身份、查权限。

## 3. 分层隔离（纵深）

| 层 | 机制 | 防什么 |
|---|---|---|
| 进程隔离 | 一蛋一 BrowserWindow（独立渲染进程） | 蛋之间互看内存、跨蛋读数据 |
| 渲染沙箱 | `sandbox:true` + `contextIsolation:true` + `nodeIntegration:false` | 页面脚本拿到 Node、直接碰文件/网络/进程 |
| 窄桥 | `contextBridge` 暴露 `window.egg` 白名单方法 | 蛋绕过权限检查直接调 Main |
| 协议 | `egg://` 自定义协议 + 路径穿越掐死 + 每蛋 origin + CSP | 读别的蛋文件、跨 origin、外链 |
| 权限门控 | R2：Main 按 `webContents.id → eggId → manifest` 校验，不信渲染自报 | 未声明权限的能力调用 |
| 断网 | R3：`webRequest.onBeforeRequest` 拦所有出站（`egg://`、devtools 除外） | 蛋直接外联偷数据 |
| 窗口 | R4：`setWindowOpenHandler` 拦 `window.open` + `setSize` 钳制 | 蛋造窗、霸屏 |
| 数据库 | db 跑在 utilityProcess 子进程 + 禁 SQL（ATTACH/VACUUM/PRAGMA）+ 行/字节上限 + 超时强杀 | SQL 逃逸写盘外、无界结果集、卡死主进程 |
| 文件 | storage/fs 路径沙箱（锁死在蛋 `data/`）+ 尺寸上限 | 路径穿越读任意文件、撑爆磁盘 |
| 控制窗 | widget 卫星控制窗与蛋同款沙箱三件套 + 独立窄桥 | 蛋代码触碰/移除/遮挡控制窗 |

## 4. 数据进出的合法出口

- **用户手势触发的系统对话框**（`egg.ui.pickFile` / `saveFile`）是沙箱内外数据进出的唯一逃生口——因此免权限（`permission: null`），但仍受字节上限约束，且必须由真实用户点选路径。
- **ai 通道是唯一的网络出口**（R3 断了蛋的直接网络），但蛋控制其内容 → 见 §5 的 exfil 项。

## 5. 残余风险（诚实声明）

1. **进程级隔离 ≠ OS 级隔离**。所有进程（Main、渲染、db 子进程）都以**同一 OS 用户**运行，没有独立用户、容器或 VM。
2. **Chromium/V8 0-day** → 渲染沙箱逃逸 → 以用户身份任意执行（能读用户整个家目录，不只是蛋文件夹）。
3. **better-sqlite3 原生 0-day** → db 子进程同用户沦陷。
4. **Electron 0-day** → Main 沦陷 = 完全控制该用户。
5. **自身进程 DoS**：蛋即使没逃逸，也能在自己的渲染进程里死循环耗 CPU/内存——只拖垮自己那个窗口，Main 保持响应；db 靠超时强杀兜底。
6. **ai 通道 exfil**：恶意蛋能构造提示词，诱导 AI 把蛋内数据"总结"出去（经 ai 后端外流）。这属提示词注入范畴，Main 层无法彻底杜绝，只能靠 ai 侧的输入清洗 + 最小权限缓解。

## 6. 结论

这套隔离把「AI 写的代码」的作恶面收敛到：**碰不到 Node、碰不到别的蛋、碰不到网络，只能走白名单窄桥**。但天花板是**同一个 OS 用户**——任何一环的 0-day 都会直接落到用户权限。因此它不是沙箱逃脱后还有第二道墙的"纵深 VM"，而是一套"默认拒绝 + 白名单窄桥 + 资源上限"的**最小权限降级**。
