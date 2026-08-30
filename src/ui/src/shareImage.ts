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

  // 奶油纸张底 + 克制的主题色装饰，避免整张图被高饱和蛋色淹没。
  ctx.fillStyle = '#FBF4EA'
  ctx.fillRect(0, 0, W, H)
  ctx.save()
  ctx.globalAlpha = 0.18
  ctx.fillStyle = opts.cupColor
  ctx.beginPath()
  ctx.arc(900, 170, 300, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.arc(120, 960, 230, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  // 有边界的分享卡，而不是满幅宣传海报。
  roundRect(ctx, 42, 42, W - 84, H - 84, 54)
  ctx.fillStyle = 'rgba(255,253,249,0.88)'
  ctx.fill()
  ctx.lineWidth = 9
  ctx.strokeStyle = '#5C4033'
  ctx.stroke()

  // 顶部品牌与内容类型。
  ctx.textAlign = 'left'
  ctx.fillStyle = '#E05250'
  ctx.beginPath()
  ctx.arc(96, 108, 14, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#4B3429'
  ctx.font = 'bold 38px sans-serif'
  ctx.fillText('AppGacha', 124, 121)
  ctx.textAlign = 'right'
  ctx.fillStyle = 'rgba(75,52,41,0.52)'
  ctx.font = 'bold 25px sans-serif'
  ctx.fillText('APP EGG · SHARE', 970, 116)

  // 左侧主题色展台。
  ctx.save()
  ctx.globalAlpha = 0.14
  ctx.fillStyle = opts.cupColor
  roundRect(ctx, 78, 176, 438, 710, 44)
  ctx.fill()
  ctx.restore()
  roundRect(ctx, 78, 176, 438, 710, 44)
  ctx.lineWidth = 4
  ctx.strokeStyle = 'rgba(92,64,51,0.18)'
  ctx.stroke()

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
    const size = 390
    ctx.drawImage(eggImg, 102, 320, size, size)
  }

  // 右侧名称和分享码，信息层级更接近一张实体领取卡。
  ctx.textAlign = 'left'
  ctx.fillStyle = 'rgba(75,52,41,0.55)'
  ctx.font = 'bold 25px sans-serif'
  ctx.fillText('APP EGG', 568, 278)
  ctx.fillStyle = '#4B3429'
  ctx.font = 'bold 58px sans-serif'
  ctx.fillText(fitText(ctx, opts.name, 420), 568, 356)

  ctx.fillStyle = opts.cupColor
  roundRect(ctx, 568, 398, 112, 10, 5)
  ctx.fill()

  ctx.fillStyle = 'rgba(75,52,41,0.58)'
  ctx.font = 'bold 26px sans-serif'
  ctx.fillText(opts.codeLabel ?? '分享码', 568, 500)

  const code = opts.code.toUpperCase()
  roundRect(ctx, 550, 530, 446, 142, 28)
  ctx.fillStyle = '#FFFFFF'
  ctx.fill()
  ctx.lineWidth = 5
  ctx.strokeStyle = '#5C4033'
  ctx.stroke()
  ctx.textAlign = 'center'
  ctx.fillStyle = '#4B3429'
  ctx.font = 'bold 67px monospace'
  ctx.fillText(code, 773, 625)

  // 底部领取提示。
  roundRect(ctx, 550, 716, 446, 170, 30)
  ctx.fillStyle = '#4B3429'
  ctx.fill()
  ctx.textAlign = 'left'
  ctx.fillStyle = 'rgba(255,255,255,0.68)'
  ctx.font = 'bold 22px sans-serif'
  ctx.fillText('CLAIM IN APPGACHA', 582, 766)
  ctx.fillStyle = '#FFFFFF'
  ctx.font = 'bold 29px sans-serif'
  const hint = fitText(ctx, opts.hint ?? '在 AppGacha 输入分享码即可领取', 382)
  ctx.fillText(hint, 582, 824)

  ctx.textAlign = 'center'
  ctx.fillStyle = 'rgba(75,52,41,0.42)'
  ctx.font = '500 24px sans-serif'
  ctx.fillText('A tiny app, ready to travel.', W / 2, 976)

  return canvas.toDataURL('image/png')
}
