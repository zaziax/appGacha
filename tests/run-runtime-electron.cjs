// Standalone integration test: node tests/run-runtime-electron.cjs
// Builds only the test entry, creates an isolated Electron profile, and never starts index.ts.
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawn } = require('node:child_process')
const esbuild = require('esbuild')

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'appgacha-runtime-integration-'))
  try {
    await esbuild.build({
      entryPoints: [path.join(__dirname, 'runtime-integration-entry.ts')],
      bundle: true, platform: 'node', packages: 'external',
      outfile: path.join(root, 'main/runtime.cjs'), logLevel: 'silent'
    })
    await esbuild.build({
      entryPoints: [path.join(__dirname, '../src/preload/index.ts')],
      bundle: true, platform: 'node', external: ['electron'],
      outfile: path.join(root, 'preload/index.js'), logLevel: 'silent'
    })
    const env = { ...process.env, APPGACHA_RUNTIME_TEST_ROOT: root, NODE_PATH: path.join(__dirname, '../node_modules') }
    delete env.ELECTRON_RUN_AS_NODE
    const code = await new Promise((resolve, reject) => {
      const child = spawn(require('electron'), [path.join(__dirname, 'runtime-electron-fixture.cjs')], {
        cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
      })
      child.stdout.on('data', data => process.stdout.write(data))
      child.stderr.on('data', data => process.stderr.write(data))
      const timeout = setTimeout(() => { child.kill(); reject(new Error('Isolated Electron runtime suite timed out')) }, 90_000)
      child.on('error', error => { clearTimeout(timeout); reject(error) })
      child.on('exit', code => { clearTimeout(timeout); resolve(code ?? 1) })
    })
    process.exitCode = code
  } finally {
    // Only the absolute directory returned by this invocation's mkdtemp is removed.
    const validated = path.resolve(root)
    if (path.dirname(validated) !== path.resolve(os.tmpdir()) || !path.basename(validated).startsWith('appgacha-runtime-integration-')) throw new Error('Refusing unexpected integration-test cleanup path')
    fs.rmSync(validated, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
