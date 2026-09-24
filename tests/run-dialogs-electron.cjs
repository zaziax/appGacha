// Isolated renderer component tests. No production profile, network or model calls.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
async function main() {
  if (process.versions.electron) {
    const { app, BrowserWindow } = require('electron')
    const root = path.resolve(process.env.APPGACHA_DIALOG_TEST_ROOT || '')
    if (path.dirname(root) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('appgacha-dialog-test-')) throw new Error('Isolated root required')
    app.setPath('userData', path.join(root, 'profile'))
    app.setPath('sessionData', path.join(root, 'session'))
    app.disableHardwareAcceleration()
    await app.whenReady()
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
    try {
      await win.loadFile(path.join(root, 'index.html'))
      const results = await win.webContents.executeJavaScript('window.runDialogTests()')
      for (const result of results) console.log('PASS: ' + result)
      app.exit(0)
    } catch (error) { console.error(error); app.exit(1) }
    return
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'appgacha-dialog-test-'))
  try {
    await require('esbuild').build({ entryPoints: [path.join(__dirname, 'dialogs-ui-entry.tsx')], bundle: true, platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, outfile: path.join(root, 'suite.js'), logLevel: 'silent' })
    fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'; style-src \'self\' \'unsafe-inline\'"><script defer src="suite.js"></script>')
    const env = { ...process.env, APPGACHA_DIALOG_TEST_ROOT: root }
    delete env.ELECTRON_RUN_AS_NODE
    process.exitCode = await new Promise((resolve, reject) => {
      const child = require('node:child_process').spawn(require('electron'), [__filename], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      child.stdout.on('data', d => process.stdout.write(d)); child.stderr.on('data', d => process.stderr.write(d))
      const timer = setTimeout(() => { child.kill(); reject(new Error('Dialog tests timed out')) }, 60000)
      child.on('error', error => { clearTimeout(timer); reject(error) })
      child.on('exit', code => { clearTimeout(timer); resolve(code ?? 1) })
    })
  } finally {
    if (path.dirname(path.resolve(root)) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('appgacha-dialog-test-')) throw new Error('Unsafe test cleanup')
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
