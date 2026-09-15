import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ validate: vi.fn(), runtime: vi.fn() }))
vi.mock('../src/main/validate', () => ({ validateEgg: mocks.validate }))
vi.mock('../src/main/test', () => ({ testEgg: mocks.runtime }))
vi.mock('../src/main/log', () => ({ logLine: vi.fn() }))
import { pruneBuildResources, verifyFinalArtifact } from '../src/main/finalArtifact'
import { analyzeProject } from '../src/main/projectIndex'
import type { RuntimeScenario } from '../src/main/runtimeScenarios'

let root: string
const scenarios: RuntimeScenario[] = [{ name: 'Timer starts', steps: [{ action: 'click', selector: '#start' }, { action: 'assert-change', selector: '#time', property: 'text' }] }]
const reportPath = () => path.join(root, 'build-report.json')
function write(file: string, content = '') {
  const target = path.join(root, file)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, content)
}
function exists(file: string) { return fs.existsSync(path.join(root, file)) }
function healthy() {
  return { ok: true, blank: false, crashed: false, consoleErrors: [], widgetIssues: [], diagnostics: [],
    coverage: { startup: 'passed', scenarios: 'not-run' }, scenarios: [] }
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'appgacha-artifact-test-'))
  mocks.validate.mockReset().mockReturnValue([])
  mocks.runtime.mockReset().mockResolvedValue(healthy())
})
afterEach(() => {
  if (!path.basename(root).startsWith('appgacha-artifact-test-') || path.dirname(root) !== os.tmpdir()) throw new Error('Unsafe test cleanup')
  fs.rmSync(root, { recursive: true, force: true })
})

describe('dependency-aware artifact pruning', () => {
  it('preserves src → vendor → vendor modules and recursive CSS/font resources', () => {
    write('index.html', '<script type="module" src="./src/app.js"></script><link rel="stylesheet" href="./vendor/theme.css">')
    write('src/app.js', 'import { chart } from "../vendor/chart.js"; export { chart };')
    write('vendor/chart.js', 'import { value } from "./internal/helper.js"; export const chart = value;')
    write('vendor/internal/helper.js', 'export { value } from "../leaf.js";')
    write('vendor/leaf.js', 'export const value = 1;')
    write('vendor/theme.css', '@import "./themes/colors.css"; @font-face { font-family: test; src: url("./fonts/font.woff2"); }')
    write('vendor/themes/colors.css', ':root { --accent: red; }')
    write('vendor/fonts/font.woff2', 'test-font-bytes')
    write('vendor/unused.js', 'export const unused = true;')
    expect(analyzeProject(root).issues).toEqual([])
    pruneBuildResources(root)
    for (const file of ['vendor/chart.js', 'vendor/internal/helper.js', 'vendor/leaf.js', 'vendor/theme.css', 'vendor/themes/colors.css', 'vendor/fonts/font.woff2']) expect(exists(file), file).toBe(true)
    expect(exists('vendor/unused.js')).toBe(false)
    expect(analyzeProject(root).issues).toEqual([])
  })

  it('retains all possible libraries and authoring resources for computed dynamic imports', () => {
    write('index.html', '<script type="module" src="./app.js"></script>')
    write('app.js', 'export const load = name => import("./vendor/" + name + ".js");')
    write('vendor/a.js', 'export const a = 1;')
    write('vendor/b.js', 'export const b = 2;')
    write('guides/guide.md', 'guide')
    write('widget.js', '// protected shell')
    pruneBuildResources(root)
    for (const file of ['vendor/a.js', 'vendor/b.js', 'guides/guide.md', 'widget.js']) expect(exists(file), file).toBe(true)
  })

  it('also detects computed imports inside a referenced vendor library', () => {
    write('index.html', '<script type="module" src="./app.js"></script>')
    write('app.js', 'export { load } from "./vendor/main.js";')
    write('vendor/main.js', 'export const load = name => import(name);')
    write('vendor/plugin.js', 'export default 1;')
    pruneBuildResources(root)
    expect(exists('vendor/plugin.js')).toBe(true)
  })

  it('retains the KaTeX companion asset directory', () => {
    write('app.js', 'import katex from "./vendor/katex.esm.js"; export { katex };')
    write('vendor/katex.esm.js', 'export default {};')
    write('vendor/katex/fonts/roman.woff2', 'font')
    write('vendor/unrelated.js', 'export default {};')
    pruneBuildResources(root)
    expect(exists('vendor/katex/fonts/roman.woff2')).toBe(true)
    expect(exists('vendor/unrelated.js')).toBe(false)
  })

  it('keeps referenced host resources and removes only unused authoring resources', () => {
    write('index.html', '<script src="./widget.js"></script><link rel="stylesheet" href="./widget.css"><script type="module" src="./guides/help.js"></script>')
    write('widget.js', '// shell')
    write('widget.css', '.widget { display: block; }')
    write('guides/help.js', 'export const help = true;')
    write('icons-manifest.json', '{}')
    pruneBuildResources(root)
    for (const file of ['widget.js', 'widget.css', 'guides/help.js']) expect(exists(file), file).toBe(true)
    expect(exists('icons-manifest.json')).toBe(false)
  })

  it('does not destructively prune from an incomplete or invalid dependency graph', () => {
    write('app.js', 'import { broken syntax')
    write('vendor/needed-after-repair.js', 'export const value = 1;')
    write('guides/repair.md', 'guide')
    expect(analyzeProject(root).issues.length).toBeGreaterThan(0)
    try { pruneBuildResources(root) } catch { /* Refusing pruning is also a safe outcome. */ }
    expect(exists('vendor/needed-after-repair.js')).toBe(true)
    expect(exists('guides/repair.md')).toBe(true)
  })
})

describe('final deliverable verification (runtime mocked)', () => {
  it('persists structural step evidence and always reruns final verification', async () => {
    mocks.runtime.mockResolvedValue({ ...healthy(), coverage: { startup: 'passed', scenarios: 'passed' },
      scenarios: [{ name: scenarios[0].name, ok: true, steps: [
        { action: 'click', ok: true, selector: '#PRIVATE-SELECTOR' },
        { action: 'assert-change', ok: true, observed: 'PRIVATE-OBSERVED' }
      ] }] })
    const signal = new AbortController().signal
    await verifyFinalArtifact(root, signal, scenarios)
    await verifyFinalArtifact(root, signal, scenarios)
    expect(mocks.runtime).toHaveBeenCalledTimes(2)
    const report = fs.readFileSync(reportPath(), 'utf8')
    expect(JSON.parse(report).scenarios[0]).toMatchObject({ index: 0, status: 'passed', steps: [
      { action: 'click', status: 'passed' }, { action: 'assert-change', status: 'passed' }
    ] })
    expect(report).not.toContain('PRIVATE')
    expect(report).not.toContain(scenarios[0].name)
  })
  it('records startup-only evidence truthfully when no core scenarios were submitted', async () => {
    const signal = new AbortController().signal
    await expect(verifyFinalArtifact(root, signal)).resolves.toEqual({ level: 'startup', scenariosPassed: 0 })
    expect(mocks.runtime).toHaveBeenCalledWith(root, { signal, scenarios: [] })
    expect(JSON.parse(fs.readFileSync(reportPath(), 'utf8'))).toMatchObject({ schemaVersion: 1, level: 'startup', scenariosPassed: 0 })
  })

  it('requires and records the submitted scenarios on the actual deliverable', async () => {
    mocks.runtime.mockResolvedValueOnce({ ...healthy(), coverage: { startup: 'passed', scenarios: 'passed' }, scenarios: [{ name: scenarios[0].name, ok: true, steps: [] }] })
    await expect(verifyFinalArtifact(root, new AbortController().signal, scenarios)).resolves.toEqual({ level: 'scenarios', scenariosPassed: 1 })
    expect(mocks.runtime.mock.calls[0][1].scenarios).toEqual(scenarios)
  })

  it('does not run or produce evidence after cancellation', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(verifyFinalArtifact(root, controller.signal, scenarios)).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.validate).not.toHaveBeenCalled()
    expect(mocks.runtime).not.toHaveBeenCalled()
    expect(exists('build-report.json')).toBe(false)
  })

  it('rejects even a late successful result after cancellation', async () => {
    const controller = new AbortController()
    mocks.runtime.mockImplementationOnce(async () => { controller.abort(); return healthy() })
    await expect(verifyFinalArtifact(root, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(exists('build-report.json')).toBe(false)
  })

  it('refuses structural failures without running the artifact or recording success', async () => {
    mocks.validate.mockReturnValueOnce([{ file: 'app.js', message: 'missing src/store.js' }])
    await expect(verifyFinalArtifact(root, new AbortController().signal)).rejects.toThrow('Final artifact validation failed')
    expect(mocks.runtime).not.toHaveBeenCalled()
    expect(exists('build-report.json')).toBe(false)
  })

  it('refuses runtime failures without producing a success report', async () => {
    mocks.runtime.mockResolvedValueOnce({ ...healthy(), ok: false, consoleErrors: ['module load failed'] })
    await expect(verifyFinalArtifact(root, new AbortController().signal)).rejects.toThrow('Final artifact runtime verification failed')
    expect(exists('build-report.json')).toBe(false)
  })

  it.each([
    { name: 'startup not run', result: { ...healthy(), coverage: { startup: 'not-run', scenarios: 'not-run' } }, scenarios: [] },
    { name: 'missing startup evidence', result: { ...healthy(), coverage: undefined }, scenarios: [] },
    { name: 'requested scenarios not run', result: healthy(), scenarios },
    { name: 'missing scenario results', result: { ...healthy(), coverage: { startup: 'passed', scenarios: 'passed' } }, scenarios },
    { name: 'different scenarios were tested', result: { ...healthy(), coverage: { startup: 'passed', scenarios: 'passed' }, scenarios: [{ name: 'Unrelated trivial scenario', ok: true, steps: [] }] }, scenarios },
    { name: 'failed scenario under a success flag', result: { ...healthy(), coverage: { startup: 'passed', scenarios: 'passed' }, scenarios: [{ name: scenarios[0].name, ok: false, steps: [] }] }, scenarios }
  ])('does not publish without sufficient evidence: $name', async test => {
    mocks.runtime.mockResolvedValueOnce(test.result)
    await expect(verifyFinalArtifact(root, new AbortController().signal, test.scenarios)).rejects.toThrow()
    expect(exists('build-report.json')).toBe(false)
  })
})
