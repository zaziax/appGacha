import { app } from 'electron'
import path from 'node:path'
import { McpAuth } from './auth'
import { McpBridge } from './bridge'
import { McpDrafts } from './drafts'
import { appRoot, dataRoot } from '../paths'
import { validateEgg } from '../validate'
import { testEgg } from '../test'
import { verifyFinalArtifact } from '../finalArtifact'
import { getEgg, registerEgg } from '../eggs'
import { isGachaBusy } from '../pipeline'
import { setExternalBuildActive } from '../buildActivity'
import { sendToShelf } from '../shelfWindow'
import type { McpConnectionConfig, McpStatus } from '../../shared/mcp'

let host: ReturnType<typeof createHost> | undefined
function createHost() {
  const root = path.join(app.getPath('userData'), 'mcp')
  const endpointFile = path.join(root, 'endpoint.json')
  const auth = new McpAuth(path.join(root, 'connections.json'))
  const drafts = new McpDrafts(path.join(root, 'drafts'), appRoot('template'), dataRoot('eggs'), {
    allowed: owner => auth.has(owner), busy: isGachaBusy, activity: setExternalBuildActive,
    changed: () => sendToShelf('mcp:changed', {}),
    check: async (dir, signal, scenarios, screenshotTo) => {
      signal.throwIfAborted()
      const issues = validateEgg(dir)
      if (issues.length) return { ok: false, phase: 'structure', issues }
      const { screenshotPath: _path, ...result } = await testEgg(dir, { signal, scenarios, screenshotTo })
      return { ...result, phase: 'runtime' }
    },
    verify: verifyFinalArtifact,
    installed: id => !!getEgg(id),
    registered: dir => {
      const egg = registerEgg(dir)
      try { sendToShelf('shelf:eggsChanged', { eggId: egg.eggId }) } catch { /* A closing shelf must not undo a registered app. */ }
    },
  })
  const bridge = new McpBridge(auth, drafts, endpointFile)
  let queue = Promise.resolve()
  return {
    auth, drafts, bridge,
    status: (): McpStatus => ({ enabled: auth.enabled, running: bridge.running, connections: auth.list(), drafts: drafts.list() }),
    toggle: (enabled: boolean) => {
      const next = queue.then(async () => {
        if (!enabled) { auth.setEnabled(false); bridge.stop() }
        else { await bridge.start(); auth.setEnabled(true) }
      })
      queue = next.catch(() => {})
      return next
    },
    connect: (name: string): McpConnectionConfig => {
      if (!bridge.running) throw new Error('Enable MCP first')
      const { id, token } = auth.create(name)
      // ELECTRON_RUN_AS_NODE uses the bundled runtime; no separate Node install.
      // The script remains inside app.asar in a packaged app (Electron understands it).
      return { id, config: { mcpServers: { appgacha: {
        command: process.execPath, args: [path.join(app.getAppPath(), 'dist', 'mcp', 'stdio.js')],
        env: { ELECTRON_RUN_AS_NODE: '1', APPGACHA_MCP_ENDPOINT_FILE: endpointFile, APPGACHA_MCP_TOKEN: token },
      } } } }
    },
  }
}
function current() { return host ??= createHost() }
export function getMcpStatus() { return current().status() }
export async function setMcpEnabled(enabled: boolean) { await current().toggle(enabled); return current().status() }
export function createMcpConnection(name: string) { return current().connect(name) }
export function revokeMcpConnection(id: string) { current().auth.revoke(id); current().drafts.stop(id); return current().status() }
export function discardMcpDraft(id: string) { current().drafts.discard(id); return current().status() }
export async function initMcp() { const h = current(); if (h.auth.enabled) await h.toggle(true) }
export function stopMcp() { host?.bridge.stop() }
