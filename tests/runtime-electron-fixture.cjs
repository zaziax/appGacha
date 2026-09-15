const { app, protocol, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const assert = require('node:assert/strict')
// Electron does not initialize NODE_PATH the same way as a plain Node subprocess.
require('node:module').Module._initPaths()

const root = path.resolve(process.env.APPGACHA_RUNTIME_TEST_ROOT || '')
if (path.dirname(root) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('appgacha-runtime-integration-')) throw new Error('An isolated integration-test root is required')
for (const name of ['profile', 'session', 'logs', 'crashes']) fs.mkdirSync(path.join(root, name), { recursive: true })
app.setPath('userData', path.join(root, 'profile'))
app.setPath('sessionData', path.join(root, 'session'))
app.setPath('logs', path.join(root, 'logs'))
app.setPath('crashDumps', path.join(root, 'crashes'))
app.setAppPath(root)
// Headless fixture rendering does not need a GPU; the product runtime remains unchanged.
app.disableHardwareAcceleration()
protocol.registerSchemesAsPrivileged([{ scheme: 'egg', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }])
app.on('window-all-closed', () => {})
let lastTestSession
app.on('browser-window-created', (_event, win) => { lastTestSession = win.webContents.session })

function fixture(name, script, extraHead = '', permissions = []) {
  const dir = path.join(root, `${name}.gacha`)
  fs.mkdirSync(dir)
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ eggId: `fixture-${name}`, name, version: '1.0.0', hostApiVersion: '1', permissions }))
  fs.writeFileSync(path.join(dir, 'index.html'), `<!doctype html><html><head><title>Fixture</title>${extraHead}</head><body><button id="start">Start</button><span id="count">0</span><script type="module" src="app.js"></script></body></html>`)
  fs.writeFileSync(path.join(dir, 'app.js'), script)
  return dir
}

app.whenReady().then(async () => {
  const { testEgg, registerCapabilities } = require(path.join(root, 'main/runtime.cjs'))
  registerCapabilities()
  const scenarios = [{ name: 'Button changes count', steps: [
    { action: 'click', selector: '#start' },
    { action: 'assert', selector: '#count', property: 'text', equals: '1' },
    { action: 'assert-change', selector: '#count', property: 'text' }
  ] }]
  const cases = [
    ['module404', "import './missing.js';", {}, false, 'resource'],
    ['exception', "throw new Error('fixture initialization failed');", {}, false, 'exception'],
    ['rejection', "Promise.reject(new Error('fixture initialization rejected'));", {}, false, 'exception|unhandled-rejection'],
    ['csp', '', { head: '<script>window.inlineShouldBeBlocked=true</script>' }, false, 'csp|console'],
    ['healthy', "document.querySelector('#start').addEventListener('click',()=>document.querySelector('#count').textContent='1');", { scenarios }, true],
    ['absolute-self', "import { count } from 'egg://fixture-absolute-self/helper.js'; document.querySelector('#count').textContent=String(count);", {
      files: { 'helper.js': 'export const count = 7;' },
      scenarios: [{ name:'Absolute self import works', steps:[{ action:'assert', selector:'#count', property:'text', equals:'7' }] }]
    }, true],
    ['dead-control', '', { scenarios }, false, 'scenario']
  ]
  for (const [name, script, options, shouldPass, diagnostic] of cases) {
    const source = fixture(name, script, options.head)
    for (const [file, content] of Object.entries(options.files || {})) fs.writeFileSync(path.join(source, file), content)
    const result = await testEgg(source, options)
    console.log(JSON.stringify({ case: name, ok: result.ok, coverage: result.coverage, diagnostics: result.diagnostics, scenarios: result.scenarios }))
    assert.equal(result.ok, shouldPass, `${name}: ${result.error || JSON.stringify(result.diagnostics)}`)
    assert.equal(result.blank, false, `${name} must have visible static content`)
    if (diagnostic) assert.ok(result.diagnostics.some(item => new RegExp(`^(?:${diagnostic})$`).test(item.kind)), `${name}: diagnostic missing`)
    if (name === 'healthy') assert.equal(result.coverage.scenarios, 'passed')
    assert.equal(BrowserWindow.getAllWindows().length, 0, `${name}: leaked a window`)
    assert.equal(await lastTestSession.protocol.isProtocolHandled('egg'), false, `${name}: retained test protocol handler`)
  }
  const storageSource = fixture('storage-isolation', "await egg.storage.set('count',99); document.querySelector('#count').textContent=String(await egg.storage.get('count'));", '', ['storage'])
  fs.mkdirSync(path.join(storageSource, 'data'))
  fs.writeFileSync(path.join(storageSource, 'data/storage.json'), '{"count":0}')
  const storageResult = await testEgg(storageSource, { scenarios: [{ name: 'Isolated data write works', steps: [{ action:'assert', selector:'#count', property:'text', equals:'99' }] }] })
  assert.equal(storageResult.ok, true, JSON.stringify(storageResult.diagnostics))
  assert.equal(fs.readFileSync(path.join(storageSource, 'data/storage.json'), 'utf8'), '{"count":0}')
  console.log(JSON.stringify({ case: 'source-storage-unchanged', ok: storageResult.ok }))
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 100)
  const cancelled = await testEgg(fixture('cancelled', ''), { signal: controller.signal })
  clearTimeout(timer)
  assert.equal(cancelled.ok, false)
  assert.equal(cancelled.aborted, true)
  assert.equal(BrowserWindow.getAllWindows().length, 0)
  console.log(JSON.stringify({ case: 'cancelled', ok: cancelled.ok, aborted: cancelled.aborted }))
  console.log('PASS: isolated Electron runtime verification (9 cases)')
  app.exit(0)
}).catch(error => { console.error(error); app.exit(1) })
