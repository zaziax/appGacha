import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { getEgg, loadManifest, registerEgg } from './eggs'
import { closeEggWindow } from './eggWindow'
import { getAiSettings } from './settings'
import { appRoot, dataRoot } from './paths'
import { copyDir } from './fsutil'
import { testEgg } from './test'
import { runFcDriver, DriverResult, ActivityType, IpcText } from './fcDriver'
import { logLine } from './log'

export const PIPELINE_VERSION = '0.1'
const CHECKPOINT_VERSION = 1
const MAX_ROUNDS = 3

// ─── 断点续建 ───

export interface GachaCheckpoint {
  version: number
  eggId: string
  wish: string
  lang: 'zh' | 'en'
  /** 升级模式才有的字段 */
  upgrade?: { baseWish: string }
  realEggId?: string  // 升级时用：真实蛋 ID（舱内是临时 ID）
  /** fcDriver 状态 */
  messages: unknown[]
  turns: number
  rounds: number
  totalTokens: number
  /** 中断原因 */
  errorKey: string
  createdAt: string
}

function checkpointPath(stagingDir: string): string {
  return path.join(stagingDir, 'checkpoint.json')
}

export function saveCheckpoint(stagingDir: string, cp: Omit<GachaCheckpoint, 'version' | 'createdAt'>): void {
  const data: GachaCheckpoint = {
    ...cp,
    version: CHECKPOINT_VERSION,
    createdAt: new Date().toISOString()
  }
  fs.writeFileSync(checkpointPath(stagingDir), JSON.stringify(data, null, 2), 'utf-8')
}

export function loadCheckpoint(eggId: string): GachaCheckpoint | null {
  const dir = dataRoot('staging', eggId)
  const p = checkpointPath(dir)
  if (!fs.existsSync(p)) return null
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf-8'))
    if (data.version === CHECKPOINT_VERSION) return data as GachaCheckpoint
  } catch { /* 损坏的 checkpoint 视为不存在 */ }
  return null
}

export function hasCheckpoint(eggId: string): boolean {
  return loadCheckpoint(eggId) !== null
}

export function abandonCheckpoint(eggId: string): void {
  const dir = dataRoot('staging', eggId)
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true })
}

/** 扫描所有待续建的断点（供 UI 查询） */
export function listCheckpoints(): GachaCheckpoint[] {
  const dir = dataRoot('staging')
  if (!fs.existsSync(dir)) return []
  const result: GachaCheckpoint[] = []
  for (const entry of fs.readdirSync(dir)) {
    const cp = loadCheckpoint(entry)
    if (cp) result.push(cp)
  }
  return result
}

export interface GachaActivity {
  type: ActivityType
  text: IpcText
  /** 同 id 的条目在前端原地替换（流式思考实时更新） */
  id?: string
}

export interface GachaProgress {
  stage: 'coin' | 'crank' | 'clack' | 'pop' | 'fail' | 'cancelled'
  detail?: IpcText
  activity?: GachaActivity
  /** 进度量化：当前回合/总回合 + 当前轮次/总轮次 */
  metrics?: { turn: number; maxTurns: number; round: number; maxRounds: number }
}

export interface GachaResult {
  ok: boolean
  eggId?: string
  name?: string
  error?: IpcText
  /** 蛋图标 SVG 原文——开蛋仪式爆出用（缺失时为空串） */
  icon?: string
}

let busy = false
let currentAbort: AbortController | null = null

export function isGachaBusy(): boolean {
  return busy
}

/** 取消当前正在进行的扭蛋/升级。安全幂等：无在途任务时调用无副作用。 */
export function cancelGacha(): void {
  if (currentAbort) {
    currentAbort.abort()
    currentAbort = null
  }
}

function cancelledResult(onProgress?: (p: GachaProgress) => void): GachaResult {
  onProgress?.({ stage: 'cancelled' })
  return { ok: false, error: { key: 'err.cancelled' } }
}

// 启动时调用：清扫上一次残留的 staging 目录，但保留断点续建的检查点
export function sweepStaging(): void {
  const dir = dataRoot('staging')
  if (!fs.existsSync(dir)) return
  for (const entry of fs.readdirSync(dir)) {
    // 有待续建断点的目录不删：用户可能充值后回来继续
    if (fs.existsSync(path.join(dir, entry, 'checkpoint.json'))) continue
    try { fs.rmSync(path.join(dir, entry), { recursive: true, force: true }) } catch { /* 占用时下次再扫 */ }
  }
}

// GachaDriver 接口位：目前唯一实现是 runFcDriver，日后可插拔替换
type GachaDriver = typeof runFcDriver

export async function runGacha(
  wish: string,
  lang: 'zh' | 'en',
  onProgress: (p: GachaProgress) => void,
  driver: GachaDriver = runFcDriver
): Promise<GachaResult> {
  if (busy) return { ok: false, error: { key: 'err.busy' } }
  if (typeof wish !== 'string' || wish.trim().length < 2) return { ok: false, error: { key: 'err.wishTooShort' } }
  busy = true
  currentAbort = new AbortController()
  const signal = currentAbort.signal

  const eggId = randomUUID().toLowerCase()
  const stagingDir = dataRoot('staging', eggId)
  logLine('[pipeline] runGacha start:', { eggId, wish: wish.trim().slice(0, 60), lang })

  try {
    // ① 投币：备舱——模板落位，manifest 由管线写入（wish 不经智能体之手）
    onProgress({ stage: 'coin', detail: { key: 'pipe.coin' } })
    if (signal.aborted) return cancelledResult(onProgress)
    fs.mkdirSync(stagingDir, { recursive: true })
    copyDir(appRoot('template'), stagingDir)
    fs.rmSync(path.join(stagingDir, 'EGG_GUIDE.md'), { force: true })
    fs.rmSync(path.join(stagingDir, 'egg.d.ts'), { force: true })
    writeManifestFields(stagingDir, { eggId, wish: wish.trim() })

    // ② 旋钮转动：驱动智能体制造
    onProgress({ stage: 'crank', detail: { key: 'pipe.crank' } })
    if (signal.aborted) return cancelledResult(onProgress)
    const result: DriverResult = await runDriverSafely(driver, wish.trim(), lang, stagingDir, onProgress, signal)

    if (!result.ok) {
      if (signal.aborted) return cancelledResult(onProgress)
      // 断点模式：保留 staging 目录，不归档失败（用户可续建）
      if (!result.checkpointed) {
        logLine('[pipeline] runGacha archiveFailure:', { eggId, error: result.error })
        archiveFailure(stagingDir, eggId, wish, result)
      } else {
        logLine('[pipeline] runGacha checkpointed (staging preserved):', { eggId })
      }
      onProgress({ stage: 'fail', detail: result.error })
      return { ok: false, error: result.error }
    }

    if (signal.aborted) return cancelledResult(onProgress)
    // ③ 咔哒：成功出蛋后清除断点（如果有的话）
    try { fs.rmSync(checkpointPath(stagingDir), { force: true }) } catch { /* 可能本就不存在 */ }
    // 剥离未用 vendor，管线复写受保护字段（防智能体篡改），原子入柜
    logLine('[pipeline] runGacha stripUnusedVendor start:', { eggId, stagingDir })
    stripUnusedVendor(stagingDir)
    logLine('[pipeline] runGacha stripUnusedVendor done:', { eggId, vendorExists: fs.existsSync(path.join(stagingDir, 'vendor')) })
    const manifest = writeManifestFields(stagingDir, { eggId, wish: wish.trim() })
    const dest = uniqueFolder(dataRoot('eggs'), manifest.name)
    logLine('[pipeline] runGacha uniqueFolder:', { eggId, name: manifest.name, dest })
    fs.mkdirSync(dataRoot('eggs'), { recursive: true })
    await safeRename(stagingDir, dest)
    const ctx = registerEgg(dest)
    logLine('[pipeline] runGacha registered:', { eggId: ctx.eggId, name: manifest.name, dest })
    onProgress({ stage: 'pop', detail: { key: 'pipe.pop', params: { name: manifest.name } } })
    return { ok: true, eggId: ctx.eggId, name: manifest.name, icon: readIconSvg(dest) }
  } catch (e) {
    if (signal.aborted) return cancelledResult(onProgress)
    const error = (e as Error).message
    try { archiveFailure(stagingDir, eggId, wish, { ok: false, rounds: 0, turns: 0, error }) } catch { /* 尽力而为 */ }
    onProgress({ stage: 'fail', detail: error })
    return { ok: false, error }
  } finally {
    busy = false
    currentAbort = null
  }
}

/** 断点续建：从上次中断的 staging 目录继续构建 */
export async function resumeGacha(
  eggId: string,
  onProgress: (p: GachaProgress) => void,
  driver: GachaDriver = runFcDriver
): Promise<GachaResult> {
  const cp = loadCheckpoint(eggId)
  if (!cp) return { ok: false, error: 'no checkpoint found' }
  if (busy) return { ok: false, error: { key: 'err.busy' } }

  busy = true
  currentAbort = new AbortController()
  const signal = currentAbort.signal

  const stagingDir = dataRoot('staging', eggId)
  const isUpgrade = !!cp.realEggId && !!cp.upgrade

  try {
    // 续建：staging 目录已存在，直接驱动继续
    onProgress({ stage: 'crank', detail: { key: 'pipe.crank' } })
    if (signal.aborted) return cancelledResult(onProgress)

    const result: DriverResult = await runDriverSafely(driver, cp.wish, cp.lang, stagingDir, onProgress, signal, cp)

    if (!result.ok) {
      if (signal.aborted) return cancelledResult(onProgress)
      if (!result.checkpointed) archiveFailure(stagingDir, eggId, cp.wish, result)
      onProgress({ stage: 'fail', detail: result.error })
      return { ok: false, error: result.error }
    }

    if (signal.aborted) return cancelledResult(onProgress)

    // 成功：清除断点
    try { fs.rmSync(checkpointPath(stagingDir), { force: true }) } catch { /* 可能已不存在 */ }

    if (isUpgrade) {
      // 升级续建：迁移试跑 + 换装（与 runUpgrade 相同的后处理）
      const egg = getEgg(cp.realEggId!)
      if (egg) {
        const dataDir = path.join(egg.dir, 'data')
        if (fs.existsSync(dataDir)) {
          onProgress({ stage: 'clack', detail: { key: 'pipe.migrate' } })
          copyDir(dataDir, path.join(stagingDir, 'data'))
          const t = await testEgg(stagingDir)
          fs.rmSync(path.join(stagingDir, 'data'), { recursive: true, force: true })
          if (!t.ok) {
            const error: IpcText = { key: 'err.migrateFailed', params: { detail:
              (t.error ?? [t.crashed ? '渲染进程崩溃' : '', t.blank ? '页面空白' : '', ...t.consoleErrors].filter(Boolean).join('；')) } }
            archiveFailure(stagingDir, eggId, cp.wish, { ...result, ok: false, error })
            onProgress({ stage: 'fail', detail: error })
            return { ok: false, error }
          }
        }
        stripUnusedVendor(stagingDir)
        patchManifest(stagingDir, m => {
          m.eggId = cp.realEggId
          m.wish = egg.manifest.wish ?? cp.wish
          m.hostApiVersion = '1'
          m.version = bumpMinor(String(egg.manifest.version ?? '1.0.0'))
          m.createdBy = { model: getAiSettings()?.model ?? 'unknown', pipelineVersion: PIPELINE_VERSION }
          m.upgrades = [...(egg.manifest.upgrades ?? []), { wish: cp.wish, at: new Date().toISOString(), model: getAiSettings()?.model ?? 'unknown' }]
        })
        closeEggWindow(cp.realEggId!)
        try {
          swapCode(stagingDir, egg.dir)
        } catch (e) {
          restoreLatestBackup(cp.realEggId!, egg.dir)
          throw e
        }
        fs.rmSync(stagingDir, { recursive: true, force: true })
        egg.manifest = loadManifest(egg.dir)
        onProgress({ stage: 'pop', detail: { key: 'pipe.popUpgraded', params: { name: egg.manifest.name } } })
        return { ok: true, eggId: cp.realEggId!, name: egg.manifest.name, icon: readIconSvg(egg.dir) }
      }
    }

    // 新蛋续建：与 runGacha 相同的后处理
    stripUnusedVendor(stagingDir)
    const manifest = writeManifestFields(stagingDir, { eggId, wish: cp.wish })
    const dest = uniqueFolder(dataRoot('eggs'), manifest.name)
    fs.mkdirSync(dataRoot('eggs'), { recursive: true })
    await safeRename(stagingDir, dest)
    const ctx = registerEgg(dest)
    onProgress({ stage: 'pop', detail: { key: 'pipe.pop', params: { name: manifest.name } } })
    return { ok: true, eggId: ctx.eggId, name: manifest.name, icon: readIconSvg(dest) }
  } catch (e) {
    if (signal.aborted) return cancelledResult(onProgress)
    const error = (e as Error).message
    try { archiveFailure(stagingDir, eggId, cp.wish, { ok: false, rounds: 0, turns: 0, error }) } catch { /* 尽力而为 */ }
    onProgress({ stage: 'fail', detail: error })
    return { ok: false, error }
  } finally {
    busy = false
    currentAbort = null
  }
}

const MAX_BACKUPS_PER_EGG = 5

// 许愿升级：备份 → 现有代码入舱（临时身份）→ 增量进化 → 迁移试跑 → 换装
export async function runUpgrade(
  eggId: string,
  wish: string,
  lang: 'zh' | 'en',
  onProgress: (p: GachaProgress) => void,
  driver: GachaDriver = runFcDriver
): Promise<GachaResult> {
  if (busy) return { ok: false, error: { key: 'err.busy' } }
  if (typeof wish !== 'string' || wish.trim().length < 2) return { ok: false, error: { key: 'err.wishTooShort' } }
  const egg = getEgg(eggId)
  if (!egg || egg.ephemeral) return { ok: false, error: 'egg not found' }
  busy = true
  currentAbort = new AbortController()
  const signal = currentAbort.signal

  // 舱内用临时身份：正主还在柜里营业，同 eggId 会撞注册表；换装时管线写回真身
  const tempId = randomUUID().toLowerCase()
  const stagingDir = dataRoot('staging', tempId)
  const upgradeWish = wish.trim()
  logLine('[pipeline] runUpgrade start:', { realEggId: eggId, eggName: egg.manifest.name, tempId, wish: upgradeWish.slice(0, 60), lang })

  try {
    // ① 投币：整蛋备份（含数据），然后代码入舱（data/ 不进舱，不给智能体碰真实数据）
    onProgress({ stage: 'coin', detail: { key: 'pipe.backup', params: { name: egg.manifest.name } } })
    backupEgg(eggId, egg.dir)
    fs.mkdirSync(stagingDir, { recursive: true })
    const realDataDir = path.resolve(egg.dir, 'data')
    copyDir(egg.dir, stagingDir, src => path.resolve(src) !== realDataDir)
    // 回补 vendor：创建时被剥离的预置库在升级时重新可用（只补缺失的，不覆盖蛋已有的）
    const templateVendor = appRoot('template', 'vendor')
    if (fs.existsSync(templateVendor)) {
      const stagingVendor = path.join(stagingDir, 'vendor')
      for (const f of fs.readdirSync(templateVendor)) {
        if (!fs.existsSync(path.join(stagingVendor, f))) {
          fs.mkdirSync(stagingVendor, { recursive: true })
          fs.copyFileSync(path.join(templateVendor, f), path.join(stagingVendor, f))
        }
      }
    }
    patchManifest(stagingDir, m => { m.eggId = tempId })

    // ② 旋钮转动：增量进化（驱动自检走的是"无数据全新安装"路径）
    onProgress({ stage: 'crank', detail: { key: 'pipe.crankUpgrade' } })
    if (signal.aborted) return cancelledResult(onProgress)
    const result = await driver({
      wish: upgradeWish,
      stagingDir,
      templateDir: appRoot('template'),
      maxRounds: MAX_ROUNDS,
      lang,
      upgrade: { baseWish: egg.manifest.wish ?? '（未留档）' },
      signal,
      onStage: (stage, detail) => onProgress({ stage: stage === 'clack' ? 'clack' : 'crank', detail }),
      onActivity: (type, text, id) => onProgress({ stage: 'crank', activity: { type, text, id } }),
      onCheckpoint: (state) => {
        saveCheckpoint(stagingDir, {
          eggId: tempId,
          wish: upgradeWish,
          lang,
          upgrade: { baseWish: egg.manifest.wish ?? '（未留档）' },
          realEggId: eggId,
          messages: state.messages,
          turns: state.turns,
          rounds: state.rounds,
          totalTokens: state.totalTokens,
          errorKey: 'err.checkpointed'
        })
      }
    })
    if (!result.ok) {
      if (signal.aborted) return cancelledResult(onProgress)
      if (!result.checkpointed) archiveFailure(stagingDir, tempId, upgradeWish, result)
      onProgress({ stage: 'fail', detail: result.error })
      return { ok: false, error: result.error }
    }
    // ③ 机芯咔咔：把真实数据的副本放进舱，验证升级后的代码带着旧数据也能跑（迁移验收）
    const dataDir = path.join(egg.dir, 'data')
    if (fs.existsSync(dataDir)) {
      onProgress({ stage: 'clack', detail: { key: 'pipe.migrate' } })
      copyDir(dataDir, path.join(stagingDir, 'data'))
      const t = await testEgg(stagingDir)
      fs.rmSync(path.join(stagingDir, 'data'), { recursive: true, force: true })
      if (!t.ok) {
        const error: IpcText = { key: 'err.migrateFailed', params: { detail:
          (t.error ?? [t.crashed ? '渲染进程崩溃' : '', t.blank ? '页面空白' : '', ...t.consoleErrors].filter(Boolean).join('；')) } }
        archiveFailure(stagingDir, tempId, upgradeWish, { ...result, ok: false, error })
        onProgress({ stage: 'fail', detail: error })
        return { ok: false, error }
      }
    }

    // ④ 咔哒：剥离未用 vendor，写回真身与升级记录，换装（代码整体替换，data/ 原地不动）
    logLine('[pipeline] runUpgrade stripUnusedVendor start:', { tempId, realEggId: eggId })
    stripUnusedVendor(stagingDir)
    logLine('[pipeline] runUpgrade stripUnusedVendor done:', { tempId, vendorExists: fs.existsSync(path.join(stagingDir, 'vendor')) })
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
      logLine('[pipeline] runUpgrade swapCode start:', { stagingDir, eggDir: egg.dir })
      swapCode(stagingDir, egg.dir)
      logLine('[pipeline] runUpgrade swapCode done')
    } catch (e) {
      // 换装半途翻车 → 从刚才的备份整体还原，蛋不能处于半新半旧状态
      logLine('[pipeline] runUpgrade swapCode FAILED, restoring backup:', (e as Error).message)
      restoreLatestBackup(eggId, egg.dir)
      throw e
    }
    logLine('[pipeline] runUpgrade removing staging:', stagingDir)
    fs.rmSync(stagingDir, { recursive: true, force: true })
    logLine('[pipeline] runUpgrade done:', { eggId, name: egg.manifest.name })
    egg.manifest = loadManifest(egg.dir)
    onProgress({ stage: 'pop', detail: { key: 'pipe.popUpgraded', params: { name: egg.manifest.name } } })
    return { ok: true, eggId, name: egg.manifest.name, icon: readIconSvg(egg.dir) }
  } catch (e) {
    if (signal.aborted) return cancelledResult(onProgress)
    const error = (e as Error).message
    try { archiveFailure(stagingDir, tempId, upgradeWish, { ok: false, rounds: 0, turns: 0, error }) } catch { /* 尽力而为 */ }
    onProgress({ stage: 'fail', detail: error })
    return { ok: false, error }
  } finally {
    busy = false
    currentAbort = null
  }
}

/** 读取蛋目录下的 icon.svg（限 16KB），开蛋仪式爆出图标用 */
function readIconSvg(dir: string): string {
  try {
    const p = path.join(dir, 'icon.svg')
    if (fs.existsSync(p) && fs.statSync(p).size <= 16 * 1024) return fs.readFileSync(p, 'utf-8')
  } catch { /* 图标缺失不影响结果 */ }
  return ''
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
  lang: 'zh' | 'en',
  stagingDir: string,
  onProgress: (p: GachaProgress) => void,
  signal: AbortSignal,
  resume?: GachaCheckpoint
): Promise<DriverResult> {
  let latestMetrics: GachaProgress['metrics'] = undefined
  return driver({
    wish,
    stagingDir,
    templateDir: appRoot('template'),
    maxRounds: MAX_ROUNDS,
    lang,
    signal,
    onStage: (stage, detail) => {
      // 驱动的实况全部转发：crank 是工作动作，clack 是自检
      onProgress({ stage: stage === 'clack' ? 'clack' : 'crank', detail, metrics: latestMetrics })
    },
    onActivity: (type, text, id) => onProgress({ stage: 'crank', activity: { type, text, id }, metrics: latestMetrics }),
    onMetrics: (m) => { latestMetrics = m },
    onCheckpoint: (state) => {
      saveCheckpoint(stagingDir, {
        eggId: path.basename(stagingDir),
        wish,
        lang,
        upgrade: resume?.upgrade,
        realEggId: resume?.realEggId,
        messages: state.messages,
        turns: state.turns,
        rounds: state.rounds,
        totalTokens: state.totalTokens,
        errorKey: 'err.checkpointed'
      })
    },
    resume: resume ? {
      messages: resume.messages,
      turns: resume.turns,
      rounds: resume.rounds,
      totalTokens: resume.totalTokens
    } : undefined
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
  let dir = path.join(rootDir, `${baseName}.gacha`)
  let i = 2
  while (fs.existsSync(dir)) dir = path.join(rootDir, `${baseName}-${i++}.gacha`)
  return dir
}

function archiveFailure(stagingDir: string, eggId: string, wish: string, result: DriverResult): void {
  if (!fs.existsSync(stagingDir)) return
  const failedRoot = dataRoot('failed')
  fs.mkdirSync(failedRoot, { recursive: true })
  const dest = path.join(failedRoot, `${new Date().toISOString().replace(/[:.]/g, '-')}-${eggId.slice(0, 8)}`)
  try {
    fs.renameSync(stagingDir, dest)
  } catch {
    // Windows 文件锁：rename 失败则复制后删除
    copyDir(stagingDir, dest)
    fs.rmSync(stagingDir, { recursive: true, force: true })
  }
  fs.writeFileSync(
    path.join(dest, 'FAILURE.json'),
    JSON.stringify({ wish, ...result, pipelineVersion: PIPELINE_VERSION }, null, 2),
    'utf-8'
  )
}

/** Windows 文件句柄释放有延迟，rename 加重试 + copy 兜底 */
async function safeRename(from: string, to: string): Promise<void> {
  for (let i = 0; i < 3; i++) {
    try {
      fs.renameSync(from, to)
      return
    } catch (e) {
      if (i === 2) {
        // 最后一次重试失败：复制后删除
        copyDir(from, to)
        fs.rmSync(from, { recursive: true, force: true })
        return
      }
      await new Promise(r => setTimeout(r, 800))
    }
  }
}

/**
 * 剥离未被 import 的 vendor 文件 + 开发参考文件（icons-manifest.json）。
 * 蛋保持自包含可移植，不用的库不占体积。
 */
function stripUnusedVendor(dir: string): void {
  // icons-manifest.json 是生成时的参考清单，运行时不需要
  fs.rmSync(path.join(dir, 'icons-manifest.json'), { force: true })

  const vendorDir = path.join(dir, 'vendor')
  if (!fs.existsSync(vendorDir)) return

  // 扫描蛋自身代码（跳过 vendor/ 和 data/）中的 vendor 引用
  const referenced = new Set<string>()
  const scanImports = (rel: string) => {
    for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const relPath = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (relPath !== 'vendor' && relPath !== 'data') scanImports(relPath)
        continue
      }
      if (!entry.name.endsWith('.js') && !entry.name.endsWith('.html')) continue
      const content = fs.readFileSync(path.join(dir, relPath), 'utf-8')
      for (const m of content.matchAll(/\.\/vendor\/([\w.-]+)/g)) referenced.add(m[1])
    }
  }
  scanImports('')

  for (const file of fs.readdirSync(vendorDir)) {
    if (!referenced.has(file)) fs.rmSync(path.join(vendorDir, file), { force: true })
  }
  // vendor 目录空了则整个移除
  if (fs.readdirSync(vendorDir).length === 0) fs.rmSync(vendorDir, { recursive: true, force: true })
}
