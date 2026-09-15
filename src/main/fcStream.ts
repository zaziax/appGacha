/** Strict, single-attempt Chat Completions transport. No tools run in this module. */
import { chatCompletionFetch, type AiEndpoint } from './aiChannel'

export interface StreamToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface StreamAssistantMessage {
  role: 'assistant'
  content: string | null
  /** Kept separately for providers requiring reasoning replay with tool results. */
  reasoning_content?: string
  tool_calls?: StreamToolCall[]
}

export interface StreamResult {
  message: StreamAssistantMessage
  /** Output-only fallback estimate; not a cumulative input/output billing total. */
  estimatedTokens: number
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number }
  finishReason?: string
  diagnostics?: StreamDiagnostics
}

/** Counts only: no source, prompts, credentials, or private reasoning in diagnostics. */
export interface StreamDiagnostics {
  requestedMaxTokens?: number
  effectiveMaxTokens?: number
  finishReason?: string
  contentChars: number
  reasoningChars: number
  toolArgumentChars: number
  toolCalls: number
  estimatedOutputTokens: number
  usage?: StreamResult['usage']
}

export class HttpError extends Error {
  constructor(public status: number, public body: string) {
    super(`HTTP ${status}`)
    this.name = 'HttpError'
  }
}

export type CompletionStreamErrorCode =
  | 'malformed_event' | 'upstream_error' | 'incomplete_stream'
  | 'truncated' | 'filtered' | 'invalid_tool_call' | 'timeout'

export class CompletionStreamError extends Error {
  constructor(public code: CompletionStreamErrorCode, message: string, public diagnostics?: StreamDiagnostics) {
    super(message)
    this.name = 'CompletionStreamError'
  }
}

export interface StreamOptions {
  maxOutputTokens?: number
  purpose?: 'app_build'
  onPhase?: (phase: 'reasoning' | 'tool') => void
  /** Optional live display of provider-returned reasoning; kept separate from ordinary content and diagnostic logs. */
  onReasoning?: (accumulatedText: string) => void
  stallTimeoutMs?: number
  hardTimeoutMs?: number
  preserveReasoningContent?: boolean
  /** Set false only for providers that reject the standard usage-stream option. */
  includeUsage?: boolean
}

type JsonObject = Record<string, unknown>
const isObject = (value: unknown): value is JsonObject => !!value && typeof value === 'object' && !Array.isArray(value)
function streamError(code: CompletionStreamErrorCode, message: string): never { throw new CompletionStreamError(code, message) }
const MAX_RESPONSE_CHARS = 8_000_000

/** Local checkpoint/tool metadata is never part of the provider protocol. */
function providerMessage(message: unknown): JsonObject {
  if (!isObject(message)) streamError('malformed_event', 'AI request message is not an object')
  const result: JsonObject = {}
  for (const key of ['role', 'content', 'tool_call_id', 'name', 'reasoning_content']) {
    if (message[key] !== undefined) result[key] = message[key]
  }
  if (message.tool_calls !== undefined) {
    if (!Array.isArray(message.tool_calls)) streamError('invalid_tool_call', 'AI request tool-call history is invalid')
    result.tool_calls = message.tool_calls.map(call => {
      if (!isObject(call) || !isObject(call.function)) streamError('invalid_tool_call', 'AI request tool-call history is invalid')
      return { id: call.id, type: call.type, function: { name: call.function.name, arguments: call.function.arguments } }
    })
  }
  return result
}

/**
 * Return an assistant turn only after explicit stream completion and validation.
 * Partial/truncated tool arguments are never returned to the caller for execution.
 */
export async function streamCompletion(
  endpoint: AiEndpoint,
  messages: unknown[],
  tools: unknown[],
  onDelta: (accumulatedText: string) => void,
  externalSignal?: AbortSignal,
  options: StreamOptions = {}
): Promise<StreamResult> {
  if (options.maxOutputTokens !== undefined && (!Number.isSafeInteger(options.maxOutputTokens) || options.maxOutputTokens < 1)) throw new Error('Invalid output token budget')
  externalSignal?.throwIfAborted()
  const controller = new AbortController()
  const onExternalAbort = () => controller.abort(externalSignal?.reason)
  externalSignal?.addEventListener('abort', onExternalAbort, { once: true })
  const hardTimeoutMs = options.hardTimeoutMs ?? 8 * 60_000
  const stallTimeoutMs = options.stallTimeoutMs ?? 60_000
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let stallTimer: ReturnType<typeof setTimeout> | undefined
  let tailTimer: ReturnType<typeof setTimeout> | undefined
  let diagnostics: () => StreamDiagnostics = () => ({ requestedMaxTokens: options.maxOutputTokens, contentChars: 0, reasoningChars: 0, toolArgumentChars: 0, toolCalls: 0, estimatedOutputTokens: 0 })
  const hardTimer = setTimeout(() => controller.abort(new CompletionStreamError('timeout', 'AI request exceeded its time limit')), hardTimeoutMs)
  const feedWatchdog = () => {
    clearTimeout(stallTimer)
    stallTimer = setTimeout(() => controller.abort(new CompletionStreamError('timeout', 'AI stream stopped responding')), stallTimeoutMs)
  }
  const cancelReader = () => { void reader?.cancel().catch(() => {}) }
  controller.signal.addEventListener('abort', cancelReader, { once: true })
  feedWatchdog()

  try {
    const res = await chatCompletionFetch(endpoint, {
      messages: messages.map(providerMessage), tools, temperature: 0.5, stream: true,
      ...(options.maxOutputTokens !== undefined ? { max_tokens: options.maxOutputTokens } : {}),
      ...(endpoint.kind === 'proxy' && options.purpose ? { purpose: options.purpose } : {}),
      ...(options.includeUsage === false ? {} : { stream_options: { include_usage: true } })
    }, { signal: controller.signal, timeout: hardTimeoutMs + 30_000 })
    controller.signal.throwIfAborted()
    if (!res.body) {
      if (!res.ok) throw new HttpError(res.status, '')
      streamError('incomplete_stream', 'AI response has no readable stream')
    }
    reader = res.body.getReader()
    if (!res.ok) {
      // Keep only a bounded business-error body; do not buffer or log raw replies.
      const errorDecoder = new TextDecoder()
      let body = ''
      while (body.length < 1000) {
        const { done, value } = await reader.read()
        controller.signal.throwIfAborted()
        if (done) { body += errorDecoder.decode(); break }
        feedWatchdog()
        body += errorDecoder.decode(value.subarray(0, 4000), { stream: true }).slice(0, 1000 - body.length)
      }
      throw new HttpError(res.status, body.slice(0, 1000))
    }
    const decoder = new TextDecoder()
    let buffer = ''
    let eventData: string[] = []
    let eventType = ''
    let content = ''
    let reasoning = ''
    let responseChars = 0
    let sawDone = false
    let finishReason: string | undefined
    let usage: StreamResult['usage']
    const calls = new Map<number, { id: string; name: string; args: string }>()
    const advertisedLimit = Number(res.headers.get('X-AppGacha-Output-Limit'))
    const effectiveMaxTokens = Number.isSafeInteger(advertisedLimit) && advertisedLimit > 0 ? advertisedLimit : undefined
    diagnostics = () => {
      const toolArgumentChars = [...calls.values()].reduce((sum, call) => sum + call.args.length, 0)
      return { requestedMaxTokens: options.maxOutputTokens, effectiveMaxTokens, finishReason,
        contentChars: content.length, reasoningChars: reasoning.length, toolArgumentChars, toolCalls: calls.size,
        estimatedOutputTokens: Math.ceil((content.length + reasoning.length + toolArgumentChars) / 3), ...(usage ? { usage } : {}) }
    }
    let phase: 'reasoning' | 'tool' | undefined
    let lastPhaseAt = 0
    // Only actual provider deltas refresh liveness; no timer or SSE keep-alive heartbeat.
    const reportPhase = (next: 'reasoning' | 'tool') => {
      if (phase !== next || Date.now() - lastPhaseAt >= 1000) {
        phase = next; lastPhaseAt = Date.now(); options.onPhase?.(next)
      }
    }
    const allowedNames = new Set(tools.flatMap(tool => isObject(tool) && isObject(tool.function) && typeof tool.function.name === 'string' ? [tool.function.name] : []))

    const appendDelta = (delta: JsonObject) => {
      for (const key of ['content', 'reasoning_content'] as const) {
        const value = delta[key]
        if (value != null && typeof value !== 'string') streamError('malformed_event', 'AI text delta has an invalid type')
        if (typeof value !== 'string' || !value) continue
        if (finishReason) streamError('malformed_event', 'AI sent content after the turn finished')
        if (key === 'content') { content += value; onDelta(content) }
        else { reasoning += value; reportPhase('reasoning'); options.onReasoning?.(reasoning) }
      }
      if (delta.tool_calls == null) return
      if (!Array.isArray(delta.tool_calls)) streamError('invalid_tool_call', 'AI tool-call delta is not an array')
      if (delta.tool_calls.length) reportPhase('tool')
      if (delta.tool_calls.length && finishReason) streamError('invalid_tool_call', 'AI sent tool calls after the turn finished')
      for (const rawCall of delta.tool_calls) {
        if (!isObject(rawCall)) streamError('invalid_tool_call', 'AI tool-call delta is invalid')
        const index = rawCall.index ?? (delta.tool_calls.length === 1 ? 0 : undefined)
        if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0) streamError('invalid_tool_call', 'AI tool-call index is invalid')
        if (rawCall.type != null && rawCall.type !== 'function') streamError('invalid_tool_call', 'AI tool-call type is unsupported')
        const call = calls.get(index) ?? { id: '', name: '', args: '' }
        if (rawCall.id != null) {
          if (typeof rawCall.id !== 'string' || (call.id && rawCall.id !== call.id)) streamError('invalid_tool_call', 'AI tool-call identifier changed')
          call.id = rawCall.id
        }
        if (rawCall.function != null) {
          if (!isObject(rawCall.function)) streamError('invalid_tool_call', 'AI tool-call function is invalid')
          if (rawCall.function.name != null) {
            if (typeof rawCall.function.name !== 'string') streamError('invalid_tool_call', 'AI tool name is invalid')
            // Some compatible providers repeat the whole name, others split it.
            if (call.name !== rawCall.function.name) call.name += rawCall.function.name
          }
          if (rawCall.function.arguments != null) {
            if (typeof rawCall.function.arguments !== 'string') streamError('invalid_tool_call', 'AI tool arguments are not JSON text')
            call.args += rawCall.function.arguments
          }
        }
        calls.set(index, call)
      }
    }

    const dispatch = () => {
      const payload = eventData.join('\n').trim()
      const type = eventType
      eventData = []
      eventType = ''
      if (type === 'error') streamError('upstream_error', 'AI provider returned a stream error')
      if (!payload) return
      if (payload === '[DONE]') { sawDone = true; return }
      let chunk: unknown
      try { chunk = JSON.parse(payload) } catch { streamError('malformed_event', 'AI stream contains invalid JSON') }
      if (!isObject(chunk)) streamError('malformed_event', 'AI stream event is not an object')
      if (chunk.error != null) streamError('upstream_error', 'AI provider returned a stream error')
      if (isObject(chunk.usage)) {
        const input = chunk.usage.prompt_tokens
        const output = chunk.usage.completion_tokens
        const total = chunk.usage.total_tokens
        if (typeof input === 'number' && Number.isSafeInteger(input) && input >= 0 && typeof output === 'number' && Number.isSafeInteger(output) && output >= 0) {
          usage = { promptTokens: input, completionTokens: output, totalTokens: typeof total === 'number' && Number.isSafeInteger(total) && total >= input + output ? total : input + output }
        }
      }
      if (chunk.choices == null) return
      if (!Array.isArray(chunk.choices)) streamError('malformed_event', 'AI choices field is invalid')
      for (const choice of chunk.choices) {
        if (!isObject(choice)) streamError('malformed_event', 'AI choice is invalid')
        if (choice.index != null && choice.index !== 0) streamError('malformed_event', 'Multiple AI choices are unsupported')
        if (choice.delta != null) {
          if (!isObject(choice.delta)) streamError('malformed_event', 'AI delta is invalid')
          appendDelta(choice.delta)
        }
        if (choice.finish_reason != null) {
          const reason = choice.finish_reason
          if (reason === 'length') {
            finishReason = 'length'
            // Usage is commonly sent AFTER finish_reason. Drain a bounded tail so
            // accounting/refunds can finish before the driver's next request.
            if (!tailTimer) tailTimer = setTimeout(() => controller.abort(new CompletionStreamError('truncated', 'AI output reached its token limit')), 5000)
            continue
          }
          if (reason === 'content_filter') streamError('filtered', 'AI output was stopped by the provider content filter')
          if (reason !== 'stop' && reason !== 'tool_calls') streamError('incomplete_stream', 'AI returned an unsupported finish reason')
          if (finishReason && finishReason !== reason) streamError('malformed_event', 'AI finish reason changed')
          finishReason = reason
        }
      }
    }

    const processLine = (line: string) => {
      if (!line) { dispatch(); return }
      if (line.startsWith(':')) return
      const colon = line.indexOf(':')
      const field = colon < 0 ? line : line.slice(0, colon)
      let value = colon < 0 ? '' : line.slice(colon + 1)
      if (value.startsWith(' ')) value = value.slice(1)
      if (field === 'data') eventData.push(value)
      else if (field === 'event') eventType = value
    }
    const drainLines = (eof = false) => {
      for (;;) {
        const newline = buffer.search(/[\r\n]/)
        if (newline < 0) break
        // A CRLF pair can itself be split across network chunks.
        if (!eof && buffer[newline] === '\r' && newline === buffer.length - 1) break
        const width = buffer[newline] === '\r' && buffer[newline + 1] === '\n' ? 2 : 1
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + width)
        processLine(line)
        if (sawDone) return
      }
      if (eof && !sawDone) {
        if (buffer) processLine(buffer)
        buffer = ''
        dispatch()
      }
    }

    while (!sawDone) {
      controller.signal.throwIfAborted()
      const { done, value } = await reader.read()
      controller.signal.throwIfAborted()
      if (done) { buffer += decoder.decode(); drainLines(true); break }
      feedWatchdog()
      const text = decoder.decode(value, { stream: true })
      responseChars += text.length
      if (responseChars > MAX_RESPONSE_CHARS) streamError('malformed_event', 'AI response exceeds the transport size limit')
      buffer += text
      drainLines()
    }
    if (finishReason === 'length') streamError('truncated', 'AI output reached its token limit; partial tool calls were discarded')
    if (!sawDone && !finishReason) streamError('incomplete_stream', 'AI stream ended without a completion marker')
    if (!content.trim() && !calls.size) streamError('incomplete_stream', 'AI stream produced no final answer or tool call')
    if (finishReason === 'tool_calls' && !calls.size) streamError('invalid_tool_call', 'AI reported tool calls without any calls')

    const seenIds = new Set<string>()
    const toolCalls: StreamToolCall[] = [...calls.entries()].sort(([a], [b]) => a - b).map(([index, call], expected) => {
      if (index !== expected || !call.id.trim() || seenIds.has(call.id) || !allowedNames.has(call.name)) {
        streamError('invalid_tool_call', 'AI returned a missing, duplicate, or unknown tool-call identifier/name')
      }
      let args: unknown
      try { args = JSON.parse(call.args) } catch { streamError('invalid_tool_call', 'AI tool arguments are incomplete or invalid JSON') }
      if (!isObject(args)) streamError('invalid_tool_call', 'AI tool arguments must be a JSON object')
      seenIds.add(call.id)
      return { id: call.id, type: 'function', function: { name: call.name, arguments: call.args } }
    })
    controller.signal.throwIfAborted()
    return {
      message: {
        role: 'assistant', content: content || null,
        ...(reasoning && options.preserveReasoningContent !== false ? { reasoning_content: reasoning } : {}),
        ...(toolCalls.length ? { tool_calls: toolCalls } : {})
      },
      estimatedTokens: Math.ceil((content.length + reasoning.length + [...calls.values()].reduce((sum, call) => sum + call.args.length, 0)) / 3),
      ...(usage ? { usage } : {}),
      ...(finishReason ? { finishReason } : {}),
      diagnostics: diagnostics()
    }
  } catch (error) {
    const failure = controller.signal.aborted ? controller.signal.reason : error
    if (failure instanceof CompletionStreamError) failure.diagnostics = diagnostics()
    throw failure
  } finally {
    clearTimeout(hardTimer)
    clearTimeout(stallTimer)
    clearTimeout(tailTimer)
    externalSignal?.removeEventListener('abort', onExternalAbort)
    controller.signal.removeEventListener('abort', cancelReader)
    cancelReader()
    reader?.releaseLock()
  }
}
