import { handle } from './ipc'
import { createMcpConnection, discardMcpDraft, getMcpStatus, revokeMcpConnection, setMcpEnabled } from '../mcp/host'
export function registerMcpChannels(): void {
  handle('shelf:mcpStatus', getMcpStatus)
  handle('shelf:mcpEnabled', enabled => { if (typeof enabled !== 'boolean') throw new Error('Invalid enabled value'); return setMcpEnabled(enabled) })
  handle('shelf:mcpConnect', name => { if (typeof name !== 'string') throw new Error('Invalid name'); return createMcpConnection(name) })
  handle('shelf:mcpRevoke', id => { if (typeof id !== 'string') throw new Error('Invalid id'); return revokeMcpConnection(id) })
  handle('shelf:mcpDiscard', id => { if (typeof id !== 'string') throw new Error('Invalid id'); return discardMcpDraft(id) })
}
