/**
 * 房间协调器：P2 局域网联机的中枢。
 * 职责：房间注册表、join 握手编排（信令↔RTC）、消息路由（星型中继）、事件推送、生命周期清理。
 * 蛋只看见"房间"，看不见 UDP/TCP/WebRTC 的任何细节。
 */
import { webContents } from 'electron'
import crypto from 'node:crypto'
import * as discovery from './discovery'
import * as rtcHost from './rtcHost'
import { SignalingServer, connectSignaling } from './signaling'

// ---- 契约硬约束 ----
const MAX_PEERS = 8
const MAX_MSG_BYTES = 64 * 1024
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // 防混淆字符集
const HANDSHAKE_TIMEOUT = 8000

// ---- 内部状态 ----

interface PeerEntry {
  peerId: string
  connId: string | null          // RTC 连接 id（DataChannel 建立后）
  signalConnId: string | null    // TCP 信令连接 id（握手期间）
  connected: boolean
  answerReceived?: boolean       // 房主已收到 answer（信令断开时不清理 RTC）
  handshakeTimer?: ReturnType<typeof setTimeout>
}

interface RoomState {
  roomId: string
  code: string
  name: string
  role: 'host' | 'joiner'
  eggId: string
  webContentsId: number
  myPeerId: string
  hostPeerId: string
  /** host：所有 joiner；joiner：仅房主 */
  peers: Map<string, PeerEntry>
  signaling: SignalingServer | null
}

const rooms = new Map<string, RoomState>()
/** RTC connId → roomId（隐藏窗事件路由） */
const connRoom = new Map<string, string>()

// ---- 工具 ----

function randomId(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(4).toString('hex')}`
}

function makeCode(): string {
  let code = ''
  for (let i = 0; i < 4; i++) code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]
  return code
}

/** 向蛋渲染进程推送房间事件 */
function pushEvent(wcId: number, roomId: string, type: string, payload: unknown): void {
  const wc = webContents.fromId(wcId)
  if (wc && !wc.isDestroyed()) wc.send('egg:net:event', roomId, type, payload)
}

function peerCount(room: RoomState): number {
  return 1 + [...room.peers.values()].filter(p => p.connected).length
}

function connectedPeerIds(room: RoomState): string[] {
  return [...room.peers.values()].filter(p => p.connected).map(p => p.peerId)
}

// ---- RTC 事件路由（隐藏窗 → coordinator → 蛋） ----

function onRtcOpen(connId: string): void {
  const roomId = connRoom.get(connId)
  if (!roomId) return
  const room = rooms.get(roomId)
  if (!room) return

  if (room.role === 'host') {
    const peer = [...room.peers.values()].find(p => p.connId === connId)
    if (!peer) return
    peer.connected = true
    if (peer.handshakeTimer) { clearTimeout(peer.handshakeTimer); peer.handshakeTimer = undefined }

    // 通知房主蛋
    pushEvent(room.webContentsId, roomId, 'peer-join', { peerId: peer.peerId })
    // 中继给其他已连接 joiner
    relayToPeers(room, connId, JSON.stringify({ t: 'join', peerId: peer.peerId }))
    discovery.updateAnnouncePeerCount(peerCount(room))
  } else {
    // joiner 的 DataChannel 打开 = 加入成功（joinRoom 的 resolve 即以此为准，无需另发事件）
    const hostEntry = room.peers.get(room.hostPeerId)
    if (hostEntry) hostEntry.connected = true
  }
}

function onRtcMessage(connId: string, data: string): void {
  const roomId = connRoom.get(connId)
  if (!roomId) return
  const room = rooms.get(roomId)
  if (!room) return

  let envelope: { t: string; d?: string; peerId?: string }
  try { envelope = JSON.parse(data) } catch { return }

  if (room.role === 'host') {
    const sender = [...room.peers.values()].find(p => p.connId === connId)
    if (!sender) return

    switch (envelope.t) {
      case 'data':
        // 送达房主蛋 + 中继给其他 joiner
        pushEvent(room.webContentsId, roomId, 'message', { msg: safeParse(envelope.d), from: sender.peerId })
        relayToPeers(room, connId, data)
        break
      case 'leave':
        removePeer(room, sender.peerId, 'leave')
        break
    }
  } else {
    // joiner 只和房主有连接
    switch (envelope.t) {
      case 'data':
        pushEvent(room.webContentsId, roomId, 'message', { msg: safeParse(envelope.d), from: room.hostPeerId })
        break
      case 'join':
        if (envelope.peerId) pushEvent(room.webContentsId, roomId, 'peer-join', { peerId: envelope.peerId })
        break
      case 'leave':
        if (envelope.peerId) pushEvent(room.webContentsId, roomId, 'peer-leave', { peerId: envelope.peerId })
        break
      case 'closing':
        // 房主主动解散
        cleanupJoinerRoom(room, 'host-left')
        break
    }
  }
}

function onRtcClose(connId: string): void {
  const roomId = connRoom.get(connId)
  if (!roomId) return
  const room = rooms.get(roomId)
  if (!room) return
  connRoom.delete(connId)

  if (room.role === 'host') {
    const peer = [...room.peers.values()].find(p => p.connId === connId)
    if (peer && peer.connected) removePeer(room, peer.peerId, 'leave')
  } else {
    // 与房主的连接断开 = 房间没了
    const hostEntry = room.peers.get(room.hostPeerId)
    if (hostEntry && hostEntry.connected) {
      cleanupJoinerRoom(room, 'network')
    }
  }
}

function onRtcError(connId: string, error: string): void {
  console.error(`[net] rtc error (${connId}): ${error}`)
}

function safeParse(s: string | undefined): unknown {
  if (s === undefined) return null
  try { return JSON.parse(s) } catch { return s }
}

/** host：中继消息给除 excludeConnId 外的所有已连接 peer */
function relayToPeers(room: RoomState, excludeConnId: string, raw: string): void {
  for (const peer of room.peers.values()) {
    if (peer.connected && peer.connId && peer.connId !== excludeConnId) {
      rtcHost.send(peer.connId, raw).catch(() => { /* 发送失败忽略，close 事件会清理 */ })
    }
  }
}

/** host：移除 peer（主动离开或连接断开） */
function removePeer(room: RoomState, peerId: string, _reason: string): void {
  const peer = room.peers.get(peerId)
  if (!peer) return
  if (peer.handshakeTimer) clearTimeout(peer.handshakeTimer)
  room.peers.delete(peerId)
  if (peer.connId) {
    connRoom.delete(peer.connId)
    rtcHost.closeConnection(peer.connId).catch(() => {})
  }
  pushEvent(room.webContentsId, room.roomId, 'peer-leave', { peerId })
  relayToPeers(room, '', JSON.stringify({ t: 'leave', peerId }))
  discovery.updateAnnouncePeerCount(peerCount(room))
}

/** joiner：清理自己的房间状态并通知蛋 */
function cleanupJoinerRoom(room: RoomState, reason: 'host-left' | 'closed' | 'network'): void {
  const hostEntry = room.peers.get(room.hostPeerId)
  if (hostEntry?.connId) {
    connRoom.delete(hostEntry.connId)
    rtcHost.closeConnection(hostEntry.connId).catch(() => {})
  }
  rooms.delete(room.roomId)
  pushEvent(room.webContentsId, room.roomId, 'closed', { reason })
}

// ---- 对外 API（经 capabilities 权限校验后调用） ----

export interface RoomSnapshot {
  roomId: string
  code: string
  peerId: string
  isHost: boolean
  peers: string[]
}

export async function createRoom(name: string, eggId: string, wcId: number): Promise<RoomSnapshot> {
  const roomId = randomId('room')
  const code = makeCode()
  const myPeerId = randomId('host')

  const room: RoomState = {
    roomId, code,
    name: String(name).slice(0, 32) || 'room',
    role: 'host',
    eggId, webContentsId: wcId,
    myPeerId, hostPeerId: myPeerId,
    peers: new Map(),
    signaling: null
  }

  // 信令服务器（ephemeral 端口）
  const signaling = new SignalingServer({
    onJoin: (signalConnId, peerId) => handleJoinRequest(room, signalConnId, peerId),
    onAnswer: (signalConnId, sdp) => handleAnswer(room, signalConnId, sdp),
    onDisconnect: (signalConnId) => handleSignalDisconnect(room, signalConnId)
  })
  const signalPort = await signaling.start()
  room.signaling = signaling
  rooms.set(roomId, room)

  // UDP 广播发现
  discovery.startAnnounce({
    roomId, code, name: room.name,
    hostPeerId: myPeerId,
    hostIp: discovery.getLocalIp(),
    signalPort,
    peerCount: 1
  })

  return { roomId, code, peerId: myPeerId, isHost: true, peers: [] }
}

async function handleJoinRequest(room: RoomState, signalConnId: string, peerId: string): Promise<void> {
  // 容量检查
  if (peerCount(room) >= MAX_PEERS) {
    room.signaling?.send(signalConnId, { type: 'error', reason: 'room is full (max 8)' })
    return
  }
  // 重复 peerId 检查
  if (room.peers.has(peerId)) {
    room.signaling?.send(signalConnId, { type: 'error', reason: 'duplicate peerId' })
    return
  }

  const connId = `h-${room.roomId}-${peerId}`
  const peer: PeerEntry = { peerId, connId, signalConnId, connected: false }
  peer.handshakeTimer = setTimeout(() => {
    if (!peer.connected && room.peers.has(peerId)) {
      room.peers.delete(peerId)
      if (peer.connId) connRoom.delete(peer.connId)
      rtcHost.closeConnection(connId).catch(() => {})
    }
  }, HANDSHAKE_TIMEOUT)
  room.peers.set(peerId, peer)
  connRoom.set(connId, room.roomId)

  try {
    const offerSdp = await rtcHost.createOffer(connId)
    room.signaling?.send(signalConnId, { type: 'offer', sdp: offerSdp })
  } catch (e) {
    room.peers.delete(peerId)
    connRoom.delete(connId)
    room.signaling?.send(signalConnId, { type: 'error', reason: `offer failed: ${(e as Error).message}` })
  }
}

function handleAnswer(room: RoomState, signalConnId: string, sdp: string): void {
  const peer = [...room.peers.values()].find(p => p.signalConnId === signalConnId)
  if (!peer || !peer.connId) return
  peer.answerReceived = true // 标记：即使信令随后断开，也不清理 RTC
  rtcHost.acceptAnswer(peer.connId, sdp).catch((e) => {
    console.error(`[net] acceptAnswer failed: ${(e as Error).message}`)
  })
}

function handleSignalDisconnect(room: RoomState, signalConnId: string): void {
  const peer = [...room.peers.values()].find(p => p.signalConnId === signalConnId)
  if (!peer) return
  peer.signalConnId = null
  // 握手未完成就断开 → 移除；已收到 answer 或已连接的 peer 断开信令属正常（信令用完即弃）
  if (!peer.connected && !peer.answerReceived) {
    if (peer.handshakeTimer) clearTimeout(peer.handshakeTimer)
    room.peers.delete(peer.peerId)
    if (peer.connId) {
      connRoom.delete(peer.connId)
      rtcHost.closeConnection(peer.connId).catch(() => {})
    }
  }
}

export async function joinRoom(idOrCode: string, eggId: string, wcId: number): Promise<RoomSnapshot> {
  const target = discovery.findRooms().find(
    r => r.roomId === idOrCode || r.code === idOrCode.toUpperCase()
  )
  if (!target) throw new Error(`room not found: "${idOrCode}" (ensure the room is open and on the same LAN)`)

  const myPeerId = randomId('peer')
  const roomId = target.roomId
  if (rooms.has(roomId)) throw new Error('already in this room')
  const connId = `j-${roomId}`

  const room: RoomState = {
    roomId, code: target.code, name: target.name,
    role: 'joiner',
    eggId, webContentsId: wcId,
    myPeerId, hostPeerId: target.hostPeerId,
    peers: new Map([[target.hostPeerId, { peerId: target.hostPeerId, connId, signalConnId: null, connected: false }]]),
    signaling: null
  }

  let sig: Awaited<ReturnType<typeof connectSignaling>> | null = null
  try {
    // 1. TCP 信令：发 join、收 offer
    sig = await connectSignaling(target.hostIp, target.signalPort, myPeerId)
    // 2. WebRTC：接受 offer、生成 answer
    const answerSdp = await rtcHost.acceptOffer(connId, sig.offer)
    // 3. 发回 answer，信令用完即弃
    sig.sendAnswer(answerSdp)
    sig.close()
    sig = null

    connRoom.set(connId, roomId)
    rooms.set(roomId, room)

    // 4. 等 DataChannel 打开（connected 事件由 onRtcOpen 推送）
    await waitForConnected(room, connId)

    return { roomId, code: room.code, peerId: myPeerId, isHost: false, peers: [target.hostPeerId] }
  } catch (e) {
    if (sig) sig.close()
    connRoom.delete(connId)
    rooms.delete(roomId)
    rtcHost.closeConnection(connId).catch(() => {})
    throw e
  }
}

function waitForConnected(room: RoomState, connId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = setTimeout(() => {
      cleanupJoinerRoom(room, 'network')
      reject(new Error('connection timeout: DataChannel did not open within 8s'))
    }, HANDSHAKE_TIMEOUT)

    const check = setInterval(() => {
      const entry = room.peers.get(room.hostPeerId)
      if (entry?.connected) {
        clearTimeout(deadline)
        clearInterval(check)
        resolve()
      } else if (!rooms.has(room.roomId) || !connRoom.has(connId)) {
        // 连接在等待期间被清理（host 拒绝/断开）
        clearTimeout(deadline)
        clearInterval(check)
        reject(new Error('connection closed during handshake'))
      }
    }, 50)
  })
}

export function findRooms(): { id: string; code: string; name: string; peerCount: number }[] {
  return discovery.findRooms().map(r => ({
    id: r.roomId, code: r.code, name: r.name, peerCount: r.peerCount
  }))
}

export async function broadcast(roomId: string, fromWcId: number, msg: unknown): Promise<void> {
  const room = rooms.get(roomId)
  if (!room) throw new Error('room not found or already closed')
  if (room.webContentsId !== fromWcId) throw new Error('not a member of this room')

  const raw = JSON.stringify(msg)
  if (Buffer.byteLength(raw, 'utf-8') > MAX_MSG_BYTES) {
    throw new Error(`message too large (max ${MAX_MSG_BYTES} bytes)`)
  }

  const envelope = JSON.stringify({ t: 'data', d: raw })

  if (room.role === 'host') {
    // 送达自己 + 中继给所有 joiner
    pushEvent(room.webContentsId, roomId, 'message', { msg: msg, from: room.myPeerId })
    relayToPeers(room, '', envelope)
  } else {
    // joiner：发给房主（房主负责中继）；本地立即回显
    pushEvent(room.webContentsId, roomId, 'message', { msg: msg, from: room.myPeerId })
    const hostEntry = room.peers.get(room.hostPeerId)
    if (hostEntry?.connId && hostEntry.connected) {
      await rtcHost.send(hostEntry.connId, envelope)
    } else {
      throw new Error('not connected to host')
    }
  }
}

export async function closeRoom(roomId: string, fromWcId: number): Promise<void> {
  const room = rooms.get(roomId)
  if (!room) return
  if (room.webContentsId !== fromWcId) throw new Error('not a member of this room')

  if (room.role === 'host') {
    // 通知所有 joiner 解散
    relayToPeers(room, '', JSON.stringify({ t: 'closing' }))
    for (const peer of room.peers.values()) {
      if (peer.handshakeTimer) clearTimeout(peer.handshakeTimer)
      if (peer.connId) {
        connRoom.delete(peer.connId)
        rtcHost.closeConnection(peer.connId).catch(() => {})
      }
    }
    room.peers.clear()
    room.signaling?.close()
    discovery.stopAnnounce()
    rooms.delete(roomId)
    pushEvent(room.webContentsId, roomId, 'closed', { reason: 'closed' })
  } else {
    // joiner 主动离开：告知房主
    const hostEntry = room.peers.get(room.hostPeerId)
    if (hostEntry?.connId && hostEntry.connected) {
      await rtcHost.send(hostEntry.connId, JSON.stringify({ t: 'leave', peerId: room.myPeerId })).catch(() => {})
    }
    cleanupJoinerRoom(room, 'closed')
  }
}

// ---- 生命周期 ----

/** 蛋窗口关闭时清理其所有房间（host→解散，joiner→离开） */
export function onEggClosed(eggId: string): void {
  for (const room of [...rooms.values()]) {
    if (room.eggId !== eggId) continue
    closeRoom(room.roomId, room.webContentsId).catch(() => {})
  }
}

export async function init(): Promise<void> {
  discovery.init()
  await rtcHost.init({
    onOpen: onRtcOpen,
    onMessage: onRtcMessage,
    onClose: onRtcClose,
    onError: onRtcError
  })
  console.log('[net] coordinator ready (UDP discovery + RTC host window)')
}

export function shutdown(): void {
  for (const room of [...rooms.values()]) {
    if (room.role === 'host') {
      relayToPeers(room, '', JSON.stringify({ t: 'closing' }))
      room.signaling?.close()
    }
  }
  rooms.clear()
  connRoom.clear()
  discovery.shutdown()
  rtcHost.shutdown()
}
