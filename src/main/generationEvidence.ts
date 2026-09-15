import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import type { RuntimeScenario, RuntimeScenarioResult } from './runtimeScenarios'

export const evidenceHash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value) ?? 'null').digest('hex')
export const sourceLines = (text: string): number => text ? text.split(/\r\n|\r|\n/).length : 0

/** Session-local cache identity. Include data and dependencies, never log their contents.
 * Only host-owned bookkeeping is excluded; links/large trees disable reuse safely. */
export function verificationIdentity(dir: string, scenarios: RuntimeScenario[]): string | undefined {
  try {
    const hash = createHash('sha256').update(evidenceHash({ scenarios, platform: process.platform, versions: process.versions }))
    let bytes = 0, files = 0
    const walk = (folder: string, prefix: string) => {
      for (const entry of fs.readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        if (!prefix && ['checkpoint.json', '.checkpoint.tmp', '.last-check.png', 'build-report.json'].includes(entry.name)) continue
        const relative = prefix + entry.name
        const target = path.join(folder, entry.name)
        if (entry.isSymbolicLink()) throw new Error('uncacheable-link')
        hash.update(JSON.stringify([relative, entry.isDirectory() ? 'directory' : 'file']))
        if (entry.isDirectory()) walk(target, relative + '/')
        else if (entry.isFile()) {
          const size = fs.statSync(target).size
          bytes += size
          if (++files > 4096 || bytes > 64 * 1024 * 1024) throw new Error('uncacheable-size')
          hash.update(createHash('sha256').update(fs.readFileSync(target)).digest())
        } else throw new Error('uncacheable-entry')
      }
    }
    walk(dir, '')
    return hash.digest('hex')
  } catch { return undefined }
}

/** Structural evidence only: no scenario names, selectors, inputs, assertions or observed data. */
export function scenarioEvidence(definitions: RuntimeScenario[], results: RuntimeScenarioResult[] = []) {
  return definitions.map((scenario, index) => ({
    index, definitionHash: evidenceHash(scenario),
    status: !results[index] ? 'not-run' : results[index].ok ? 'passed' : 'failed',
    steps: scenario.steps.map((step, stepIndex) => ({
      index: stepIndex, action: step.action,
      status: !results[index]?.steps?.[stepIndex] ? 'not-run' : results[index].steps[stepIndex].ok ? 'passed' : 'failed',
      ...(!results[index]?.steps?.[stepIndex]?.ok && results[index]?.steps?.[stepIndex]?.error
        ? { failureCode: scenarioFailureCode(results[index].steps[stepIndex].error!) } : {})
    }))
  }))
}

export function scenarioFailureCode(message: string): string {
  if (/Selector must match exactly one/i.test(message)) return 'selector-cardinality'
  if (/not interactive|covered or outside/i.test(message)) return 'control-not-interactive'
  if (/did not change|unchanged/i.test(message)) return 'value-unchanged'
  if (/assertion|expected/i.test(message)) return 'assertion-failed'
  if (/requires an input|read-only|file inputs/i.test(message)) return 'unsupported-control'
  if (/timeout|timed out/i.test(message)) return 'timeout'
  return 'scenario-step-error'
}

/** Classify failures without persisting arbitrary model/project text or secrets. */
export function toolFailureCode(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  if (/changed since read|stale/i.test(message)) return 'stale-file'
  if (/match exactly once|old_text/i.test(message)) return 'edit-match'
  if (/set_plan/i.test(message)) return 'plan-required'
  if (/scenario/i.test(message)) return 'scenario-definition'
  if (/path|private|protected|symbolic|filename/i.test(message)) return 'workspace-path'
  if (/ENOENT/i.test(message)) return 'file-not-found'
  if (/too large|exceeds|limit/i.test(message)) return 'size-limit'
  return 'tool-error'
}

export function closingGuidance(turnsUsed: number, elapsedMs: number, outputUsed: number): string {
  if (turnsUsed < 45 && elapsedMs < 11 * 60_000 && outputUsed < 225_000) return ''
  return '[HOST WRAP-UP]\nPrioritize remaining requested core functionality and regression checks. Batch related safe edits, then check once. Do not add optional polish or new scope. Once requested outcomes pass, call finish promptly. Do not drop requirements, weaken assertions, or claim unverified success to fit the remaining budget. If blocked, preserve evidence and the draft.'
}
