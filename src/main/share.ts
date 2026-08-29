/**
 * 分享码模块 — 蛋应用分享（仅应用包，3 天过期，登录即可导入）
 *
 * 创建：packGacha(不含 data) → multipart 上传 POST /share → 返回 code + expiresAt
 * 导入：GET /share/{code} → Buffer → importGachaFile 入柜（复用 .gacha 导入的冲突检测）
 */

import fs from 'node:fs'
import path from 'node:path'
import { apiFetchRaw } from './api'
import { packGacha, SHARE_UNPACK_LIMITS } from './gachaPkg'
import { getEgg } from './eggs'
import { dataRoot } from './paths'
import { importGachaFile } from './eggImport'

export interface ShareResult {
  code: string
  expiresAt: string
  name: string
}

export async function createShareCode(eggId: string): Promise<ShareResult> {
  const egg = getEgg(eggId)
  if (!egg) throw new Error('egg not found')

  let tmpFile: string | undefined
  try {
    // 仅应用打包（不含 data/ 目录）
    tmpFile = path.join(dataRoot('staging'), `__share-${Date.now()}-${Math.random().toString(36).slice(2)}.gacha`)
    fs.mkdirSync(path.dirname(tmpFile), { recursive: true })
    await packGacha(egg.dir, tmpFile, { includeData: false })

    // icon.svg（可选，后端存库预览用）
    let icon: string | undefined
    try {
      const p = path.join(egg.dir, 'icon.svg')
      if (fs.existsSync(p)) icon = fs.readFileSync(p, 'utf-8')
    } catch { /* best-effort */ }

    const fileBuffer = fs.readFileSync(tmpFile)
    const boundary = `----AppGacha${Date.now().toString(36)}`
    // 固定 ASCII 文件名：应用名可能含引号/换行等字符，会破坏 multipart 头；真名走 egg_name 字段
    const fileName = 'shared.gacha'
    const parts: Buffer[] = [
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`, 'utf-8'),
      fileBuffer,
      Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="egg_name"\r\n\r\n${egg.manifest.name}`, 'utf-8'),
      // egg_id 供后端同蛋复用旧码（刷新内容 + 延长有效期），不再重复造码
      Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="egg_id"\r\n\r\n${egg.eggId}`, 'utf-8'),
    ]
    if (icon) {
      parts.push(Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="icon"\r\n\r\n${icon}`, 'utf-8'))
    }
    parts.push(Buffer.from(`\r\n--${boundary}--\r\n`, 'utf-8'))
    const body = Buffer.concat(parts)

    const res = await apiFetchRaw('/share', {
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body,
      logoutOnAuthFail: true,
    })

    if (!res.ok) {
      let detail = ''
      try { const j = await res.json() as { detail?: string }; detail = j?.detail || '' } catch { /* 非 JSON */ }
      if (res.status === 403) {
        // 稳定错误码区分免费(引导升级) / Pro(等待过期) 两种上限
        if (detail === 'SHARE_QUOTA_PRO') throw new Error('SHARE_QUOTA_PRO')
        throw new Error('SHARE_QUOTA_FREE')
      }
      throw new Error(detail || `HTTP ${res.status}`)
    }

    const data = await res.json() as { code: string; expires_at: string }
    return { code: data.code, expiresAt: data.expires_at, name: egg.manifest.name }
  } finally {
    if (tmpFile) { try { fs.rmSync(tmpFile, { force: true }) } catch { /* best-effort */ } }
  }
}

export async function importShareCode(code: string): Promise<{ name: string; eggId: string }> {
  const res = await apiFetchRaw(`/share/${encodeURIComponent(code)}`, { logoutOnAuthFail: true, timeout: 120_000 })
  if (!res.ok) {
    if (res.status === 401) throw new Error('SHARE_LOGIN_REQUIRED')
    if (res.status === 404) throw new Error('SHARE_NOT_FOUND')
    let detail = ''
    try { const j = await res.json() as { detail?: string }; detail = j?.detail || '' } catch { /* 非 JSON */ }
    throw new Error(detail || `HTTP ${res.status}`)
  }

  const buf = Buffer.from(await res.arrayBuffer())
  const tmpFile = path.join(dataRoot('staging'), `__shareimport-${Date.now()}.gacha`)
  fs.mkdirSync(path.dirname(tmpFile), { recursive: true })
  try {
    fs.writeFileSync(tmpFile, buf)
    // 复用 .gacha 导入（分享包走严格解压上限，防 zip bomb）：解包 → 校验 → 冲突检测 → 入柜 → 注册
    return await importGachaFile(tmpFile, SHARE_UNPACK_LIMITS)
  } finally {
    fs.rmSync(tmpFile, { force: true })
  }
}
