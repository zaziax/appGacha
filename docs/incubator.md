# 孵化器设计（生成管线）

> 本质：把 Agent SDK 关进一个"只能孵蛋"的世界。工作目录是隔离的孵化巢，工具面只有蛋文件读写 + 两个验收工具，验收通过才移入蛋架。

## 1. 管线全景

```
愿望单 wish
   │
   ▼
① 备巢     从蛋模板复制脚手架到孵化巢 staging/<eggId>/
   │
   ▼
② 生成     Agent SDK 会话（子进程），智能体在巢内填空
   │            工具: Read/Write/Edit/Glob(限巢内) + validate_egg + test_egg
   ▼
③ 自检环   validate_egg(静态) → test_egg(动态+截图) → 智能体看截图自查
   │            不合格自动迭代，上限 3 轮
   ▼
④ 破壳     通过 → 原子移入蛋架 eggs/<name>.egg/
             超限 → "这个蛋没孵好，再抽一次？"（保留失败日志）
```

孵化器运行在**独立子进程**（utilityProcess），通过 IPC 向主进程上报阶段事件：`构思中 → 搭建中 → 自检中(第n轮) → 破壳`。蛋架 UI 的扭蛋动画绑定真实进度。

## 2. 蛋模板（脚手架）

智能体做填空题，不做作文题。模板内容：

```
template/
├── manifest.json      ← eggId/hostApiVersion/createdBy 已预填，智能体只填 name/permissions
├── index.html         ← 骨架 + 引用 base.css
├── base.css           ← 统一的基础视觉（所有蛋有家族相似性）
├── egg.d.ts           ← bridge API 完整类型声明（喂规范的最佳载体）
└── EGG_GUIDE.md       ← 智能体必读：能力清单、免费赠品(Web Speech等)、禁令、范例
```

`wish` 原文由管线写入 manifest，不经智能体之手（保证留档保真）。

## 3. Agent SDK 会话配置

| 项 | 配置 |
|---|---|
| cwd | `staging/<eggId>/`，路径守卫拒绝一切巢外访问 |
| 工具 | 仅 Read/Write/Edit/Glob + 自定义 MCP 工具 `validate_egg`/`test_egg`；禁用 Bash/WebSearch/网络 |
| 系统提示 | 角色设定 + EGG_GUIDE 要点 + "只能使用 egg.* 与标准 Web API" |
| 模型 | 用户自配（Anthropic 兼容 baseURL，如 DeepSeek）或托管通道 |
| 预算 | 单次孵化 token 上限；自检迭代上限 3 轮 |

`validate_egg`/`test_egg` 实现为进程内 MCP 工具：孵化子进程经 IPC 请求主进程执行，结果回传给智能体。

## 4. 两个验收工具

### validate_egg（静态，毫秒级）

- manifest schema 校验（ajv/zod）；`permissions` ⊆ 已知能力域
- `index.html` 存在；JS 语法解析通过
- 静态扫描禁令：`require`/`process`/`node:` 出现即拒；外部 `http(s)://` 资源引用即拒（所有引用必须相对路径）
- 体积上限（防失控生成）

### test_egg（动态，秒级）

- 主进程按正式运行时规则起**离屏 BrowserWindow**，`egg://` 指向孵化巢
- **bridge 测试模式**：`egg.ai` 返回符合 schema 的 mock 数据（不烧真 token）；db/storage 用巢内临时库
- 收集：console 错误、未处理 rejection、被拦截的网络请求、被拒绝的 bridge 调用
- 产出：截图（回传智能体做视觉自查）+ 问题清单

### 验收线

零 console 错误、零越权调用、截图非空白、智能体视觉自查通过。

## 5. 许愿升级（同管线，三处不同）

1. **输入**：现有蛋整体复制入巢 + manifest 中的原始 `wish` + 本次升级愿望
2. **前置**：升级前自动整蛋备份（`.egg.bak-<timestamp>`）
3. **验收追加**：若涉及 db schema 变更，智能体必须写迁移逻辑；test_egg 用**真实数据的副本**跑迁移，验证旧数据完好后才准破壳

升级成功后 manifest `version` 递增，`wish` 追加升级记录。

## 6. 失败与遥测

- 3 轮不过 → 抛给用户"再抽一次？"，孵化巢连同日志归档到 `failed/`
- 每次孵化记录：模型、pipelineVersion、迭代轮数、失败原因分类
- 用于回答"哪个模型/哪版管线孵化质量高"（对应 manifest `createdBy` 字段）

## 7. 边界与后续

- v1 不做愿望澄清对话（wish 直接进管线）；若失败率数据表明愿望太模糊是主因，再加"许愿时追问一轮"
- v1 不做交互冒烟测试（仅加载+截图）；后续可让 test_egg 支持智能体声明的自测脚本
- 孵化并发：v1 同时只孵一颗（子进程单例），排队即可
