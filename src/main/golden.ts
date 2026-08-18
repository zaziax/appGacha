import fs from 'node:fs'
import path from 'node:path'
import { BrowserWindow } from 'electron'
import { EggContext, getEgg, removeEgg } from './eggs'
import { createEggWindow } from './eggWindow'
import { validateEgg } from './validate'
import { runGacha, GachaResult, GachaProgress } from './pipeline'
import { getAiSettings } from './settings'
import { cancelAllForEgg } from './schedule'
import { DriverJob, DriverResult, runFcDriver } from './fcDriver'

/**
 * 金标愿望集：产品能力矩阵的「最小覆盖抽样」。
 * 三条轴 ——
 *   ① 应用形态（tool/data/game/3d/widget）：不同形态的翻车点互不相通，各需代表；
 *   ② 能力域（bridge 权限 + vendor）：高风险/结构性特殊的单独一条，低风险靠交叉覆盖；
 *   ③ 难度梯度（易→难）：拉开难度，出蛋率才有分层诊断价值。
 * 每条愿望 = 一个代表性抽样 + 「核心价值承诺的最小可验证断言」（probe，即达标线）。
 */

export type GoldenCategory = 'tool' | 'data' | 'game' | '3d' | 'widget'

export interface GoldenCheck {
  name: string
  pass: boolean
  detail?: string
}

export interface GoldenProbeResult {
  pass: boolean
  checks: GoldenCheck[]
  error?: string
}

export interface GoldenWish {
  id: string
  name: string
  category: GoldenCategory
  difficulty: 'easy' | 'medium' | 'hard'
  /** 愿望原文（即跑真实驱动的 prompt）。带轻契约提示，让达标线可判定，但保持自然意图。 */
  wish: string
  /** 页面内探针（在 PROBE_UTILS 作用域内执行，return { pass, checks }）。null = 仅健康检查（只测出蛋率，不测指标达成率） */
  probe: string | null
  /** 探针验证边界说明：端到端可验则不写；仅验证本地 UI 面时标注（报告展示用，非断言） */
  probeNote?: string
  /** 期望覆盖的权限域（报告展示用，非断言） */
  perms?: string[]
}

export interface GoldenResult {
  id: string
  name: string
  category: GoldenCategory
  difficulty: string
  pass: boolean
  /** generated=驱动失败；validated=结构校验失败；healthy=仅健康检查；probed=跑完语义探针；fail=出蛋失败 */
  stage: 'generated' | 'validated' | 'healthy' | 'probed' | 'fail'
  gacha?: GachaResult
  validateIssues?: string[]
  consoleErrors?: string[]
  blank?: boolean
  crashed?: boolean
  probe?: GoldenProbeResult
  probeNote?: string
  screenshot?: string
  error?: string
  durationMs?: number
}

export interface GoldenReport {
  total: number
  passed: number
  /** 出蛋率：驱动成功产出蛋的比例（广度） */
  generatedRate: number
  /** 指标达成率：成功产出的蛋里语义探针通过的比例（深度，仅统计有 probe 的愿望） */
  instructionRate: number | null
  results: GoldenResult[]
  model?: string
}

// ─── 探针工具：注入到每个 probe 作用域 ───
// 注意：探针字符串不得出现反斜杠（避免 TS 模板串转义歧义），用 [0-9] 等字符类代替 \d。
const PROBE_UTILS = `
  // 排除 preload 注入的标题栏（__egg_titlebar 里的最小化/最大化/关闭按钮）：
  // 点关闭按钮会直接销毁测试窗口，探针绝不能把窗口控制当应用按钮去点。
  const $all = (s) => Array.from(document.querySelectorAll(s)).filter(el => !el.closest('#__egg_titlebar'))
  const wait = (ms) => new Promise(r => setTimeout(r, ms))
  const setValue = (el, v) => {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype
      : el.tagName === 'SELECT' ? HTMLSelectElement.prototype
      : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
    setter.call(el, String(v))
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }
  const bodyText = () => (document.body.innerText || '').trim()
`

// ─── 核心 4 条（每次改动后跑，覆盖主流形态 + 最基础能力）───

export const GOLDEN_CORE: GoldenWish[] = [
  {
    id: 'unit-converter',
    name: '单位换算器',
    category: 'tool',
    difficulty: 'easy',
    perms: [],
    wish: '做一个单位换算器。支持长度换算（米、厘米、毫米、千米）和温度换算（摄氏度、华氏度）。' +
      '页面上要有输入数值的输入框、选择换算类型和单位的下拉框，以及一个「换算」按钮；' +
      '点击后把换算结果显示在页面上清晰的位置。',
    probe: `
  const checks = []
  const inputs = $all('input').filter(i => i.type === 'number' || i.type === 'text')
  const selects = $all('select')
  const buttons = $all('button')
  checks.push({ name: '有数值输入框', pass: inputs.length > 0, detail: '输入框 ' + inputs.length + ' 个' })
  checks.push({ name: '有换算按钮或单位选择', pass: buttons.length > 0 || selects.length > 0, detail: '按钮 ' + buttons.length + ' / 下拉 ' + selects.length })

  let reacted = false
  let drove = false
  try {
    if (inputs.length > 0 && buttons.length > 0) {
      setValue(inputs[0], 100)
      const before = bodyText()
      for (const b of buttons) {
        b.click()
        await wait(220)
        if (bodyText() !== before) { reacted = true; break }
      }
      drove = true
    }
  } catch (e) {
    checks.push({ name: '触发换算', pass: false, detail: String(e) })
  }
  checks.push({ name: '触发换算有响应', pass: reacted, detail: reacted ? '结果已刷新' : (drove ? '点击后无可见变化' : '无输入/按钮可驱动') })

  return { pass: checks.every(c => c.pass), checks }`
  },
  {
    id: 'ledger',
    name: '记账本',
    category: 'data',
    difficulty: 'medium',
    perms: ['db', 'storage'],
    wish: '做一个记账本。可以添加一笔收支记录（金额、类型「收入/支出」、备注），用列表展示所有记录，' +
      '并实时计算显示总收入、总支出和结余。记录要持久化保存，刷新后不丢失。',
    probe: `
  const checks = []
  const inputs = $all('input')
  const buttons = $all('button')
  checks.push({ name: '有输入与按钮', pass: inputs.length > 0 && buttons.length > 0, detail: '输入 ' + inputs.length + ' / 按钮 ' + buttons.length })

  let added = false
  try {
    const beforeText = bodyText()
    const beforeRows = $all('li, .list-item, tr').length
    for (const i of inputs.slice(0, 3)) setValue(i, '100')
    for (const b of buttons) { b.click(); await wait(160) }
    await wait(400)
    const afterRows = $all('li, .list-item, tr').length
    added = afterRows > beforeRows || bodyText() !== beforeText
  } catch (e) {
    checks.push({ name: '新增记录', pass: false, detail: String(e) })
  }
  checks.push({ name: '可新增一条记录', pass: added, detail: added ? '列表已增长' : '操作后无变化' })

  const nums = bodyText().match(/[-+]?[0-9][0-9,]*(?:[.][0-9]+)?/g) || []
  checks.push({ name: '显示金额/合计', pass: nums.length > 0, detail: nums.length ? '可见数字 ' + nums.slice(0, 3).join(', ') : '无数字' })

  return { pass: checks.every(c => c.pass), checks }`
  },
  {
    id: 'game-2048',
    name: '2048 小游戏',
    category: 'game',
    difficulty: 'hard',
    perms: [],
    wish: '做一个 2048 数字合并小游戏。用 HTML 网格（div）实现 4×4 的棋盘，键盘方向键移动方块，' +
      '相同数字相邻时合并相加。页面顶部显示当前分数，游戏结束或获胜时给出提示，并提供「重新开始」按钮。',
    probe: `
  const checks = []
  const canvas = $all('canvas')
  const cells = $all('[class*="cell"], [class*="tile"], .board div, .grid div')
  checks.push({ name: '有渲染载体', pass: canvas.length > 0 || cells.length > 0, detail: 'canvas ' + canvas.length + ' / 单元格 ' + cells.length })
  const hasScore = /分数|得分|score/i.test(bodyText())
  checks.push({ name: '有分数显示', pass: hasScore, detail: hasScore ? '已找到分数文本' : '未找到（可能绘制在画布上）' })

  let reacted = false
  try {
    const before = bodyText()
    const beforeCells = cells.length
    for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }))
      await wait(120)
    }
    await wait(350)
    const afterCells = $all('[class*="cell"], [class*="tile"], .board div, .grid div').length
    reacted = bodyText() !== before || afterCells !== beforeCells
  } catch (e) {
    checks.push({ name: '方向键可驱动', pass: false, detail: String(e) })
  }
  checks.push({ name: '方向键可驱动', pass: reacted, detail: reacted ? '界面已响应' : '键盘无响应' })

  return { pass: checks.every(c => c.pass), checks }`
  },
  {
    id: '3d-earth',
    name: '3D 地球',
    category: '3d',
    difficulty: 'hard',
    perms: [],
    wish: '做一个 3D 地球仪。用 three.js 渲染一个旋转的地球，支持鼠标拖拽旋转视角、滚轮缩放。' +
      '页面主体是一个全屏的 3D 画布。',
    probe: `
  const checks = []
  const canvas = $all('canvas')
  checks.push({ name: '有 3D 画布', pass: canvas.length > 0, detail: 'canvas ' + canvas.length + ' 个' })
  let hasWebGL = false
  try {
    for (const c of canvas) {
      if (c.getContext('webgl') || c.getContext('webgl2')) { hasWebGL = true; break }
    }
  } catch (e) {}
  checks.push({ name: '有 WebGL 上下文', pass: hasWebGL, detail: hasWebGL ? 'WebGL 已创建' : '未检测到 WebGL' })

  return { pass: checks.every(c => c.pass), checks }`
  }
]

// ─── 全量 10 条：核心 4 + 补充 6（覆盖剩余形态/能力域）───
// 补充 6 分层断言：本地可端到端验证的（番茄钟倒计时/体重折线/KaTeX 渲染）做完整断言；
// 跨设备/未来时点/真实 AI 的（联机/定时通知/真模型）退到「UI 入口 + 触发反馈」的本地面，边界见各条 probeNote。
const GOLDEN_EXTRA: GoldenWish[] = [
  {
    id: 'pomodoro-widget',
    name: '番茄钟 widget',
    category: 'widget',
    difficulty: 'medium',
    perms: ['notify'],
    wish: '做一个番茄钟悬浮组件（widget）：一个圆形的倒计时悬浮窗，25 分钟工作倒计时，到点提醒，可以开始/暂停/重置。',
    probeNote: '验证倒计时显示、控制按钮、点开始后倒计时走动；到点提醒（notify）未端到端验证',
    probe: `
  const checks = []
  const btns = $all('button')
  const btnText = btns.map(b => (b.innerText || '').trim()).join(' ').toLowerCase()
  const hasStart = /开始|继续|start|begin|play/i.test(btnText)
  checks.push({ name: '有倒计时控制按钮', pass: btns.length > 0 && hasStart, detail: '按钮 ' + btns.length + ' 个' })

  const beforeText = bodyText()
  const hasTime = /[0-9]{1,3}:[0-9]{2}/.test(beforeText) || /倒计时|分钟|剩余|min|timer/i.test(beforeText)
  checks.push({ name: '有倒计时显示', pass: hasTime, detail: hasTime ? '已找到时间文本' : '未见时间文本' })

  let ticking = false
  try {
    const startBtn = btns.find(b => /开始|继续|start|begin|play/i.test((b.innerText || '')))
    if (startBtn) startBtn.click()
    await wait(2500)
    ticking = bodyText() !== beforeText
  } catch (e) {
    checks.push({ name: '倒计时走动', pass: false, detail: String(e) })
  }
  checks.push({ name: '倒计时在走', pass: ticking, detail: ticking ? '点击后时间文本已变化' : (hasStart ? '点击后无变化' : '无开始按钮可点') })

  return { pass: checks.every(c => c.pass), checks }`
  },
  {
    id: 'tictactoe-lan',
    name: '联机井字棋',
    category: 'game',
    difficulty: 'hard',
    perms: ['network'],
    wish: '做一个联机井字棋：创建一个房间得到邀请码，另一台设备输入邀请码加入，双方轮流落子，实时同步，判定胜负。',
    probeNote: '仅验证「创建房间 → 出现邀请码」的本地 UI 面，未验证真实 P2P 联机同步',
    probe: `
  const checks = []
  const btns = $all('button')
  const btnText = btns.map(b => (b.innerText || '').trim()).join(' ').toLowerCase()
  const hasCreate = /创建|新建|建房|开房|host|create/i.test(btnText)
  checks.push({ name: '有创建房间入口', pass: hasCreate, detail: '按钮 ' + btns.length + ' 个' })

  let codeAppeared = false
  let drove = false
  try {
    const createBtn = btns.find(b => /创建|新建|建房|开房|host|create/i.test((b.innerText || '')))
    if (createBtn) {
      createBtn.click()
      drove = true
      await wait(1500)
      const t = bodyText()
      codeAppeared = /邀请码|房间号|房间码|invite|code/i.test(t) || /[a-z0-9]{4,8}/i.test(t)
    }
  } catch (e) {
    checks.push({ name: '生成邀请码', pass: false, detail: String(e) })
  }
  checks.push({ name: '点击后出现邀请码', pass: codeAppeared, detail: codeAppeared ? '已出现房间标识' : (drove ? '点击后未见邀请码' : '无创建入口可点') })

  return { pass: checks.every(c => c.pass), checks }`
  },
  {
    id: 'weight-chart',
    name: '体重记录折线图',
    category: 'data',
    difficulty: 'medium',
    perms: ['db', 'storage'],
    wish: '做一个体重记录工具：输入日期和体重添加记录，列表展示历史记录，并用折线图展示体重变化趋势。',
    probe: `
  const checks = []
  const inputs = $all('input')
  const btns = $all('button')
  checks.push({ name: '有输入与添加按钮', pass: inputs.length > 0 && btns.length > 0, detail: '输入 ' + inputs.length + ' / 按钮 ' + btns.length })

  let added = false
  try {
    const rowsSel = 'li, .list-item, tr, [class*="row"], [class*="item"]'
    const beforeRows = $all(rowsSel).length
    const beforeText = bodyText()
    for (const i of inputs.slice(0, 4)) setValue(i, i.type === 'date' ? '2024-01-01' : '70')
    const addBtn = btns.find(b => /添加|新增|记录|保存|add|save/i.test((b.innerText || ''))) || btns[0]
    if (addBtn) { addBtn.click(); await wait(600) }
    const afterRows = $all(rowsSel).length
    added = afterRows > beforeRows || bodyText() !== beforeText
  } catch (e) {
    checks.push({ name: '新增记录', pass: false, detail: String(e) })
  }
  checks.push({ name: '可新增一条记录', pass: added, detail: added ? '列表已增长' : '操作后无变化' })

  const canvas = $all('canvas')
  checks.push({ name: '有折线图载体', pass: canvas.length > 0, detail: 'canvas ' + canvas.length + ' 个' })

  return { pass: checks.every(c => c.pass), checks }`
  },
  {
    id: 'math-formula',
    name: '数学公式卡',
    category: 'tool',
    difficulty: 'medium',
    perms: [],
    wish: '做一个数学公式卡：输入或选择 LaTeX 公式，用 KaTeX 渲染显示，比如勾股定理、二次公式、欧拉公式。',
    probe: `
  const checks = []
  const entrySel = 'input, select, button'
  const entryCount = $all(entrySel).length
  checks.push({ name: '有公式输入或预设', pass: entryCount > 0, detail: '输入/下拉/按钮共 ' + entryCount + ' 个' })

  const katexSel = '.katex, .katex-display, math, [class*="katex"]'
  let rendered = $all(katexSel).length > 0
  try {
    if (!rendered) {
      const input = $all('input')[0]
      if (input) setValue(input, 'E=mc^2')
      const btn = $all('button')[0]
      if (btn) btn.click()
      await wait(700)
      rendered = $all(katexSel).length > 0
    }
  } catch (e) {
    checks.push({ name: '渲染公式', pass: false, detail: String(e) })
  }
  checks.push({ name: '渲染出公式', pass: rendered, detail: rendered ? '已检测到 KaTeX/MathML 输出' : '未见 .katex 渲染' })

  return { pass: checks.every(c => c.pass), checks }`
  },
  {
    id: 'ai-vocab',
    name: 'AI 背单词',
    category: 'tool',
    difficulty: 'medium',
    perms: ['ai'],
    wish: '做一个 AI 背单词卡：随机展示一个单词，调用 AI 生成例句和中文释义，可以标记已掌握，记录学习进度。',
    probeNote: 'AI 调用走 mock（aiMock=true），验证「点生成 → 出例句/释义」完整链路，非真实模型',
    probe: `
  const checks = []
  const btns = $all('button')
  const btnText = btns.map(b => (b.innerText || '').trim()).join(' ').toLowerCase()
  const hasGen = /生成|下一个|换一个|例句|释义|generate|next|example/i.test(btnText)
  const wordShown = bodyText().length > 0
  checks.push({ name: '有单词展示与生成入口', pass: wordShown && hasGen, detail: '正文 ' + (wordShown ? '有' : '空') + ' / 按钮 ' + btns.length + ' 个' })

  let responded = false
  let drove = false
  try {
    const beforeText = bodyText()
    const genBtn = btns.find(b => /生成|下一个|换一个|例句|释义|generate|next/i.test((b.innerText || ''))) || btns[0]
    if (genBtn) {
      genBtn.click()
      drove = true
      await wait(1500)
      responded = bodyText().length > beforeText.length
    }
  } catch (e) {
    checks.push({ name: '生成例句/释义', pass: false, detail: String(e) })
  }
  checks.push({ name: '生成后有例句/释义', pass: responded, detail: responded ? '内容已刷新' : (drove ? '点击后无新增内容' : '无生成按钮可点') })

  return { pass: checks.every(c => c.pass), checks }`
  },
  {
    id: 'reminder',
    name: '定时提醒',
    category: 'tool',
    difficulty: 'medium',
    perms: ['schedule', 'notify'],
    wish: '做一个定时提醒工具：设定一个时间（如每天 21:00 或一次性倒计时），到点弹出系统通知提醒。',
    probeNote: '仅验证「设置 → 出现确认反馈」的本地 UI 面，未验证到点系统通知（notify）',
    probe: `
  const checks = []
  const inputs = $all('input')
  const btns = $all('button')
  const setBtn = btns.find(b => /设置|提醒|保存|确认|确定|开始|set|save|ok/i.test((b.innerText || '')))
  checks.push({ name: '有时间输入与设置按钮', pass: inputs.length > 0 && !!setBtn, detail: '输入 ' + inputs.length + ' / 设置按钮 ' + (setBtn ? '有' : '无') })

  let confirmed = false
  try {
    if (setBtn) {
      const beforeText = bodyText()
      setBtn.click()
      await wait(800)
      confirmed = bodyText() !== beforeText
    }
  } catch (e) {
    checks.push({ name: '设置确认', pass: false, detail: String(e) })
  }
  checks.push({ name: '点设置后有确认反馈', pass: confirmed, detail: confirmed ? '已出现确认反馈' : (setBtn ? '点击后无变化' : '无设置按钮') })

  return { pass: checks.every(c => c.pass), checks }`
  }
]

export const GOLDEN_FULL: GoldenWish[] = [...GOLDEN_CORE, ...GOLDEN_EXTRA]

// ─── 驱动类型：与 runGacha 的 driver 参数同构 ───
type GoldenDriver = (job: DriverJob) => Promise<DriverResult>

/** 探针外壳：把 PROBE_UTILS + 愿望专属探针体包成 async IIFE，交给 executeJavaScript */
function probeScript(probe: string): string {
  return `(async () => {
    ${PROBE_UTILS}
    ${probe}
  })()`
}

function waitForLoad(win: BrowserWindow, timeoutMs = 15_000): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`load timeout (${timeoutMs}ms)`)), timeoutMs)
    win.webContents.once('did-finish-load', () => { clearTimeout(timer); resolve() })
    win.webContents.once('did-fail-load', (_e, code, desc) => {
      clearTimeout(timer)
      reject(new Error(`did-fail-load ${code} ${desc}`))
    })
  })
}

/** 给无超时的 renderer 往返（executeJavaScript / capturePage）加护栏：
 *  渲染进程僵死时这些 Promise 永不落定，会把整个金标跑挂死。 */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timeout (${ms}ms)`)), ms))
  ])
}

interface EggProbeOutcome {
  consoleErrors: string[]
  blank: boolean
  crashed: boolean
  probe?: GoldenProbeResult
  screenshot?: string
  error?: string
}

/** 离屏起蛋：健康检查（加载/报错/白屏/崩溃）+ 语义探针 + 截图，同一窗口生命周期 */
async function runEggProbe(egg: EggContext, w: GoldenWish, screenshotPath: string): Promise<EggProbeOutcome> {
  const out: EggProbeOutcome = { consoleErrors: [], blank: false, crashed: false }
  egg.aiMock = true  // 试跑期蛋的运行时 AI 调用走 mock，不发真实请求、不烧 token
  const win = createEggWindow(egg, { show: false })
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 3) out.consoleErrors.push(message)
    // vendor 依赖加载失败的 warn 视同错误——静默降级不能骗过验收
    else if (level === 2 && /vendor\/[\w.-]+/.test(message)) out.consoleErrors.push(`[依赖降级] ${message}`)
  })
  win.webContents.on('render-process-gone', (_e, details) => {
    out.crashed = true
    out.consoleErrors.push(`renderer gone: ${details.reason}`)
  })

  try {
    await waitForLoad(win)
    // 给异步初始化留时间（建表、首次渲染等）
    await new Promise(r => setTimeout(r, 1800))

    const view = await withTimeout(win.webContents.executeJavaScript(`({
      textLen: document.body.innerText.trim().length,
      nodeCount: document.body.querySelectorAll('*').length
    })`), 10_000, 'executeJavaScript(view)')
    out.blank = view.textLen === 0 && view.nodeCount < 3

    if (w.probe) {
      try {
        out.probe = await withTimeout(
          win.webContents.executeJavaScript(probeScript(w.probe)) as Promise<GoldenProbeResult>,
          10_000, 'executeJavaScript(probe)'
        )
      } catch (e) {
        out.probe = { pass: false, checks: [], error: (e as Error).message }
      }
    }

    const image = await withTimeout(win.webContents.capturePage(), 10_000, 'capturePage')
    fs.mkdirSync(path.dirname(screenshotPath), { recursive: true })
    fs.writeFileSync(screenshotPath, image.toPNG())
    out.screenshot = screenshotPath
    console.log('[golden] probe: screenshot saved')
  } catch (e) {
    out.error = (e as Error).message
  } finally {
    console.log('[golden] probe: destroying window...')
    win.destroy()
    egg.aiMock = false
    console.log('[golden] probe: window destroyed')
  }
  return out
}

async function runGoldenWish(w: GoldenWish, driver: GoldenDriver): Promise<GoldenResult> {
  const t0 = Date.now()
  const res: GoldenResult = {
    id: w.id, name: w.name, category: w.category, difficulty: w.difficulty,
    pass: false, stage: 'generated',
    probeNote: w.probeNote
  }
  console.log(`\n[golden] ${w.id} 「${w.name}」(${w.difficulty}) 开始出蛋…`)

  const onProgress = (p: GachaProgress) => {
    const m = p.metrics ? ` ${p.metrics.turn}/${p.metrics.maxTurns}t ${p.metrics.round}/${p.metrics.maxRounds}r` : ''
    console.log(`[golden] ${w.id} stage=${p.stage}${m}`)
  }

  const gacha = await runGacha(w.wish, 'zh', onProgress, driver)
  res.gacha = gacha
  if (!gacha.ok || !gacha.eggId) {
    res.stage = 'fail'
    res.error = typeof gacha.error === 'string' ? gacha.error : (gacha.error?.key ?? 'driver failed')
    res.durationMs = Date.now() - t0
    console.log(`[golden] ${w.id} 出蛋失败: ${res.error}`)
    return res
  }

  let egg: EggContext | undefined
  try {
    egg = getEgg(gacha.eggId)
    if (!egg) throw new Error('出蛋成功但未注册')

    const issues = validateEgg(egg.dir)
    res.validateIssues = issues.map(i => `[${i.file}] ${i.message}`)

    const probe = await runEggProbe(egg, w, path.join('dist', 'golden', `${w.id}.png`))
    console.log('[golden] probe: outcome returned')
    res.consoleErrors = probe.consoleErrors
    res.blank = probe.blank
    res.crashed = probe.crashed
    res.probe = probe.probe
    res.screenshot = probe.screenshot
    if (probe.error) res.error = probe.error

    res.stage = w.probe ? 'probed' : 'healthy'
    if (res.validateIssues.length > 0) res.stage = 'validated'
    res.pass =
      res.validateIssues.length === 0 &&
      res.consoleErrors.length === 0 &&
      res.blank === false &&
      res.crashed === false &&
      (res.probe ? res.probe.pass : true)
  } catch (e) {
    res.error = (e as Error).message
  } finally {
    // 金标产物是测试工件，不入柜不留档
    if (egg) {
      try { cancelAllForEgg(egg.eggId) } catch { /* 尽力而为 */ }
      try { removeEgg(egg.eggId) } catch { /* 尽力而为 */ }
      console.log('[golden] cleanup: rmSync', egg.dir)
      try { fs.rmSync(egg.dir, { recursive: true, force: true }) } catch { /* 尽力而为 */ }
      console.log('[golden] cleanup: done')
    }
    res.durationMs = Date.now() - t0
  }

  console.log(`[golden] ${w.id} ${res.pass ? 'PASS' : 'FAIL'} (${res.stage})`)
  return res
}

export async function runGolden(wishes: GoldenWish[], driver: GoldenDriver = runFcDriver): Promise<GoldenReport> {
  const results: GoldenResult[] = []
  for (const w of wishes) {
    results.push(await runGoldenWish(w, driver))
  }

  const generated = results.filter(r => r.gacha?.ok)
  const probed = results.filter(r => r.probe)
  const report: GoldenReport = {
    total: results.length,
    passed: results.filter(r => r.pass).length,
    generatedRate: results.length ? generated.length / results.length : 0,
    instructionRate: probed.length ? probed.filter(r => r.probe!.pass).length / probed.length : null,
    results,
    model: getAiSettings()?.model
  }
  writeReport(report)
  return report
}

/** 单条失败原因的简洁摘要（报告表格用） */
function failSummary(r: GoldenResult): string {
  if (r.error) return r.error
  if (r.blank) return '白屏'
  if (r.crashed) return '渲染进程崩溃'
  if (r.validateIssues?.length) return r.validateIssues[0]
  if (r.consoleErrors?.length) return r.consoleErrors[0]
  if (r.probe) {
    const failed = r.probe.checks.filter(c => !c.pass)
    if (failed.length) return failed.map(c => `${c.name}${c.detail ? '(' + c.detail + ')' : ''}`).join('；')
    if (r.probe.error) return r.probe.error
  }
  return '—'
}

function writeReport(report: GoldenReport): { md: string; json: string } {
  const dir = path.join('dist', 'golden')
  fs.mkdirSync(dir, { recursive: true })

  const lines: string[] = []
  lines.push('# 金标愿望集测试报告')
  lines.push('')
  lines.push(
    `- 总数 ${report.total}　通过 ${report.passed}　出蛋率 ${(report.generatedRate * 100).toFixed(0)}%` +
    `　指标达成率 ${report.instructionRate === null ? '—' : (report.instructionRate * 100).toFixed(0) + '%'}`
  )
  if (report.model) lines.push(`- 模型：${report.model}`)
  lines.push('')
  lines.push('| # | 愿望 | 形态 | 难度 | 结果 | 阶段 | 明细 |')
  lines.push('|---|------|------|------|------|------|------|')
  report.results.forEach((r, i) => {
    lines.push(`| ${i + 1} | ${r.name} | ${r.category} | ${r.difficulty} | ${r.pass ? '✅' : '❌'} | ${r.stage} | ${r.pass ? '—' : failSummary(r)} |`)
  })
  lines.push('')
  for (const r of report.results) {
    lines.push(`## ${r.name}（${r.id}）`)
    lines.push('')
    lines.push(`- 形态 ${r.category} / 难度 ${r.difficulty} / ${r.pass ? '✅ 通过' : '❌ 失败'} / 阶段 ${r.stage} / 耗时 ${((r.durationMs ?? 0) / 1000).toFixed(1)}s`)
    if (r.gacha) lines.push(`- 出蛋：${r.gacha.ok ? `成功（${r.gacha.name}）` : '失败 ' + (typeof r.gacha.error === 'string' ? r.gacha.error : r.gacha.error?.key ?? '')}`)
    if (r.validateIssues?.length) lines.push(`- 结构校验：\n  - ${r.validateIssues.join('\n  - ')}`)
    if (r.consoleErrors?.length) lines.push(`- 控制台错误：\n  - ${r.consoleErrors.join('\n  - ')}`)
    if (r.blank) lines.push('- 白屏：是')
    if (r.crashed) lines.push('- 渲染进程崩溃：是')
    if (r.probe) {
      lines.push(`- 语义探针：${r.probe.pass ? '通过' : '未通过'}`)
      for (const c of r.probe.checks) lines.push(`  - ${c.pass ? '✅' : '❌'} ${c.name}${c.detail ? ' — ' + c.detail : ''}`)
      if (r.probe.error) lines.push(`  - 探针异常：${r.probe.error}`)
      if (r.probeNote) lines.push(`  - 探针边界：${r.probeNote}`)
    }
    if (r.screenshot) lines.push(`- 截图：${r.screenshot}`)
    lines.push('')
  }

  const md = path.join(dir, 'report.md')
  const json = path.join(dir, 'report.json')
  fs.writeFileSync(md, lines.join('\n'), 'utf-8')
  fs.writeFileSync(json, JSON.stringify(report, null, 2), 'utf-8')
  console.log(`[golden] 报告已写入 ${md} / ${json}`)
  return { md, json }
}

/** 假驱动：写一个最小可渲染蛋，用于自检金标框架（不开真实 AI、不烧 token） */
export async function goldenFakeDriver(job: DriverJob): Promise<DriverResult> {
  fs.writeFileSync(path.join(job.stagingDir, 'index.html'),
    '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>金标假蛋</title>' +
    '<link rel="stylesheet" href="base.css"></head><body class="app-shell">' +
    '<div class="toolbar"><h1>金标假蛋</h1></div><div class="content" id="app">golden-fake</div>' +
    '<script type="module" src="app.js"></script></body></html>', 'utf-8')
  fs.writeFileSync(path.join(job.stagingDir, 'app.js'),
    "document.getElementById('app').textContent = 'golden fake ok'", 'utf-8')
  return { ok: true, rounds: 1, turns: 1 }
}
