/** Public MCP contract. No Electron imports: also used by the stdio connector. */
export interface McpStatus {
  enabled: boolean
  running: boolean
  connections: { id: string; name: string; createdAt: string }[]
  drafts: { id: string; name: string; owner: string; state: string; updatedAt: string; lastJob?: { kind: 'check' | 'install'; state: string; error?: string } }[]
}
export interface McpConnectionConfig {
  id: string
  config: { mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }> }
}
const text = { type: 'string' }
const draft = { draft_id: { ...text, description: 'Opaque draft ID returned by create_draft. Never a filesystem path.' } }
function tool(name: string, description: string, properties: Record<string, unknown>, required: string[], readOnly = false) {
  return { name, description, inputSchema: { type: 'object' as const, properties, required, additionalProperties: false },
    annotations: { readOnlyHint: readOnly, destructiveHint: false, openWorldHint: false } }
}
export const MCP_TOOLS = [
  tool('get_guide', 'Read AppGacha authoring rules before creating apps. topic: overview, api, icons, or guides/<topic>. Code is plain HTML/CSS/ES modules, no npm/Node/CDN. Follow current host rules.', { topic: text }, [] , true),
  tool('create_draft', 'Create an isolated NEW capsule from the host template. No AI request or credits are consumed. Keep the returned draft_id for reconnection.', { name: text, wish: text }, ['name', 'wish']),
  tool('list_drafts', 'List only drafts belonging to this connection. Installed user apps and their data are never exposed.', {}, [], true),
  tool('list_files', 'Read the live source tree and dependency diagnostics for your draft.', draft, ['draft_id'], true),
  tool('read_file', 'Read numbered source with a content hash. Paths relative to draft root. Host files read-only; private data inaccessible.', { ...draft, path: text, start_line: { type: 'integer', minimum: 1 }, end_line: { type: 'integer', minimum: 1 } }, ['draft_id', 'path'], true),
  tool('write_file', 'Write one complete source file (max 500KB). For an existing file pass the hash returned by read_file; for a new file pass expected_hash="new". Only manifest name/permissions/window are editable.', { ...draft, path: text, content: text, expected_hash: text }, ['draft_id', 'path', 'content', 'expected_hash']),
  tool('edit_file', 'Exact unique replacement in a source file. Pass its latest hash. Never edit data, host resources or installed capsules.', { ...draft, path: text, old_text: text, new_text: text, expected_hash: text }, ['draft_id', 'path', 'old_text', 'new_text', 'expected_hash']),
  tool('check_draft', 'Start isolated static/startup/interaction validation. Returns job_id; poll get_job. Optional scenarios (up to 5): {name,steps:[{action:"click"|"fill"|"wait"|"assert"|"assert-change",selector?,value?,ms?,property?:"text"|"value",equals?,contains?}]}. Each scenario needs an assertion. Existing checks cannot be removed/weakened. External AI/network are mocked, not verified.', { ...draft, scenarios: { type: 'array', maxItems: 5, items: { type: 'object' } } }, ['draft_id']),
  tool('get_job', 'Read a check/install job. Prefer wait_ms=10000 instead of rapid polling. A completed check requires result.ok=true; an installation requires result.installed=true. Never claim full correctness from startup-only verification.', { job_id: text, wait_ms: { type: 'integer', minimum: 0, maximum: 10000 } }, ['job_id'], true),
  tool('get_preview', 'Return the isolated check screenshot of the current draft revision, never the user desktop. The image will be shared with your agent provider.', draft, ['draft_id'], true),
  tool('request_install', 'Install a NEW capsule directly to the shelf using this connection authorization; no AppGacha confirmation dialog. Requires a successful current-revision check and revalidates the deliverable. Never overwrites or auto-opens apps. Returns job_id, NOT installation success: wait with get_job until result.installed=true.', draft, ['draft_id']),
  tool('cancel_job', 'Cancel your in-progress check or install. Draft files remain. Cancellation after successful commit cannot undo installation.', { job_id: text }, ['job_id']),
]
