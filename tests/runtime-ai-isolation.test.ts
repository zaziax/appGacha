import { describe, expect, it, vi } from 'vitest'
const upstream = vi.hoisted(() => ({ resolveAiEndpoint: vi.fn(), chatCompletionFetch: vi.fn() }))
vi.mock('../src/main/aiChannel', () => ({ ...upstream, throwForProxyStatus: vi.fn(), parseSseContent: vi.fn() }))
import { chat, extract } from '../src/main/capabilities/ai'

describe('testMode cannot accidentally spend upstream AI credits', () => {
  it('mocks chat/extract even when aiMock was omitted', async () => {
    const ctx = { testMode: true, eggId: 'isolated-ai-test' } as any
    expect(await chat(ctx, [{ role: 'user', content: 'hello' }])).toContain('测试模式')
    expect(await extract(ctx, 'hello', { type: 'object', properties: { title: { type: 'string' } } })).toEqual({ title: '示例文本' })
    expect(upstream.resolveAiEndpoint).not.toHaveBeenCalled()
    expect(upstream.chatCompletionFetch).not.toHaveBeenCalled()
  })
})
