import fs from 'node:fs'
import path from 'node:path'
import { expect, it } from 'vitest'
import { releases } from '../src/shared/releaseNotes'

it('keeps application, lockfile and localized release metadata in sync', () => {
  const root = path.join(__dirname, '..')
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'))
  expect(lock.version).toBe(pkg.version)
  expect(lock.packages[''].version).toBe(pkg.version)
  expect(releases[0].version).toBe(pkg.version)
  expect(new Set(releases.map(release => release.version)).size).toBe(releases.length)
  for (const release of releases) {
    expect(release.en.length).toBeGreaterThan(0)
    expect(release.zh.length).toBe(release.en.length)
    expect([...release.en, ...release.zh].every(note => note.trim().length > 0)).toBe(true)
  }
  const notes = fs.readFileSync(path.join(root, `docs/releases/v${pkg.version}.md`), 'utf8')
  expect(notes).toContain('## English')
  expect(notes).toContain('## 中文')
})
