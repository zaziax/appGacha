import { logLine } from '../log'
import { sendToShelf } from '../shelfWindow'
import { makeError, ErrorCode } from '../../shared/types'
import { resolveAiEndpoint, chatCompletionFetch, throwForProxyStatus, AiNotConfiguredError, AiProxyError, parseSseContent } from '../aiChannel'
import { apiFetch } from '../api'
import { buildWishGuideSystem, buildWishSuggestPrompt, type WishGuideContext } from '../wishGuide'
import { runGacha, runUpgrade, resumeGacha, isGachaBusy, cancelGacha, listCheckpoints, abandonCheckpoint } from '../pipeline'
import { allEggs, getEgg } from '../eggs'
import type { IpcText } from '../fcDriver'
import { handle } from './ipc'

interface WishQuestion { text: string; options: string[] }
interface WishChatResult { done: boolean; questions: WishQuestion[]; styleNote?: string }

/** 把平台通道错误翻成用户可读文案（许愿链路） */
function proxyErrText(e: unknown): string | null {
  if (e instanceof AiProxyError && e.insufficientCredits) return makeError(ErrorCode.INSUFFICIENT_CREDITS, '积分不足，请先充值')
  if (e instanceof AiProxyError) return makeError(ErrorCode.PROXY_UNAVAILABLE, '平台 AI 通道暂不可用')
  return null
}


async function wishChatAi(messages: { role: string; content: string }[], systemPrompt: string): Promise<WishChatResult> {
  const endpoint = await resolveAiEndpoint()
  if (!endpoint) {
    logLine('[wishChat] AI not configured')
    throw new AiNotConfiguredError()
  }

  const epLabel = endpoint.kind === 'direct' ? `${endpoint.kind}/${endpoint.model}` : endpoint.kind
  logLine('[wishChat] req:', `endpoint=${epLabel}`, `msgCount=${messages.length}`, `lastMsg=${messages[messages.length - 1]?.content?.slice(0, 120)}`)

  const MAX_RETRIES = 2
  // 这些网络错误属于临时性故障，重试可恢复
  const RETRYABLE = new Set(['ERR_INCOMPLETE_CHUNKED_ENCODING', 'ERR_CONNECTION_RESET',
    'ERR_SOCKET_NOT_CONNECTED', 'ERR_HTTP2_SERVER_REFUSED_STREAM',
    'ERR_EMPTY_RESPONSE', 'ERR_NETWORK_CHANGED', 'ERR_CONTENT_LENGTH_MISMATCH',
    'OUTPUT_TRUNCATED'])

  let lastError: Error | null = null
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const t0 = Date.now()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 30_000)
    try {
      const res = await chatCompletionFetch(endpoint, {
        messages: [{ role: 'system', content: systemPrompt }, ...messages],
        response_format: { type: 'json_object' },
        temperature: 0.8,
        max_tokens: 2000,  // 推理模型 reasoning_content 计入输出，800 会被截断导致 JSON 残缺
        stream: false  // 关流式 — 代理可能忽略"非流式"语义但仍能减少 SSE 截断风险
      }, { signal: controller.signal, timeout: 35_000 })

      // 记录响应头用于诊断
      const ct = res.headers.get('content-type') || '-'
      const te = res.headers.get('transfer-encoding') || '-'
      if (attempt > 0) {
        logLine('[wishChat] retry OK:', `attempt=${attempt}`, `elapsed=${Date.now() - t0}ms`,
          `status=${res.status}`, `contentType=${ct}`, `transferEnc=${te}`)
      }

      if (!res.ok) {
        await throwForProxyStatus(res)
        const text = (await res.text().catch(() => '')).slice(0, 200)
        logLine('[wishChat] HTTP error:', res.status, text)
        throw new Error(`AI HTTP ${res.status}: ${text}`)
      }

      // 读取响应体：先取原文再判断格式（代理可能无视 Content-Type 返回 SSE）
      const rawText = await res.text()
      let content: string
      if (ct.includes('text/event-stream') || ct.includes('application/x-ndjson')) {
        logLine('[wishChat] SSE response:', `len=${rawText.length}`, `first=${rawText.slice(0, 200)}`)
        content = parseSseContent(rawText)
      } else {
        logLine('[wishChat] JSON response:', `len=${rawText.length}`, `first=${rawText.slice(0, 200)}`)
        // 空响应体：服务端临时故障，包装为可重试错误
        if (rawText.trim().length === 0) {
          throw Object.assign(new Error('Empty response body from AI'), { code: 'ERR_EMPTY_RESPONSE' })
        }
        // 代理可能返回 SSE 格式但不设正确的 Content-Type
        if (rawText.startsWith('data:')) {
          logLine('[wishChat] Response looks like SSE despite Content-Type, falling back')
          content = parseSseContent(rawText)
        } else {
          try {
            const data = JSON.parse(rawText) as { choices?: { message?: { content?: string; reasoning_content?: string }; finish_reason?: string }[] }
            const choice = data.choices?.[0]
            // 推理模型可能因 max_tokens 不足被截断（finish_reason=length）→ 抛可重试错误
            if (choice?.finish_reason === 'length') {
              throw Object.assign(new Error('AI output truncated (finish_reason=length)'), { code: 'OUTPUT_TRUNCATED' })
            }
            const msg = choice?.message
            content = msg?.content || msg?.reasoning_content || ''
          } catch (e) {
            if ((e as { code?: string }).code === 'OUTPUT_TRUNCATED') throw e
            // JSON 解析失败最后尝试 SSE 回退
            logLine('[wishChat] JSON parse failed, trying SSE fallback')
            content = parseSseContent(rawText)
          }
        }
      }
      logLine('[wishChat] raw:', content.slice(0, 300))
      const stripped = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '')
      const parsed = JSON.parse(stripped) as WishChatResult
      // 基本校验
      if (typeof parsed.done !== 'boolean') parsed.done = true
      if (!Array.isArray(parsed.questions)) parsed.questions = []
      parsed.questions = parsed.questions.slice(0, 3).map(q => ({
        text: String(q.text ?? ''),
        options: Array.isArray(q.options) ? q.options.slice(0, 4).map(String) : []
      }))
      if (typeof parsed.styleNote !== 'string' || parsed.styleNote.trim().length === 0) delete parsed.styleNote
      logLine('[wishChat] parsed:', `done=${parsed.done}`, `questions=${parsed.questions.length}`,
        `hasStyleNote=${!!parsed.styleNote}`, `elapsed=${Date.now() - t0}ms`)
      if (parsed.questions.length === 0 && !parsed.done) {
        logLine('[wishChat] ⚠ AI returned done=false but zero questions — forcing done=true')
        parsed.done = true
      }
      return parsed
    } catch (e) {
      clearTimeout(timer)
      lastError = e as Error
      const msg = lastError.message
      const isRetryable = RETRYABLE.has((e as { code?: string }).code ?? '') ||
        msg.includes('chunked') || msg.includes('Chunked') ||
        msg.includes('ERR_INCOMPLETE') || msg.includes('ERR_CONNECTION') ||
        msg.includes('ERR_EMPTY') || msg.includes('ERR_SOCKET') ||
        msg.includes('Unexpected end of JSON input') || msg.includes('Unexpected token') ||
        msg.includes('Unterminated string') ||
        msg.includes('Empty response body')

      logLine('[wishChat] error:',
        `attempt=${attempt}/${MAX_RETRIES}`,
        `code=${(e as { code?: string }).code || '-'}`,
        `msg=${msg}`,
        `elapsed=${Date.now() - t0}ms`,
        isRetryable && attempt < MAX_RETRIES ? '(will retry)' : '(final)')

      if (!isRetryable || attempt >= MAX_RETRIES) break
      // 退避延迟：第 1 次重试等 600ms，第 2 次等 1200ms
      await new Promise(r => setTimeout(r, 600 * (attempt + 1)))
    }
  }

  // 所有重试都失败 — 抛出友好错误
  const friendly = proxyErrText(lastError!)
  if (friendly) throw new Error(friendly)
  if (lastError instanceof AiNotConfiguredError) throw new Error('尚未配置模型，请先在设置里填写 API 或登录账号')
  if (lastError!.name === 'AbortError') throw new Error('AI 响应超时，请重试')
  throw new Error(`AI 通信失败（已重试${MAX_RETRIES}次）: ${lastError!.message}`)
}

// 扭蛋/升级共用：进度落日志再转发收藏柜（闪退时 app.log 里能看到最后一步）
function reportProgress(p: { stage: string; detail?: IpcText }): void {
  logLine('[gacha]', p.stage, typeof p.detail === 'string' ? p.detail : (p.detail?.key ?? ''))
  sendToShelf('gacha:progress', p)
}

// 拉最新积分余额（结算通知用；未登录/失败静默返回 null）
async function getCreditBalance(): Promise<number | null> {
  try {
    const res = await apiFetch('/billing/credits')
    if (!res.ok) return null
    const b = (res.data as { balance?: number })?.balance
    return typeof b === 'number' ? b : null
  } catch {
    return null
  }
}

// 扭蛋/升级共用的收尾：done 事件带 upgraded 标记（系统通知由渲染端发，那边才知道 UI 语言）
// 同时对比前后余额：走平台通道时构建完成后推 billing:settled，让渲染端提示“本次消耗”
function launchGacha(run: Promise<{ ok: boolean; name?: string; error?: IpcText }>, upgraded: boolean): void {
  void (async () => {
    const before = await getCreditBalance()
    let result: { ok: boolean; name?: string; error?: IpcText }
    try {
      result = await run
    } catch (e) {
      // 兜底：管线意外 reject 时也必须通知前端，否则 running 永远为 true
      result = { ok: false, error: (e as Error).message || { key: 'err.unexpected' } }
      logLine('[gacha] unexpected error', result.error)
    }
    logLine('[gacha] done', result)
    sendToShelf('gacha:done', { ...result, upgraded })
    // 构建成功且有扣费时通知渲染端（自带 Key 时余额不变，不会发）
    if (result.ok && before !== null) {
      const after = await getCreditBalance()
      if (after !== null) {
        const spent = Math.round((before - after) * 10) / 10
        if (spent > 0) sendToShelf('billing:settled', { spent, balance: after })
      }
    }
  })()
}

export function registerGachaChannels(): void {
  handle('shelf:wish', async (wish, lang) => {
    logLine('[shelf:wish] IPC received:', { wish: String(wish ?? '').slice(0, 80), lang, busy: isGachaBusy() })
    if (isGachaBusy()) throw new Error(makeError(ErrorCode.BUSY, '机芯正忙，请等上一颗蛋出来'))
    const l = lang === 'en' ? 'en' : 'zh'
    // 不 await：扭蛋过程通过 gacha:progress 事件流式上报，完成事件里带结果
    launchGacha(runGacha(String(wish ?? ''), l, reportProgress), false)
    return { started: true }
  })

  handle('shelf:upgrade', async (eggId, wish, lang) => {
    logLine('[shelf:upgrade] IPC received:', { eggId, wish: String(wish ?? '').slice(0, 80), lang, busy: isGachaBusy() })
    if (isGachaBusy()) throw new Error(makeError(ErrorCode.BUSY, '机芯正忙，请等上一颗蛋出来'))
    const l = lang === 'en' ? 'en' : 'zh'
    launchGacha(runUpgrade(String(eggId), String(wish ?? ''), l, reportProgress), true)
    return { started: true }
  })

  handle('shelf:cancelGacha', async () => {
    cancelGacha()
    return { ok: true }
  })

  // ─── 断点续建 ───

  handle('shelf:getPendingBuild', async () => {
    const cps = listCheckpoints()
    if (cps.length === 0) return null
    // 返回最近一个断点（通常只有一个，除非多次中断）
    const cp = cps.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
    // 升级场景：查找真实蛋名
    let upgradeName = ''
    if (cp.realEggId) {
      const egg = getEgg(cp.realEggId)
      upgradeName = egg?.manifest?.name ?? ''
    }
    return {
      eggId: cp.eggId,
      wish: cp.wish,
      turns: cp.turns,
      rounds: cp.rounds,
      errorKey: cp.errorKey,
      isUpgrade: !!cp.realEggId,
      realEggId: cp.realEggId ?? '',
      upgradeName,
      createdAt: cp.createdAt
    }
  })

  handle('shelf:resumeBuild', async (eggId) => {
    if (isGachaBusy()) throw new Error(makeError(ErrorCode.BUSY, '机芯正忙，请等上一颗蛋出来'))
    const cp = listCheckpoints().find(c => c.eggId === eggId)
    if (!cp) throw new Error('checkpoint not found')
    launchGacha(resumeGacha(eggId as string, reportProgress), cp.realEggId ? true : false)
    return { started: true }
  })

  handle('shelf:abandonBuild', async (eggId) => {
    abandonCheckpoint(eggId as string)
    return { ok: true }
  })

  handle('shelf:wishChat', async (messages, context) => {
    const msgs = messages as { role: string; content: string }[]
    if (!Array.isArray(msgs) || msgs.length === 0) throw new Error('messages 不能为空')
    // 场景上下文装配：升级 → 注入目标蛋档案；新愿望 → 注入已有蛋名单
    const ctx = context as { upgradeEggId?: string } | undefined
    const guideCtx: WishGuideContext = {}
    if (ctx?.upgradeEggId) {
      const egg = getEgg(ctx.upgradeEggId)
      if (egg) {
        guideCtx.upgrade = {
          name: egg.manifest.name,
          wish: egg.manifest.wish ?? '',
          permissions: Array.isArray(egg.manifest.permissions) ? egg.manifest.permissions : []
        }
      }
    } else {
      guideCtx.existingEggNames = allEggs().filter(e => !e.ephemeral).map(e => e.manifest.name).slice(0, 20)
    }
    return wishChatAi(msgs, buildWishGuideSystem(guideCtx))
  })

  handle('shelf:wishSuggest', async (lang) => {
    const endpoint = await resolveAiEndpoint()
    if (!endpoint) throw new Error('AI not configured')
    const existing = allEggs().filter(e => !e.ephemeral).map(e => e.manifest.name).slice(0, 20)
    const prompt = buildWishSuggestPrompt(lang === 'zh' ? 'zh' : 'en', existing)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15_000)
    try {
      const res = await chatCompletionFetch(endpoint, {
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: lang === 'zh' ? '给我来 3 个灵感！' : 'Give me 3 ideas!' }
        ],
        response_format: { type: 'json_object' },
        temperature: 1.0,
        max_tokens: 1000  // 推理模型 reasoning_content 计入输出，避免截断
      }, { signal: controller.signal, timeout: 20_000 })
      if (!res.ok) throw new Error(`AI HTTP ${res.status}`)
      const rawText = await res.text()
      const ct = res.headers.get('content-type') || ''
      let content: string
      if (ct.includes('text/event-stream') || ct.includes('application/x-ndjson') || rawText.startsWith('data:')) {
        content = parseSseContent(rawText)
      } else {
        try {
          const msg = (JSON.parse(rawText) as { choices?: { message?: { content?: string; reasoning_content?: string } }[] }).choices?.[0]?.message
          content = msg?.content || msg?.reasoning_content || ''
        } catch {
          content = parseSseContent(rawText)
        }
      }
      const parsed = JSON.parse(content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '')) as { suggestions?: string[] }
      return { suggestions: (parsed.suggestions ?? []).slice(0, 3).map(String) }
    } catch (e) {
      logLine(`[wishSuggest] AI 灵感生成失败，UI 将降级到本地池: ${(e as Error).message}`)
      throw e
    } finally {
      clearTimeout(timer)
    }
  })
}
