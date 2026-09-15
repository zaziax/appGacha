export type ScenarioProperty = 'text' | 'value'
export type RuntimeScenarioStep =
  | { action: 'click'; selector: string }
  | { action: 'fill'; selector: string; value: string }
  | { action: 'wait'; ms: number }
  | { action: 'assert'; selector: string; property: ScenarioProperty; equals?: string; contains?: string }
  | { action: 'assert-change'; selector: string; property: ScenarioProperty }

export interface RuntimeScenario { name: string; steps: RuntimeScenarioStep[] }
export interface ScenarioStepEvidence {
  action: RuntimeScenarioStep['action']
  ok: boolean
  selector?: string
  observed?: string
  before?: string
  expected?: string
  error?: string
}
export interface RuntimeScenarioResult { name: string; ok: boolean; steps: ScenarioStepEvidence[]; error?: string }

export function validateRuntimeScenarios(scenarios: RuntimeScenario[]): void {
  if (!Array.isArray(scenarios) || scenarios.length > 5) throw new Error('At most 5 runtime scenarios are allowed')
  let waitMs = 0
  for (const scenario of scenarios) {
    if (typeof scenario.name !== 'string' || !scenario.name.trim() || scenario.name.length > 120) throw new Error('Scenario name must be 1–120 characters')
    if (!Array.isArray(scenario.steps) || !scenario.steps.length || scenario.steps.length > 30) throw new Error('Scenario must have 1–30 steps')
    let assertions = 0
    for (const step of scenario.steps) {
      if (!step || !['click', 'fill', 'wait', 'assert', 'assert-change'].includes(step.action)) throw new Error('Unsupported scenario action')
      if (step.action === 'wait') {
        if (!Number.isInteger(step.ms) || step.ms < 0 || step.ms > 5000) throw new Error('Scenario wait must be 0–5000 ms')
        waitMs += step.ms
        continue
      }
      if (typeof step.selector !== 'string' || !step.selector || step.selector.length > 512) throw new Error('Scenario selector must be 1–512 characters')
      if (step.action === 'fill' && (typeof step.value !== 'string' || step.value.length > 2000)) throw new Error('Scenario input is too long')
      if (step.action === 'assert' || step.action === 'assert-change') {
        assertions++
        if (step.property !== 'text' && step.property !== 'value') throw new Error('Only text/value assertions are supported')
        if (step.action === 'assert') {
          if (step.equals !== undefined && typeof step.equals !== 'string' || step.contains !== undefined && typeof step.contains !== 'string') throw new Error('Assertion values must be strings')
          if ((typeof step.equals === 'string') === (typeof step.contains === 'string')) throw new Error('Assertion needs exactly one of equals/contains')
          if ((step.equals ?? step.contains ?? '').length > 2000) throw new Error('Assertion text is too long')
        }
      }
    }
    if (!assertions) throw new Error('Scenario needs an explicit assertion; clicks alone do not prove functionality')
  }
  if (waitMs > 15_000) throw new Error('Total scenario wait exceeds 15 seconds')
}

export function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : Object.assign(new Error('Runtime test cancelled'), { name: 'AbortError' })
}

/** Attach the rejection handler immediately so a late renderer rejection is never unhandled. */
export function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(abortReason(signal))
    signal.addEventListener('abort', abort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
    if (signal.aborted) abort()
  })
}

export function waitForRuntime(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = () => { signal.removeEventListener('abort', abort); resolve() }
    const timer = setTimeout(finish, ms)
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(abortReason(signal)) }
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
  })
}

/** Only fixed renderer operations; selectors and strings are serialized data, never source code. */
function scenarioCommand(command: Record<string, unknown>): string {
  return `(() => {
    const command = ${JSON.stringify(command)};
    const matches = document.querySelectorAll(command.selector);
    if (matches.length !== 1) throw new Error('Selector must match exactly one element: ' + command.selector);
    const element = matches[0];
    if (command.property === 'value' && !(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) throw new Error('Value assertion requires an input, textarea or select');
    const read = () => command.property === 'value' ? String(element.value ?? '') : String(element.textContent ?? '').trim();
    if (command.action === 'read') return read().slice(0, 2000);
    if (!(element instanceof HTMLElement)) throw new Error('Element is not an HTML control');
    const style = getComputedStyle(element), rect = element.getBoundingClientRect();
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0 || rect.width <= 0 || rect.height <= 0 || element.closest('[inert]') || element.disabled) throw new Error('Control is not interactive');
    const x = Math.max(0, Math.min(innerWidth - 1, rect.left + rect.width / 2));
    const y = Math.max(0, Math.min(innerHeight - 1, rect.top + rect.height / 2));
    const hit = document.elementFromPoint(x, y);
    if (!hit || (hit !== element && !element.contains(hit))) throw new Error('Control is covered or outside the viewport');
    if (command.action === 'click') { element.click(); return ''; }
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) throw new Error('Fill requires an input, textarea or select');
    if (element.readOnly) throw new Error('Read-only controls cannot be filled');
    if (element instanceof HTMLInputElement && element.type === 'file') throw new Error('File inputs are not allowed in scenarios');
    const proto = element instanceof HTMLInputElement ? HTMLInputElement.prototype : element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLSelectElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(element, command.value);
    element.dispatchEvent(new Event('input', { bubbles:true }));
    element.dispatchEvent(new Event('change', { bubbles:true }));
    return String(element.value).slice(0, 2000);
  })()`
}

export async function runRuntimeScenarios(
  scenarios: RuntimeScenario[],
  execute: (source: string) => Promise<unknown>,
  signal: AbortSignal
): Promise<RuntimeScenarioResult[]> {
  validateRuntimeScenarios(scenarios)
  const results: RuntimeScenarioResult[] = []
  for (const scenario of scenarios) {
    if (signal.aborted) throw abortReason(signal)
    const result: RuntimeScenarioResult = { name: scenario.name, ok: false, steps: [] }
    results.push(result)
    const initial = new Map<string, string>()
    const read = async (selector: string, property: ScenarioProperty) => String(await abortable(execute(scenarioCommand({ action: 'read', selector, property })), signal))
    try {
      for (const step of scenario.steps) {
        if (step.action === 'assert-change') initial.set(`${step.property}:${step.selector}`, await read(step.selector, step.property))
      }
      for (const step of scenario.steps) {
        if (signal.aborted) throw abortReason(signal)
        const evidence: ScenarioStepEvidence = { action: step.action, ok: false, ...('selector' in step ? { selector: step.selector } : {}) }
        result.steps.push(evidence)
        try {
          if (step.action === 'wait') await waitForRuntime(step.ms, signal)
          else if (step.action === 'click' || step.action === 'fill') {
            evidence.observed = String(await abortable(execute(scenarioCommand(step)), signal))
          } else {
            evidence.observed = await read(step.selector, step.property)
            if (step.action === 'assert-change') {
              evidence.before = initial.get(`${step.property}:${step.selector}`)
              if (evidence.observed === evidence.before) throw new Error('Value did not change from the start of the scenario')
            } else {
              evidence.expected = step.equals ?? `contains: ${step.contains}`
              if (step.equals !== undefined ? evidence.observed !== step.equals : !evidence.observed.includes(step.contains!)) throw new Error('Assertion did not match')
            }
          }
          evidence.ok = true
        } catch (e) {
          evidence.error = (e as Error).message
          throw e
        }
      }
      result.ok = true
    } catch (e) {
      if (signal.aborted) throw abortReason(signal)
      result.error = (e as Error).message
      break // Do not run another scenario on state whose setup/interaction already failed.
    }
  }
  return results
}
