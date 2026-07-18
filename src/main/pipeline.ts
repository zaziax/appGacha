import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { registerEgg } from './eggs'
import { getAiSettings } from './settings'
import { runFcDriver, DriverResult } from './fcDriver'

export const PIPELINE_VERSION = '0.1'
const MAX_ROUNDS = 3

export interface GachaProgress {
  stage: 'coin' | 'crank' | 'clack' | 'pop' | 'fail'
  detail?: string
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

function root(...p: string[]): string {
  return path.join(app.getAppPath(), ...p)
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
  const stagingDir = root('staging', eggId)

  try {
    // ① 投币：备舱——模板落位，manifest 由管线写入（wish 不经智能体之手）
    onProgress({ stage: 'coin', detail: '投币，装配舱就位' })
    fs.mkdirSync(stagingDir, { recursive: true })
    fs.cpSync(root('template'), stagingDir, { recursive: true })
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
    const dest = uniqueFolder(root('eggs'), manifest.name)
    fs.mkdirSync(root('eggs'), { recursive: true })
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

async function runDriverSafely(
  driver: GachaDriver,
  wish: string,
  stagingDir: string,
  onProgress: (p: GachaProgress) => void
): Promise<DriverResult> {
  return driver({
    wish,
    stagingDir,
    templateDir: root('template'),
    maxRounds: MAX_ROUNDS,
    onStage: (stage, detail) => {
      // 驱动的实况全部转发：crank 是工作动作，clack 是自检
      onProgress({ stage: stage === 'clack' ? 'clack' : 'crank', detail })
    }
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
  const failedRoot = root('failed')
  fs.mkdirSync(failedRoot, { recursive: true })
  const dest = path.join(failedRoot, `${new Date().toISOString().replace(/[:.]/g, '-')}-${eggId.slice(0, 8)}`)
  fs.renameSync(stagingDir, dest)
  fs.writeFileSync(
    path.join(dest, 'FAILURE.json'),
    JSON.stringify({ wish, ...result, pipelineVersion: PIPELINE_VERSION }, null, 2),
    'utf-8'
  )
}
