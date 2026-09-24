const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawn } = require('node:child_process')
const esbuild = require('esbuild')

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'appgacha-mcp-integration-'))
  // On Windows this exercises C: temp -> E: workspace when the repo is on E:.
  // On macOS it still exercises the same destination-local staging path.
  const shelfParent = path.resolve(__dirname, '..')
  const shelf = fs.mkdtempSync(path.join(shelfParent, '.mcp-test-shelf-'))
  try {
    await esbuild.build({ entryPoints: [path.join(__dirname, 'mcp-integration-entry.ts')], bundle: true, platform: 'node', packages: 'external', outfile: path.join(root, 'main/runtime.cjs'), logLevel: 'silent' })
    await esbuild.build({ entryPoints: [path.join(__dirname, '../src/preload/index.ts')], bundle: true, platform: 'node', external: ['electron'], outfile: path.join(root, 'preload/index.js'), logLevel: 'silent' })
    await esbuild.build({ entryPoints: [path.join(__dirname, '../src/mcp/stdio.ts')], bundle: true, platform: 'node', outfile: path.join(root, 'connector.cjs'), logLevel: 'silent' })
    const env = { ...process.env, APPGACHA_MCP_TEST_ROOT: root, APPGACHA_MCP_TEST_SHELF: shelf, APPGACHA_MCP_TEST_TEMPLATE: path.resolve(__dirname, '../template'), NODE_PATH: path.resolve(__dirname, '../node_modules') }
    delete env.ELECTRON_RUN_AS_NODE
    process.exitCode = await new Promise((resolve, reject) => {
      const child = spawn(require('electron'), [path.join(__dirname, 'mcp-electron-fixture.cjs')], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      child.stdout.on('data', d => process.stdout.write(d)); child.stderr.on('data', d => process.stderr.write(d))
      const timeout = setTimeout(() => { child.kill(); reject(new Error('MCP integration timed out')) }, 120000)
      child.on('error', e => { clearTimeout(timeout); reject(e) })
      child.on('exit', code => { clearTimeout(timeout); resolve(code ?? 1) })
    })
  } finally {
    if (path.dirname(path.resolve(root)) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('appgacha-mcp-integration-')) throw new Error('Unsafe test cleanup')
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    if (path.dirname(path.resolve(shelf)) !== shelfParent || !path.basename(shelf).startsWith('.mcp-test-shelf-')) throw new Error('Unsafe shelf cleanup')
    fs.rmSync(shelf, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}
main().catch(e => { console.error(e); process.exitCode = 1 })
