import { describe, it, expect } from 'vitest'
import { validateMessages, checkRate, chat, extract } from '../src/main/capabilities/ai'
import type { EggContext } from '../src/main/eggs'

// ai 能力校验面：validateMessages（结构 + 总长）、checkRate（滑动窗口限速）、
// extract（text/schema 校验 + mock）。全走纯 Node，不碰网络（ctx.aiMock 短路）。

const MAX_TOTAL_CHARS = 64_000

const ctx: EggContext = {
  eggId: 'test-egg',
  dir: '/tmp/ai-test',
  manifest: { eggId: 'test-egg', name: 't', version: '1.0.0', hostApiVersion: '1', permissions: [] },
  aiMock: true,
}

describe('validateMessages', () => {
  it('rejects non-array or empty', () => {
    expect(() => validateMessages([])).toThrow(/非空数组/)
    expect(() => validateMessages('hi' as unknown)).toThrow(/非空数组/)
    expect(() => validateMessages(null as unknown)).toThrow(/非空数组/)
  })

  it('rejects an invalid role', () => {
    expect(() => validateMessages([{ role: 'tool', content: 'x' }])).toThrow(/message 必须/)
  })

  it('rejects a non-string content', () => {
    expect(() => validateMessages([{ role: 'user', content: 123 }])).toThrow(/message 必须/)
  })

  it('rejects a null element', () => {
    expect(() => validateMessages([null])).toThrow(/message 必须/)
  })

  it('rejects total content over the cap', () => {
    expect(() => validateMessages([{ role: 'user', content: 'x'.repeat(MAX_TOTAL_CHARS + 1) }])).toThrow(/总长度超过/)
  })

  it('accepts valid messages, including exactly at the cap', () => {
    expect(() => validateMessages([{ role: 'user', content: 'hi' }])).not.toThrow()
    expect(() =>
      validateMessages([{ role: 'user', content: 'x'.repeat(MAX_TOTAL_CHARS) }])
    ).not.toThrow()
  })
})

describe('checkRate', () => {
  it('allows 20 calls/min then rejects the 21st', () => {
    const id = 'egg-rate-limit'
    for (let i = 0; i < 20; i++) expect(() => checkRate(id)).not.toThrow()
    expect(() => checkRate(id)).toThrow(/AI_RATE_LIMITED/)
  })

  it('does not leak across eggs', () => {
    expect(() => checkRate('egg-rate-isolated')).not.toThrow()
  })
})

describe('chat (validation runs before mock)', () => {
  it('rejects empty messages even in mock mode', async () => {
    await expect(chat(ctx, [])).rejects.toThrow(/非空数组/)
  })

  it('returns the mock reply for valid messages', async () => {
    await expect(chat(ctx, [{ role: 'user', content: 'hi' }])).resolves.toContain('测试模式')
  })
})

describe('extract (validation + mock)', () => {
  it('rejects empty text', async () => {
    await expect(extract(ctx, '', { type: 'object' })).rejects.toThrow(/非空字符串/)
  })

  it('rejects over-length text', async () => {
    await expect(extract(ctx, 'x'.repeat(MAX_TOTAL_CHARS + 1), { type: 'object' })).rejects.toThrow(/超过/)
  })

  it('rejects a non-object schema', async () => {
    await expect(extract(ctx, 'hi', 'not-a-schema')).rejects.toThrow(/JSON Schema/)
  })

  it('mocks a schema-conformant object', async () => {
    const out = await extract(ctx, 'hi', { type: 'object', properties: { name: { type: 'string' } } })
    expect(out).toEqual({ name: '示例文本' })
  })
})
