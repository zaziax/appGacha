// test-db.cjs — 启动 db 集成测试的 launcher。
// 先真正删除 ELECTRON_RUN_AS_NODE（Electron 用 getenv 判断，空字符串也会被当作「存在」
// 而进入 Node 模式），再以真实 Electron 主进程运行 test-utility.cjs。
const { spawnSync } = require('node:child_process')
delete process.env.ELECTRON_RUN_AS_NODE
const electron = require('electron') // 返回 electron.exe 的路径
// Chromium 会在加载应用脚本之前解析这些开关；把它们放在入口脚本前，
// 才能让无桌面的 Windows CI/受限会话完全避开 GPU 子进程。
const r = spawnSync(electron, [
  '--disable-gpu',
  '--in-process-gpu',
  'test-utility.cjs',
], { stdio: 'inherit', env: process.env, timeout: 90_000 })
if (r.error) {
  console.error('[test:db] Electron launcher failed:', r.error.message)
}
process.exit(r.status ?? 1)
