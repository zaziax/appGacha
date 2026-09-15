/** Runtime evidence is local to one test window; never telemetry or a model instruction. */
export interface RuntimeDiagnostic {
  kind: 'resource' | 'exception' | 'unhandled-rejection' | 'console' | 'csp' | 'preload' | 'navigation' | 'crash' | 'observer' | 'cancelled' | 'scenario'
  source: 'network' | 'runtime' | 'log' | 'page' | 'electron' | 'test'
  message: string
  url?: string
  line?: number
  column?: number
  status?: number
}

const MAX_DIAGNOSTICS = 100
const MAX_REQUESTS = 2000
const clipped = (value: unknown, size = 3000): string => String(value ?? '').slice(0, size)

/** Pure collector: also exercised without Electron by negative-case unit tests. */
export class RuntimeDiagnostics {
  readonly items: RuntimeDiagnostic[] = []
  private readonly keys = new Set<string>()
  private readonly requests = new Map<string, string>()

  constructor(private readonly ignoredResourceUrls: ReadonlySet<string> = new Set()) {}

  add(item: RuntimeDiagnostic): void {
    const normalized = {
      ...item,
      message: clipped(item.message),
      ...(item.url ? { url: clipped(item.url, 2000) } : {})
    }
    const key = JSON.stringify(normalized)
    if (this.keys.has(key) || this.items.length >= MAX_DIAGNOSTICS) return
    this.keys.add(key)
    this.items.push(normalized)
  }

  resource(message: string, url?: string, status?: number, source: RuntimeDiagnostic['source'] = 'network'): void {
    if (url && this.ignoredResourceUrls.has(url)) return
    this.add({ kind: 'resource', source, message, ...(url ? { url } : {}), ...(status !== undefined ? { status } : {}) })
  }

  cdp(method: string, params: Record<string, any>): void {
    if (method === 'Network.requestWillBeSent') {
      if (this.requests.size >= MAX_REQUESTS) this.requests.delete(this.requests.keys().next().value!)
      this.requests.set(params.requestId, clipped(params.request?.url, 2000))
    } else if (method === 'Network.responseReceived') {
      if (params.response?.status >= 400) {
        this.resource(`HTTP ${params.response.status}: ${params.response.statusText || 'resource load failed'}`, params.response.url, params.response.status)
      }
    } else if (method === 'Network.loadingFailed') {
      const url = this.requests.get(params.requestId)
      this.resource(`Resource load failed: ${params.errorText || 'unknown error'}${params.blockedReason ? ` (${params.blockedReason})` : ''}`, url)
      this.requests.delete(params.requestId)
    } else if (method === 'Network.loadingFinished') {
      this.requests.delete(params.requestId)
    } else if (method === 'Runtime.exceptionThrown') {
      const detail = params.exceptionDetails ?? {}
      const frame = detail.stackTrace?.callFrames?.[0]
      const message = detail.exception?.description || detail.exception?.value || detail.text || 'Uncaught exception'
      this.add({
        kind: /in promise|unhandled.*rejection/i.test(`${detail.text ?? ''} ${message}`) ? 'unhandled-rejection' : 'exception',
        source: 'runtime', message,
        url: detail.url || frame?.url,
        line: (detail.lineNumber ?? frame?.lineNumber ?? 0) + 1,
        column: (detail.columnNumber ?? frame?.columnNumber ?? 0) + 1
      })
    } else if (method === 'Log.entryAdded') {
      const entry = params.entry ?? {}
      if (entry.level === 'error') {
        if (entry.source === 'network') this.resource(entry.text || 'Resource load failed', entry.url, undefined, 'log')
        else this.add({ kind: entry.source === 'security' ? 'csp' : 'console', source: 'log', message: entry.text || 'Runtime error', url: entry.url })
      } else if (entry.level === 'warning' && /vendor\/[\w.-]+/.test(entry.text ?? '')) {
        this.add({ kind: 'console', source: 'log', message: `[依赖降级] ${entry.text}`, url: entry.url })
      }
    }
  }

  page(payload: unknown): void {
    if (!payload || typeof payload !== 'object') return
    const value = payload as Record<string, unknown>
    if (value.kind === 'resource') {
      this.resource(clipped(value.message), typeof value.url === 'string' ? value.url : undefined, undefined, 'page')
    } else if (value.kind === 'exception' || value.kind === 'unhandled-rejection' || value.kind === 'csp') {
      this.add({ kind: value.kind, source: 'page', message: clipped(value.message), ...(typeof value.url === 'string' ? { url: value.url } : {}) })
    }
  }

  clearRequests(): void { this.requests.clear() }
}

/** Runs in a named isolated renderer world, before any application module executes. */
export function runtimeObserverSource(bindingName: string): string {
  return `(() => {
    const report = value => { try { globalThis[${JSON.stringify(bindingName)}](JSON.stringify(value)) } catch {} };
    addEventListener('error', event => {
      const target = event.target;
      if (target && target !== window && (target.src || target.href)) {
        report({kind:'resource', message:'Element resource failed to load', url:target.src || target.href});
      } else {
        report({kind:'exception', message:event.message || 'Uncaught exception', url:event.filename || location.href});
      }
    }, true);
    addEventListener('unhandledrejection', event => {
      let message = 'Unhandled promise rejection';
      try { message = String(event.reason?.stack || event.reason || message).slice(0, 3000) } catch {}
      report({kind:'unhandled-rejection', message, url:location.href});
    });
    addEventListener('securitypolicyviolation', event => {
      report({kind:'csp', message:'Content Security Policy blocked ' + event.violatedDirective, url:event.blockedURI || location.href});
    });
  })()`
}
