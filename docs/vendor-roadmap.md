# Vendor 与能力扩展 Roadmap

> 目标：把蛋的能力面从「基础设施」扩展到「普通用户高频场景」，覆盖约 80% 的日常愿望。
> 状态：进行中。第 1 项（二进制 I/O）与第 2 项（9 个 vendor 库）已落地（2026-08-16），第 3~5 项待做。

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

## 2. 待新增 vendor 库（已引入 2026-08-16）

| 库 | 用途 | 许可 | 体积(min) | 备注 |
|---|---|---|---|---|
| exceljs | Excel(.xlsx)/CSV 导入导出 | MIT | 946 KB | 对接外部文件需二进制 I/O |
| math.js | 单位换算、公式计算 | Apache-2.0 | 752 KB | 无 default 导出，用 `import * as math` |
| pdfmake | 导出 PDF / 报告 | MIT | 1.86 MB | 声明式 API；内置 Roboto 不含中文字形 |
| js-yaml | YAML 解析 / 格式化 | MIT | 126 KB | 命名导出 load/dump |
| jsdiff | 文本对比 | BSD-3 | 23 KB | 命名导出 diffLines 等 |
| matter.js | 2D 物理 | MIT | 86 KB | 纯物理，不含渲染 |
| anime.js | 补间动画 | MIT | 408 KB | v4 命名导出 animate（无 default） |
| tone.js | 音频合成 | MIT | 349 KB | 发声前需 `await Tone.start()` |
| p5.js | 生成艺术 / 创意编程 | LGPL | 1.10 MB | default 导出，实例模式 |
| katex | LaTeX 公式渲染（STEM 学习类） | MIT | 160 KB JS + 260 KB 字体 | 带资产子目录 `katex/`，运行时注入 CSS |

**构建方式**：`node scripts/build-vendor.mjs` 用 esbuild 把每个库打成「自包含浏览器 ESM」单文件（`template/vendor/*.esm.js`），库本体来自 package.json devDependencies。改库或升级版本后重跑即可再生成。

**顺带修复 three.js**：官方 `three.module.js` 已拆分出 `three.core.js`（跨文件 import），旧 vendor 里只拷了前者、缺后者，`import * as THREE` 在运行时解析 `./three.core.js` 会失败。已改为 esbuild 打包成自包含单文件（713 KB），不再依赖兄弟文件。

**带资产子目录的 vendor（katex，首个）**：KaTeX 需要 CSS + 字体，是第一个不是「单 .esm.js」的库。CSP `font-src 'self'` 禁 data: URI，字体只能本地文件，故在 `vendor/katex/` 放 `katex.min.css` + `fonts/*.woff2`（Electron=Chromium 只用 woff2，.woff/.ttf 不拷）。`katex.esm.js` 运行时注入 `<link>` 加载该 CSS，蛋只需 `import katex`。配套改造：`stripUnusedVendor` 连带保留 `katex/` 子目录（主文件被 import 时），升级「回补 vendor」改为目录递归复制。

### 暂缓（依赖二进制 I/O）

| 库 | 用途 | 许可 | 备注 |
|---|---|---|---|
| gif.js | GIF 生成 | MIT | 待二进制 I/O 落地后引入 |

## 3. 配套桥接能力（非 vendor）

不是 vendor 库，但同属本轮能力扩展，需单独实现：

- **二进制文件 I/O** ✅：`egg.fs.readBytes/writeBytes` + `egg.ui.pickBinary/saveBinary` 已落地，字节经 IPC 结构化克隆直通（10MB 上限不变）。表格、图像文件进出的地基。
- **压缩 / 解压** ✅：复用现有 `yauzl` / `yazl`（gachaPkg.ts 打包 `.gacha` 已用），做成桥接能力而非 vendor 库。新增 `egg.zip.create/extract`（权限域 `zip`），内存进出、流式解压、防压缩炸弹（单条目 ≤10MB、总量 ≤50MB、≤1000 条目）。
- **本地模型管道**：共享模型缓存 + 中立下载 + 宿主侧 ML worker。另见本地 AI 规划（后续文档）。

## 4. 落地顺序

1. 二进制 I/O 桥接（地基，其余依赖它）✅
2. 已确定的 9 个库 + 同步更新 EGG_GUIDE 教学 ✅
3. 压缩 / 解压桥接 ✅
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
