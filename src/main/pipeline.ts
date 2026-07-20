import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { getEgg, loadManifest, registerEgg } from './eggs'
import { closeEggWindow } from './eggWindow'
import { getAiSettings } from './settings'
import { appRoot, dataRoot } from './paths'
import { copyDir } from './fsutil'
import { testEgg } from './test'
import { runFcDriver, DriverResult, ActivityType } from './fcDriver'

export const PIPELINE_VERSION = '0.1'
const MAX_ROUNDS = 3

export interface GachaActivity {
  type: ActivityType
  text: string
  /** 同 id 的条目在前端原地替换（流式思考实时更新） */
  id?: string
}

export interface GachaProgress {
  stage: 'coin' | 'crank' | 'clack' | 'pop' | 'fail'
  detail?: string
  activity?: GachaActivity
}

export interface GachaResult {
  ok: boolean
  eggId?: string
  name?: string
  error?: string
}

let busy = false

export function isGachaBusy(): boolean {
  return busy
}

// 启动时调用：应用刚启动不可能有在途扭蛋，舱内一切（中断残留目录、自检截图）都是遗留物
export function sweepStaging(): void {
  const dir = dataRoot('staging')
  if (!fs.existsSync(dir)) return
  for (const entry of fs.readdirSync(dir)) {
    try { fs.rmSync(path.join(dir, entry), { recursive: true, force: true }) } catch { /* 占用时下次再扫 */ }
  }
}

// GachaDriver 接口位：目前唯一实现是 runFcDriver，日后可插拔替换
type GachaDriver = typeof runFcDriver

export async function runGacha(
  wish: string,
  onProgress: (p: GachaProgress) => void,
  driver: GachaDriver = runFcDriver
): Promise<GachaResult> {
  if (busy) return { ok: false, error: '机芯正忙，请等上一颗蛋出来' }
  if (typeof wish !== 'string' || wish.trim().length < 2) return { ok: false, error: '愿望太短了，多说两句' }
  busy = true

  const eggId = randomUUID().toLowerCase()
  const stagingDir = dataRoot('staging', eggId)

  try {
    // ① 投币：备舱——模板落位，manifest 由管线写入（wish 不经智能体之手）
    onProgress({ stage: 'coin', detail: '投币，装配舱就位' })
    fs.mkdirSync(stagingDir, { recursive: true })
    copyDir(appRoot('template'), stagingDir)
    fs.rmSync(path.join(stagingDir, 'EGG_GUIDE.md'), { force: true })
    fs.rmSync(path.join(stagingDir, 'egg.d.ts'), { force: true })
    writeManifestFields(stagingDir, { eggId, wish: wish.trim() })

    // ② 旋钮转动：驱动智能体制造
    onProgress({ stage: 'crank', detail: '旋钮转动，机芯开始工作' })
    const result: DriverResult = await runDriverSafely(driver, wish.trim(), stagingDir, onProgress)

    if (!result.ok) {
      archiveFailure(stagingDir, eggId, wish, result)
      onProgress({ stage: 'fail', detail: result.error })
      return { ok: false, error: result.error }
    }

    // ③ 咔哒：管线复写受保护字段（防智能体篡改），原子入柜
    const manifest = writeManifestFields(stagingDir, { eggId, wish: wish.trim() })
    const dest = uniqueFolder(dataRoot('eggs'), manifest.name)
    fs.mkdirSync(dataRoot('eggs'), { recursive: true })
    fs.renameSync(stagingDir, dest)
    const ctx = registerEgg(dest)
    onProgress({ stage: 'pop', detail: `咔哒！「${manifest.name}」出蛋了` })
    return { ok: true, eggId: ctx.eggId, name: manifest.name }
  } catch (e) {
    const error = (e as Error).message
    try { archiveFailure(stagingDir, eggId, wish, { ok: false, rounds: 0, turns: 0, error }) } catch { /* 尽力而为 */ }
    onProgress({ stage: 'fail', detail: error })
    return { ok: false, error }
  } finally {
    busy = false
  }
}

const MAX_BACKUPS_PER_EGG = 5

// 许愿升级：备份 → 现有代码入舱（临时身份）→ 增量进化 → 迁移试跑 → 换装
export async function runUpgrade(
  eggId: string,
  wish: string,
  onProgress: (p: GachaProgress) => void,
  driver: GachaDriver = runFcDriver
): Promise<GachaResult> {
  if (busy) return { ok: false, error: '机芯正忙，请等上一颗蛋出来' }
  if (typeof wish !== 'string' || wish.trim().length < 2) return { ok: false, error: '愿望太短了，多说两句' }
  const egg = getEgg(eggId)
  if (!egg || egg.ephemeral) return { ok: false, error: 'egg not found' }
  busy = true

  // 舱内用临时身份：正主还在柜里营业，同 eggId 会撞注册表；换装时管线写回真身
  const tempId = randomUUID().toLowerCase()
  const stagingDir = dataRoot('staging', tempId)
  const upgradeWish = wish.trim()

  try {
    // ① 投币：整蛋备份（含数据），然后代码入舱（data/ 不进舱，不给智能体碰真实数据）
    onProgress({ stage: 'coin', detail: `备份「${egg.manifest.name}」…` })
    backupEgg(eggId, egg.dir)
    fs.mkdirSync(stagingDir, { recursive: true })
    const realDataDir = path.resolve(egg.dir, 'data')
    copyDir(egg.dir, stagingDir, src => path.resolve(src) !== realDataDir)
    patchManifest(stagingDir, m => { m.eggId = tempId })

    // ② 旋钮转动：增量进化（驱动自检走的是"无数据全新安装"路径）
    onProgress({ stage: 'crank', detail: '旋钮转动，机芯开始改造' })
    const result = await driver({
      wish: upgradeWish,
      stagingDir,
      templateDir: appRoot('template'),
      maxRounds: MAX_ROUNDS,
      upgrade: { baseWish: egg.manifest.wish ?? '（未留档）' },
      onStage: (stage, detail) => onProgress({ stage: stage === 'clack' ? 'clack' : 'crank', detail }),
      onActivity: (type, text, id) => onProgress({ stage: 'crank', activity: { type, text, id } })
    })
    if (!result.ok) {
      archiveFailure(stagingDir, tempId, upgradeWish, result)
      onProgress({ stage: 'fail', detail: result.error })
      return { ok: false, error: result.error }
    }

    // ③ 机芯咔咔：把真实数据的副本放进舱，验证升级后的代码带着旧数据也能跑（迁移验收）
    const dataDir = path.join(egg.dir, 'data')
    if (fs.existsSync(dataDir)) {
      onProgress({ stage: 'clack', detail: '带旧数据迁移试跑…' })
      copyDir(dataDir, path.join(stagingDir, 'data'))
      const t = await testEgg(stagingDir)
      fs.rmSync(path.join(stagingDir, 'data'), { recursive: true, force: true })
      if (!t.ok) {
        const error = '升级代码带旧数据试跑未通过：' +
          (t.error ?? [t.crashed ? '渲染进程崩溃' : '', t.blank ? '页面空白' : '', ...t.consoleErrors].filter(Boolean).join('；'))
        archiveFailure(stagingDir, tempId, upgradeWish, { ...result, ok: false, error })
        onProgress({ stage: 'fail', detail: error })
        return { ok: false, error }
      }
    }

    // ④ 咔哒：写回真身与升级记录，换装（代码整体替换，data/ 原地不动）
    patchManifest(stagingDir, m => {
      m.eggId = eggId
      m.wish = egg.manifest.wish ?? upgradeWish
      m.hostApiVersion = '1'
      // 基于升级前真身的版本递增：智能体可能已在舱内自行 bump 过，不叠加
      m.version = bumpMinor(String(egg.manifest.version ?? '1.0.0'))
      m.createdBy = { model: getAiSettings()?.model ?? 'unknown', pipelineVersion: PIPELINE_VERSION }
      m.upgrades = [...(egg.manifest.upgrades ?? []),
        { wish: upgradeWish, at: new Date().toISOString(), model: getAiSettings()?.model ?? 'unknown' }]
    })
    closeEggWindow(eggId)
    try {
      swapCode(stagingDir, egg.dir)
    } catch (e) {
      // 换装半途翻车 → 从刚才的备份整体还原，蛋不能处于半新半旧状态
      restoreLatestBackup(eggId, egg.dir)
      throw e
    }
    fs.rmSync(stagingDir, { recursive: true, force: true })
    egg.manifest = loadManifest(egg.dir)
    onProgress({ stage: 'pop', detail: `咔哒！「${egg.manifest.name}」升级完成` })
    return { ok: true, eggId, name: egg.manifest.name }
  } catch (e) {
    const error = (e as Error).message
    try { archiveFailure(stagingDir, tempId, upgradeWish, { ok: false, rounds: 0, turns: 0, error }) } catch { /* 尽力而为 */ }
    onProgress({ stage: 'fail', detail: error })
    return { ok: false, error }
  } finally {
    busy = false
  }
}

function backupsDir(eggId: string): string {
  return dataRoot('backups', eggId)
}

export function hasBackup(eggId: string): boolean {
  const dir = backupsDir(eggId)
  return fs.existsSync(dir) && fs.readdirSync(dir).length > 0
}

function backupEgg(eggId: string, eggDir: string): void {
  const dest = path.join(backupsDir(eggId), new Date().toISOString().replace(/[:.]/g, '-'))
  copyDir(eggDir, dest)
  const all = fs.readdirSync(backupsDir(eggId)).sort()
  for (const old of all.slice(0, Math.max(0, all.length - MAX_BACKUPS_PER_EGG))) {
    fs.rmSync(path.join(backupsDir(eggId), old), { recursive: true, force: true })
  }
}

// 还原最近一次备份（整蛋覆盖，含数据）。返回还原后的 manifest 名称。
export function restoreLatestBackup(eggId: string, eggDir: string): string {
  const dir = backupsDir(eggId)
  const all = fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []
  if (all.length === 0) throw new Error('没有可用的备份')
  const src = path.join(dir, all[all.length - 1])
  fs.rmSync(eggDir, { recursive: true, force: true })
  copyDir(src, eggDir)
  return loadManifest(eggDir).name
}

// 代码整体换装：蛋目录里 data/ 之外全部替换为舱内产物
function swapCode(stagingDir: string, eggDir: string): void {
  for (const entry of fs.readdirSync(eggDir)) {
    if (entry === 'data') continue
    fs.rmSync(path.join(eggDir, entry), { recursive: true, force: true })
  }
  for (const entry of fs.readdirSync(stagingDir, { withFileTypes: true })) {
    if (entry.name === 'data') continue
    const from = path.join(stagingDir, entry.name)
    const to = path.join(eggDir, entry.name)
    if (entry.isDirectory()) copyDir(from, to)
    else fs.copyFileSync(from, to)
  }
}

function bumpMinor(v: string): string {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v)
  return m ? `${m[1]}.${Number(m[2]) + 1}.0` : '1.1.0'
}

function patchManifest(dir: string, mutate: (m: Record<string, unknown>) => void): void {
  const file = path.join(dir, 'manifest.json')
  const m = JSON.parse(fs.readFileSync(file, 'utf-8'))
  mutate(m)
  fs.writeFileSync(file, JSON.stringify(m, null, 2), 'utf-8')
}

async function runDriverSafely(
  driver: GachaDriver,
  wish: string,
  stagingDir: string,
  onProgress: (p: GachaProgress) => void
): Promise<DriverResult> {
  return driver({
    wish,
    stagingDir,
    templateDir: appRoot('template'),
    maxRounds: MAX_ROUNDS,
    onStage: (stage, detail) => {
      // 驱动的实况全部转发：crank 是工作动作，clack 是自检
      onProgress({ stage: stage === 'clack' ? 'clack' : 'crank', detail })
    },
    onActivity: (type, text, id) => onProgress({ stage: 'crank', activity: { type, text, id } })
  })
}

function writeManifestFields(dir: string, fields: { eggId: string; wish: string }): { name: string } {
  const file = path.join(dir, 'manifest.json')
  const m = JSON.parse(fs.readFileSync(file, 'utf-8'))
  m.eggId = fields.eggId
  m.wish = fields.wish
  m.hostApiVersion = '1'
  m.createdBy = { model: getAiSettings()?.model ?? 'unknown', pipelineVersion: PIPELINE_VERSION }
  fs.writeFileSync(file, JSON.stringify(m, null, 2), 'utf-8')
  return { name: typeof m.name === 'string' ? m.name : '未命名扭蛋' }
}

function uniqueFolder(rootDir: string, baseName: string): string {
  let dir = path.join(rootDir, `${baseName}.egg`)
  let i = 2
  while (fs.existsSync(dir)) dir = path.join(rootDir, `${baseName}-${i++}.egg`)
  return dir
}

function archiveFailure(stagingDir: string, eggId: string, wish: string, result: DriverResult): void {
  if (!fs.existsSync(stagingDir)) return
  const failedRoot = dataRoot('failed')
  fs.mkdirSync(failedRoot, { recursive: true })
  const dest = path.join(failedRoot, `${new Date().toISOString().replace(/[:.]/g, '-')}-${eggId.slice(0, 8)}`)
  fs.renameSync(stagingDir, dest)
  fs.writeFileSync(
    path.join(dest, 'FAILURE.json'),
    JSON.stringify({ wish, ...result, pipelineVersion: PIPELINE_VERSION }, null, 2),
    'utf-8'
  )
}
