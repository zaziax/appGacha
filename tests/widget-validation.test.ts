import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { validateEgg } from '../src/main/validate'

const dirs: string[] = []

function makeEgg(indexHtml: string, includeShell = true): string {
  const dir = mkdtempSync(join(tmpdir(), 'widget-validation-'))
  dirs.push(dir)
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({
    eggId: 'widget-test', name: 'Widget Test', version: '1.0.0', hostApiVersion: '1', permissions: [],
    window: { type: 'widget', width: 320, height: 420 }
  }))
  writeFileSync(join(dir, 'index.html'), indexHtml)
  writeFileSync(join(dir, 'style.css'), '')
  writeFileSync(join(dir, 'app.js'), '')
  if (includeShell) {
    writeFileSync(join(dir, 'widget.css'), '')
    writeFileSync(join(dir, 'widget.js'), '')
  }
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('widget shell validation', () => {
  it('rejects a widget that rebuilds its own unconstrained page', () => {
    const dir = makeEgg('<!doctype html><html><body><main>clock</main></body></html>', false)
    const messages = validateEgg(dir).map(issue => issue.message)
    expect(messages).toContain('widget 必须引用受保护的 widget.css')
    expect(messages).toContain('widget 必须引用受保护的 widget.js')
    expect(messages).toContain('widget 的 body 必须使用 widget-body')
    expect(messages).toContain('widget 缺少 class="widget-shell" data-widget-shell 根节点')
  })

  it('accepts the required shape-neutral shell structure', () => {
    const dir = makeEgg(`<!doctype html><html><head>
      <link rel="stylesheet" href="widget.css"><link rel="stylesheet" href="style.css">
      </head><body class="widget-body">
      <main class="widget-shell" data-widget-shell><div class="widget-surface" data-widget-surface><section class="widget-page" data-widget-page="main" data-active="true">Clock</section></div></main>
      <script type="module" src="widget.js"></script><script type="module" src="app.js"></script>
      </body></html>`)
    const widgetIssues = validateEgg(dir).filter(issue => issue.message.startsWith('widget'))
    expect(widgetIssues).toEqual([])
  })
})
