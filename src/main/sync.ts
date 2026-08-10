/**
 * 云同步模块 — 与后端 /sync/eggs 交互
 *
 * 增量同步：计算 SHA-256 → POST /sync/plan → 只传有变化的蛋
 * 上传：蛋目录 → packGacha → multipart PUT
 * 下载：GET 二进制 → unpackGacha → 注册到收藏柜
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { net } from 'electron'
import { getAccessToken, getRefreshToken, updateTokens, logout } from './auth'
import { API_BASE } from './api'
import { packGacha, unpackGacha } from './gachaPkg'
import { dataRoot } from './paths'
import { getEgg, registerEgg, loadManifest } from './eggs'
import { initSchedules } from './schedule'
import { isSyncDisabledForEgg } from './settings'
import { logLine } from './log'

export interface CloudEggInfo {
  egg_id: string
  egg_name: string
  icon?: string | null  // SVG 原文（蛋的应用图标）
  version: number
  size_bytes: number | null
  updated_at: string | null
}

export interface SyncPlan {
  upload: string[]
  download: string[]
  skip: string[]
  conflict: string[]
}

export interface SyncEggResult {
  eggId: string
  action: 'uploaded' | 'downloaded' | 'skipped' | 'error'
  error?: string
}

/** 云同步总开关：免费用户 / 未登录 → false，不发起任何同步请求 */
let _syncEnabled = false
export function setSyncEnabled(v: boolean): void { _syncEnabled = v }

/** 单个蛋同步：计算哈希 → plan → 上传/下载/跳过 */
export async function syncEgg(eggId: string): Promise<SyncEggResult> {
  if (!_syncEnabled) return { eggId, action: 'skipped' }
  if (isSyncDisabledForEgg(eggId)) return { eggId, action: 'skipped' }
  const egg = getEgg(eggId)
  if (!egg) return { eggId, action: 'error', error: 'Egg not found' }

  let tmpFile: string | undefined
  try {
    // ① 计算本地哈希
    const { hash, tmpFile: tf } = await computeEggHash(egg.dir)
    tmpFile = tf

    // ② 请求单蛋同步计划
    const res = await authFetch('/sync/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eggs: [{ egg_id: eggId, hash }] }),
    })
    if (!res.ok) await throwSyncError(res, '同步计划失败')
    const plan = await res.json() as SyncPlan

    // ③ 执行
    if (plan.skip?.includes(eggId)) {
      logLine(`[sync] ${egg.manifest.name}: skip (hash match)`)
      return { eggId, action: 'skipped' }
    }
    if (plan.upload?.includes(eggId)) {
      // 读 icon.svg（可选——不在就是空）
      let icon: string | undefined
      try {
        const iconPath = path.join(egg.dir, 'icon.svg')
        if (fs.existsSync(iconPath)) icon = fs.readFileSync(iconPath, 'utf-8')
      } catch { /* best-effort */ }
      await uploadPackedFile(eggId, egg.manifest.name, tmpFile, hash, icon)
      return { eggId, action: 'uploaded' }
    }
    if (plan.download?.includes(eggId)) {
      await downloadEgg(eggId)
      return { eggId, action: 'downloaded' }
    }

    // 云端没有、本地也没有 → skip
    return { eggId, action: 'skipped' }
  } catch (e) {
    logLine(`[sync] ${eggId} failed:`, (e as Error).message)
    if ((e as Error).message === 'SYNC_PRO_REQUIRED') throw e
    return { eggId, action: 'error', error: (e as Error).message }
  } finally {
    if (tmpFile) {
      try { fs.rmSync(tmpFile, { force: true }) } catch { /* best-effort */ }
    }
  }
}
export async function authFetch(pathname: string, opts: RequestInit = {}): Promise<Response> {
  const token = getAccessToken()
  const headers: Record<string, string> = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(opts.headers as Record<string, string> || {}),
  }

  let res = await net.fetch(`${API_BASE}${pathname}`, { ...opts, headers })

  // 401 → refresh 一次
  if (res.status === 401) {
    const refreshed = await tryRefreshToken()
    if (refreshed) {
      const newToken = getAccessToken()
      headers.Authorization = `Bearer ${newToken}`
      res = await net.fetch(`${API_BASE}${pathname}`, { ...opts, headers })
    } else {
      await logout()
    }
  }

  return res
}

async function tryRefreshToken(): Promise<boolean> {
  const rt = getRefreshToken()
  if (!rt) return false
  try {
    const res = await net.fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: rt }),
    })
    if (!res.ok) return false
    const data = await res.json() as { access_token: string; refresh_token: string }
    updateTokens(data.access_token, data.refresh_token)
    return true
  } catch {
    return false
  }
}

/** 云同步错误归一：403 → Pro 门禁标记（渲染端映射本地化文案）；其余透传后端 detail */
async function throwSyncError(res: Response, fallback: string): Promise<never> {
  if (res.status === 403) throw new Error('SYNC_PRO_REQUIRED')
  let detail = ''
  try {
    const j = await res.json() as { detail?: string }
    detail = j?.detail || ''
  } catch { /* 非 JSON 响应 */ }
  throw new Error(detail || `${fallback}: HTTP ${res.status}`)
}

/** 获取云端蛋列表 */
export async function listCloudEggs(): Promise<CloudEggInfo[]> {
  const res = await authFetch('/sync/eggs')
  if (!res.ok) await throwSyncError(res, '获取云端列表失败')
  const data = await res.json() as { eggs: CloudEggInfo[] }
  return data.eggs
}

/** 从云端删除蛋（不抛错：网络/权限问题均静默返回 false，不影响本地操作） */
export async function deleteCloudEgg(eggId: string): Promise<boolean> {
  try {
    const res = await authFetch(`/sync/eggs/${encodeURIComponent(eggId)}`, { method: 'DELETE' })
    if (res.status === 404) {
      logLine(`[sync] cloud egg already gone: ${eggId}`)
      return true
    }
    if (!res.ok) {
      await throwSyncError(res, '云端删除失败')
      return false
    }
    logLine(`[sync] deleted from cloud: ${eggId}`)
    return true
  } catch (e) {
    // 未登录 / Pro 门禁 / 网络不通 → 不阻塞本地删除
    logLine(`[sync] cloud delete skipped for ${eggId}:`, (e as Error).message)
    return false
  }
}

/** 计算蛋目录的 SHA-256（打包后计算，保证与上传内容一致） */
async function computeEggHash(eggDir: string): Promise<{ hash: string; tmpFile: string }> {
  const tmpFile = path.join(dataRoot('staging'), `__hash-${Date.now()}-${Math.random().toString(36).slice(2)}.gacha`)
  fs.mkdirSync(path.dirname(tmpFile), { recursive: true })
  await packGacha(eggDir, tmpFile, { includeData: true })
  const buf = fs.readFileSync(tmpFile)
  const hash = crypto.createHash('sha256').update(buf).digest('hex')
  return { hash, tmpFile }
}

/** 上传已打包好的 .gacha 文件（附带名称 + 图标，供后端存库展示） */
export async function uploadPackedFile(eggId: string, eggName: string, filePath: string, hash?: string, icon?: string): Promise<void> {
  const fileBuffer = fs.readFileSync(filePath)
  const boundary = `----AppGacha${Date.now().toString(36)}`
  const fileName = `${eggName}.gacha`

  const parts: Buffer[] = [
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`, 'utf-8'),
    fileBuffer,
  ]
  // egg_name（总是附带——比后端从 ZIP 解析更可靠）
  parts.push(Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="egg_name"\r\n\r\n${eggName}`, 'utf-8'))
  // icon SVG（可选）
  if (icon) {
    parts.push(Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="icon"\r\n\r\n${icon}`, 'utf-8'))
  }
  // content_hash
  if (hash) {
    parts.push(Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="content_hash"\r\n\r\n${hash}`, 'utf-8'))
  }
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`, 'utf-8'))
  const body = Buffer.concat(parts)

  const res = await authFetch(`/sync/eggs/${eggId}`, {
    method: 'PUT',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body: body as unknown as BodyInit,
  })

  if (!res.ok) await throwSyncError(res, '上传失败')
  logLine(`[sync] uploaded ${eggName}`)
}

/** 从云端下载蛋并安装到本地 */
export async function downloadEgg(eggId: string): Promise<{ name: string; eggId: string }> {
  const res = await authFetch(`/sync/eggs/${eggId}`)
  if (!res.ok) await throwSyncError(res, '下载失败')

  const arrayBuf = await res.arrayBuffer()
  const buf = Buffer.from(arrayBuf)

  // 写入临时 .gacha 文件
  const tmpFile = path.join(dataRoot('staging'), `__dl-${eggId}-${Date.now()}.gacha`)
  fs.mkdirSync(path.dirname(tmpFile), { recursive: true })
  try {
    fs.writeFileSync(tmpFile, buf)

    // 解包到临时目录
    const tmpDir = path.join(dataRoot('staging'), `__dl-dir-${eggId}-${Date.now()}`)
    fs.mkdirSync(tmpDir, { recursive: true })
    await unpackGacha(tmpFile, tmpDir)

    const manifest = loadManifest(tmpDir)
    const existing = getEgg(manifest.eggId)
    if (existing) {
      // 已存在 → 覆盖（保留蛋目录名不变）
      fs.rmSync(existing.dir, { recursive: true, force: true })
      fs.renameSync(tmpDir, existing.dir)
      existing.manifest = loadManifest(existing.dir)
      return { name: existing.manifest.name, eggId: existing.eggId }
    }

    // 新蛋 → 入柜
    const eggsRoot = dataRoot('eggs')
    fs.mkdirSync(eggsRoot, { recursive: true })
    const dest = path.join(eggsRoot, manifest.name.replace(/[<>:"/\\|?*]/g, '_'))
    fs.renameSync(tmpDir, dest)
    const ctx = registerEgg(dest)
    initSchedules([ctx])
    return { name: manifest.name, eggId: manifest.eggId }
  } finally {
    fs.rmSync(tmpFile, { force: true })
  }
}
