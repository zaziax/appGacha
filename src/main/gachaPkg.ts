import fs from 'node:fs'
import path from 'node:path'
import yazl from 'yazl'
import yauzl from 'yauzl'

export interface PackOptions {
  /** 含 data/ 目录 = 整蛋迁移；不含 = 纯应用分享 */
  includeData: boolean
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
 * 安全防护：路径穿越条目（.. / 绝对路径）直接拒绝整包。
 * 解包后校验 manifest.json 存在且可解析。
 */
export async function unpackGacha(gachaFile: string, destDir: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    yauzl.open(gachaFile, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) return reject(new Error(`无法打开 .gacha 文件：${err?.message ?? '未知错误'}`))
      zipfile.readEntry()
      zipfile.on('entry', (entry: yauzl.Entry) => {
        // 路径穿越防护：normalize 后仍越界的条目直接拒绝
        const normalized = path.normalize(entry.fileName)
        if (path.isAbsolute(normalized) || normalized.startsWith('..')) {
          return reject(new Error(`包内条目路径非法：${entry.fileName}`))
        }
        const target = path.join(destDir, normalized)
        if (entry.fileName.endsWith('/')) {
          fs.mkdirSync(target, { recursive: true })
          zipfile.readEntry()
        } else {
          fs.mkdirSync(path.dirname(target), { recursive: true })
          zipfile.openReadStream(entry, (e, stream) => {
            if (e || !stream) return reject(new Error(`读取包内文件失败：${entry.fileName}`))
            stream.pipe(fs.createWriteStream(target))
              .on('close', () => zipfile.readEntry())
              .on('error', reject)
          })
        }
      })
      zipfile.on('end', resolve)
      zipfile.on('error', reject)
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
