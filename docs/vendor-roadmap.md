# Vendor 与能力扩展 Roadmap

> 目标：把蛋的能力面从「基础设施」扩展到「普通用户高频场景」，覆盖约 80% 的日常愿望。
> 状态：规划中（讨论定稿于 2026-08，尚未开始引入）。

## 1. 现状

当前 vendor 池（`template/vendor/`，蛋按需 `import`）：

| 文件 | 用途 |
|---|---|
| chart.esm.js | 图表 |
| dayjs.esm.js | 日期 |
| marked.esm.js | Markdown |
| qrcode.esm.js | 二维码 |
| canvas-confetti.esm.js | 庆祝动效 |
| three.module.js | 3D |

**机制**：vendor 是共享库池。生成/升级后由 `stripUnusedVendor`（pipeline.ts）剥离未被 `./vendor/<file>` 引用的库，单个蛋只保留实际用到的文件。因此新增库只会增大模板池（一次），不会撑大每个蛋。

## 2. 待新增 vendor 库

| 库 | 用途 | 许可 | 备注 |
|---|---|---|---|
| exceljs | Excel(.xlsx)/CSV 导入导出 | MIT | 对接外部文件需二进制 I/O |
| math.js | 单位换算、公式计算 | Apache-2.0 | |
| pdfmake | 导出 PDF / 报告 | MIT | 声明式 API，适合模型生成 |
| js-yaml | YAML 解析 / 格式化 | MIT | |
| jsdiff | 文本对比 | BSD-3 | |
| matter.js | 2D 物理 | MIT | |
| anime.js | 补间动画 | MIT | |
| tone.js | 音频合成 | MIT | |
| p5.js | 生成艺术 / 创意编程 | LGPL | 体积较大 |

### 暂缓（依赖二进制 I/O）

| 库 | 用途 | 许可 | 备注 |
|---|---|---|---|
| gif.js | GIF 生成 | MIT | 待二进制 I/O 落地后引入 |

## 3. 配套桥接能力（非 vendor）

不是 vendor 库，但同属本轮能力扩展，需单独实现：

- **二进制文件 I/O**：`fs` / `pickFile` / `saveFile` 目前纯文本，需支持 bytes。表格、图像文件进出的地基。
- **压缩 / 解压**：复用现有 `yauzl` / `yazl`（gachaPkg.ts 打包 `.gacha` 已用），做成桥接能力而非 vendor 库。
- **本地模型管道**：共享模型缓存 + 中立下载 + 宿主侧 ML worker。另见本地 AI 规划（后续文档）。

## 4. 落地顺序

1. 二进制 I/O 桥接（地基，其余依赖它）
2. 已确定的 9 个库 + 同步更新 EGG_GUIDE 教学
3. 压缩 / 解压桥接
4. 本地模型管道
5. gif.js（二进制 I/O 落地后）

## 5. 明确不引入

- 重 UI 组件：tabulator / handsontable（网格）、fullcalendar（日历）、quill（富文本）——模型用原生 HTML 更稳
- pdf.js / wavesurfer / jsEncrypt —— 过重或过低频
- jsbarcode（一维码）—— 已移除
- 音 / 视频编辑 —— 需原生 ffmpeg，纯 JS 沙箱做不了

## 6. 引入一个库的 checklist

每次加库需同步三件事：

1. 塞进 `template/vendor/`（沿用 `*.esm.js` 命名）
2. EGG_GUIDE + fcDriver system prompt 补 import 写法与 API 要点
3. 核许可 + 记录体积
