import { describe, it, expect } from 'vitest'
import yazl from 'yazl'
import { create, extract } from '../src/main/capabilities/zip'

// egg.zip：内存进出，纯函数（不依赖 EggContext）。往返一致 + 参数校验 + 上限守卫。

const MAX_ZIP_ENTRY_BYTES = 10 * 1024 * 1024

// 外部工具产出的 zip 常含目录条目；用 yazl 的 addEmptyDirectory 造一个含目录的真实 zip。
function zipWithDirEntry(): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const zf = new yazl.ZipFile()
    zf.addEmptyDirectory('folder/')
    zf.addBuffer(Buffer.from([9, 9]), 'folder/real.txt')
    zf.end()
    const chunks: Buffer[] = []
    zf.outputStream.on('data', (c: Buffer) => chunks.push(c))
    zf.outputStream.on('end', () => resolve(Buffer.concat(chunks)))
    zf.outputStream.on('error', reject)
  })
}

describe('create / extract 往返', () => {
  it('多个条目打包再解包，名称与字节逐条一致', async () => {
    const a = new Uint8Array([0x00, 0x01, 0xfe, 0xff, 0x89, 0x50, 0x4e, 0x47])
    const b = new TextEncoder().encode('hello 世界')
    const zipBytes = await create([
      { name: 'a.bin', data: a },
      { name: 'dir/b.txt', data: b },
    ])
    expect(zipBytes).toBeInstanceOf(Uint8Array)

    const entries = await extract(zipBytes)
    expect(entries.map(e => e.name).sort()).toEqual(['a.bin', 'dir/b.txt'])
    const gotA = entries.find(e => e.name === 'a.bin')!.data
    const gotB = entries.find(e => e.name === 'dir/b.txt')!.data
    expect(Buffer.compare(Buffer.from(gotA), Buffer.from(a))).toBe(0)
    expect(Buffer.compare(Buffer.from(gotB), Buffer.from(b))).toBe(0)
  })

  it('反斜杠路径被规整为正斜杠', async () => {
    const zipBytes = await create([{ name: 'a\\b.txt', data: new Uint8Array([1, 2, 3]) }])
    const entries = await extract(zipBytes)
    expect(entries[0].name).toBe('a/b.txt')
  })

  it('目录条目（尾 /）在解包时被跳过', async () => {
    const zipBytes = await zipWithDirEntry()
    const entries = await extract(zipBytes)
    expect(entries.map(e => e.name)).toEqual(['folder/real.txt'])
  })
})

describe('create 参数校验', () => {
  it('拒绝非数组', async () => {
    await expect(create('nope')).rejects.toThrow(/array/)
  })

  it('拒绝空名或非字符串名', async () => {
    await expect(create([{ name: '', data: new Uint8Array([1]) }])).rejects.toThrow(/non-empty string/)
    await expect(create([{ name: 42, data: new Uint8Array([1]) }])).rejects.toThrow(/non-empty string/)
  })

  it('拒绝非 Uint8Array 数据', async () => {
    await expect(create([{ name: 'a', data: 'bytes' }])).rejects.toThrow(/Uint8Array/)
  })

  it('拒绝单条目超 10MB', async () => {
    await expect(create([{ name: 'big', data: new Uint8Array(MAX_ZIP_ENTRY_BYTES + 1) }])).rejects.toThrow(/exceeds/)
  })
})

describe('extract 参数校验', () => {
  it('拒绝非 Uint8Array 输入', async () => {
    await expect(extract('not bytes')).rejects.toThrow(/Uint8Array/)
  })

  it('拒绝损坏的 zip 字节', async () => {
    await expect(extract(new Uint8Array([1, 2, 3, 4, 5]))).rejects.toThrow(/cannot open archive/)
  })
})
