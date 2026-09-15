/** User-facing activity categories are derived from real events, never filenames or guessed features. */
export function buildProgressKey(event: { stage: string; detail?: string | { key: string }; activity?: { type: string; text: string | { key: string } } }): string | undefined {
  const detail = typeof event.detail === 'object' ? event.detail.key : undefined
  if (detail === 'feed.modelReasoning') return 'live.reasoning'
  if (detail === 'feed.modelTools') return 'live.preparingOperations'
  if (detail === 'feed.turn') return 'live.awaitingModel'
  if (detail === 'feed.checking') return 'live.checking'
  const activity = event.activity
  if (activity) {
    const key = typeof activity.text === 'object' ? activity.text.key : undefined
    if (activity.type === 'write') return 'live.updatingFiles'
    if (activity.type === 'tool') return 'live.readingFiles'
    if (activity.type === 'think') return key === 'feed.wrappingUp' ? 'live.wrappingUp' : 'live.explaining'
    if (activity.type === 'error') return 'live.issue'
    if (activity.type === 'retry') return 'live.retrying'
    if (key === 'feed.checkFail') return 'live.checkFailed'
    if (key === 'feed.checkPass' || key === 'feed.checkReused') return 'live.checkPassed'
  }
  if (event.stage === 'coin') return 'live.starting'
  if (event.stage === 'pop') return 'live.packaging'
  if (event.stage === 'fail') return 'live.issue'
  return undefined
}

export function progressSilenceSeconds(now: number, lastUpdateAt: number, running: boolean): number {
  return running && lastUpdateAt > 0 ? Math.max(0, Math.floor((now - lastUpdateAt) / 1000)) : 0
}
