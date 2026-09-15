import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), updateTokens: vi.fn(), logout: vi.fn() }))
vi.mock('electron', () => ({ app: { isPackaged: false }, net: { fetch: mocks.fetch } }))
vi.mock('../src/main/auth', () => ({ getAccessToken: () => 'test-access', getRefreshToken: () => 'test-refresh', updateTokens: mocks.updateTokens, logout: mocks.logout }))
vi.mock('../src/main/settings', () => ({ getAiSettings: () => null }))
vi.mock('../src/main/log', () => ({ logLine: vi.fn() }))
import { apiFetchRaw } from '../src/main/api'
import { chatCompletionFetch, parseSseContent, type AiEndpoint } from '../src/main/aiChannel'

beforeEach(() => { mocks.fetch.mockReset(); mocks.updateTokens.mockClear(); mocks.logout.mockClear() })
afterEach(() => vi.useRealTimers())

describe('AI channel cancellation (network mocked)', () => {
  const endpoints: AiEndpoint[] = [
    { kind: 'proxy', defaultModel: 'test-model' },
    { kind: 'direct', baseURL: 'https://provider.invalid/v1', model: 'test-model', apiKey: 'test-only-key' }
  ]

  it.each(endpoints)('keeps $kind cancellation attached after response headers', async endpoint => {
    let transportSignal: AbortSignal | undefined
    mocks.fetch.mockImplementation(async (_url, options) => {
      transportSignal = options.signal
      return new Response(new ReadableStream({
        start(controller) {
          options.signal.addEventListener('abort', () => controller.error(options.signal.reason), { once: true })
        }
      }))
    })
    const controller = new AbortController()
    const response = await chatCompletionFetch(endpoint, { messages: [], stream: true }, { signal: controller.signal })
    const reader = response.body!.getReader()
    const rejected = expect(reader.read()).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await rejected
    expect(transportSignal?.aborted).toBe(true)
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    reader.releaseLock()
  })

  it.each(endpoints)('does not send an already aborted $kind request', async endpoint => {
    const controller = new AbortController()
    controller.abort()
    await expect(chatCompletionFetch(endpoint, {}, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('refreshes only once after 401 and reuses the exact proxy request body', async () => {
    mocks.fetch
      .mockResolvedValueOnce(new Response('expired', { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'new', refresh_token: 'new-refresh' })))
      .mockResolvedValueOnce(new Response('still expired', { status: 401 }))
    const res = await chatCompletionFetch(endpoints[0], { messages: [], stream: true })
    expect(res.status).toBe(401)
    expect(mocks.fetch).toHaveBeenCalledTimes(3)
    expect(mocks.fetch.mock.calls[0][1].body).toBe(mocks.fetch.mock.calls[2][1].body)
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body).request_id).toBeTruthy()
    expect(mocks.updateTokens).toHaveBeenCalledTimes(1)
  })

  it('propagates cancellation while refreshing without retry or logout', async () => {
    const caller = new AbortController()
    mocks.fetch.mockResolvedValueOnce(new Response('expired', { status: 401 }))
      .mockImplementationOnce(async (_url, options) => {
        expect(options.signal).toBe(caller.signal)
        caller.abort()
        throw caller.signal.reason
      })
    await expect(apiFetchRaw('/proxy/chat', { signal: caller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
    expect(mocks.logout).not.toHaveBeenCalled()
  })

  it('clears the header timeout without losing caller cancellation', async () => {
    vi.useFakeTimers()
    let transportSignal: AbortSignal | undefined
    mocks.fetch.mockImplementationOnce(async (_url, options) => { transportSignal = options.signal; return new Response('ok') })
    const caller = new AbortController()
    await apiFetchRaw('/proxy/chat', { signal: caller.signal, timeout: 30 })
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(31)
    expect(transportSignal?.aborted).toBe(false)
    caller.abort()
    expect(transportSignal?.aborted).toBe(true)
  })

  it('does not present provider reasoning as an answer', () => {
    expect(parseSseContent('data: {"choices":[{"delta":{"reasoning_content":"hidden","content":"answer"}}]}\n\ndata: [DONE]')).toBe('answer')
  })
})
