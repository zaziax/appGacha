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
import { apiFetchRaw, apiDownloadStream } from './api'
import { packGacha, unpackGacha } from './gachaPkg'
import { dataRoot } from './paths'
import { copyDir } from './fsutil'
import { getEgg, registerEgg, loadManifest } from './eggs'
import { cancelAllForEgg, initSchedules } from './schedule'
import {
  clearEggSyncState,
  getEggSyncState,
  isSyncDisabledForEgg,
  setEggSyncState,
} from './settings'
import { logLine } from './log'
import { validateEgg } from './validate'
import * as registry from './registry'

export interface CloudEggInfo {
  egg_id: string
  egg_name: string
  icon?: string | null  // SVG 原文（蛋的应用图标）
  version: number
  size_bytes: number | null
  content_hash?: string | null
  updated_at: string | null
}

export interface CloudSyncState {
  version: number
  content_hash: string | null
}

export interface SyncPlan {
  upload: string[]
  download: string[]
  skip: string[]
  conflict: string[]
  cloud_state: Record<string, CloudSyncState>
}

export interface SyncEggResult {
  eggId: string
  action: 'uploaded' | 'downloaded' | 'conflict-copy' | 'skipped' | 'error'
  error?: string
}

/** 云同步总开关：免费用户 / 未登录 → false，不发起任何同步请求 */
let _syncEnabled = false
export function setSyncEnabled(v: boolean): void { _syncEnabled = v }

const syncInFlight = new Map<string, Promise<SyncEggResult>>()

/** 单个蛋同步：计算哈希 → plan → 上传/下载/跳过 */
export async function syncEgg(eggId: string): Promise<SyncEggResult> {
  const existing = syncInFlight.get(eggId)
  if (existing) return existing
  const task = syncEggOnce(eggId).finally(() => syncInFlight.delete(eggId))
  syncInFlight.set(eggId, task)
  return task
}

async function syncEggOnce(eggId: string): Promise<SyncEggResult> {
  if (!_syncEnabled) return { eggId, action: 'skipped' }
  if (isSyncDisabledForEgg(eggId)) return { eggId, action: 'skipped' }
  const egg = getEgg(eggId)
  if (!egg || egg.ephemeral) return { eggId, action: 'skipped' }

  let tmpFile: string | undefined
  try {
    // ① 计算本地哈希
    const { hash, tmpFile: tf } = await computeEggHash(egg.dir)
    tmpFile = tf

    // ② 请求单蛋同步计划
    const base = getEggSyncState(eggId)
    const res = await apiFetchRaw('/sync/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eggs: [{
        egg_id: eggId,
        hash,
        base_hash: base?.lastSyncedHash ?? null,
        known_cloud_version: base?.cloudVersion ?? null,
      }] }),
      logoutOnAuthFail: true,
    })
    if (!res.ok) await throwSyncError(res, '同步计划失败')
    const plan = await res.json() as SyncPlan
    const cloud = plan.cloud_state?.[eggId]

    // ③ 执行
    if (plan.skip?.includes(eggId)) {
      if (cloud?.content_hash) rememberSync(eggId, cloud.content_hash, cloud.version)
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
      const uploaded = await uploadPackedFile(
        eggId, egg.manifest.name, tmpFile, cloud?.version ?? 0, icon
      )
      rememberSync(eggId, uploaded.content_hash, uploaded.version)
      return { eggId, action: 'uploaded' }
    }
    if (plan.download?.includes(eggId)) {
      if (registry.isEggActive(eggId)) throw new Error('SYNC_EGG_IN_USE')
      const downloaded = await downloadEgg(eggId)
      rememberSync(eggId, downloaded.contentHash, downloaded.cloudVersion)
      return { eggId, action: 'downloaded' }
    }
    if (plan.conflict?.includes(eggId)) {
      // 没有可信共同基线或双端都已修改：保留本地，再把云端导入为新副本。
      const copy = await downloadEgg(eggId, undefined, 'copy')
      // 云端版本已安全保留为副本；将它设为原蛋的比较基线，下一次同步可判定
      // “仅本地变化”并上传本地版，避免每次同步重复制造冲突副本。
      rememberSync(eggId, copy.contentHash, copy.cloudVersion)
      logLine(`[sync] conflict preserved as copy: ${egg.manifest.name} -> ${copy.name}`)
      return { eggId, action: 'conflict-copy' }
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

function rememberSync(eggId: string, contentHash: string, cloudVersion: number): void {
  if (!contentHash || cloudVersion < 1) return
  setEggSyncState(eggId, {
    lastSyncedHash: contentHash,
    cloudVersion,
    lastSyncedAt: Date.now(),
  })
}
/** 云同步错误归一：403 → Pro 门禁标记（渲染端映射本地化文案）；其余透传后端 detail */
async function throwSyncError(res: Response, fallback: string): Promise<never> {
  if (res.status === 403) throw new Error('SYNC_PRO_REQUIRED')
  let detail = ''
  try {
    const j = await res.json() as { detail?: string | { code?: string } }
    detail = typeof j?.detail === 'string' ? j.detail : (j?.detail?.code ?? '')
  } catch { /* 非 JSON 响应 */ }
  throw new Error(detail || `${fallback}: HTTP ${res.status}`)
}

/** 获取云端蛋列表 */
export async function listCloudEggs(): Promise<CloudEggInfo[]> {
  const res = await apiFetchRaw('/sync/eggs', { logoutOnAuthFail: true })
  if (!res.ok) await throwSyncError(res, '获取云端列表失败')
  const data = await res.json() as { eggs: CloudEggInfo[] }
  return data.eggs
}

/** 从云端删除蛋（不抛错：网络/权限问题均静默返回 false，不影响本地操作） */
export async function deleteCloudEgg(eggId: string): Promise<boolean> {
  try {
    const res = await apiFetchRaw(`/sync/eggs/${encodeURIComponent(eggId)}`, { method: 'DELETE', logoutOnAuthFail: true })
    if (res.status === 404) {
      logLine(`[sync] cloud egg already gone: ${eggId}`)
      clearEggSyncState(eggId)
      return true
    }
    if (!res.ok) {
      await throwSyncError(res, '云端删除失败')
      return false
    }
    logLine(`[sync] deleted from cloud: ${eggId}`)
    clearEggSyncState(eggId)
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

export interface UploadSyncResult {
  version: number
  content_hash: string
}

/** 上传已打包好的 .gacha 文件（服务端自行计算哈希）。 */
export async function uploadPackedFile(
  eggId: string,
  eggName: string,
  filePath: string,
  expectedVersion: number,
  icon?: string
): Promise<UploadSyncResult> {
  const fileBuffer = fs.readFileSync(filePath)
  const boundary = `----AppGacha${Date.now().toString(36)}`
  const fileName = 'sync.gacha'

  const parts: Buffer[] = [
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`, 'utf-8'),
    fileBuffer,
  ]
  // egg_name（总是附带——比后端从 ZIP 解析更可靠）
  parts.push(Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="egg_name"\r\n\r\n${eggName}`, 'utf-8'))
  parts.push(Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="expected_version"\r\n\r\n${expectedVersion}`, 'utf-8'))
  // icon SVG（可选）
  if (icon) {
    parts.push(Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="icon"\r\n\r\n${icon}`, 'utf-8'))
  }
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`, 'utf-8'))
  const body = Buffer.concat(parts)

  const res = await apiFetchRaw(`/sync/eggs/${eggId}`, {
    method: 'PUT',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body,
    logoutOnAuthFail: true,
  })

  if (!res.ok) await throwSyncError(res, '上传失败')
  const result = await res.json() as UploadSyncResult
  logLine(`[sync] uploaded ${eggName}`)
  return result
}

/** 从云端下载蛋并安装到本地。onProgress 可选：回调 (0-100, stage)。 */
export async function downloadEgg(
  eggId: string,
  onProgress?: (percent: number, stage: 'downloading' | 'installing') => void,
  mode: 'replace' | 'copy' = 'replace'
): Promise<{ name: string; eggId: string; contentHash: string; cloudVersion: number }> {
  // 流式下载 + 进度回调
  const downloaded = await apiDownloadStream(
    `/sync/eggs/${eggId}`,
    (p) => onProgress?.(p.percent, 'downloading')
  )
  const contentHash = downloaded.headers.get('x-content-hash') || ''
  const cloudVersion = Number(downloaded.headers.get('x-egg-version') || '0')
  if (!/^[a-f0-9]{64}$/i.test(contentHash) || !Number.isInteger(cloudVersion) || cloudVersion < 1) {
    throw new Error('SYNC_METADATA_INVALID')
  }

  // 安装阶段
  onProgress?.(100, 'installing')

  const tmpFile = path.join(dataRoot('staging'), `__dl-${eggId}-${Date.now()}.gacha`)
  const tmpDir = path.join(dataRoot('staging'), `__dl-dir-${eggId}-${Date.now()}`)
  fs.mkdirSync(path.dirname(tmpFile), { recursive: true })
  try {
    fs.writeFileSync(tmpFile, downloaded.buffer)
    const actualHash = crypto.createHash('sha256').update(downloaded.buffer).digest('hex')
    if (actualHash !== contentHash) throw new Error('SYNC_CONTENT_HASH_MISMATCH')

    // 解包到临时目录
    fs.mkdirSync(tmpDir, { recursive: true })
    await unpackGacha(tmpFile, tmpDir)

    const manifest = loadManifest(tmpDir)
    if (manifest.eggId !== eggId) throw new Error('SYNC_EGG_ID_MISMATCH')
    assertValidDownloadedEgg(tmpDir)

    if (mode === 'copy') {
      const newId = crypto.randomUUID().toLowerCase()
      const manifestPath = path.join(tmpDir, 'manifest.json')
      const copyManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
      copyManifest.eggId = newId
      copyManifest.name = `${manifest.name} (Cloud copy)`
      fs.writeFileSync(manifestPath, JSON.stringify(copyManifest, null, 2), 'utf-8')
      const dest = uniqueEggFolder(copyManifest.name)
      safeRename(tmpDir, dest)
      const ctx = registerEgg(dest)
      initSchedules([ctx])
      return { name: copyManifest.name, eggId: newId, contentHash, cloudVersion }
    }

    const existing = getEgg(manifest.eggId)
    if (existing) {
      if (registry.isEggActive(existing.eggId)) throw new Error('SYNC_EGG_IN_USE')
      await replaceEggAtomically(tmpDir, existing.dir)
      existing.manifest = loadManifest(existing.dir)
      cancelAllForEgg(existing.eggId)
      initSchedules([existing])
      return { name: existing.manifest.name, eggId: existing.eggId, contentHash, cloudVersion }
    }

    // 新蛋 → 入柜（目录名必须以 .gacha 结尾，discoverEggs 只认这种）
    const dest = uniqueEggFolder(manifest.name)
    safeRename(tmpDir, dest)
    const ctx = registerEgg(dest)
    initSchedules([ctx])
    rememberSync(manifest.eggId, contentHash, cloudVersion)
    return { name: manifest.name, eggId: manifest.eggId, contentHash, cloudVersion }
  } finally {
    fs.rmSync(tmpFile, { force: true })
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}

function assertValidDownloadedEgg(dir: string): void {
  const issues = validateEgg(dir)
  if (issues.length > 0) {
    throw new Error('SYNC_VALIDATION_FAILED:\n' + issues.map(i => `- [${i.file}] ${i.message}`).join('\n'))
  }
}

function uniqueEggFolder(name: string): string {
  const eggsRoot = dataRoot('eggs')
  fs.mkdirSync(eggsRoot, { recursive: true })
  const base = name.replace(/[<>:"/\\|?*]/g, '_')
  let dest = path.join(eggsRoot, `${base}.gacha`)
  let i = 2
  while (fs.existsSync(dest)) dest = path.join(eggsRoot, `${base}-${i++}.gacha`)
  return dest
}

async function replaceEggAtomically(src: string, dest: string): Promise<void> {
  const backup = path.join(dataRoot('staging'), `__sync-backup-${Date.now()}-${crypto.randomUUID()}`)
  let oldMoved = false
  try {
    safeRename(dest, backup)
    oldMoved = true
    safeRename(src, dest)
  } catch (e) {
    try { fs.rmSync(dest, { recursive: true, force: true }) } catch { /* best-effort */ }
    if (oldMoved && fs.existsSync(backup)) safeRename(backup, dest)
    throw e
  }
  try { fs.rmSync(backup, { recursive: true, force: true }) } catch (e) {
    logLine('[sync] backup cleanup deferred:', (e as Error).message)
  }
}

/** Windows rename 可能因文件被占用（杀软/索引）失败，降级为 copy+delete */
function safeRename(src: string, dest: string): void {
  try {
    fs.renameSync(src, dest)
  } catch {
    copyDir(src, dest)
    fs.rmSync(src, { recursive: true, force: true })
  }
}
