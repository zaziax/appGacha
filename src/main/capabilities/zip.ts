import yazl from 'yazl'
import yauzl from 'yauzl'

// egg.zip：把一组内存里的 { name, data } 打成一个 zip 字节，或把 zip 字节解回一组 { name, data }。
// 复用打包 .gacha 已用的 yazl/yauzl，做成「桥接能力」而非 vendor 库（沙箱里没有 Node zlib/stream）。
// 纯内存进出，不落盘；压缩炸弹在流式解压时逐条目掐死。

export interface ZipEntry {
  name: string
  data: Uint8Array
}

const MAX_ZIP_ENTRIES = 1000
const MAX_ZIP_TOTAL_BYTES = 50 * 1024 * 1024 // 解压后总量上限（防 zip 炸弹）
const MAX_ZIP_ENTRY_BYTES = 10 * 1024 * 1024 // 单条目上限（与 fs 一致）

function collect(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    stream.on('data', (c: Buffer) => chunks.push(c))
    stream.on('end', () => resolve(Buffer.concat(chunks)))
    stream.on('error', reject)
  })
}

export async function create(entries: unknown): Promise<Uint8Array> {
  if (!Array.isArray(entries)) throw new Error('zip: entries must be an array')
  if (entries.length > MAX_ZIP_ENTRIES) throw new Error(`zip: too many entries (max ${MAX_ZIP_ENTRIES})`)

  const zipfile = new yazl.ZipFile()
  let total = 0
  for (const e of entries as Array<Record<string, unknown>>) {
    const name = e?.name
    const data = e?.data
    if (typeof name !== 'string' || name.length === 0) throw new Error('zip: entry name must be a non-empty string')
    if (!(data instanceof Uint8Array)) throw new Error('zip: entry data must be a Uint8Array')
    if (data.byteLength > MAX_ZIP_ENTRY_BYTES) throw new Error(`zip: entry "${name}" exceeds ${MAX_ZIP_ENTRY_BYTES} bytes`)
    total += data.byteLength
    if (total > MAX_ZIP_TOTAL_BYTES) throw new Error(`zip: total uncompressed exceeds ${MAX_ZIP_TOTAL_BYTES} bytes`)
    // ZIP 条目一律正斜杠（yazl 约定），顺手把用户传来的反斜杠规整掉
    zipfile.addBuffer(Buffer.from(data), name.replace(/\\/g, '/'))
  }
  zipfile.end()
  return collect(zipfile.outputStream)
}

export async function extract(data: unknown): Promise<ZipEntry[]> {
  if (!(data instanceof Uint8Array)) throw new Error('zip: data must be a Uint8Array')
  if (data.byteLength > MAX_ZIP_TOTAL_BYTES) throw new Error(`zip: input exceeds ${MAX_ZIP_TOTAL_BYTES} bytes`)

  return new Promise<ZipEntry[]>((resolve, reject) => {
    yauzl.fromBuffer(Buffer.from(data), { lazyEntries: true, validateEntrySizes: true }, (err, zipfile) => {
      if (err || !zipfile) {
        reject(new Error(`zip: cannot open archive: ${err?.message ?? 'unknown'}`))
        return
      }

      const out: ZipEntry[] = []
      let total = 0
      let settled = false
      const fail = (e: Error) => {
        if (!settled) { settled = true; reject(e) }
      }

      zipfile.readEntry()
      zipfile.on('entry', (entry: yauzl.Entry) => {
        if (entry.fileName.endsWith('/')) { zipfile.readEntry(); return } // 目录条目，跳过
        if (out.length >= MAX_ZIP_ENTRIES) { fail(new Error(`zip: too many entries (max ${MAX_ZIP_ENTRIES})`)); return }
        if (entry.uncompressedSize > MAX_ZIP_ENTRY_BYTES) { fail(new Error(`zip: entry "${entry.fileName}" exceeds ${MAX_ZIP_ENTRY_BYTES} bytes`)); return }
        total += entry.uncompressedSize
        if (total > MAX_ZIP_TOTAL_BYTES) { fail(new Error(`zip: total uncompressed exceeds ${MAX_ZIP_TOTAL_BYTES} bytes`)); return }

        zipfile.openReadStream(entry, (e, stream) => {
          if (e || !stream) { fail(new Error(`zip: read failed for "${entry.fileName}"`)); return }
          const chunks: Buffer[] = []
          let size = 0
          stream.on('data', (c: Buffer) => {
            size += c.length
            if (size > MAX_ZIP_ENTRY_BYTES) { fail(new Error(`zip: entry "${entry.fileName}" exceeds ${MAX_ZIP_ENTRY_BYTES} bytes`)); return }
            chunks.push(c)
          })
          stream.on('end', () => {
            out.push({ name: entry.fileName, data: Buffer.concat(chunks) })
            zipfile.readEntry()
          })
          stream.on('error', fail)
        })
      })
      zipfile.on('end', () => { if (!settled) { settled = true; resolve(out) } })
      zipfile.on('error', fail)
    })
  })
}
