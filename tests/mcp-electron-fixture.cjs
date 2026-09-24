const { app, protocol, BrowserWindow } = require('electron')
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
require('node:module').Module._initPaths()
const root = path.resolve(process.env.APPGACHA_MCP_TEST_ROOT || '')
if (path.dirname(root) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('appgacha-mcp-integration-')) throw new Error('Isolated test root required')
for (const name of ['profile', 'session', 'logs', 'crashes']) fs.mkdirSync(path.join(root, name), { recursive: true })
app.setPath('userData', path.join(root, 'profile')); app.setPath('sessionData', path.join(root, 'session')); app.setPath('logs', path.join(root, 'logs')); app.setPath('crashDumps', path.join(root, 'crashes'))
app.setAppPath(root)
app.disableHardwareAcceleration()
protocol.registerSchemesAsPrivileged([{ scheme: 'egg', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }])
app.on('window-all-closed', () => {})
app.whenReady().then(async () => {
  const { McpAuth, McpDrafts, McpBridge, EggStorage, installEggAtomically, registerCapabilities, validateEgg, testEgg, verifyFinalArtifact, registerEgg, getEgg, Client, StdioClientTransport } = require(path.join(root, 'main/runtime.cjs'))
  registerCapabilities()
  const auth = new McpAuth(path.join(root, 'auth.json')); auth.setEnabled(true)
  const { id, token } = auth.create('Integration agent')
  const shelf = process.env.APPGACHA_MCP_TEST_SHELF
  assert.ok(shelf && path.basename(shelf).startsWith('.mcp-test-shelf-'), 'Isolated destination shelf required')
  const defaultShelf = path.join(root, 'default-eggs')
  const seed = path.join(defaultShelf, '🍅 Copy check.gacha')
  fs.mkdirSync(path.join(seed, 'data'), { recursive: true })
  fs.writeFileSync(path.join(seed, 'data/egg.db-wal'), 'saved migration data')
  const storage = new EggStorage(path.join(root, 'profile/egg-storage.json'), defaultShelf)
  storage.schedule(shelf, true)
  assert.equal(storage.directory, defaultShelf)
  assert.equal((await storage.initialize()).error, undefined)
  assert.equal(storage.directory, shelf)
  assert.equal(fs.readFileSync(path.join(shelf, '🍅 Copy check.gacha/data/egg.db-wal'), 'utf8'), 'saved migration data')
  assert.ok(fs.existsSync(seed), 'original library must survive migration')
  const download = path.join(root, 'download')
  fs.mkdirSync(download)
  fs.writeFileSync(path.join(download, 'egg.db-wal'), 'replacement data')
  const replaced = path.join(shelf, '🍅 Copy check.gacha')
  installEggAtomically(download, replaced, true)
  assert.equal(fs.readFileSync(path.join(replaced, 'egg.db-wal'), 'utf8'), 'replacement data')
  assert.ok(fs.existsSync(path.join(seed, 'data/egg.db-wal')), 'original migration source remains untouched')
  console.log('PASS: destination-local atomic install using real Electron filesystem across source/shelf volumes')
  const service = new McpDrafts(path.join(root, 'drafts'), process.env.APPGACHA_MCP_TEST_TEMPLATE, storage.directory, {
    allowed: owner => auth.has(owner), busy: () => false, changed: () => {},
    check: async (dir, signal, scenarios, screenshotTo) => {
      const issues = validateEgg(dir)
      if (issues.length) return { ok: false, issues }
      const { screenshotPath, ...result } = await testEgg(dir, { signal, scenarios, screenshotTo })
      return result
    },
    verify: verifyFinalArtifact,
    registered: dir => registerEgg(dir),
  })
  const endpoint = path.join(root, 'endpoint.json'), bridge = new McpBridge(auth, service, endpoint)
  await bridge.start()
  // The actual bundled Electron runtime launches the connector, not system Node.
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'connector.cjs')], env: { ELECTRON_RUN_AS_NODE: '1', APPGACHA_MCP_ENDPOINT_FILE: endpoint, APPGACHA_MCP_TOKEN: token }, stderr: 'pipe' })
  const client = new Client({ name: 'integration', version: '1' })
  async function call(name, args = {}) {
    const result = await client.callTool({ name, arguments: args })
    assert.ok(!result.isError, JSON.stringify(result))
    return JSON.parse(result.content[0].text)
  }
  async function wait(job) {
    for (let i = 0; i < 150; i++) {
      const result = await call('get_job', { job_id: job.job_id, wait_ms: 10000 })
      if (result.state !== 'running') { assert.equal(result.state, 'succeeded', JSON.stringify(result)); return result.result }
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    throw new Error('Job timed out')
  }
  try {
    await client.connect(transport)
    const { draft_id } = await call('create_draft', { name: 'MCP Counter', wish: 'Create a persistent counter' })
    const source = path.join(root, 'drafts', draft_id, 'source')
    async function write(file, content) {
      // Real protocol read is exercised; the fixture reads its own source for precise hashing.
      await call('read_file', { draft_id, path: file })
      const expected_hash = createHash('sha256').update(fs.readFileSync(path.join(source, file))).digest('hex')
      return call('write_file', { draft_id, path: file, content, expected_hash })
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(source, 'manifest.json'), 'utf8'))
    manifest.permissions = ['storage']
    await write('manifest.json', JSON.stringify(manifest))
    await write('index.html', '<!doctype html><html><head><title>MCP Counter</title><link rel="stylesheet" href="base.css"><link rel="stylesheet" href="style.css"></head><body class="app-shell"><main class="content"><p id="count">0</p><button id="add">Add</button></main><script type="module" src="app.js"></script></body></html>')
    await write('style.css', '#count{font-size:48px} button{padding:24px}')
    await write('app.js', 'let count = (await egg.storage.get("count")) ?? 0; document.querySelector("#count").textContent=String(count); document.querySelector("#add").addEventListener("click", async () => {count++; await egg.storage.set("count",count); document.querySelector("#count").textContent=String(count)});')
    await call('write_file', { draft_id, path: 'icon.svg', content: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><circle cx="24" cy="24" r="18" fill="#56a"/></svg>', expected_hash: fs.existsSync(path.join(source, 'icon.svg')) ? createHash('sha256').update(fs.readFileSync(path.join(source, 'icon.svg'))).digest('hex') : 'new' })
    const scenarios = [{ name: 'Add persists count', steps: [{ action: 'click', selector: '#add' }, { action: 'wait', ms: 150 }, { action: 'assert', selector: '#count', property: 'text', equals: '1' }] }]
    const checked = await wait(await call('check_draft', { draft_id, scenarios }))
    assert.equal(checked.ok, true, JSON.stringify(checked))
    assert.equal(fs.existsSync(path.join(source, 'data')), false, 'test data leaked into draft')
    const preview = await client.callTool({ name: 'get_preview', arguments: { draft_id } })
    assert.equal(preview.content[0].type, 'image')
    const installed = await wait(await call('request_install', { draft_id }))
    assert.equal(installed.installed, true)
    const egg = getEgg(installed.egg_id)
    assert.ok(egg); assert.equal(egg.manifest.permissions[0], 'storage')
    assert.equal(path.dirname(egg.dir), shelf)
    console.log(JSON.stringify({ draftVolume: path.parse(root).root, shelfVolume: path.parse(shelf).root, directInstall: true }))
    assert.equal(fs.existsSync(path.join(egg.dir, 'data')), false)
    assert.equal(fs.existsSync(path.join(egg.dir, 'build-report.json')), true)
    assert.equal(BrowserWindow.getAllWindows().length, 0)
    console.log('PASS: real MCP stdio -> authenticated bridge -> source writes -> Electron interaction check/preview -> final verification -> direct shelf registration; no live AI or user data')
  } finally { await client.close(); bridge.stop() }
  app.exit(0)
}).catch(error => { console.error(error); app.exit(1) })
