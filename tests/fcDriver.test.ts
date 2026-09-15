import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ stream: vi.fn(), validate: vi.fn(), runtime: vi.fn(), endpoint: vi.fn(), wait: vi.fn(), fetch: vi.fn(), log: vi.fn() }))
vi.mock('../src/main/settings', () => ({ getAiSettings: () => ({ contextTokens: 256_000 }) }))
vi.mock('../src/main/validate', () => ({ validateEgg: mocks.validate }))
vi.mock('../src/main/test', () => ({ testEgg: mocks.runtime }))
vi.mock('../src/main/aiChannel', () => ({ resolveAiEndpoint: mocks.endpoint, chatCompletionFetch: mocks.fetch }))
vi.mock('../src/main/log', () => ({ logLine: mocks.log }))
vi.mock('../src/main/fcStream', async importOriginal => ({ ...await importOriginal<object>(), streamCompletion: mocks.stream }))
vi.mock('../src/main/runtimeScenarios', async importOriginal => ({ ...await importOriginal<object>(), waitForRuntime: mocks.wait }))
import { runFcDriver, type DriverJob } from '../src/main/fcDriver'
import { CompletionStreamError, HttpError, type StreamResult, type StreamToolCall } from '../src/main/fcStream'
import { checkpointMessages, compactMessages } from '../src/main/fcContext'
import type { RuntimeScenario } from '../src/main/runtimeScenarios'

let root: string
let staging: string
let template: string
let snapshots: NonNullable<DriverJob['resume']>[]
let histories: unknown[][]
let callId = 0

const scenario: RuntimeScenario = { name: 'Start timer', steps: [{ action: 'click', selector: '#start' }, { action: 'assert-change', selector: '#remaining', property: 'text' }] }
const plan = () => toolCall('set_plan', { summary: 'Implement the timer', files: ['app.js'], outcomes: ['Starting the timer changes remaining time'] })
function toolCall(name: string, args: object): StreamToolCall {
  return { id: `call_${++callId}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }
}
function answer(calls: StreamToolCall[], extra: Partial<StreamResult> = {}): StreamResult {
  return { message: { role: 'assistant', content: null, tool_calls: calls }, estimatedTokens: 100, finishReason: 'tool_calls', ...extra }
}
function job(extra: Partial<DriverJob> = {}): DriverJob {
  return {
    wish: 'Build a working timer', stagingDir: staging, templateDir: template, maxRounds: 3, lang: 'en',
    onStage: vi.fn(), onCheckpoint: state => snapshots.push(structuredClone(state)), ...extra
  }
}
function replies(...results: StreamResult[]) {
  mocks.stream.mockImplementation(async (_endpoint, messages) => {
    histories.push(structuredClone(messages))
    const result = results.shift()
    if (!result) throw new Error('Test has no further model replies; no network was called')
    return result
  })
}

/** OpenAI-compatible tool responses must precede the next user/assistant turn. */
function assertLegalHistory(messages: unknown[]) {
  let pending = new Set<string>()
  for (const raw of messages) {
    const message = raw as { role: string; tool_call_id?: string; tool_calls?: StreamToolCall[] }
    if (message.role === 'tool') {
      expect(pending.has(message.tool_call_id!)).toBe(true)
      pending.delete(message.tool_call_id!)
    } else {
      expect([...pending], 'all tool calls must have contiguous replies before the next turn').toEqual([])
      if (message.role === 'assistant') pending = new Set((message.tool_calls ?? []).map(call => call.id))
    }
  }
  expect([...pending]).toEqual([])
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'appgacha-driver-test-'))
  staging = path.join(root, 'egg')
  template = path.join(root, 'template')
  fs.mkdirSync(staging)
  fs.mkdirSync(template)
  fs.writeFileSync(path.join(template, 'EGG_GUIDE.md'), 'Host test guide')
  fs.writeFileSync(path.join(template, 'egg.d.ts'), 'declare const egg: unknown;')
  fs.writeFileSync(path.join(staging, 'index.html'), '<button id="start">Start</button><p id="remaining">25:00</p>')
  snapshots = []
  histories = []
  callId = 0
  for (const mock of Object.values(mocks)) mock.mockReset()
  mocks.endpoint.mockResolvedValue({ kind: 'direct', model: 'test-model', baseURL: 'https://invalid.test', apiKey: 'not-real' })
  mocks.validate.mockReturnValue([])
  mocks.runtime.mockImplementation(async (_directory, options) => ({
    ok: true, blank: false, crashed: false, consoleErrors: [], widgetIssues: [], diagnostics: [],
    coverage: { startup: 'passed', scenarios: options.scenarios.length ? 'passed' : 'not-run' },
    scenarios: options.scenarios.map((s: RuntimeScenario) => ({ name: s.name, ok: true, steps: [] }))
  }))
  mocks.wait.mockResolvedValue(undefined)
})

afterEach(() => {
  // These directories were created by this test, not user projects or application data.
  if (!path.basename(root).startsWith('appgacha-driver-test-') || path.dirname(root) !== os.tmpdir()) throw new Error('Refusing unsafe test cleanup')
  fs.rmSync(root, { recursive: true, force: true })
})

describe('driver lifecycle without network or Electron windows', () => {
  it('shows ordinary text alongside tools without forwarding provider reasoning to the feed', async () => {
    const onActivity = vi.fn()
    mocks.stream.mockImplementation(async (_endpoint, _messages, _tools, onContent, _signal, options) => {
      expect(options.onReasoning).toBeUndefined()
      onContent('现在开始实现。')
      const result = answer([plan(), toolCall('write_file', { path: 'app.js', content: 'export const ready = true;' }), toolCall('finish', {})])
      result.message.reasoning_content = '检查入口'
      return result
    })
    await expect(runFcDriver(job({ onActivity }))).resolves.toMatchObject({ ok: true })
    expect(JSON.stringify(onActivity.mock.calls)).not.toContain('检查入口')
    expect(onActivity).toHaveBeenCalledWith('think', '现在开始实现。', 'think-1')
    const contentIndex = onActivity.mock.calls.findIndex(([, text]) => text === '现在开始实现。')
    const writeIndex = onActivity.mock.calls.findIndex(([type]) => type === 'write')
    expect(writeIndex).toBeGreaterThan(contentIndex)
    expect(JSON.stringify(mocks.log.mock.calls)).not.toContain('检查入口')
  })
  it('shows actual edited excerpt sizes and logs no source or test values', async () => {
    const onActivity = vi.fn()
    replies(answer([plan(), toolCall('write_file', { path: 'app.js', content: 'PRIVATE-ONE\nPRIVATE-TWO' }),
      toolCall('edit_file', { path: 'app.js', old_text: 'PRIVATE-ONE\nPRIVATE-TWO', new_text: 'PRIVATE-THREE\nPRIVATE-FOUR\nPRIVATE-FIVE' }),
      toolCall('finish', { summary: 'Ready' })]))
    await expect(runFcDriver(job({ onActivity }))).resolves.toMatchObject({ ok: true })
    expect(onActivity).toHaveBeenCalledWith('write', { key: 'feed.edit', params: { path: 'app.js', oldLines: 2, newLines: 3 } })
    expect(mocks.log.mock.calls).toContainEqual(['[fc] tool completed:', expect.objectContaining({ tool: 'edit_file', path: 'app.js', replacedLines: 2, replacementLines: 3, status: 'completed' })])
    expect(JSON.stringify(mocks.log.mock.calls)).not.toContain('PRIVATE')
  })

  it('does not reuse success after an edit or a source change outside file tools', async () => {
    replies(answer([plan(), toolCall('write_file', { path: 'app.js', content: 'one' }), toolCall('check_egg', {})]),
      answer([toolCall('edit_file', { path: 'app.js', old_text: 'one', new_text: 'two' }), toolCall('finish', {})]))
    await expect(runFcDriver(job())).resolves.toMatchObject({ ok: true })
    expect(mocks.runtime).toHaveBeenCalledTimes(2)
    mocks.runtime.mockClear()
    let request = 0
    mocks.stream.mockImplementation(async () => {
      if (++request === 1) return answer([toolCall('check_egg', {})])
      fs.writeFileSync(path.join(staging, 'app.js'), 'changed outside tool')
      return answer([toolCall('finish', {})])
    })
    await expect(runFcDriver(job())).resolves.toMatchObject({ ok: true })
    expect(mocks.runtime).toHaveBeenCalledTimes(2)
  })

  it('never reuses a failure and logs failed scenario steps without their values', async () => {
    mocks.runtime.mockResolvedValueOnce({ ok: false, blank: false, crashed: false, consoleErrors: ['PRIVATE-ERROR'], widgetIssues: [], diagnostics: [],
      coverage: { startup: 'passed', scenarios: 'failed' }, scenarios: [{ name: scenario.name, ok: false, steps: [{ action: 'click', ok: false, error: 'PRIVATE-ERROR' }] }] })
    replies(answer([toolCall('check_egg', { scenarios: [scenario] })]), answer([toolCall('finish', {})]))
    await expect(runFcDriver(job())).resolves.toMatchObject({ ok: true })
    expect(mocks.runtime).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(mocks.log.mock.calls)).not.toContain('PRIVATE-ERROR')
    expect(mocks.log.mock.calls).toContainEqual(['[fc] check completed:', expect.objectContaining({ passed: false, scenarios: [expect.objectContaining({ status: 'failed' })] })])
  })

  it('expires success reuse after 30 seconds and never carries it between runs', async () => {
    const realNow = Date.now()
    let clock = realNow
    const now = vi.spyOn(Date, 'now').mockImplementation(() => clock)
    try {
      let request = 0
      mocks.stream.mockImplementation(async () => {
        if (++request === 1) return answer([toolCall('check_egg', {})])
        clock += 30_001
        return answer([toolCall('finish', {})])
      })
      await expect(runFcDriver(job())).resolves.toMatchObject({ ok: true })
      expect(mocks.runtime).toHaveBeenCalledTimes(2)
      replies(answer([toolCall('finish', {})]))
      await expect(runFcDriver(job())).resolves.toMatchObject({ ok: true })
      expect(mocks.runtime).toHaveBeenCalledTimes(3)
    } finally { now.mockRestore() }
  })

  it('rechecks changed scenarios and logs a definition change', async () => {
    const nextScenario = { ...scenario, steps: [...scenario.steps, { action: 'wait' as const, ms: 1 }] }
    replies(answer([toolCall('check_egg', { scenarios: [scenario] })]),
      answer([toolCall('check_egg', { scenarios: [nextScenario], scenario_change_reason: 'Add settling wait' }), toolCall('finish', {})]))
    await expect(runFcDriver(job())).resolves.toMatchObject({ ok: true })
    expect(mocks.runtime).toHaveBeenCalledTimes(2)
    expect(mocks.log.mock.calls).toContainEqual(['[fc] check completed:', expect.objectContaining({ scenariosChanged: true, reused: false })])
    expect(mocks.runtime.mock.calls[1][1].scenarios).toEqual([nextScenario])
  })

  it('keeps wrap-up guidance in the live prompt and announces it only once', async () => {
    let request = 0
    const onActivity = vi.fn()
    mocks.stream.mockImplementation(async (_endpoint, messages) => {
      request++
      if (request >= 46) expect(JSON.stringify(messages)).toContain('HOST WRAP-UP')
      return answer([request === 48 ? toolCall('finish', {}) : toolCall('list_files', {})])
    })
    await expect(runFcDriver(job({ onActivity }))).resolves.toMatchObject({ ok: true, turns: 48 })
    expect(onActivity.mock.calls.filter(([, text]) => text?.key === 'feed.wrappingUp')).toHaveLength(1)
  })

  it('recovers a real parsed length event and completes without user intervention or partial writes', async () => {
    const actual = await vi.importActual<typeof import('../src/main/fcStream')>('../src/main/fcStream')
    mocks.stream.mockImplementation(actual.streamCompletion)
    const event = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`
    let request = 0
    mocks.fetch.mockImplementation(async (_endpoint, body) => {
      histories.push(structuredClone(body.messages))
      request++
      if (request === 1) {
        expect(body.max_tokens).toBe(16384)
        return new Response(event({ choices: [{ delta: { tool_calls: [{ index: 0, ...toolCall('write_file', { path: 'partial.js', content: 'DO NOT EXECUTE' }) }] }, finish_reason: 'length' }] }) +
          event({ choices: [], usage: { prompt_tokens: 10000, completion_tokens: 16384, total_tokens: 26384 } }) + 'data: [DONE]\n\n')
      }
      expect(body.max_tokens).toBe(32768)
      expect(fs.existsSync(path.join(staging, 'partial.js'))).toBe(false)
      expect(JSON.stringify(body.messages)).toContain('OUTPUT LIMIT RECOVERY')
      assertLegalHistory(body.messages)
      const calls = [plan(), toolCall('write_file', { path: 'app.js', content: 'export const ready = true;' }), toolCall('finish', { summary: 'Ready' })]
      return new Response(event({ choices: [{ delta: { tool_calls: calls.map((call, index) => ({ index, ...call })) }, finish_reason: 'tool_calls' }] }) + 'data: [DONE]\n\n')
    })
    const onStage = vi.fn()
    await expect(runFcDriver(job({ onStage }))).resolves.toMatchObject({ ok: true, turns: 2 })
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
    expect(onStage.mock.calls.some(([stage]) => stage === 'fail')).toBe(false)
    expect(fs.readFileSync(path.join(staging, 'app.js'), 'utf8')).toContain('ready')
    expect(snapshots.at(-1)?.truncationRecoveries).toBe(1)
    expect(snapshots.at(-1)!.totalTokens).toBeGreaterThanOrEqual(16384)
  })

  it('preserves completed files and stops after three bounded automatic recoveries', async () => {
    mocks.stream.mockResolvedValueOnce(answer([plan(), toolCall('write_file', { path: 'done.js', content: 'export const done = 1;' })]))
      .mockRejectedValue(new CompletionStreamError('truncated', 'length'))
    await expect(runFcDriver(job())).resolves.toMatchObject({ ok: false, checkpointed: true })
    expect(mocks.stream).toHaveBeenCalledTimes(5) // initial completed turn + length + 3 recoveries
    expect(mocks.wait).toHaveBeenCalledTimes(3)
    expect(fs.readFileSync(path.join(staging, 'done.js'), 'utf8')).toContain('done = 1')
    expect(snapshots.at(-1)).toMatchObject({ truncationRecoveries: 3, outputLimit: 32768 })
    for (const snapshot of snapshots) assertLegalHistory(snapshot.messages)
  })

  it('does not increase an already credit-limited request and counts the failed output', async () => {
    mocks.stream.mockRejectedValueOnce(new CompletionStreamError('truncated', 'length', {
      requestedMaxTokens: 16384, effectiveMaxTokens: 4096, contentChars: 2, reasoningChars: 0,
      toolArgumentChars: 0, toolCalls: 0, estimatedOutputTokens: 1
    })).mockResolvedValueOnce(answer([plan(), toolCall('finish', { summary: 'Ready' })]))
    await expect(runFcDriver(job())).resolves.toMatchObject({ ok: true })
    expect(mocks.stream.mock.calls[1][5].maxOutputTokens).toBe(16384)
    expect(snapshots.at(-1)!.totalTokens).toBeGreaterThanOrEqual(4096)
  })

  it('does not issue a recovery request after user cancellation', async () => {
    const caller = new AbortController()
    mocks.stream.mockRejectedValueOnce(new CompletionStreamError('truncated', 'length'))
    mocks.wait.mockImplementationOnce(async () => caller.abort())
    await expect(runFcDriver(job({ signal: caller.signal }))).resolves.toMatchObject({ ok: false, error: { key: 'err.cancelled' } })
    expect(mocks.stream).toHaveBeenCalledTimes(1)
  })

  it('persists exhausted recovery count through resume instead of starting a new loop', async () => {
    mocks.stream.mockRejectedValue(new CompletionStreamError('truncated', 'length'))
    await expect(runFcDriver(job({ resume: { messages: [], turns: 4, rounds: 1, totalTokens: 10000,
      truncationRecoveries: 3, outputLimit: 32768 } }))).resolves.toMatchObject({ ok: false, checkpointed: true })
    expect(mocks.stream).toHaveBeenCalledTimes(1)
    expect(mocks.wait).not.toHaveBeenCalled()
  })

  it('counts length failures toward the output budget and never runs another paid turn beyond it', async () => {
    mocks.stream.mockResolvedValueOnce(answer([plan()], { estimatedTokens: 299000 }))
      .mockRejectedValueOnce(new CompletionStreamError('truncated', 'length'))
    await expect(runFcDriver(job())).resolves.toMatchObject({ ok: false, error: { key: 'err.tokenBudget' } })
    expect(mocks.stream.mock.calls[1][5].maxOutputTokens).toBe(1000)
    expect(mocks.stream).toHaveBeenCalledTimes(2)
  })
  it('runs set_plan → write_file → finish and checkpoints valid tool history after every action', async () => {
    replies(answer([plan(), toolCall('write_file', { path: 'app.js', content: 'export const timer = true;' }), toolCall('finish', { summary: 'Ready' })]))
    const result = await runFcDriver(job())
    expect(result).toMatchObject({ ok: true, turns: 1, verification: { level: 'startup', scenariosPassed: 0 } })
    expect(fs.readFileSync(path.join(staging, 'app.js'), 'utf8')).toBe('export const timer = true;')
    expect(mocks.runtime).toHaveBeenCalledTimes(1)
    expect(snapshots.length).toBeGreaterThanOrEqual(4)
    for (const snapshot of snapshots) assertLegalHistory(snapshot.messages)
  })

  it('rejects a non-terminal finish instead of silently dropping later writes in the batch', async () => {
    replies(
      answer([plan(), toolCall('finish', { summary: 'Too early' }), toolCall('write_file', { path: 'app.js', content: 'export const included = true;' })]),
      answer([toolCall('finish', { summary: 'Now complete' })])
    )
    const result = await runFcDriver(job())
    expect(result).toMatchObject({ ok: true, turns: 2 })
    expect(fs.readFileSync(path.join(staging, 'app.js'), 'utf8')).toContain('included')
    expect(mocks.runtime).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(histories[1])).toContain('finish must be the last tool')
    for (const snapshot of snapshots) assertLegalHistory(snapshot.messages)
  })

  it('does not execute tool calls returned after cancellation', async () => {
    const caller = new AbortController()
    mocks.stream.mockImplementationOnce(async () => {
      caller.abort()
      return answer([plan(), toolCall('write_file', { path: 'late.js', content: 'late' })])
    })
    const result = await runFcDriver(job({ signal: caller.signal }))
    expect(result).toMatchObject({ ok: false, error: { key: 'err.cancelled' }, checkpointed: true })
    expect(fs.existsSync(path.join(staging, 'late.js'))).toBe(false)
    expect(mocks.runtime).not.toHaveBeenCalled()
    expect(mocks.stream).toHaveBeenCalledTimes(1)
  })

  it('does not resolve a provider for an already cancelled task', async () => {
    const caller = new AbortController()
    caller.abort()
    await expect(runFcDriver(job({ signal: caller.signal }))).resolves.toMatchObject({ ok: false, error: { key: 'err.cancelled' } })
    expect(mocks.endpoint).not.toHaveBeenCalled()
    expect(mocks.stream).not.toHaveBeenCalled()
  })

  it('does not perform the next paid attempt when cancelled during a 429 backoff', async () => {
    const caller = new AbortController()
    mocks.stream.mockRejectedValueOnce(new HttpError(429, 'rejected'))
    mocks.wait.mockImplementationOnce(async () => caller.abort())
    await expect(runFcDriver(job({ signal: caller.signal }))).resolves.toMatchObject({ ok: false, error: { key: 'err.cancelled' }, checkpointed: true })
    expect(mocks.stream).toHaveBeenCalledTimes(1)
    expect(mocks.wait).toHaveBeenCalledTimes(1)
  })

  it('does not execute a later tool if cancellation occurs between actions', async () => {
    const caller = new AbortController()
    replies(answer([plan(), toolCall('write_file', { path: 'not-written.js', content: 'not written' })]))
    const result = await runFcDriver(job({ signal: caller.signal, onActivity: type => { if (type === 'think') caller.abort() } }))
    expect(result).toMatchObject({ ok: false, error: { key: 'err.cancelled' }, checkpointed: true })
    expect(fs.existsSync(path.join(staging, 'not-written.js'))).toBe(false)
    assertLegalHistory(snapshots.at(-1)!.messages)
  })

  it('does not accept a verification that resolves successfully after cancellation', async () => {
    const caller = new AbortController()
    replies(answer([toolCall('finish', { summary: 'Ready' })]))
    mocks.runtime.mockImplementationOnce(async () => {
      caller.abort()
      return { ok: true, coverage: { startup: 'passed', scenarios: 'not-run' }, scenarios: [] }
    })
    const result = await runFcDriver(job({ signal: caller.signal }))
    expect(result).toMatchObject({ ok: false, error: { key: 'err.cancelled' }, checkpointed: true })
    assertLegalHistory(snapshots.at(-1)!.messages)
  })

  it('checkpoints incomplete streams without blindly repeating accepted requests', async () => {
    mocks.stream.mockRejectedValueOnce(new CompletionStreamError('incomplete_stream', 'missing marker'))
    const result = await runFcDriver(job())
    expect(result).toMatchObject({ ok: false, checkpointed: true })
    expect(String(result.error)).toContain('incomplete_stream')
    expect(mocks.stream).toHaveBeenCalledTimes(1)
    expect(mocks.wait).not.toHaveBeenCalled()
  })

  it('does not retry unknown transport errors or HTTP 402', async () => {
    mocks.stream.mockRejectedValueOnce(new Error('connection lost after acceptance'))
    await expect(runFcDriver(job())).resolves.toMatchObject({ ok: false, checkpointed: true })
    expect(mocks.stream).toHaveBeenCalledTimes(1)
    mocks.stream.mockReset().mockRejectedValueOnce(new HttpError(402, 'credits'))
    await expect(runFcDriver(job())).resolves.toMatchObject({ ok: false, error: { key: 'err.insufficientCredits' }, checkpointed: true })
    expect(mocks.stream).toHaveBeenCalledTimes(1)
  })

  it.each([403, 409, 500, 502, 503])('does not repeat an uncertain or rejected HTTP %s request', async status => {
    mocks.stream.mockRejectedValueOnce(new HttpError(status, 'bounded business error'))
    await expect(runFcDriver(job())).resolves.toMatchObject({ ok: false, checkpointed: true })
    expect(mocks.stream).toHaveBeenCalledTimes(1)
    expect(mocks.wait).not.toHaveBeenCalled()
  })

  it('retries explicitly rejected 429s only, and never exceeds three attempts', async () => {
    mocks.stream.mockRejectedValue(new HttpError(429, 'rate limit'))
    const result = await runFcDriver(job())
    expect(result.ok).toBe(false)
    expect(mocks.stream).toHaveBeenCalledTimes(3)
    expect(mocks.wait).toHaveBeenCalledTimes(2)
  })

  it('requires an explicit plan rather than treating model prose as authorization to write', async () => {
    replies(
      answer([toolCall('write_file', { path: 'app.js', content: 'wrong' })]),
      answer([plan(), toolCall('write_file', { path: 'app.js', content: 'export const ready = true;' }), toolCall('finish', { summary: 'Ready' })])
    )
    await expect(runFcDriver(job())).resolves.toMatchObject({ ok: true })
    expect(JSON.stringify(histories[1])).toContain('Call set_plan')
    expect(fs.readFileSync(path.join(staging, 'app.js'), 'utf8')).toContain('export const ready')
  })

  it('retains scenarios, reruns explicit checks, and reuses a fresh success on finish', async () => {
    replies(
      answer([plan(), toolCall('check_egg', { scenarios: [scenario] })]),
      answer([toolCall('check_egg', {}), toolCall('finish', { summary: 'Ready' })])
    )
    const result = await runFcDriver(job())
    expect(result).toMatchObject({ ok: true, verification: { level: 'scenarios', scenariosPassed: 1 } })
    expect(mocks.runtime).toHaveBeenCalledTimes(2)
    for (const [, options] of mocks.runtime.mock.calls) expect(options.scenarios).toEqual([scenario])
  })

  it('rejects silent removal of regression scenarios', async () => {
    replies(answer([plan(), toolCall('check_egg', { scenarios: [scenario] })]), answer([toolCall('check_egg', { scenarios: [] }), toolCall('finish', { summary: 'Ready' })]))
    await expect(runFcDriver(job())).resolves.toMatchObject({ ok: true, verification: { level: 'scenarios' } })
    expect(mocks.runtime).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(snapshots.at(-1)?.messages)).toContain('scenario_change_reason')
    expect(mocks.runtime.mock.calls.at(-1)?.[1].scenarios).toEqual([scenario])
  })

  it('stops repeated identical failures and does not execute remaining tool calls', async () => {
    mocks.validate.mockReturnValue([{ file: 'app.js', message: 'Missing module' }])
    replies(answer([plan(), toolCall('check_egg', {}), toolCall('check_egg', {}), toolCall('check_egg', {}), toolCall('write_file', { path: 'never.js', content: 'never' })]))
    const result = await runFcDriver(job())
    expect(result).toMatchObject({ ok: false, checkpointed: true })
    expect(String(result.error)).toContain('same verification failure')
    expect(fs.existsSync(path.join(staging, 'never.js'))).toBe(false)
    expect(mocks.stream).toHaveBeenCalledTimes(1)
    assertLegalHistory(snapshots.at(-1)!.messages)
  })

  it('recognizes an unchanged runtime failure across fresh isolated fixture identities', async () => {
    let attempt = 0
    mocks.runtime.mockImplementation(async () => {
      const url = `egg://test-00000000-0000-4000-8000-${String(++attempt).padStart(12, '0')}/src/timer.js`
      return { ok: false, blank: false, crashed: false, widgetIssues: [], scenarios: [],
        coverage: { startup: 'failed', scenarios: 'not-run' },
        diagnostics: [{ kind: 'exception', source: 'runtime', message: `ReferenceError: missing is not defined\n    at ${url}:5:1`, url, line: 5 }],
        consoleErrors: [`exception: ReferenceError: missing is not defined [${url}:5]`] }
    })
    replies(...Array.from({ length: 5 }, () => answer([toolCall('check_egg', {})])))
    const result = await runFcDriver(job())
    expect(result).toMatchObject({ ok: false, checkpointed: true })
    expect(String(result.error)).toContain('same verification failure')
    expect(mocks.stream).toHaveBeenCalledTimes(3)
    expect(mocks.runtime).toHaveBeenCalledTimes(3)
  })

  it('resumes with current workspace, restores scenarios, and asks for a new plan before writes', async () => {
    fs.writeFileSync(path.join(staging, 'app.js'), 'export const preserved = true;')
    const savedCall = toolCall('check_egg', { scenarios: [scenario] })
    const resume = {
      messages: [{ role: 'system', content: 'old policy' }, { role: 'user', content: 'old stale file list' },
        answer([savedCall]).message, { role: 'tool', tool_call_id: savedCall.id, content: 'passed', _tool: 'check_egg' }],
      turns: 10, rounds: 2, totalTokens: 2000
    }
    replies(answer([plan(), toolCall('edit_file', { path: 'app.js', old_text: 'true', new_text: 'false' }), toolCall('finish', { summary: 'Ready' })]))
    const result = await runFcDriver(job({ resume }))
    expect(result).toMatchObject({ ok: true, turns: 11, verification: { level: 'scenarios' } })
    expect(fs.readFileSync(path.join(staging, 'app.js'), 'utf8')).toBe('export const preserved = false;')
    expect(mocks.runtime).toHaveBeenCalledTimes(2)
    expect(mocks.runtime.mock.calls[0][1].scenarios).toEqual([scenario])
    expect(JSON.stringify(histories[0])).not.toContain('old stale file list')
    expect(JSON.stringify(histories[0])).toContain('app.js')
    assertLegalHistory(histories[0])
  })

  it('treats explicit resume scenarios as authoritative over obsolete history, including an empty list', async () => {
    const oldCall = toolCall('check_egg', { scenarios: [scenario] })
    const messages = [{ role: 'system', content: 'old' }, { role: 'user', content: 'old' }, answer([oldCall]).message,
      { role: 'tool', tool_call_id: oldCall.id, content: 'passed', _tool: 'check_egg' }]
    replies(answer([toolCall('finish', { summary: 'Ready' })]))
    const result = await runFcDriver(job({ resume: { messages, turns: 1, rounds: 1, totalTokens: 100, scenarios: [] } }))
    expect(result).toMatchObject({ ok: true, verification: { level: 'startup' }, scenarios: [] })
    expect(mocks.runtime.mock.calls[0][1].scenarios).toEqual([])
    expect(snapshots.at(-1)?.scenarios).toEqual([])
  })

  it('keeps real total usage separate from the existing output soft budget', async () => {
    replies(answer([plan()], { usage: { promptTokens: 1_800_000, completionTokens: 100, totalTokens: 1_800_100 } }), answer([toolCall('finish', { summary: 'Ready' })]))
    await expect(runFcDriver(job())).resolves.toMatchObject({ ok: true, turns: 2 })
    expect(snapshots.at(-1)?.totalTokens).toBe(200)
  })

  it('stops the next call when the existing output soft budget is exhausted', async () => {
    replies(answer([plan()], { estimatedTokens: 300_001 }))
    await expect(runFcDriver(job())).resolves.toMatchObject({ ok: false, error: { key: 'err.tokenBudget' }, checkpointed: true })
    expect(mocks.stream).toHaveBeenCalledTimes(1)
  })
})

describe('checkpoint review regressions', () => {
  it('repairs incomplete older tool batches without changing the original history', () => {
    const first = toolCall('read_file', { path: 'app.js' })
    const second = toolCall('check_egg', {})
    const history = [{ role: 'system', content: 'system' }, { role: 'user', content: 'request' },
      answer([first]).message, { role: 'user', content: 'Historical interruption' },
      answer([second]).message, { role: 'tool', tool_call_id: second.id, content: 'passed', _tool: 'check_egg' }]
    const checkpoint = checkpointMessages(history)
    assertLegalHistory(checkpoint)
    expect(history).toHaveLength(6)
    expect(checkpoint).toHaveLength(7)
  })

  it('fills interrupted tool replies before any later user message', () => {
    const first = toolCall('check_egg', {})
    const second = toolCall('write_file', { path: 'x.js', content: 'x' })
    const messages = [{ role: 'system', content: 'system' }, { role: 'user', content: 'request' },
      answer([first, second]).message, { role: 'tool', tool_call_id: first.id, content: 'failed', _tool: 'check_egg' },
      { role: 'user', content: 'Paused after repeated failure' }]
    assertLegalHistory(checkpointMessages(messages))
  })

  it('does not lose accepted regression scenarios across history compression and resume', async () => {
    const checked = toolCall('check_egg', { scenarios: [scenario] })
    replies(answer([plan(), checked]))
    await expect(runFcDriver(job())).resolves.toMatchObject({ ok: false, checkpointed: true })
    const savedState = snapshots.at(-1)!
    expect(savedState.scenarios).toEqual([scenario])
    const history: unknown[] = [{ role: 'system', content: 'system' }, { role: 'user', content: 'request' }, answer([checked]).message,
      { role: 'tool', tool_call_id: checked.id, content: 'passed', _tool: 'check_egg' }]
    for (let i = 0; i < 6; i++) {
      const call = toolCall('write_file', { path: 'x.js', content: 'x'.repeat(2500) })
      history.push(answer([call]).message, { role: 'tool', tool_call_id: call.id, content: 'written', _tool: 'write_file' })
    }
    compactMessages(history, 7000, 'en')
    expect(JSON.stringify(history)).not.toContain('Start timer')
    mocks.runtime.mockClear()
    replies(answer([toolCall('finish', { summary: 'Ready' })]))
    await expect(runFcDriver(job({ resume: { ...savedState, messages: checkpointMessages(history) } }))).resolves.toMatchObject({ ok: true, verification: { level: 'scenarios' } })
    expect(mocks.runtime.mock.calls[0][1].scenarios).toEqual([scenario])
  })
})
