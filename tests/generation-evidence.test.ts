import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { closingGuidance, scenarioEvidence, sourceLines, toolFailureCode, verificationIdentity } from '../src/main/generationEvidence'
import type { RuntimeScenario } from '../src/main/runtimeScenarios'

let root: string
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'appgacha-evidence-test-')) })
afterEach(() => {
  if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('appgacha-evidence-test-')) throw new Error('Unsafe cleanup')
  fs.rmSync(root, { recursive: true, force: true })
})
const scenario: RuntimeScenario = { name: 'PRIVATE-NAME', steps: [{ action: 'fill', selector: '#PRIVATE-SELECTOR', value: 'PRIVATE-KEY' }, { action: 'assert', selector: '#result', property: 'text', equals: 'PRIVATE-RESULT' }] }

it('counts replacement excerpts including multiline, deletion and CRLF', () => {
  expect(sourceLines('')).toBe(0)
  expect(sourceLines('one')).toBe(1)
  expect(sourceLines('one\r\ntwo\r\nthree')).toBe(3)
})

it('fingerprints source, nested vendor, file deletion, data, and scenario definitions', () => {
  fs.mkdirSync(path.join(root, 'vendor'))
  fs.mkdirSync(path.join(root, 'data'))
  const seen = new Set<string | undefined>()
  const fresh = (scenarios: RuntimeScenario[] = []) => {
    const key = verificationIdentity(root, scenarios)
    expect(key).toMatch(/^[a-f0-9]{64}$/)
    expect(seen.has(key)).toBe(false)
    seen.add(key)
  }
  fresh()
  fs.writeFileSync(path.join(root, 'app.js'), 'one'); fresh()
  fs.writeFileSync(path.join(root, 'app.js'), 'two'); fresh()
  fs.writeFileSync(path.join(root, 'vendor/lib.js'), 'lib'); fresh()
  fs.writeFileSync(path.join(root, 'data/state.db'), 'private'); fresh()
  fs.writeFileSync(path.join(root, 'data/state.db'), 'changed'); fresh()
  fs.unlinkSync(path.join(root, 'vendor/lib.js')); fresh()
  fresh([scenario])
  fresh([{ ...scenario, steps: [...scenario.steps, { action: 'wait', ms: 100 }] }])
})

it('ignores host bookkeeping but disables reuse for inaccessible roots and links', () => {
  const key = verificationIdentity(root, [])
  for (const file of ['checkpoint.json', '.last-check.png', 'build-report.json']) fs.writeFileSync(path.join(root, file), 'updated')
  expect(verificationIdentity(root, [])).toBe(key)
  expect(verificationIdentity(path.join(root, 'missing'), [])).toBeUndefined()
  const nested = path.join(root, 'nested')
  fs.mkdirSync(nested)
  fs.symlinkSync(nested, path.join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir')
  expect(verificationIdentity(root, [])).toBeUndefined()
})

it('persists action/result evidence without test inputs, observed values or names', () => {
  const evidence = scenarioEvidence([scenario], [{ name: scenario.name, ok: false, steps: [
    { action: 'fill', ok: true, selector: '#PRIVATE-SELECTOR' },
    { action: 'assert', ok: false, observed: 'PRIVATE-OBSERVED', error: 'PRIVATE-ERROR' }
  ] }])
  expect(evidence[0]).toMatchObject({ index: 0, status: 'failed', steps: [{ action: 'fill', status: 'passed' }, { action: 'assert', status: 'failed' }] })
  expect(JSON.stringify(evidence)).not.toContain('PRIVATE')
  expect(scenarioEvidence([scenario])[0].status).toBe('not-run')
})

it('classifies failed edits without logging their content', () => {
  expect(toolFailureCode(new Error('old_text must match exactly once: PRIVATE'))).toBe('edit-match')
  expect(toolFailureCode(new Error('File changed since read'))).toBe('stale-file')
  expect(toolFailureCode(new Error('UNCLASSIFIED'))).toBe('tool-error')
})

it('starts wrap-up on turn, time or output pressure without lowering requirements', () => {
  expect(closingGuidance(44, 10 * 60_000, 224_999)).toBe('')
  for (const values of [[45, 0, 0], [1, 11 * 60_000, 0], [1, 0, 225_000]]) {
    const guidance = closingGuidance(...values as [number, number, number])
    expect(guidance).toContain('HOST WRAP-UP')
    expect(guidance).toContain('Do not drop requirements')
  }
})
