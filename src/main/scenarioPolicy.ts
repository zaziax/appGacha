import { validateRuntimeScenarios, type RuntimeScenario } from './runtimeScenarios'

/** Once submitted, a regression obligation cannot disappear with a prose excuse.
 * Additional scenarios, assertions and settling waits are allowed. */
export function retainRegressionScenarios(previous: RuntimeScenario[], next: RuntimeScenario[]): RuntimeScenario[] {
  validateRuntimeScenarios(next)
  const canonical = (step: RuntimeScenario['steps'][number]) => JSON.stringify(Object.entries(step).sort(([a], [b]) => a.localeCompare(b)))
  if (new Set(next.map(s => s.name)).size !== next.length) throw new Error('Scenario names must be unique')
  for (const old of previous) {
    const replacement = next.find(s => s.name === old.name)
    if (!replacement) throw new Error('Cannot remove regression scenarios; a scenario_change_reason does not waive verification')
    let cursor = 0
    for (const step of old.steps.filter(s => s.action !== 'wait')) {
      const serialized = canonical(step)
      while (cursor < replacement.steps.length && canonical(replacement.steps[cursor]) !== serialized) cursor++
      if (cursor === replacement.steps.length) throw new Error('Cannot weaken regression scenarios; retain previous actions and assertions')
      cursor++
    }
  }
  return structuredClone(next)
}
