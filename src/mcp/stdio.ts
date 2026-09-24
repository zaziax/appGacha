/** Launched using the installed Electron executable in Node mode. No UI/profile,
 * no stdout logging, and no filesystem access other than the endpoint descriptor. */
import fs from 'node:fs'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { MCP_TOOLS } from '../shared/mcp'

async function bridge(name: string, args: unknown): Promise<unknown> {
  const descriptor = process.env.APPGACHA_MCP_ENDPOINT_FILE
  const token = process.env.APPGACHA_MCP_TOKEN
  if (!descriptor || !token) throw new Error('Missing MCP configuration. Copy a connection from AppGacha Settings > External agents.')
  let port: number
  try {
    if (fs.statSync(descriptor).size > 1024) throw new Error('Invalid endpoint descriptor')
    port = JSON.parse(fs.readFileSync(descriptor, 'utf8')).port
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port')
  } catch { throw new Error('Open AppGacha and enable MCP in Settings. The app must stay running; this connector does not launch it automatically.') }
  const response = await fetch(`http://127.0.0.1:${port}/tool`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ name, arguments: args }),
  })
  const data = await response.json() as { result?: unknown; error?: string }
  if (!response.ok) throw new Error(data.error ?? 'AppGacha request failed')
  return data.result
}
async function main() {
  const server = new Server({ name: 'appgacha', version: '0.1.0' }, { capabilities: { tools: {}, resources: {} },
    instructions: 'Build capsules yourself using AppGacha draft tools; this server does not call a generation agent. Read get_guide overview/api, create/edit a draft, check_draft, then get_job(wait_ms=10000). Fix diagnostics until result.ok=true. request_install installs directly with connection authorization, without an AppGacha dialog. Wait for result.installed=true before claiming shelf success. Do not bypass sandbox rules or weaken tests. Source/previews may reach your AI provider. Never request user credentials. Live capsule AI uses AppGacha configuration, not the agent subscription.' })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: MCP_TOOLS }))
  server.setRequestHandler(CallToolRequestSchema, async request => {
    try {
      const value = await bridge(request.params.name, request.params.arguments ?? {})
      if (request.params.name === 'get_preview' && value && typeof value === 'object' && 'png' in value) return { content: [{ type: 'image' as const, data: String(value.png), mimeType: 'image/png' }] }
      const structured = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : { result: value }
      return { content: [{ type: 'text' as const, text: JSON.stringify(value) }], structuredContent: structured }
    } catch (error) { return { isError: true, content: [{ type: 'text' as const, text: (error as Error).message }] } }
  })
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [
    { uri: 'appgacha://docs/overview', name: 'Capsule authoring guide', mimeType: 'text/plain' },
    { uri: 'appgacha://docs/api', name: 'Host API types', mimeType: 'text/plain' },
  ] }))
  server.setRequestHandler(ReadResourceRequestSchema, async request => {
    const topic = request.params.uri === 'appgacha://docs/overview' ? 'overview' : request.params.uri === 'appgacha://docs/api' ? 'api' : undefined
    if (!topic) throw new Error('Unknown AppGacha resource')
    const result = await bridge('get_guide', { topic }) as { text: string }
    return { contents: [{ uri: request.params.uri, mimeType: 'text/plain', text: result.text }] }
  })
  await server.connect(new StdioServerTransport())
}
main().catch(() => { process.stderr.write('AppGacha MCP connector failed to start. Check the connection configuration.\n'); process.exitCode = 1 })
