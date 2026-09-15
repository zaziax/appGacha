import { describe, expect, it } from 'vitest'
import { buildProgressKey, progressSilenceSeconds } from '../src/shared/buildProgress'

describe('honest build progress presentation', () => {
  it('uses real events rather than inferring completed features from file names', () => {
    expect(buildProgressKey({ stage: 'crank', activity: { type: 'write', text: { key: 'feed.edit' } } })).toBe('live.updatingFiles')
    expect(buildProgressKey({ stage: 'crank', activity: { type: 'tool', text: 'Read audio.js' } })).toBe('live.readingFiles')
    expect(buildProgressKey({ stage: 'crank', activity: { type: 'think', text: 'Next I will check the button' } })).toBe('live.explaining')
    expect(buildProgressKey({ stage: 'crank', detail: { key: 'feed.modelReasoning' } })).toBe('live.reasoning')
    expect(buildProgressKey({ stage: 'crank', detail: { key: 'feed.modelTools' } })).toBe('live.preparingOperations')
    expect(buildProgressKey({ stage: 'crank', detail: { key: 'feed.turn' } })).toBe('live.awaitingModel')
  })
  it('distinguishes running checks, failures and partial success from delivery', () => {
    expect(buildProgressKey({ stage: 'clack', detail: { key: 'feed.checking' } })).toBe('live.checking')
    expect(buildProgressKey({ stage: 'crank', activity: { type: 'check', text: { key: 'feed.checkFail' } } })).toBe('live.checkFailed')
    expect(buildProgressKey({ stage: 'crank', activity: { type: 'check', text: { key: 'feed.checkPass' } } })).toBe('live.checkPassed')
    expect(buildProgressKey({ stage: 'crank' })).toBeUndefined()
  })
  it('measures silence from the last received update and stops after completion', () => {
    expect(progressSilenceSeconds(25_000, 1000, true)).toBe(24)
    expect(progressSilenceSeconds(25_000, 24_500, true)).toBe(0)
    expect(progressSilenceSeconds(25_000, 1000, false)).toBe(0)
    expect(progressSilenceSeconds(0, 1000, true)).toBe(0)
  })
})
