// test-db.cjs — 启动 db 集成测试的 launcher。
// 先真正删除 ELECTRON_RUN_AS_NODE（Electron 用 getenv 判断，空字符串也会被当作「存在」
// 而进入 Node 模式），再以真实 Electron 主进程运行 test-utility.cjs。
const { spawnSync } = require('node:child_process')
delete process.env.ELECTRON_RUN_AS_NODE
const electron = require('electron') // 返回 electron.exe 的路径
const r = spawnSync(electron, ['test-utility.cjs'], { stdio: 'inherit', env: process.env })
process.exit(r.status ?? 1)
