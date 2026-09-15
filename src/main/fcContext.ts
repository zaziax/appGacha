/** Compact complete conversation turns, never orphan tool responses or rewrite tool JSON. */
export function compactMessages(messages: unknown[], charBudget: number, lang: 'zh' | 'en'): void {
  const size = () => JSON.stringify(messages).length
  if (size() <= charBudget) return
  const blocks: unknown[][] = []
  for (const message of messages.slice(2)) {
    const m = message as Record<string, unknown>
    if (m.role === 'tool' && blocks.length) blocks[blocks.length - 1].push(message)
    else blocks.push([message])
  }
  const summaries: string[] = []
  while (blocks.length > 2 && JSON.stringify([messages[0], messages[1], ...blocks.flat()]).length > charBudget - 4000) {
    const block = blocks.shift()!
    for (const entry of block) {
      const message = entry as Record<string, unknown>
      if (message._contextSummary) continue
      if (message.role === 'tool') {
        const label = String(message._tool ?? 'tool')
        const limit = ['check_egg', 'finish', 'set_plan'].includes(label) ? 1400 : 250
        summaries.push(`${label}: ${String(message.content ?? '').slice(0, limit)}`)
      }
    }
  }
  if (blocks.length === 0) return
  const summary = lang === 'zh'
    ? '较早的完整工具回合已移出上下文，旧源码不是当前状态。需要源码请重新读取；以当前文件索引及最新检查为准。\n'
    : 'Earlier complete tool turns were removed. Old source is not current state; read files again and use the live index and latest checks.\n'
  messages.splice(2, messages.length - 2,
    { role: 'user', content: summary + summaries.slice(-8).join('\n').slice(-3500), _contextSummary: true },
    ...blocks.flat())
}

/** Checkpoints taken between tool actions must still be valid chat histories. */
export function checkpointMessages(messages: unknown[]): unknown[] {
  const copy: unknown[] = JSON.parse(JSON.stringify(messages))
  for (let i = 0; i < copy.length; i++) {
    const msg = copy[i] as { role?: string; tool_calls?: Array<{ id: string }> }
    if (msg.role !== 'assistant' || !msg.tool_calls?.length) continue
    const answered = new Set<string>()
    let end = i + 1
    while (end < copy.length && (copy[end] as Record<string, unknown>).role === 'tool') {
      answered.add(String((copy[end] as Record<string, unknown>).tool_call_id))
      end++
    }
    const missing = msg.tool_calls.filter(call => !answered.has(call.id)).map(call => ({
      role: 'tool', tool_call_id: call.id, content: 'Not executed: task stopped before this action. Inspect the current workspace before retrying.', _tool: '_interrupted'
    }))
    copy.splice(end, 0, ...missing)
    i = end + missing.length - 1
  }
  return copy
}
