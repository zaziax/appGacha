# appGacha 应用扭蛋机

基于 Electron 的桌面应用。用户填写愿望单，扭蛋机芯（智能体管线）扭出即开即用、可迁移的小应用（扭蛋 `.egg`）。

## 核心理念

- **为小白解决"代码之后的一切"**：运行环境、数据持久化、迁移分发
- **沙箱 + 能力桥接**：扭蛋是纯 HTML/JS，通过 bridge API 使用主应用提供的能力
- **可迁移**：一个 `.egg` 文件夹即一个完整应用（代码 + 数据），拷贝到任何装有主应用的设备即可运行

## 系统组成

| 模块 | 职责 |
|---|---|
| 收藏柜 UI | 愿望单 / 扭蛋中 / 我的收藏 |
| 蛋运行时 | webview + preload bridge，沙箱隔离 |
| 能力层 | db / storage / fs / ui 等 bridge API |
| 蛋管理器 | 安装、加载、备份、导入导出 |
| 扭蛋机芯 | 自研 function calling 循环 + 生成验收闭环 |
| 模型接入层 | 用户自配 API（MVP）/ 托管计费（商业化） |

## 文档

- [设计总览与决策记录](docs/design.md)
- [.egg 格式规范与 Bridge API v1](docs/egg-spec.md)
- [蛋运行时技术方案](docs/runtime.md)
- [扭蛋机芯设计（生成管线）](docs/gacha-core.md)

## 开发

```powershell
npm install        # Electron 二进制经常需要镜像/手动安装，见下
npm start          # 构建并启动，自动加载 eggs/ 下所有蛋
npm run smoke      # 无头验收：起离屏蛋窗口探测 bridge 全链路
```

国内网络下 Electron/native 预编译二进制建议走镜像：

- Electron：下载 `https://npmmirror.com/mirrors/electron/37.2.0/electron-v37.2.0-win32-x64.zip`，放入 `node_modules/electron/`，将 install.js 的下载调用改为解压本地 zip 后执行 `node node_modules/electron/install.js`
- better-sqlite3（需 Electron ABI 136）：`https://registry.npmmirror.com/-/binary/better-sqlite3/v<版本>/better-sqlite3-v<版本>-electron-v136-win32-x64.tar.gz`，解压覆盖 `node_modules/better-sqlite3/build/Release/`
- 若在 VSCode 扩展环境的终端里启动报 `protocol undefined`，先清掉 `ELECTRON_RUN_AS_NODE` 环境变量

## 状态

- **M1 完成**：蛋运行时——egg:// 协议、沙箱窗口、权限拦截，样例蛋"背单词"跑通
- **M2 完成**：能力层补齐（egg.ai / notify / schedule / fs / window）+ 收藏柜素颜版（陈列/打开/导入/导出/删除）+ 模型设置（OpenAI 兼容接口，key 加密存储）
- **M3 完成**：扭蛋机芯——自研 function calling 循环（fcDriver）+ validate/test 双重验收（最多 3 轮修复）+ 许愿进度实况与后台挂起。首颗机器造蛋「猜猜我是谁」已出柜
- **M3.5 完成**：许愿升级——整蛋备份、现有代码入舱增量进化、真实数据副本迁移试跑、原子换装、蛋卡片「还原」回滚；失败/升级管线均纳入 smoke 全自动验证
- **下一步**：金标愿望集（回归基准）、M4 收藏柜化妆

决策变更记录见 [design.md](docs/design.md) D2'（Agent SDK → 自研微型机芯）。
