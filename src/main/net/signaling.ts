/**
 * TCP 信令层（换行分隔 JSON）。
 * UDP 只传发现小包；SDP 有几 KB，走 TCP 可靠传输。
 * host 端：SignalingServer（每房间一个，ephemeral 端口）。
 * joiner 端：connectSignaling（一次性连接，交换完 offer/answer 即断开）。
 */
import net from 'node:net'

export interface SignalMessage {
  type: 'join' | 'offer' | 'answer' | 'joined' | 'error' | 'bye'
  peerId?: string
  sdp?: string
  reason?: string
}

export interface SignalingServerEvents {
  /** joiner 发来 join 请求 */
  onJoin: (connId: string, peerId: string) => void
  /** joiner 发来 answer */
  onAnswer: (connId: string, sdp: string) => void
  /** 连接断开 */
  onDisconnect: (connId: string) => void
}

/** host 端信令服务器：接受 joiner 连接，中转 offer/answer */
export class SignalingServer {
  private server: net.Server | null = null
  private conns = new Map<string, net.Socket>()
  private connCounter = 0
  port = 0

  constructor(private events: SignalingServerEvents) {}

  /** 启动监听，返回实际端口（ephemeral） */
  start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => {
        const connId = `c${++this.connCounter}`
        this.conns.set(connId, socket)
        let buffer = ''

        socket.on('data', (chunk) => {
          buffer += chunk.toString('utf-8')
          let nl: number
          while ((nl = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, nl).trim()
            buffer = buffer.slice(nl + 1)
            if (!line) continue
            try {
              const msg = JSON.parse(line) as SignalMessage
              this.handleMessage(connId, msg)
            } catch { /* 非法行忽略 */ }
          }
        })

        socket.on('close', () => {
          this.conns.delete(connId)
          this.events.onDisconnect(connId)
        })
        socket.on('error', () => {
          this.conns.delete(connId)
          this.events.onDisconnect(connId)
        })
      })

      this.server.on('error', reject)
      this.server.listen(0, () => {
        this.port = (this.server!.address() as net.AddressInfo).port
        resolve(this.port)
      })
    })
  }

  private handleMessage(connId: string, msg: SignalMessage): void {
    switch (msg.type) {
      case 'join':
        if (msg.peerId) this.events.onJoin(connId, msg.peerId)
        break
      case 'answer':
        if (msg.sdp) this.events.onAnswer(connId, msg.sdp)
        break
      case 'bye':
        this.conns.get(connId)?.end()
        break
    }
  }

  /** 向指定连接发送消息 */
  send(connId: string, msg: SignalMessage): void {
    const socket = this.conns.get(connId)
    if (socket && !socket.destroyed) socket.write(JSON.stringify(msg) + '\n')
  }

  /** 向所有连接广播 */
  broadcast(msg: SignalMessage): void {
    const line = JSON.stringify(msg) + '\n'
    for (const socket of this.conns.values()) {
      if (!socket.destroyed) socket.write(line)
    }
  }

  close(): void {
    for (const socket of this.conns.values()) socket.destroy()
    this.conns.clear()
    this.server?.close()
    this.server = null
  }
}

/** joiner 端：连接 host 信令服务器，收到 offer 后 resolve；answer 经同一连接发回 */
export function connectSignaling(
  hostIp: string,
  signalPort: number,
  peerId: string
): Promise<{ offer: string; sendAnswer: (sdp: string) => void; close: () => void }> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: hostIp, port: signalPort }, () => {
      socket.write(JSON.stringify({ type: 'join', peerId } satisfies SignalMessage) + '\n')
    })

    let buffer = ''
    const timeout = setTimeout(() => {
      socket.destroy()
      reject(new Error('signaling timeout (5s)'))
    }, 5000)

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf-8')
      const nl = buffer.indexOf('\n')
      if (nl === -1) return
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (!line) return
      try {
        const msg = JSON.parse(line) as SignalMessage
        if (msg.type === 'offer' && msg.sdp) {
          clearTimeout(timeout)
          resolve({
            offer: msg.sdp,
            sendAnswer: (sdp: string) => {
              if (!socket.destroyed) socket.write(JSON.stringify({ type: 'answer', sdp } satisfies SignalMessage) + '\n')
            },
            close: () => {
              try {
                socket.write(JSON.stringify({ type: 'bye' }) + '\n')
                socket.end()
              } catch { /* ignore */ }
            }
          })
        } else if (msg.type === 'error') {
          clearTimeout(timeout)
          socket.destroy()
          reject(new Error(msg.reason ?? 'room rejected'))
        }
      } catch { /* ignore */ }
    })

    socket.on('error', (e) => {
      clearTimeout(timeout)
      reject(new Error(`signaling connect failed: ${e.message}`))
    })
    socket.on('close', () => clearTimeout(timeout))
  })
}
