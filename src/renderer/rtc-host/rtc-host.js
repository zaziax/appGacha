/**
 * RTC 哑引擎：运行在隐藏窗中，承载 Chromium 原生 RTCPeerConnection。
 * 只管连接的创建/收发/销毁，路由决策全在主进程 coordinator。
 *
 * 命令（主进程 → 本页面）：
 *   createOffer(connId)              → host 侧建连+DataChannel，返回完整 offer SDP
 *   acceptAnswer(connId, sdp)        → host 侧应用 answer
 *   acceptOffer(connId, sdp)         → joiner 侧接受 offer，返回完整 answer SDP
 *   send(connId, data)               → DataChannel 发送
 *   close(connId)                    → 销毁连接
 *
 * 事件（本页面 → 主进程）：open / message / close / error
 */
'use strict'

// LAN 直连无需 STUN（host candidates 足够）
const RTC_CONFIG = { iceServers: [] }
const CHANNEL_NAME = 'egg-room'

/** @type {Map<string, {pc: RTCPeerConnection, dc: RTCDataChannel|null}>} */
const conns = new Map()

/** 等待 ICE 收集完成（non-trickle：SDP 里含全部 candidates） */
function waitForIce(pc) {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve()
    const check = () => {
      if (pc.iceGatheringState === 'complete') {
        pc.removeEventListener('icegatheringstatechange', check)
        resolve()
      }
    }
    pc.addEventListener('icegatheringstatechange', check)
    // 兜底超时：3s 后强制继续（LAN 收集通常 <100ms）
    setTimeout(resolve, 3000)
  })
}

function bindDataChannel(connId, dc) {
  const entry = conns.get(connId)
  if (entry) entry.dc = dc

  dc.onopen = () => window.rtcBridge.emit(connId, 'open')
  dc.onmessage = (e) => window.rtcBridge.emit(connId, 'message', String(e.data))
  dc.onclose = () => window.rtcBridge.emit(connId, 'close')
  dc.onerror = () => window.rtcBridge.emit(connId, 'error', 'datachannel error')
}

function bindPcEvents(connId, pc) {
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
      window.rtcBridge.emit(connId, 'close')
    }
  }
  // joiner 侧：DataChannel 由对端创建，通过 ondatachannel 接收
  pc.ondatachannel = (e) => bindDataChannel(connId, e.channel)
}

// ---- 命令实现 ----

async function cmdCreateOffer(connId) {
  const pc = new RTCPeerConnection(RTC_CONFIG)
  conns.set(connId, { pc, dc: null })
  bindPcEvents(connId, pc)

  // host 侧主动创建 DataChannel
  const dc = pc.createDataChannel(CHANNEL_NAME, { ordered: true })
  bindDataChannel(connId, dc)

  const offer = await pc.createOffer()
  await pc.setLocalDescription(offer)
  await waitForIce(pc)
  return pc.localDescription.sdp
}

async function cmdAcceptAnswer(connId, sdp) {
  const entry = conns.get(connId)
  if (!entry) throw new Error(`no connection: ${connId}`)
  await entry.pc.setRemoteDescription({ type: 'answer', sdp })
}

async function cmdAcceptOffer(connId, sdp) {
  const pc = new RTCPeerConnection(RTC_CONFIG)
  conns.set(connId, { pc, dc: null })
  bindPcEvents(connId, pc)

  await pc.setRemoteDescription({ type: 'offer', sdp })
  const answer = await pc.createAnswer()
  await pc.setLocalDescription(answer)
  await waitForIce(pc)
  return pc.localDescription.sdp
}

async function cmdSend(connId, data) {
  const entry = conns.get(connId)
  if (!entry || !entry.dc) throw new Error(`no datachannel: ${connId}`)
  if (entry.dc.readyState !== 'open') throw new Error(`datachannel not open: ${entry.dc.readyState}`)
  entry.dc.send(data)
}

async function cmdClose(connId) {
  const entry = conns.get(connId)
  if (!entry) return
  try { entry.dc?.close() } catch (e) { /* ignore */ }
  try { entry.pc.close() } catch (e) { /* ignore */ }
  conns.delete(connId)
}

// ---- 命令分发 ----

const handlers = {
  createOffer: cmdCreateOffer,
  acceptAnswer: cmdAcceptAnswer,
  acceptOffer: cmdAcceptOffer,
  send: cmdSend,
  close: cmdClose
}

window.rtcBridge.onCommand(async (reqId, cmd, ...args) => {
  const fn = handlers[cmd]
  if (!fn) {
    window.rtcBridge.reply(reqId, `unknown command: ${cmd}`)
    return
  }
  try {
    const result = await fn(...args)
    window.rtcBridge.reply(reqId, null, result)
  } catch (e) {
    console.error('[rtc] cmd error', cmd, e && e.message)
    window.rtcBridge.reply(reqId, e.message || String(e))
  }
})

window.rtcBridge.ready()
