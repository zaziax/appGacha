import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { getEgg, loadManifest, registerEgg } from './eggs'
import { unpackGacha, UnpackLimits } from './gachaPkg'
import { initSchedules } from './schedule'
import { dataRoot } from './paths'
import { validateEgg } from './validate'
import { uniqueEggFolder } from './eggFolder'
import { installEggAtomically } from './atomicEggInstall'

/** 导入前置校验：结构不合法（缺入口 / 权限未知 / 禁用的 JS 等）直接拒绝入柜 */
function assertValidEgg(dir: string): void {
  const issues = validateEgg(dir)
  if (issues.length > 0) {
    throw new Error('校验未通过：\n' + issues.map(i => `- [${i.file}] ${i.message}`).join('\n'))
  }
}

export async function importGachaFile(gachaFile: string, limits?: UnpackLimits): Promise<{ name: string; eggId: string }> {
  return importPackage(gachaFile, false, limits)
}

/**
 * 导入 .gacha 为新副本：解包后替换 eggId（避免与原蛋冲突），移入收藏柜。
 * 用于"仅应用"导出文件的冲突解决——用户选择"导入为新副本"时走此路径。
 */
export async function importGachaAsNew(gachaFile: string, limits?: UnpackLimits): Promise<{ name: string; eggId: string }> {
  return importPackage(gachaFile, true, limits)
}

async function importPackage(gachaFile: string, asNew: boolean, limits?: UnpackLimits): Promise<{ name: string; eggId: string }> {
  const root = dataRoot('eggs')
  const staging = dataRoot('staging')
  fs.mkdirSync(staging, { recursive: true })
  const tmp = fs.mkdtempSync(path.join(staging, '__import-'))
  try {
    await unpackGacha(gachaFile, tmp, limits)
    const manifest = loadManifest(tmp)
    assertValidEgg(tmp)
    if (asNew) {
      manifest.eggId = randomUUID()
      fs.writeFileSync(path.join(tmp, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8')
    } else if (getEgg(manifest.eggId)) {
      throw new Error(`「${manifest.name}」已在收藏柜里（eggId 相同）`)
    }
    fs.mkdirSync(root, { recursive: true })
    const dest = uniqueEggFolder(root, manifest.name)
    installEggAtomically(tmp, dest, false, message => console.warn('[import]', message))
    const ctx = registerEgg(dest)
    initSchedules([ctx])
    return { name: ctx.manifest.name, eggId: ctx.eggId }
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }) }
    catch (error) { console.warn('[import] failed to clean staging:', (error as Error).message) }
  }
}
