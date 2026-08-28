import fs from 'node:fs'
import path from 'node:path'
import { Transform } from 'node:stream'
import yazl from 'yazl'
import yauzl from 'yauzl'

export interface PackOptions {
  /** 含 data/ 目录 = 整蛋迁移；不含 = 纯应用分享 */
  includeData: boolean
}

/** 解包防护上限（防 zip bomb） */
export interface UnpackLimits {
  maxEntries: number
  maxEntryBytes: number
  maxTotalBytes: number
  maxCompressionRatio: number
}

/** 完整迁移（含 data/）：宽松上限，覆盖 Pro 云同步 1GB 配额并留余量 */
const LOOSE_LIMITS: UnpackLimits = {
  maxEntries: 10_000,
  maxEntryBytes: 2 * 1024 * 1024 * 1024, // 单条目 2GB
  maxTotalBytes: 2 * 1024 * 1024 * 1024, // 总量 2GB
  maxCompressionRatio: 1000,
}

/** 分享应用包（仅应用，无 data/）：严格上限。实际蛋本体约 2MB，几 MB 恶意包也展不开 */
export const SHARE_UNPACK_LIMITS: UnpackLimits = {
  maxEntries: 1000,
  maxEntryBytes: 10 * 1024 * 1024, // 单条目 10MB
  maxTotalBytes: 20 * 1024 * 1024, // 总量 20MB
  maxCompressionRatio: 200,
}

/**
 * 把蛋文件夹打包为 .gacha 文件（ZIP 容器，条目平铺在根部）。
 */
export async function packGacha(eggDir: string, destFile: string, opts: PackOptions = { includeData: true }): Promise<void> {
  const zipfile = new yazl.ZipFile()
  addDir(zipfile, eggDir, '', opts.includeData)
  zipfile.end()

  await new Promise<void>((resolve, reject) => {
    const out = fs.createWriteStream(destFile)
    out.on('close', resolve)
    out.on('error', reject)
    zipfile.outputStream.pipe(out)
  })
}

function addDir(zipfile: yazl.ZipFile, baseDir: string, rel: string, includeData: boolean): void {
  const abs = rel ? path.join(baseDir, rel) : baseDir
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    // ZIP 条目一律正斜杠（yazl 约定）
    const entryRel = rel ? `${rel}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      if (!includeData && rel === '' && entry.name === 'data') continue
      addDir(zipfile, baseDir, entryRel, includeData)
    } else if (entry.isFile()) {
      zipfile.addFile(path.join(abs, entry.name), entryRel)
    }
  }
}

/**
 * 解包 .gacha 文件到目标文件夹。
 * 安全防护：
 *  - 路径穿越条目（.. / 绝对路径）直接拒绝整包
 *  - 条目数 / 单条目体积 / 总量 / 压缩比上限（防 zip bomb，按实际写入字节计数）
 *  - 任一环节失败时主动关闭 zip、输入流与输出流（Windows 下避免残留文件句柄导致清理失败）
 * 解包后校验 manifest.json 存在且可解析。
 */
export async function unpackGacha(gachaFile: string, destDir: string, limits: UnpackLimits = LOOSE_LIMITS): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    yauzl.open(gachaFile, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) return reject(new Error(`无法打开 .gacha 文件：${err?.message ?? '未知错误'}`))
      let entryCount = 0
      let totalBytes = 0
      let settled = false
      const fail = (e: unknown) => {
        if (settled) return
        settled = true
        try { zipfile.close() } catch { /* 已关闭 */ }
        reject(e instanceof Error ? e : new Error(String(e)))
      }
      const ok = () => { if (!settled) { settled = true; resolve() } }

      zipfile.readEntry()
      zipfile.on('entry', (entry: yauzl.Entry) => {
        // 路径穿越防护：normalize 后仍越界的条目直接拒绝
        const normalized = path.normalize(entry.fileName)
        if (path.isAbsolute(normalized) || normalized.startsWith('..')) {
          return fail(new Error(`包内条目路径非法：${entry.fileName}`))
        }

        if (!entry.fileName.endsWith('/')) {
          entryCount += 1
          if (entryCount > limits.maxEntries) return fail(new Error(`包内条目过多（> ${limits.maxEntries}）`))
          // 声明体积预检：直接拦掉夸大 uncompressedSize 的炸弹条目
          if (entry.uncompressedSize > limits.maxEntryBytes) {
            return fail(new Error(`包内单文件过大：${entry.fileName}`))
          }
          if (entry.compressedSize > 0 && entry.uncompressedSize / entry.compressedSize > limits.maxCompressionRatio) {
            return fail(new Error(`包内文件压缩比异常：${entry.fileName}`))
          }
        }

        const target = path.join(destDir, normalized)
        if (entry.fileName.endsWith('/')) {
          fs.mkdirSync(target, { recursive: true })
          zipfile.readEntry()
        } else {
          fs.mkdirSync(path.dirname(target), { recursive: true })
          zipfile.openReadStream(entry, (e, stream) => {
            if (e || !stream) return fail(new Error(`读取包内文件失败：${entry.fileName}`))
            // 实际写入字节计数：声明值可信与否，都按落盘字节兜底
            const counter = new Transform({
              transform(chunk: Buffer, _enc, cb) {
                totalBytes += chunk.length
                if (totalBytes > limits.maxTotalBytes) {
                  cb(new Error('解包总体积超限，疑似压缩炸弹'))
                } else {
                  cb(null, chunk)
                }
              }
            })
            const out = fs.createWriteStream(target)
            // 任一环节出错：销毁计数流、读流、写流，再走 fail（关闭 zip）
            const abort = (e: unknown) => {
              counter.destroy()
              stream.destroy()
              out.destroy()
              fail(e)
            }
            stream.on('error', abort)
            counter.on('error', abort)
            out.on('error', abort)
            out.on('close', () => { if (!settled) zipfile.readEntry() })
            stream.pipe(counter).pipe(out)
          })
        }
      })
      zipfile.on('end', ok)
      zipfile.on('error', (e) => fail(e))
    })
  })

  // 解包后校验：manifest 必须存在且可解析（后续 registerEgg 会做完整 schema 校验）
  const manifestPath = path.join(destDir, 'manifest.json')
  if (!fs.existsSync(manifestPath)) throw new Error('包内缺少 manifest.json，不是有效的 .gacha 文件')
  JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
}

/**
 * 轻量探测：仅从 ZIP 中读取 manifest.json（不完整解包），用于双击打开时判断蛋是否已安装。
 */
export async function peekGachaManifest(gachaFile: string): Promise<{ eggId: string; name: string }> {
  return new Promise((resolve, reject) => {
    yauzl.open(gachaFile, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) return reject(new Error(`无法打开 .gacha 文件：${err?.message ?? '未知错误'}`))
      zipfile.readEntry()
      zipfile.on('entry', (entry: yauzl.Entry) => {
        if (path.normalize(entry.fileName) === 'manifest.json') {
          zipfile.openReadStream(entry, (e, stream) => {
            if (e || !stream) return reject(new Error('读取 manifest.json 失败'))
            let data = ''
            stream.on('data', (chunk: Buffer) => { data += chunk.toString() })
            stream.on('end', () => {
              zipfile.close()
              try {
                const m = JSON.parse(data)
                if (!m.eggId) return reject(new Error('manifest.json 缺少 eggId'))
                resolve(m)
              } catch { reject(new Error('manifest.json 解析失败')) }
            })
          })
        } else {
          zipfile.readEntry()
        }
      })
      zipfile.on('end', () => reject(new Error('包内缺少 manifest.json，不是有效的 .gacha 文件')))
      zipfile.on('error', reject)
    })
  })
}
