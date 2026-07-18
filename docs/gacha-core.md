# 扭蛋机芯设计（生成管线）

> 本质：把智能体关进一个"只能造蛋"的世界。工作目录是隔离的装配舱，工具面只有蛋文件读写 + 验收工具，验收通过才移入收藏柜。
>
> 驱动实现：**自研 function calling 循环**（`src/main/fcDriver.ts`，见 design.md D2'）。管线定义 `GachaDriver` 接口，驱动可插拔。

## 1. 管线全景

```
愿望单 wish
   │
   ▼
① 投币       从蛋模板复制脚手架到装配舱 staging/<eggId>/
   │              管线写入 manifest 受保护字段（wish 不经智能体之手）
   ▼
② 旋钮转动   fcDriver：主进程内 function calling 循环，智能体在舱内填空
   │              工具: list_files / read_file / write_file / check_egg / finish
   ▼
③ 机芯咔咔   finish 触发验收：validate_egg(静态) → test_egg(离屏运行+截图)
   │              不合格把问题清单喂回智能体修复，上限 3 轮
   ▼
④ 咔哒！     通过 → 管线复写受保护字段 → 原子移入收藏柜 eggs/<name>.egg/
               超限 → "这次没扭出好蛋，再来一发？"（装配舱归档 failed/）
```

机芯运行在主进程内（无子进程，符合"一切能力自含"约束），通过 `onStage` 回调向收藏柜流式上报实况：`投币 → 旋钮转动（第n回合，模型思考中…/正在写 xx…）→ 机芯咔咔（自检第n轮）→ 咔哒！`。收藏柜支持后台挂起，完成时发系统通知。

## 2. 蛋模板（脚手架）

智能体做填空题，不做作文题。模板内容：

```
template/
├── manifest.json      ← eggId/hostApiVersion/createdBy 由管线写入，智能体只填 name/permissions
├── index.html         ← 骨架 + 引用 base.css
├── base.css           ← 统一的基础视觉（所有蛋有家族相似性）
├── style.css/app.js   ← 智能体的主要填空区
├── egg.d.ts           ← bridge API 完整类型声明（喂规范的最佳载体，入舱前删除）
└── EGG_GUIDE.md       ← 智能体必读：能力清单、免费赠品(Web Speech等)、禁令、范例（入舱前删除）
```

`wish` 原文由管线写入 manifest，不经智能体之手（保证留档保真）；出蛋前管线再次复写 `eggId`/`wish`/`hostApiVersion`/`createdBy`，篡改无效。

## 3. fcDriver 会话配置

| 项 | 配置 |
|---|---|
| 作用域 | `staging/<eggId>/`，所有工具路径守卫拒绝舱外访问 |
| 工具 | `list_files` / `read_file` / `write_file` / `check_egg` / `finish`，OpenAI tools 协议 |
| 系统提示 | 角色设定 + 内嵌 EGG_GUIDE.md 全文 + egg.d.ts 全文 |
| 模型 | 用户自配（OpenAI 兼容 baseURL，如 DeepSeek）或托管通道 |
| 预算 | 60 回合 / 300k tokens / 15 分钟；自检迭代上限 3 轮 |

`finish` 是唯一出口：触发 validate + test 双重验收，通过即出蛋，不通过把问题清单作为工具结果喂回，`请修复以上问题后再次 finish`。

## 4. 两个验收工具

### validate_egg（静态，毫秒级）

- manifest schema 校验（ajv/zod）；`permissions` ⊆ 已知能力域
- `index.html` 存在；JS 语法解析通过
- 静态扫描禁令：`require`/`process`/`node:` 出现即拒；外部 `http(s)://` 资源引用即拒（所有引用必须相对路径）
- 体积上限（防失控生成）

### test_egg（动态，秒级）

- 主进程按正式运行时规则起**离屏 BrowserWindow**，`egg://` 指向装配舱
- **bridge 测试模式**：`egg.ai` 返回符合 schema 的 mock 数据（不烧真 token）；db/storage 用舱内临时库
- 收集：console 错误、未处理 rejection、被拦截的网络请求、被拒绝的 bridge 调用
- 产出：截图（存档为装配舱旁 `.test.png`，供人工/遥测复查）+ 问题清单

### 验收线

零 console 错误、零越权调用、截图非空白（空白检测：无文本且节点数 < 3）。

> 注：D2 原案的"智能体看截图视觉自查"依赖多模态模型，当前 fcDriver 面向纯文本 OpenAI 兼容接口，视觉自查降级为空白检测 + 截图存档；接入多模态模型后可恢复。

## 5. 许愿升级（已实现，同管线四处不同）

1. **输入**：现有蛋代码复制入舱（`data/` 不进舱，真实数据不给智能体碰）+ 原始 `wish` + 本次升级愿望；舱内蛋用临时 eggId，出舱时管线写回真身（保护字段原则不破例）
2. **前置**：升级前自动整蛋备份（含数据）到 `backups/<eggId>/<时间戳>/`，每蛋保留最近 5 份；收藏柜蛋卡片提供「还原」回滚入口
3. **验收追加**：驱动自检走"全新安装"路径；出舱前管线再把**真实数据的副本**放进舱试跑一次，旧数据带不动就不准出蛋
4. **换装**：代码整体替换、`data/` 原地不动；换装半途出错自动从备份还原，蛋不会处于半新半旧状态

升级成功后 `version` 递增次版本号，`wish` 保持原始愿望，升级历史追加进 manifest 的 `upgrades` 数组（愿望/时间/模型）。

## 6. 失败与遥测

- 3 轮不过 → 抛给用户"再来一发？"，装配舱连同日志归档到 `failed/`
- 每次扭蛋记录：模型、pipelineVersion、迭代轮数、失败原因分类
- 用于回答"哪个模型/哪版管线出蛋质量高"（对应 manifest `createdBy` 字段）

## 7. 边界与后续

- v1 不做愿望澄清对话（wish 直接进管线）；若失败率数据表明愿望太模糊是主因，再加"许愿时追问一轮"
- v1 不做交互冒烟测试（仅加载+截图）；后续可让 test_egg 支持智能体声明的自测脚本
- 扭蛋并发：v1 同时只扭一颗（管线 busy 单例），机芯正忙时许愿直接被拒
