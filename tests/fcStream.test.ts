import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))
vi.mock('../src/main/aiChannel', () => ({ chatCompletionFetch: fetchMock }))
import { CompletionStreamError, HttpError, streamCompletion } from '../src/main/fcStream'

const endpoint = { kind: 'proxy' as const, defaultModel: 'test-model' }
const tools = [{ type: 'function', function: { name: 'write_file' } }]
const event = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`
const choice = (delta: unknown, finish_reason: string | null = null) => ({ choices: [{ index: 0, delta, finish_reason }] })
const callDelta = (args: string, initial = false) => ({ tool_calls: [{ index: 0, ...(initial ? { id: 'call_1', type: 'function', function: { name: 'write_file', arguments: args } } : { function: { arguments: args } }) }] })

function respond(raw: string, splitBytes = false): Response {
  const bytes = new TextEncoder().encode(raw)
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      if (splitBytes) for (const byte of bytes) controller.enqueue(new Uint8Array([byte]))
      else controller.enqueue(bytes)
      controller.close()
    }
  })
  const response = new Response(body, { headers: { 'Content-Type': 'text/event-stream' } })
  fetchMock.mockResolvedValueOnce(response)
  return response
}

beforeEach(() => fetchMock.mockReset())
afterEach(() => vi.useRealTimers())

describe('strict completion stream', () => {
  it('streams provider reasoning separately without replacing it with ordinary content', async () => {
    respond(event(choice({ reasoning_content: '先看结构。' })) + event(choice({ reasoning_content: '再检查入口。' })) +
      event(choice({ content: '准备检查应用。' })) + event(choice(callDelta('{"path":"app.js","content":"example"}', true), 'tool_calls')) + 'data: [DONE]\n\n', true)
    const reasoning = vi.fn(), content = vi.fn()
    const result = await streamCompletion(endpoint, [], tools, content, undefined, { onReasoning: reasoning })
    expect(reasoning.mock.calls).toEqual([['先看结构。'], ['先看结构。再检查入口。']])
    expect(content.mock.calls).toEqual([['准备检查应用。']])
    expect(result.message.reasoning_content).toBe('先看结构。再检查入口。')
    expect(JSON.stringify(result.diagnostics)).not.toContain('先看结构')
  })

  it('does not fabricate reasoning for models that only return content', async () => {
    respond(event(choice({ content: 'Ready' }, 'stop')) + 'data: [DONE]\n\n')
    const reasoning = vi.fn()
    await streamCompletion(endpoint, [], tools, () => {}, undefined, { onReasoning: reasoning })
    expect(reasoning).not.toHaveBeenCalled()
  })
  it('refreshes phase liveness only on real deltas, throttled to once per second', async () => {
    let clock = 1000
    const now = vi.spyOn(Date, 'now').mockImplementation(() => clock)
    const phase = vi.fn()
    const text = vi.fn()
    const chunks = [event(choice({ reasoning_content: 'private one' })), event(choice({ reasoning_content: 'private two' })),
      ': keep-alive\n\n', event(choice({ reasoning_content: 'private three' })), event(choice({ content: 'Checking the app now.' }, 'stop')), 'data: [DONE]\n\n']
    let index = 0
    const body = new ReadableStream<Uint8Array>({ pull(controller) {
      clock += 1100
      if (index < chunks.length) controller.enqueue(new TextEncoder().encode(chunks[index++]))
      else controller.close()
    } })
    fetchMock.mockResolvedValue(new Response(body))
    try {
      await streamCompletion(endpoint, [], tools, text, undefined, { onPhase: phase })
      expect(phase.mock.calls).toEqual([['reasoning'], ['reasoning'], ['reasoning']])
      expect(text).toHaveBeenCalledWith('Checking the app now.')
      expect(JSON.stringify(text.mock.calls)).not.toContain('private')
    } finally { now.mockRestore() }
  })
  it('sends an explicit build budget and drains length usage without exposing partial code', async () => {
    const raw = event(choice({ reasoning_content: 'hidden', content: 'short' })) +
      event(choice(callDelta('{"path":"app.js","content":"unfinished', true), 'length')) +
      event({ choices: [], usage: { prompt_tokens: 9000, completion_tokens: 4096, total_tokens: 13096 } }) + 'data: [DONE]\n\n'
    const response = respond(raw)
    response.headers.set('X-AppGacha-Output-Limit', '4096')
    const phase = vi.fn()
    let caught: CompletionStreamError | undefined
    try { await streamCompletion(endpoint, [], tools, () => {}, undefined, { maxOutputTokens: 16384, purpose: 'app_build', onPhase: phase }) }
    catch (error) { caught = error as CompletionStreamError }
    expect(caught).toMatchObject({ code: 'truncated', diagnostics: {
      requestedMaxTokens: 16384, effectiveMaxTokens: 4096, finishReason: 'length',
      contentChars: 5, reasoningChars: 6, toolCalls: 1, usage: { completionTokens: 4096 }
    } })
    expect(caught).not.toHaveProperty('message.tool_calls')
    expect(JSON.stringify(caught?.diagnostics)).not.toContain('unfinished')
    expect(JSON.stringify(caught?.diagnostics)).not.toContain('hidden')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ max_tokens: 16384, purpose: 'app_build' })
    expect(phase.mock.calls).toEqual([['reasoning'], ['tool']])
  })

  it('never sends the platform purpose field to a BYOK provider', async () => {
    respond(event(choice({ content: 'ok' }, 'stop')))
    await streamCompletion({ kind: 'direct', baseURL: 'https://invalid.test', model: 'm', apiKey: 'test' }, [], tools, () => {}, undefined, { maxOutputTokens: 16384, purpose: 'app_build' })
    expect(fetchMock.mock.calls[0][1]).toHaveProperty('max_tokens', 16384)
    expect(fetchMock.mock.calls[0][1]).not.toHaveProperty('purpose')
  })

  it('bounds a hung usage tail after length and retains safe diagnostics', async () => {
    vi.useFakeTimers()
    fetchMock.mockResolvedValueOnce(new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode(event(choice({ content: 'partial' }, 'length'))))
    } })))
    const pending = streamCompletion(endpoint, [], tools, () => {}, undefined, { maxOutputTokens: 16384 })
    const check = expect(pending).rejects.toMatchObject({ code: 'truncated', diagnostics: { finishReason: 'length', contentChars: 7 } })
    await vi.advanceTimersByTimeAsync(5001)
    await check
  })
  it('decodes UTF-8/network fragments, separates reasoning, and reports actual usage', async () => {
    respond(event(choice({ reasoning_content: 'private reasoning', content: '计时⏱' })) +
      event(choice({ content: ' ready' }, 'stop')) +
      event({ choices: [], usage: { prompt_tokens: 1200, completion_tokens: 25, total_tokens: 1225 } }) + 'data: [DONE]\n\n', true)
    const deltas: string[] = []
    const result = await streamCompletion(endpoint, [], tools, text => deltas.push(text))
    expect(result.message).toEqual({ role: 'assistant', content: '计时⏱ ready', reasoning_content: 'private reasoning' })
    expect(deltas).toEqual(['计时⏱', '计时⏱ ready'])
    expect(result.usage).toEqual({ promptTokens: 1200, completionTokens: 25, totalTokens: 1225 })
    expect(result.finishReason).toBe('stop')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][1]).not.toHaveProperty('max_tokens')
  })

  it('handles multiline data, comments, split CRLF and a final event without newline', async () => {
    respond(': keepalive\r\n\r\ndata: {"choices":[\r\ndata: {"delta":{"content":"ok"},"finish_reason":"stop"}]}', true)
    await expect(streamCompletion(endpoint, [], tools, () => {})).resolves.toMatchObject({ message: { content: 'ok' }, finishReason: 'stop' })
  })

  it('strips local checkpoint metadata from provider-bound message history', async () => {
    respond(event(choice({ content: 'ok' }, 'stop')))
    const history = [
      { role: 'tool', content: 'file', tool_call_id: 'call_1', _tool: 'read_file', _path: 'private/path' },
      { role: 'assistant', content: null, reasoning_content: 'provider replay', _contextSummary: true,
        tool_calls: [{ id: 'call_1', type: 'function', _localOnly: true, function: { name: 'write_file', arguments: '{}', _localOnly: true } }] }
    ]
    await streamCompletion(endpoint, history, tools, () => {})
    expect(fetchMock.mock.calls[0][1].messages).toEqual([
      { role: 'tool', content: 'file', tool_call_id: 'call_1' },
      { role: 'assistant', content: null, reasoning_content: 'provider replay', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'write_file', arguments: '{}' } }] }
    ])
    expect(history[0]).toHaveProperty('_path')
  })

  it('accepts DONE without finish_reason only if a usable answer is present', async () => {
    respond(event(choice({ content: 'ready' })) + 'data: [DONE]')
    await expect(streamCompletion(endpoint, [], tools, () => {})).resolves.toMatchObject({ message: { content: 'ready' } })
  })

  it('assembles tool fragments and only returns complete, known JSON-object calls', async () => {
    respond(event(choice(callDelta('{"path":"app.js",', true))) + event(choice(callDelta('"content":"hello"}'), 'tool_calls')))
    const result = await streamCompletion(endpoint, [], tools, () => {})
    expect(result.message.tool_calls).toEqual([{ id: 'call_1', type: 'function', function: { name: 'write_file', arguments: '{"path":"app.js","content":"hello"}' } }])
    expect(result.message.content).toBeNull()
  })

  it.each(['length', 'content_filter'])('rejects %s even with syntactically complete tools', async reason => {
    respond(event(choice(callDelta('{}', true), reason)) + 'data: [DONE]\n\n')
    await expect(streamCompletion(endpoint, [], tools, () => {})).rejects.toMatchObject({ code: reason === 'length' ? 'truncated' : 'filtered' })
  })

  it.each([
    ['missing completion', event(choice({ content: 'partial' })), 'incomplete_stream'],
    ['malformed event', 'data: {broken}\n\n', 'malformed_event'],
    ['explicit error event', 'event: error\ndata: provider secret text\n\n', 'upstream_error'],
    ['JSON error', event({ error: { message: 'sensitive provider text' } }), 'upstream_error'],
    ['reasoning only', event(choice({ reasoning_content: 'not the answer' }, 'stop')), 'incomplete_stream'],
    ['empty completion', 'data: [DONE]\n\n', 'incomplete_stream'],
    ['unfinished arguments', event(choice(callDelta('{"path":', true), 'tool_calls')), 'invalid_tool_call'],
    ['non-object arguments', event(choice(callDelta('[]', true), 'tool_calls')), 'invalid_tool_call'],
    ['unknown finish reason', event(choice({ content: 'x' }, 'unknown')), 'incomplete_stream'],
    ['missing tools', event(choice({}, 'tool_calls')), 'incomplete_stream']
  ])('rejects %s without retrying', async (_name, raw, code) => {
    const response = respond(raw)
    await expect(streamCompletion(endpoint, [], tools, () => {})).rejects.toMatchObject({ code })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(response.body?.locked).toBe(false)
  })

  it.each([
    { id: '', name: 'write_file' },
    { id: 'call_1', name: 'delete_everything' }
  ])('rejects a missing id or an unknown tool name', async ({ id, name }) => {
    respond(event(choice({ tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: '{}' } }] }, 'tool_calls')))
    await expect(streamCompletion(endpoint, [], tools, () => {})).rejects.toMatchObject({ code: 'invalid_tool_call' })
  })

  it('rejects duplicate IDs and incomplete sets of tool-call indices', async () => {
    respond(event(choice({ tool_calls: [0, 1].map(index => ({ index, id: 'duplicate', type: 'function', function: { name: 'write_file', arguments: '{}' } })) }, 'tool_calls')))
    await expect(streamCompletion(endpoint, [], tools, () => {})).rejects.toMatchObject({ code: 'invalid_tool_call' })
    respond(event(choice({ tool_calls: [{ index: 2, id: 'call_2', type: 'function', function: { name: 'write_file', arguments: '{}' } }] }, 'tool_calls')))
    await expect(streamCompletion(endpoint, [], tools, () => {})).rejects.toMatchObject({ code: 'invalid_tool_call' })
  })

  it('does not leak raw error payloads into stream errors', async () => {
    respond(event({ error: { message: 'secret-api-key-and-user-prompt' } }))
    try { await streamCompletion(endpoint, [], tools, () => {}) } catch (error) {
      expect(error).toBeInstanceOf(CompletionStreamError)
      expect(String(error)).not.toContain('secret-api-key')
      return
    }
    throw new Error('Expected rejection')
  })

  it('preserves HTTP status separately and never retries', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"detail":{"code":"insufficient_credits"}}', { status: 402 }))
    await expect(streamCompletion(endpoint, [], tools, () => {})).rejects.toBeInstanceOf(HttpError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not start an already cancelled request', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(streamCompletion(endpoint, [], tools, () => {}, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('cancels and unlocks a blocked reader, and clears all watchdogs', async () => {
    vi.useFakeTimers()
    const cancel = vi.fn()
    const response = new Response(new ReadableStream({ cancel }))
    fetchMock.mockResolvedValueOnce(response)
    const controller = new AbortController()
    const promise = streamCompletion(endpoint, [], tools, () => {}, controller.signal)
    const rejected = expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    await Promise.resolve()
    controller.abort()
    await rejected
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(response.body?.locked).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not return completed tool calls if cancellation occurs inside onDelta', async () => {
    respond(event(choice({ content: 'ready' }, 'stop')) + 'data: [DONE]\n\n')
    const controller = new AbortController()
    await expect(streamCompletion(endpoint, [], tools, () => controller.abort(), controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('times out a stalled stream without leaving timers or retrying', async () => {
    vi.useFakeTimers()
    const response = new Response(new ReadableStream())
    fetchMock.mockResolvedValueOnce(response)
    const rejected = expect(streamCompletion(endpoint, [], tools, () => {}, undefined, { stallTimeoutMs: 20, hardTimeoutMs: 200 })).rejects.toMatchObject({ code: 'timeout' })
    await vi.advanceTimersByTimeAsync(21)
    await rejected
    expect(vi.getTimerCount()).toBe(0)
    expect(response.body?.locked).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('can omit reasoning replay and include_usage for provider compatibility', async () => {
    respond(event(choice({ reasoning_content: 'hidden', content: 'answer' }, 'stop')))
    const result = await streamCompletion(endpoint, [], tools, () => {}, undefined, { preserveReasoningContent: false, includeUsage: false })
    expect(result.message).not.toHaveProperty('reasoning_content')
    expect(fetchMock.mock.calls[0][1]).not.toHaveProperty('stream_options')
  })
})
