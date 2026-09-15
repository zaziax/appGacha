import fs from 'node:fs'
import path from 'node:path'
import { analyzeProject } from './projectIndex'
import { validateEgg } from './validate'
import { testEgg } from './test'
import type { RuntimeScenario } from './runtimeScenarios'
import type { BuildVerification } from './fcDriver'
import { scenarioEvidence } from './generationEvidence'
import { logLine } from './log'

/** Keep uncertain dynamic dependencies rather than breaking a valid app to save space. */
export function pruneBuildResources(dir: string): void {
  const project = analyzeProject(dir)
  if (project.issues.length) return // Incomplete graphs must never destroy a recoverable draft.
  const referenced = new Set(project.imports.flatMap(ref => ref.target?.startsWith('vendor/') ? [ref.target.split('/')[1]] : []))
  const keepAll = project.warnings.some(issue => /import|动态|dynamic/i.test(issue.message))
  const vendor = path.join(dir, 'vendor')
  if (fs.existsSync(vendor) && !keepAll) {
    if (referenced.has('katex.esm.js')) referenced.add('katex')
    for (const file of fs.readdirSync(vendor)) if (!referenced.has(file)) fs.rmSync(path.join(vendor, file), { recursive: true, force: true })
    if (!fs.readdirSync(vendor).length) fs.rmdirSync(vendor)
  }
  // Remove authoring-only references only when the app does not actually load them.
  const used = new Set(project.imports.flatMap(ref => ref.target ? [ref.target] : []))
  for (const file of ['icons-manifest.json', 'guides', 'widget.css', 'widget.js']) {
    if ([...used].some(target => target === file || target.startsWith(file + '/'))) continue
    if (keepAll) continue
    fs.rmSync(path.join(dir, file), { recursive: true, force: true })
  }
  fs.rmSync(path.join(dir, '.last-check.png'), { force: true })
}

/** The host rechecks the actual deliverable after pruning, independently of the model. */
export async function verifyFinalArtifact(dir: string, signal: AbortSignal, scenarios: RuntimeScenario[] = []): Promise<BuildVerification> {
  const startedAt = Date.now()
  signal.throwIfAborted()
  const issues = validateEgg(dir)
  if (issues.length) throw new Error('Final artifact validation failed:\n' + issues.map(i => `[${i.file}] ${i.message}`).join('\n'))
  const result = await testEgg(dir, { signal, scenarios })
  signal.throwIfAborted()
  if (!result.ok || result.coverage?.startup !== 'passed') throw new Error('Final artifact runtime verification failed: ' + (result.error ?? [...result.consoleErrors, ...result.widgetIssues].join('; ')))
  if (scenarios.length && (result.coverage.scenarios !== 'passed' || result.scenarios.length !== scenarios.length || result.scenarios.some((item, index) => !item.ok || item.name !== scenarios[index].name))) {
    throw new Error('Final artifact did not pass all submitted interaction scenarios')
  }
  const verification: BuildVerification = {
    level: result.coverage?.scenarios === 'passed' && scenarios.length ? 'scenarios' : 'startup',
    scenariosPassed: result.scenarios?.filter(s => s.ok).length ?? 0
  }
  const evidence = scenarioEvidence(scenarios, result.scenarios)
  logLine('[fc] final verification:', { passed: true, durationMs: Date.now() - startedAt, ...verification, scenarios: evidence })
  fs.writeFileSync(path.join(dir, 'build-report.json'), JSON.stringify({ schemaVersion: 1, verifiedAt: new Date().toISOString(), ...verification,
    scenarios: evidence, externalServices: 'not-verified' }, null, 2))
  return verification
}
