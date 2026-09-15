import { describe, expect, it } from 'vitest'
import { RuntimeDiagnostics } from '../src/main/runtimeDiagnostics'
import { validateRuntimeScenarios, abortable } from '../src/main/runtimeScenarios'

describe('runtime diagnostic evidence', () => {
  it('records a missing module even when the document itself loaded successfully', () => {
    const evidence = new RuntimeDiagnostics()
    evidence.cdp('Network.requestWillBeSent', { requestId: 'module', request: { url: 'egg://demo/store.js' } })
    evidence.cdp('Network.responseReceived', { requestId: 'module', response: { url: 'egg://demo/store.js', status: 404, statusText: 'Not Found' } })
    expect(evidence.items).toEqual([{ kind: 'resource', source: 'network', message: 'HTTP 404: Not Found', url: 'egg://demo/store.js', status: 404 }])
  })

  it('correlates network failures, catches startup throws/rejections, and CSP', () => {
    const evidence = new RuntimeDiagnostics()
    evidence.cdp('Network.requestWillBeSent', { requestId: 'module', request: { url: 'egg://demo/app.js' } })
    evidence.cdp('Network.loadingFailed', { requestId: 'module', errorText: 'net::ERR_BLOCKED_BY_CLIENT' })
    evidence.cdp('Runtime.exceptionThrown', { exceptionDetails: { exception: { description: 'Error: init failed' }, url: 'egg://demo/app.js', lineNumber: 2 } })
    evidence.cdp('Runtime.exceptionThrown', { exceptionDetails: { exception: { description: 'Uncaught (in promise) Error: rejected' } } })
    evidence.cdp('Log.entryAdded', { entry: { level: 'error', source: 'security', text: 'Refused to execute inline script' } })
    expect(evidence.items.map(item => item.kind)).toEqual(['resource', 'exception', 'unhandled-rejection', 'csp'])
    expect(evidence.items[0].url).toBe('egg://demo/app.js')
    expect(evidence.items[1].line).toBe(3)
  })

  it('handles page load-error evidence and only ignores explicitly optional host resources', () => {
    const evidence = new RuntimeDiagnostics(new Set(['egg://demo/icon.svg']))
    evidence.page({ kind: 'resource', message: 'Image failed', url: 'egg://demo/icon.svg' })
    evidence.page({ kind: 'resource', message: 'Module failed', url: 'egg://demo/app.js' })
    evidence.page({ kind: 'unhandled-rejection', message: 'setup rejected' })
    expect(evidence.items).toHaveLength(2)
    expect(evidence.items[0].url).toBe('egg://demo/app.js')
  })

  it('does not report healthy loading as an error and bounds repeated evidence', () => {
    const evidence = new RuntimeDiagnostics()
    evidence.cdp('Network.responseReceived', { response: { url: 'egg://demo/app.js', status: 200 } })
    expect(evidence.items).toEqual([])
    for (let i = 0; i < 300; i++) evidence.add({ kind: 'exception', source: 'test', message: `failure ${i}` })
    expect(evidence.items.length).toBeLessThanOrEqual(100)
  })
})

describe('bounded declarative scenarios', () => {
  it('accepts a click plus explicit observable change', () => {
    expect(() => validateRuntimeScenarios([{ name: 'Timer starts', steps: [
      { action: 'click', selector: '#start' }, { action: 'wait', ms: 1100 },
      { action: 'assert-change', selector: '#time', property: 'text' }
    ] }])).not.toThrow()
  })

  it('does not accept arbitrary scripts or clicks without an assertion', () => {
    expect(() => validateRuntimeScenarios([{ name: 'script', steps: [{ action: 'evaluate', script: 'process.exit()' } as any] }])).toThrow('Unsupported')
    expect(() => validateRuntimeScenarios([{ name: 'click only', steps: [{ action: 'click', selector: '#start' }] }])).toThrow('explicit assertion')
    expect(() => validateRuntimeScenarios([{ name: 'long wait', steps: [{ action: 'wait', ms: 999999 }] }])).toThrow('5000')
  })

  it('rejects an in-flight renderer operation immediately on cancellation', async () => {
    const controller = new AbortController()
    const pending = abortable(new Promise(() => {}), controller.signal)
    controller.abort(new Error('cancelled by user'))
    await expect(pending).rejects.toThrow('cancelled by user')
  })
})
