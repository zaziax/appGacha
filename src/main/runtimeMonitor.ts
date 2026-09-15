import type { WebContents } from 'electron'
import { RuntimeDiagnostics, runtimeObserverSource } from './runtimeDiagnostics'
import { abortable } from './runtimeScenarios'

/** One monitor per newly-created test webContents. Never detach somebody else's debugger. */
export async function installRuntimeMonitor(contents: WebContents, evidence: RuntimeDiagnostics, signal: AbortSignal): Promise<() => void> {
  const debuggerApi = contents.debugger
  if (debuggerApi.isAttached()) throw new Error('Runtime inspection unavailable: debugger already attached')
  const bindingName = `__appgachaRuntimeEvidence${contents.id}`
  let owned = false
  let disposed = false
  const onMessage = (_event: unknown, method: string, params: Record<string, any>) => {
    if (disposed) return
    if (method === 'Runtime.bindingCalled' && params.name === bindingName) {
      try { evidence.page(JSON.parse(params.payload)) } catch { /* malformed diagnostic, not executable */ }
    } else evidence.cdp(method, params)
  }
  const onDetached = (_event: unknown, reason: string) => {
    if (!disposed && !signal.aborted) evidence.add({ kind: 'observer', source: 'electron', message: `Runtime observer detached before verification completed: ${reason}` })
  }
  const dispose = () => {
    if (disposed) return
    disposed = true
    debuggerApi.removeListener('message', onMessage)
    debuggerApi.removeListener('detach', onDetached)
    if (owned && !contents.isDestroyed() && debuggerApi.isAttached()) {
      try { debuggerApi.detach() } catch { /* window was destroyed concurrently */ }
    }
    evidence.clearRequests()
  }
  try {
    debuggerApi.attach('1.3')
    owned = true
    debuggerApi.on('message', onMessage)
    debuggerApi.on('detach', onDetached)
    for (const method of ['Network.enable', 'Runtime.enable', 'Log.enable', 'Page.enable']) {
      await abortable(debuggerApi.sendCommand(method), signal)
    }
    // No responses from another test/previous module cache may hide a missing file.
    await abortable(debuggerApi.sendCommand('Network.setCacheDisabled', { cacheDisabled: true }), signal)
    const worldName = `appgacha-runtime-test-${contents.id}`
    await abortable(debuggerApi.sendCommand('Runtime.addBinding', { name: bindingName, executionContextName: worldName }), signal)
    await abortable(debuggerApi.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
      source: runtimeObserverSource(bindingName), worldName
    }), signal)
    return dispose
  } catch (e) {
    dispose()
    throw e
  }
}
