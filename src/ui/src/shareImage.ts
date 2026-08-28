import { renderEggIconPngs } from './eggIconRender'

/**
 * 宣传截图合成 — 分享码 + 扭蛋信息 + 3D 蛋图，输出 PNG data URL。
 * 蛋图复用收藏架同款离屏渲染（renderEggIconPngs），本模块只做 2D canvas 拼版。
 */

export interface ShareImageOpts {
  name: string
  /** 蛋图标 SVG 原文（可选） */
  iconSvg?: string
  code: string
  /** 蛋的杯体色（hsl），用于背景渐变底 */
  cupColor: string
  /** 内容物色（传给 renderEggIconPngs） */
  contentColor: string
  /** 分享码标签文案（i18n，可选，默认中文） */
  codeLabel?: string
  /** 底部领取提示文案（i18n，可选，默认中文） */
  hint?: string
}

/** SVG 原文 → data URL（沙箱化不执行脚本） */
function iconDataUrl(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image load failed'))
    img.src = url
  })
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** 长文本按像素宽度截断（追加省略号），保证蛋名/提示不撑破卡片 */
function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text
  let s = text
  while (s.length > 1 && ctx.measureText(s + '…').width > maxWidth) s = s.slice(0, -1)
  return s + '…'
}

export async function renderShareImage(opts: ShareImageOpts): Promise<string> {
  const W = 1080
  const H = 1080
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!

  // 背景：奶油色 → 蛋杯体色渐变
  const grad = ctx.createLinearGradient(0, 0, W, H)
  grad.addColorStop(0, '#FBF3E8')
  grad.addColorStop(1, opts.cupColor)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, W, H)

  // 顶部品牌
  ctx.textAlign = 'center'
  ctx.fillStyle = 'rgba(92,64,51,0.55)'
  ctx.font = 'bold 40px sans-serif'
  ctx.fillText('AppGacha', W / 2, 96)

  // 3D 蛋图（离屏渲染，取最大尺寸 256）
  let eggImg: HTMLImageElement | null = null
  try {
    const pngs = await renderEggIconPngs({
      cupColor: opts.cupColor,
      contentColor: opts.contentColor,
      iconUrl: opts.iconSvg ? iconDataUrl(opts.iconSvg) : undefined,
    })
    eggImg = await loadImage(pngs[256])
  } catch { /* 蛋图渲染失败则跳过，仍输出文字卡片 */ }

  if (eggImg) {
    const size = 400
    ctx.drawImage(eggImg, (W - size) / 2, 150, size, size)
  }

  // 文案阴影：保证在渐变底上可读
  ctx.shadowColor = 'rgba(0,0,0,0.22)'
  ctx.shadowBlur = 8
  ctx.shadowOffsetY = 2

  // 蛋名（超长截断，避免撑破卡片）
  ctx.fillStyle = '#FFFFFF'
  ctx.font = 'bold 64px sans-serif'
  ctx.fillText(fitText(ctx, opts.name, W - 140), W / 2, 640)

  // 分享码标签
  ctx.fillStyle = 'rgba(255,255,255,0.88)'
  ctx.font = '500 30px sans-serif'
  ctx.fillText(opts.codeLabel ?? '分享码', W / 2, 720)

  // 分享码大字（白底胶囊 + 杯体色文字）
  ctx.shadowColor = 'rgba(0,0,0,0)'
  const code = opts.code.toUpperCase()
  ctx.font = 'bold 96px monospace'
  const cw = ctx.measureText(code).width
  const boxX = (W - cw) / 2 - 48
  const boxY = 748
  ctx.fillStyle = 'rgba(255,255,255,0.96)'
  roundRect(ctx, boxX, boxY, cw + 96, 132, 24)
  ctx.fill()
  ctx.fillStyle = opts.cupColor
  ctx.fillText(code, W / 2, boxY + 94)

  // 底部提示
  ctx.shadowColor = 'rgba(0,0,0,0.18)'
  ctx.shadowBlur = 6
  ctx.shadowOffsetY = 2
  ctx.fillStyle = 'rgba(255,255,255,0.85)'
  ctx.font = '500 30px sans-serif'
  ctx.fillText(fitText(ctx, opts.hint ?? '在 AppGacha 输入分享码即可领取', W - 140), W / 2, 1000)

  return canvas.toDataURL('image/png')
}
