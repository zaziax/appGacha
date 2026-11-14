import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getEgg, removeEgg } from '../src/main/eggs'
import { packGacha } from '../src/main/gachaPkg'
import { importGachaAsNew, importGachaFile } from '../src/main/eggImport'

const paths = vi.hoisted(() => ({ root: '' }))
vi.mock('../src/main/paths', () => ({ dataRoot: (...parts: string[]) => path.join(paths.root, ...parts) }))
vi.mock('../src/main/schedule', () => ({ initSchedules: vi.fn() }))

let ids: string[]
beforeEach(() => {
  paths.root = fs.mkdtempSync(path.join(os.tmpdir(), 'appgacha-import-test-'))
  ids = []
})
afterEach(() => {
  vi.restoreAllMocks()
  for (const id of ids) removeEgg(id)
  fs.rmSync(paths.root, { recursive: true, force: true })
})

async function makePackage(id: string, name: string) {
  const source = path.join(paths.root, id)
  fs.mkdirSync(path.join(source, 'data'), { recursive: true })
  fs.writeFileSync(path.join(source, 'manifest.json'), JSON.stringify({ eggId: id, name, hostApiVersion: '1', permissions: [] }))
  fs.writeFileSync(path.join(source, 'index.html'), '<!doctype html><title>Test</title><p>Test</p>')
  fs.writeFileSync(path.join(source, 'data', 'record.txt'), id)
  const file = path.join(paths.root, `${id}.gacha`)
  await packGacha(source, file)
  return file
}

it('keeps an imported display name from escaping the library and preserves data in a new copy', async () => {
  ids.push('import-first')
  const file = await makePackage(ids[0], '../outside')
  const original = await importGachaFile(file)
  expect(original.name).toBe('../outside')
  expect(path.dirname(getEgg(original.eggId)!.dir)).toBe(path.join(paths.root, 'eggs'))
  expect(fs.existsSync(path.join(paths.root, 'outside.gacha'))).toBe(false)
  await expect(importGachaFile(file)).rejects.toThrow('eggId 相同')

  const copy = await importGachaAsNew(file)
  ids.push(copy.eggId)
  expect(copy.eggId).not.toBe(original.eggId)
  expect(getEgg(copy.eggId)!.dir).not.toBe(getEgg(original.eggId)!.dir)
  expect(fs.readFileSync(path.join(getEgg(copy.eggId)!.dir, 'data', 'record.txt'), 'utf8')).toBe(original.eggId)
  expect(fs.readdirSync(path.join(paths.root, 'staging'))).toEqual([])
})

it('isolates simultaneous imports even when started in the same millisecond', async () => {
  ids.push('import-a', 'import-b')
  const files = await Promise.all(ids.map(id => makePackage(id, 'Same name')))
  vi.spyOn(Date, 'now').mockReturnValue(100)
  await Promise.all(files.map(file => importGachaFile(file)))
  for (const id of ids) {
    expect(fs.readFileSync(path.join(getEgg(id)!.dir, 'data', 'record.txt'), 'utf8')).toBe(id)
  }
  expect(new Set(ids.map(id => getEgg(id)!.dir)).size).toBe(2)
})

it('leaves no partial cabinet entry when copying into the library fails', async () => {
  ids.push('import-failure')
  const file = await makePackage(ids[0], 'Incomplete')
  vi.spyOn(fs, 'copyFileSync').mockImplementationOnce(() => { throw new Error('ENOSPC') })
  await expect(importGachaFile(file)).rejects.toThrow('ENOSPC')
  expect(getEgg(ids[0])).toBeUndefined()
  expect(fs.readdirSync(path.join(paths.root, 'eggs'))).toEqual([])
  expect(fs.readdirSync(path.join(paths.root, 'staging'))).toEqual([])
})
