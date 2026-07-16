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
| 扭蛋机芯 | Agent SDK 封装 + 生成验收闭环 |
| 模型接入层 | 用户自配 API（MVP）/ 托管计费（商业化） |

## 文档

- [设计总览与决策记录](docs/design.md)
- [.egg 格式规范与 Bridge API v1](docs/egg-spec.md)
- [蛋运行时技术方案](docs/runtime.md)
- [扭蛋机芯设计（生成管线）](docs/gacha-core.md)

## 状态

设计阶段收官。四份设计文档已齐（design / egg-spec / runtime / gacha-core），下一步：进入实现，从蛋运行时 + 一颗手写样例蛋开始。
