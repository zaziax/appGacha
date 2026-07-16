# 蛋运行时技术方案

> 结论：一蛋一 BrowserWindow，主应用（蛋架）只是启动器。全部基于 Electron 标准能力，无自研隔离层。

## 1. 宿主形态选型

| 选项 | 结论 | 理由 |
|---|---|---|
| iframe | 否 | 与主应用共享渲染进程，隔离最弱 |
| `<webview>` 标签 | 否 | Electron 官方不推荐，历史包袱多 |
| WebContentsView 嵌入主窗口 | 否 | 蛋沦为"主应用里的标签页"，产品语义不对 |
| **独立 BrowserWindow** | **是** | 蛋拥有自己的任务栏图标、Alt-Tab、独立置顶/尺寸——兑现"真正的桌面应用"承诺；每窗口独立渲染进程，隔离白送 |

番茄钟挂件、桌面便签类愿望天然需要独立窗口。

## 2. 运行时架构

```
┌────────── Main 进程（唯一的特权层）──────────────┐
│  能力层实现: ai / db(better-sqlite3) / fs /      │
│  notify / schedule / window                      │
│  权限检查: webContents → eggId → manifest        │
│  egg:// 协议处理器（按蛋文件夹供给文件）           │
└────────────△ ipcMain.handle ────────────────────┘
             │ ipcRenderer.invoke
┌────────────┴────────────────────────────────────┐
│  蛋窗口 (BrowserWindow, 每蛋一个)                 │
│  preload.js（主应用自带，不在蛋文件夹里）          │
│    contextBridge.exposeInMainWorld('egg', {...}) │
│  渲染层: 蛋的 index.html（纯 web，无 Node）       │
└─────────────────────────────────────────────────┘
```

窗口创建配置（沙箱三件套 + 独立 session）：

```js
new BrowserWindow({
  webPreferences: {
    sandbox: true,              // Chromium OS 级沙箱
    contextIsolation: true,
    nodeIntegration: false,
    preload: HOST_PRELOAD,      // 主应用的 preload，蛋无法替换
    partition: `persist:egg-${eggId}`
  }
})
```

## 3. 四条硬性规则

### R1 用自定义协议 `egg://` 加载，禁用 `file://`

- `egg://<eggId>/index.html` 只从该蛋文件夹供文件，路径穿越在协议层掐死
- 每蛋独立 origin
- 协议响应头统一注入 CSP

### R2 权限检查只在 Main 进程做

- 窗口创建时登记 `webContents.id → eggId`
- 每个 `ipcMain.handle` 先查登记表再查 manifest `permissions`
- 永远不信任渲染进程自报身份；preload 只是转发层，不做判断

### R3 默认断网

蛋的 session 上用 `webRequest.onBeforeRequest` 拦掉所有出站请求（`egg://`、devtools 除外）。

- 安全：AI 生成的代码无法外联
- 产品：强制蛋离线可用（可迁移承诺的一部分）
- 工程：强制智能体把 AI 需求走 `egg.ai` 而非自己 fetch
- v2 的 `http` 权限在这一层按白名单放行

### R4 窗口能力是"申请"不是"操作"

- `setWindowOpenHandler` 拦掉 `window.open`，蛋不能创建窗口
- `egg.window.setSize/setAlwaysOnTop` 是 bridge 调用，Main 校验（尺寸上限、`window` 权限）后代为执行
- 窗口所有者永远是主应用

## 4. schedule 执行方案：c 起步 → a 跟进

蛋窗口关闭后定时任务到点，handler 在哪执行：

| 方案 | 说明 | 评价 |
|---|---|---|
| a. 隐藏蛋窗口执行 | 到点起隐藏 BrowserWindow 跑 handler，执行完销毁 | 复用全部现有架构，瞬时内存开销 |
| b. utilityProcess 跑受限 JS | 轻量 | 等于第二套沙箱+第二套 bridge，工程翻倍，否决 |
| c. 静态通知 | 注册时把通知文案定死，Main 直接发系统通知，点击打开蛋 | 零额外架构，覆盖 90% 提醒场景 |

**决定**：v1 采用 c（`egg.schedule.register(cron, { title, body })` 静态文案），需要执行蛋代码的场景出现后再上 a。egg-spec 中 `schedule.register(cron, handlerName)` 的签名随 v1 实现调整为静态文案形式。
