/**
 * 局域网房间发现。两条通道，各司其职：
 *  - 跨机：UDP 广播 announce（host 每 1.2s 发送，监听端按 roomId 去重、3.5s 过期）。
 *  - 同机：userData 下的本地注册文件。Windows 的 SO_REUSEADDR 会把同端口入站包只投递给
 *    其中一个 socket（没有 Unix SO_REUSEPORT 的"多副本投递"），导致同机多实例间 UDP 发现
 *    不可靠；两个实例共享文件系统，注册文件是确定性通道。
 * 发现层只管"看见房间"，不管连接。
 */
import dgram from 'node:dgram'
import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

const PORT = 41234
const BROADCAST_ADDR = '255.255.255.255'
const ANNOUNCE_INTERVAL = 1200
const EXPIRE_MS = 3500
const PROTO = 'appgacha'

export interface RoomAnnounce {
  proto: string
  type: 'room-announce'
  v: 1
  roomId: string
  code: string
  name: string
  hostPeerId: string
  hostIp: string
  signalPort: number
  peerCount: number
}

interface CachedRoom extends RoomAnnounce {
  seenAt: number
}

let socket: dgram.Socket | null = null
let announceTimer: ReturnType<typeof setInterval> | null = null
let currentAnnounce: RoomAnnounce | null = null
const discovered = new Map<string, CachedRoom>()
/** 同机发现注册目录（位于共享的 userData 下），init() 时初始化 */
let registryDir: string | null = null

/** 取本机局域网 IPv4 地址（非回环），供 joiner 连接信令 */
export function getLocalIp(): string {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    if (!ifaces) continue
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address
    }
  }
  return '127.0.0.1'
}

export function init(): void {
  if (socket) return
  registryDir = path.join(app.getPath('userData'), 'net-rooms')
  socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })

  socket.on('message', (buf) => {
    try {
      const msg = JSON.parse(buf.toString('utf-8'))
      if (msg.proto !== PROTO || msg.type !== 'room-announce') return
      // 忽略自己广播的房间
      if (currentAnnounce && msg.roomId === currentAnnounce.roomId) return
      if (!discovered.has(msg.roomId)) {
        console.log(`[net:discovery] found room ${msg.code} (${msg.name}) @ ${msg.hostIp}:${msg.signalPort}`)
      }
      discovered.set(msg.roomId, { ...msg, seenAt: Date.now() })
    } catch { /* 非法包静默丢弃 */ }
  })

  socket.on('error', (e) => {
    console.error('[net:discovery] socket error:', e.message)
  })

  socket.bind(PORT, () => {
    try { socket!.setBroadcast(true) } catch { /* 部分环境不支持，降级 */ }
  })
}

/** 开始周期广播房间信息（host 调用） */
export function startAnnounce(info: Omit<RoomAnnounce, 'proto' | 'type' | 'v'>): void {
  stopAnnounce() // 先清掉上一个房间的公告（停定时器＋删注册文件），再设新值——顺序颠倒会被 stopAnnounce 置空
  currentAnnounce = { proto: PROTO, type: 'room-announce', v: 1, ...info }
  announceTimer = setInterval(broadcastOnce, ANNOUNCE_INTERVAL)
  broadcastOnce()
}

export function stopAnnounce(): void {
  if (announceTimer) { clearInterval(announceTimer); announceTimer = null }
  if (currentAnnounce) removeRegistry(currentAnnounce.roomId)
  currentAnnounce = null
}

/** 更新广播中的 peerCount */
export function updateAnnouncePeerCount(count: number): void {
  if (currentAnnounce) currentAnnounce.peerCount = count
}

function broadcastOnce(): void {
  if (!currentAnnounce) return
  writeRegistry() // 同机通道：写注册文件，不依赖 UDP 投递
  if (!socket) return
  const buf = Buffer.from(JSON.stringify(currentAnnounce), 'utf-8')
  socket.send(buf, 0, buf.length, PORT, BROADCAST_ADDR)
}

/** 返回未过期的已发现房间列表（UDP 缓存 + 同机注册文件合并去重） */
export function findRooms(): RoomAnnounce[] {
  const now = Date.now()
  const result = new Map<string, RoomAnnounce>()
  for (const [id, room] of discovered) {
    if (now - room.seenAt > EXPIRE_MS) { discovered.delete(id); continue }
    result.set(id, room)
  }
  for (const room of readRegistryRooms()) {
    if (!result.has(room.roomId)) result.set(room.roomId, room)
  }
  return [...result.values()]
}

/* ---------- 同机注册文件（SO_REUSEADDR 下同机 UDP 不可靠的确定性兜底） ---------- */

function writeRegistry(): void {
  if (!registryDir || !currentAnnounce) return
  try {
    fs.mkdirSync(registryDir, { recursive: true })
    const payload = JSON.stringify({ ...currentAnnounce, writtenAt: Date.now() })
    fs.writeFileSync(path.join(registryDir, `${currentAnnounce.roomId}.json`), payload, 'utf-8')
  } catch { /* 尽力而为，不影响主流程 */ }
}

function removeRegistry(roomId: string): void {
  if (!registryDir) return
  try { fs.unlinkSync(path.join(registryDir, `${roomId}.json`)) } catch { /* ignore */ }
}

/** 读取同机其它实例登记的房间（过滤自己的与过期的；host 崩溃未清理时按过期处理） */
function readRegistryRooms(): RoomAnnounce[] {
  if (!registryDir) return []
  const now = Date.now()
  const result: RoomAnnounce[] = []
  let entries: string[] = []
  try { entries = fs.readdirSync(registryDir) } catch { return [] }
  for (const name of entries) {
    if (!name.endsWith('.json')) continue
    try {
      const rec = JSON.parse(fs.readFileSync(path.join(registryDir, name), 'utf-8'))
      if (rec.proto !== PROTO || rec.type !== 'room-announce') continue
      if (currentAnnounce && rec.roomId === currentAnnounce.roomId) continue
      const { writtenAt, ...announce } = rec
      if (now - (writtenAt || 0) > EXPIRE_MS) continue
      result.push(announce as RoomAnnounce)
    } catch { /* 损坏文件忽略 */ }
  }
  return result
}

export function shutdown(): void {
  stopAnnounce()
  discovered.clear()
  if (socket) { try { socket.close() } catch { /* ignore */ } socket = null }
}
