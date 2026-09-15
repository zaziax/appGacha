import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WorkspaceTools, resolveWorkspacePath } from '../src/main/fcWorkspaceTools'
import { compactMessages, checkpointMessages } from '../src/main/fcContext'

let root: string
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'gacha-tools-')) })
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }) })
describe('bounded workspace tools', () => {
  it('reads numbered slices with explicit completeness and revision', () => {
    fs.writeFileSync(path.join(root, 'app.js'), 'one\ntwo\nthree')
    const text = new WorkspaceTools(root).read('app.js', 2, 2)
    expect(text).toContain('sha256=')
    expect(text).toContain('2: two')
    expect(text).toContain('PARTIAL FILE')
  })
  it('refuses stale or ambiguous edits', () => {
    const tools = new WorkspaceTools(root)
    tools.write('app.js', 'hello hello')
    expect(() => tools.edit('app.js', 'hello', 'bye')).toThrow('exactly once')
    tools.read('app.js')
    fs.writeFileSync(path.join(root, 'app.js'), 'changed')
    expect(() => tools.write('app.js', 'stale')).toThrow('changed since read')
    expect(fs.readFileSync(path.join(root, 'app.js'), 'utf8')).toBe('changed')
  })
  it('edits only the exact match and searches literal text', () => {
    const tools = new WorkspaceTools(root)
    tools.write('src/app.js', 'const value = "a.b"')
    tools.edit('src/app.js', '"a.b"', '"c.d"')
    expect(tools.search(['src/app.js'], 'c.d')).toContain('src/app.js:1:')
    expect(tools.search(['src/app.js'], 'cxd')).toContain('No matches')
  })
  it('protects private state, host files and out-of-workspace targets', () => {
    for (const file of ['../other.js', 'data/user.json', 'DATA/user.json', 'checkpoint.json', 'C:\\secret', '/etc/passwd', 'app.js:stream']) {
      expect(() => resolveWorkspacePath(root, file)).toThrow()
    }
    for (const file of ['widget.js', 'vendor/lib.js', 'EGGDOC.md']) expect(() => resolveWorkspacePath(root, file, true)).toThrow()
  })
})
describe('conversation checkpoints', () => {
  it('does not leave unresolved tools in a resumable history', () => {
    const messages = [{ role: 'assistant', tool_calls: [{ id: 'a' }, { id: 'b' }] }, { role: 'tool', tool_call_id: 'a', content: 'done' }]
    const cp = checkpointMessages(messages) as Array<Record<string, unknown>>
    expect(cp.at(-1)?.tool_call_id).toBe('b')
    expect(messages).toHaveLength(2)
  })
  it('compacts whole old calls including their large write arguments', () => {
    const messages: unknown[] = [{ role: 'system', content: 'rules' }, { role: 'user', content: 'live requirements' }]
    for (let i = 0; i < 8; i++) messages.push(
      { role: 'assistant', tool_calls: [{ id: `c${i}`, function: { arguments: JSON.stringify({ content: 'x'.repeat(3000) }) } }] },
      { role: 'tool', tool_call_id: `c${i}`, content: 'written', _tool: 'write_file' })
    compactMessages(messages, 12000, 'en')
    expect(JSON.stringify(messages).length).toBeLessThan(12000)
    const ids = new Set(messages.flatMap(m => (m as { tool_calls?: Array<{ id: string }> }).tool_calls?.map(c => c.id) ?? []))
    for (const m of messages as Array<Record<string, unknown>>) if (m.role === 'tool') expect(ids.has(String(m.tool_call_id))).toBe(true)
  })
})
