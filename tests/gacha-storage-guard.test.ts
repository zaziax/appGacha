import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  available: false,
  endpoint: vi.fn(), request: vi.fn(), build: vi.fn(),
}))
vi.mock('../src/main/channels/ipc', () => ({ handle: (name: string, handler: (...args: unknown[]) => unknown) => mocks.handlers.set(name, handler) }))
vi.mock('../src/main/paths', () => ({ dataRoot: () => {
  if (!mocks.available) throw new Error('Egg directory unavailable')
  return 'test-library'
} }))
vi.mock('../src/main/log', () => ({ logLine: vi.fn() }))
vi.mock('../src/main/shelfWindow', () => ({ sendToShelf: vi.fn() }))
vi.mock('../src/main/aiChannel', () => ({
  resolveAiEndpoint: mocks.endpoint, chatCompletionFetch: mocks.request,
  throwForProxyStatus: vi.fn(), parseSseContent: vi.fn(),
  AiNotConfiguredError: class extends Error {}, AiProxyError: class extends Error {},
}))
vi.mock('../src/main/api', () => ({ apiFetch: vi.fn() }))
vi.mock('../src/main/pipeline', () => ({
  runGacha: mocks.build, runUpgrade: mocks.build, resumeGacha: mocks.build,
  isGachaBusy: () => false, cancelGacha: vi.fn(), listCheckpoints: () => [], abandonCheckpoint: vi.fn(),
}))
vi.mock('../src/main/eggs', () => ({ allEggs: () => [], getEgg: vi.fn() }))
vi.mock('../src/main/telemetry', () => ({ track: vi.fn(), trackBuildSuccess: vi.fn(), aiMode: vi.fn() }))

beforeEach(async () => {
  vi.clearAllMocks(); mocks.available = false
  const { registerGachaChannels } = await import('../src/main/channels/gachaChannels')
  registerGachaChannels()
})
it.each(['shelf:wish', 'shelf:upgrade', 'shelf:resumeBuild', 'shelf:wishChat', 'shelf:wishSuggest'])('%s refuses before model/billing/build activity when storage is unavailable', async name => {
  await expect(mocks.handlers.get(name)!([{ role: 'user', content: 'Create a timer' }], 'en')).rejects.toThrow('Egg directory unavailable')
  expect(mocks.endpoint).not.toHaveBeenCalled()
  expect(mocks.request).not.toHaveBeenCalled()
  expect(mocks.build).not.toHaveBeenCalled()
})
it('allows normal requirement clarification once storage is available', async () => {
  mocks.available = true
  mocks.endpoint.mockResolvedValue(null)
  await expect(mocks.handlers.get('shelf:wishChat')!([{ role: 'user', content: 'Create a timer' }])).rejects.toBeInstanceOf(Error)
  expect(mocks.endpoint).toHaveBeenCalledOnce()
})
