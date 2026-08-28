import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { getEgg, loadManifest, registerEgg } from './eggs'
import { unpackGacha, UnpackLimits } from './gachaPkg'
import { initSchedules } from './schedule'
import { dataRoot } from './paths'
import { copyDir } from './fsutil'
import { validateEgg } from './validate'

/** 导入前置校验：结构不合法（缺入口 / 权限未知 / 禁用的 JS 等）直接拒绝入柜 */
function assertValidEgg(dir: string): void {
  const issues = validateEgg(dir)
  if (issues.length > 0) {
    throw new Error('校验未通过：\n' + issues.map(i => `- [${i.file}] ${i.message}`).join('\n'))
  }
}

function eggsRoot(): string {
  return dataRoot('eggs')
}

function uniqueFolder(root: string, baseName: string): string {
  let dir = path.join(root, `${baseName}.gacha`)
  let i = 2
  while (fs.existsSync(dir)) dir = path.join(root, `${baseName}-${i++}.gacha`)
  return dir
}

/**
 * 导入 .gacha 包文件：解包到临时目录 → 校验 → 冲突检测 → 移入收藏柜 → 注册。
 * 收藏柜导入按钮与双击 .gacha 文件共用此入口。
 */
export async function importGachaFile(gachaFile: string, limits?: UnpackLimits): Promise<{ name: string; eggId: string }> {
  const tmp = dataRoot('staging', `__import-${Date.now()}`)
  fs.mkdirSync(tmp, { recursive: true })
  try {
    await unpackGacha(gachaFile, tmp, limits)
    const manifest = loadManifest(tmp) // 校验不通过会抛错给调用方
    assertValidEgg(tmp)
    if (getEgg(manifest.eggId)) throw new Error(`「${manifest.name}」已在收藏柜里（eggId 相同）`)
    const dest = uniqueFolder(eggsRoot(), manifest.name)
    try {
      fs.renameSync(tmp, dest)
    } catch {
      copyDir(tmp, dest) // Windows 文件锁致 rename 失败时降级复制
    }
    const ctx = registerEgg(dest)
    initSchedules([ctx]) // 蛋若随身带着提醒，落地即生效
    return { name: manifest.name, eggId: manifest.eggId }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

/**
 * 导入 .gacha 为新副本：解包后替换 eggId（避免与原蛋冲突），移入收藏柜。
 * 用于"仅应用"导出文件的冲突解决——用户选择"导入为新副本"时走此路径。
 */
export async function importGachaAsNew(gachaFile: string, limits?: UnpackLimits): Promise<{ name: string; eggId: string }> {
  const tmp = dataRoot('staging', `__import-${Date.now()}`)
  fs.mkdirSync(tmp, { recursive: true })
  try {
    await unpackGacha(gachaFile, tmp, limits)
    const manifest = loadManifest(tmp)
    assertValidEgg(tmp)
    // 重写 eggId 为新 UUID，避免与原蛋冲突
    const newId = randomUUID().toLowerCase()
    const manifestPath = path.join(tmp, 'manifest.json')
    const m = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
    m.eggId = newId
    fs.writeFileSync(manifestPath, JSON.stringify(m, null, 2), 'utf-8')
    const dest = uniqueFolder(eggsRoot(), manifest.name)
    try {
      fs.renameSync(tmp, dest)
    } catch {
      copyDir(tmp, dest)
    }
    const ctx = registerEgg(dest)
    initSchedules([ctx])
    return { name: manifest.name, eggId: newId }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}
