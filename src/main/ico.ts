import fs from 'node:fs'
import path from 'node:path'

/**
 * 蛋快捷方式图标（.ico）生成。
 * PNG 由渲染进程离屏 Three.js 渲染产出（与收藏架视觉一致），
 * 主进程只负责把多尺寸 PNG 封装成 ICO 文件。
 */

/** ICO 尺寸（px），Windows 快捷方式常用规格 */
export const ICO_SIZES = [16, 32, 48, 256]

/**
 * 把多张 PNG Buffer 封装为 ICO 文件 Buffer。
 * ICO 头(6B) + 目录项(每项16B) + 各 PNG 数据。
 * Windows Vista+ 支持 ICO 内嵌 PNG（colorCount=0 标记）。
 */
function encodeIco(pngs: Map<number, Buffer>): Buffer {
  const entries: { size: number; png: Buffer }[] = []
  for (const size of ICO_SIZES) {
    const png = pngs.get(size)
    if (png) entries.push({ size, png })
  }
  const headerSize = 6
  const dirSize = entries.length * 16
  let offset = headerSize + dirSize
  const parts: Buffer[] = []

  // 头：reserved=0, type=1(ICO), count
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(entries.length, 4)
  parts.push(header)

  for (const { size, png } of entries) {
    const dir = Buffer.alloc(16)
    dir.writeUInt8(size >= 256 ? 0 : size, 0)
    dir.writeUInt8(size >= 256 ? 0 : size, 1)
    dir.writeUInt8(0, 2) // colorCount=0 → PNG
    dir.writeUInt8(0, 3)
    dir.writeUInt16LE(1, 4) // planes
    dir.writeUInt16LE(32, 6) // bpp
    dir.writeUInt32LE(png.length, 8)
    dir.writeUInt32LE(offset, 12)
    parts.push(dir)
    offset += png.length
  }

  for (const { png } of entries) parts.push(png)
  return Buffer.concat(parts)
}

/** data URL → PNG Buffer（去掉 data:image/png;base64, 前缀） */
function dataUrlToBuffer(dataUrl: string): Buffer {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  return Buffer.from(base64, 'base64')
}

/**
 * 把渲染进程传来的多尺寸 PNG（data URL）写入蛋目录 icon-<时间戳>.ico。
 * 每次用唯一文件名：Windows 图标缓存按路径缓存，同路径覆盖内容不会刷新显示。
 * 写入后清理旧图标文件（含旧版固定名 icon.ico），快捷方式总是指向最新文件。
 * 返回新 ico 绝对路径。
 */
export function writeEggIco(eggDir: string, pngDataUrls: Record<number, string>): string {
  const absDir = path.resolve(eggDir)
  const pngs = new Map<number, Buffer>()
  for (const [sizeStr, dataUrl] of Object.entries(pngDataUrls)) {
    pngs.set(Number(sizeStr), dataUrlToBuffer(dataUrl))
  }
  const icoPath = path.join(absDir, `icon-${Date.now()}.ico`)
  fs.writeFileSync(icoPath, encodeIco(pngs))

  // 清理旧图标，避免蛋目录堆积
  for (const f of fs.readdirSync(absDir)) {
    if (ICO_FILE_RE.test(f)) {
      const p = path.join(absDir, f)
      if (p !== icoPath) fs.rmSync(p, { force: true })
    }
  }
  return icoPath
}

/** 蛋图标文件名：icon.ico（旧版）或 icon-<时间戳>.ico */
const ICO_FILE_RE = /^icon(-\d+)?\.ico$/

/** 蛋目录下最新的 ico 绝对路径（时间戳最大者），无则 null */
export function eggIcoPath(eggDir: string): string | null {
  const absDir = path.resolve(eggDir)
  if (!fs.existsSync(absDir)) return null
  const candidates = fs.readdirSync(absDir).filter(f => ICO_FILE_RE.test(f)).sort()
  if (candidates.length === 0) return null
  return path.join(absDir, candidates[candidates.length - 1])
}
