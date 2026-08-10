/**
 * 一次性脚本：为现有蛋补上 icon.svg（收藏柜图标）
 * 运行：node scripts/make-egg-icons.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'eggs')

const S = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">${inner}</svg>\n`

/** 终端图标（Hello World 系列，色相变化） */
const terminal = (bg, fg) => S(
  `<rect x="6" y="8" width="36" height="32" rx="6" fill="${bg}"/>` +
  `<path d="M14 18l7 6-7 6" fill="none" stroke="${fg}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>` +
  `<rect x="24" y="28" width="10" height="4" rx="2" fill="${fg}"/>`
)

const icons = {
  '3D 悬浮地球': S(
    '<circle cx="24" cy="24" r="18" fill="#1E88E5"/>' +
    '<path d="M12 16c4-3 9-2 12 1s8 4 12 1" fill="none" stroke="#A5D6A7" stroke-width="4" stroke-linecap="round"/>' +
    '<path d="M10 28c5 2 8 6 14 5s9-5 14-3" fill="none" stroke="#A5D6A7" stroke-width="4" stroke-linecap="round"/>' +
    '<circle cx="24" cy="24" r="18" fill="none" stroke="#1565C0" stroke-width="2.5"/>'
  ),
  '3D悬浮骰子': S(
    '<rect x="8" y="8" width="32" height="32" rx="8" fill="#F5F5F5" stroke="#455A64" stroke-width="2.5"/>' +
    '<circle cx="17" cy="17" r="3.5" fill="#E53935"/>' +
    '<circle cx="24" cy="24" r="3.5" fill="#E53935"/>' +
    '<circle cx="31" cy="31" r="3.5" fill="#E53935"/>'
  ),
  'AI手账账本': S(
    '<rect x="10" y="6" width="28" height="36" rx="4" fill="#FFB74D"/>' +
    '<rect x="14" y="6" width="24" height="36" rx="3" fill="#FFF8E1"/>' +
    '<rect x="19" y="14" width="14" height="3" rx="1.5" fill="#FFB74D"/>' +
    '<rect x="19" y="21" width="14" height="3" rx="1.5" fill="#FFCC80"/>' +
    '<rect x="19" y="28" width="9" height="3" rx="1.5" fill="#FFCC80"/>' +
    '<circle cx="35" cy="35" r="8" fill="#4CAF50"/><path d="M32 35l2.5 2.5 4.5-5" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>'
  ),
  'AI每日一签': S(
    '<rect x="14" y="14" width="20" height="28" rx="3" fill="#D32F2F"/>' +
    '<rect x="18" y="8" width="4" height="14" rx="2" fill="#FFC107" transform="rotate(-8 20 15)"/>' +
    '<rect x="26" y="6" width="4" height="16" rx="2" fill="#FF9800" transform="rotate(6 28 14)"/>' +
    '<rect x="19" y="24" width="10" height="12" rx="2" fill="#FFF8E1"/>'
  ),
  'AI账本': S(
    '<rect x="8" y="10" width="32" height="28" rx="5" fill="#26A69A"/>' +
    '<rect x="13" y="16" width="22" height="7" rx="2" fill="#E0F2F1"/>' +
    '<circle cx="16" cy="29" r="2.5" fill="#E0F2F1"/><circle cx="24" cy="29" r="2.5" fill="#E0F2F1"/><circle cx="32" cy="29" r="2.5" fill="#E0F2F1"/>' +
    '<circle cx="16" cy="34.5" r="2.5" fill="#E0F2F1"/><circle cx="24" cy="34.5" r="2.5" fill="#E0F2F1"/><rect x="29.5" y="32" width="5" height="5" rx="2.5" fill="#FFCA28"/>'
  ),
  'Hello World': terminal('#37474F', '#76FF03'),
  'HelloWorld': terminal('#1A237E', '#82B1FF'),
  'Hello World-2': terminal('#4A148C', '#EA80FC'),
  'Hello World-3': terminal('#004D40', '#64FFDA'),
  'Hello World-4': terminal('#BF360C', '#FFAB91'),
  'Hello World-5': terminal('#263238', '#FFD740'),
  '亲戚称呼计算器': S(
    '<circle cx="18" cy="16" r="7" fill="#5C6BC0"/>' +
    '<path d="M6 38c0-7 5.5-11 12-11s12 4 12 11" fill="#5C6BC0"/>' +
    '<circle cx="33" cy="18" r="5.5" fill="#EC407A"/>' +
    '<path d="M24 38c0-6 4-9.5 9-9.5s9 3.5 9 9.5" fill="#EC407A"/>'
  ),
  '今晚吃什么': S(
    '<circle cx="24" cy="26" r="16" fill="#FF7043"/>' +
    '<circle cx="24" cy="26" r="11" fill="#FFF3E0"/>' +
    '<path d="M18 24c2-3 4 1 6-2s4 1 6-2" fill="none" stroke="#FF7043" stroke-width="2.5" stroke-linecap="round"/>' +
    '<rect x="22" y="6" width="4" height="8" rx="2" fill="#8D6E63"/>'
  ),
  '喝水平台': S(
    '<path d="M24 6C24 6 10 22 10 31a14 14 0 0028 0C38 22 24 6 24 6z" fill="#29B6F6"/>' +
    '<path d="M18 30a6.5 6.5 0 006 7" fill="none" stroke="#B3E5FC" stroke-width="3.5" stroke-linecap="round"/>'
  ),
  '屏幕取色器': S(
    '<rect x="6" y="6" width="22" height="22" rx="5" fill="#AB47BC"/>' +
    '<rect x="20" y="20" width="22" height="22" rx="5" fill="#26C6DA"/>' +
    '<circle cx="24" cy="24" r="7" fill="#fff"/>' +
    '<circle cx="24" cy="24" r="3.5" fill="#FF7043"/>'
  ),
  '恋爱笔记本': S(
    '<rect x="10" y="8" width="28" height="34" rx="4" fill="#F48FB1"/>' +
    '<rect x="15" y="8" width="23" height="34" rx="3" fill="#FCE4EC"/>' +
    '<path d="M26 20c-2-4-8-4-8 1 0 4 8 9 8 9s8-5 8-9c0-5-6-5-8-1z" fill="#E91E63"/>'
  ),
  '悬浮太阳系': S(
    '<circle cx="24" cy="24" r="8" fill="#FDD835"/>' +
    '<ellipse cx="24" cy="24" rx="19" ry="8" fill="none" stroke="#90A4AE" stroke-width="2" transform="rotate(-20 24 24)"/>' +
    '<circle cx="38" cy="17" r="4" fill="#42A5F5"/>' +
    '<circle cx="11" cy="30" r="3" fill="#EF5350"/>'
  ),
  '悬浮时钟': S(
    '<circle cx="24" cy="24" r="18" fill="#fff" stroke="#37474F" stroke-width="3.5"/>' +
    '<rect x="22.5" y="13" width="3" height="13" rx="1.5" fill="#37474F"/>' +
    '<rect x="24" y="22.5" width="9" height="3" rx="1.5" fill="#E53935"/>' +
    '<circle cx="24" cy="24" r="2.5" fill="#37474F"/>'
  ),
  '悬浮清单': S(
    '<rect x="10" y="6" width="28" height="36" rx="5" fill="#fff" stroke="#78909C" stroke-width="2.5"/>' +
    '<circle cx="17" cy="15" r="2.5" fill="#66BB6A"/><rect x="22" y="13.5" width="12" height="3" rx="1.5" fill="#B0BEC5"/>' +
    '<circle cx="17" cy="24" r="2.5" fill="#66BB6A"/><rect x="22" y="22.5" width="12" height="3" rx="1.5" fill="#B0BEC5"/>' +
    '<circle cx="17" cy="33" r="2.5" fill="#FFA726"/><rect x="22" y="31.5" width="8" height="3" rx="1.5" fill="#B0BEC5"/>'
  ),
  '每日一签': S(
    '<rect x="15" y="12" width="18" height="30" rx="3" fill="#FFECB3" stroke="#F9A825" stroke-width="2"/>' +
    '<path d="M20 6l4 8 4-8" fill="none" stroke="#D32F2F" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<rect x="19" y="20" width="10" height="2.5" rx="1.25" fill="#F9A825"/>' +
    '<rect x="19" y="26" width="10" height="2.5" rx="1.25" fill="#F9A825"/>' +
    '<rect x="19" y="32" width="6" height="2.5" rx="1.25" fill="#F9A825"/>'
  ),
  '炉石组卡器': S(
    '<rect x="8" y="12" width="20" height="28" rx="4" fill="#5C6BC0" transform="rotate(-10 18 26)"/>' +
    '<rect x="18" y="10" width="20" height="28" rx="4" fill="#FFA726" transform="rotate(6 28 24)"/>' +
    '<circle cx="28" cy="22" r="6" fill="#FFF8E1"/>' +
    '<path d="M25 22l2 2 4-4" fill="none" stroke="#FFA726" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>'
  ),
  '猜猜我是谁': S(
    '<circle cx="24" cy="24" r="18" fill="#7E57C2"/>' +
    '<path d="M19 19c0-4 3-6.5 5.5-6.5S30 15 30 18.5c0 3-2.5 3.5-4 5-1 1-1 2-1 3" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"/>' +
    '<circle cx="25" cy="33" r="2.5" fill="#fff"/>'
  ),
  '番茄专注': S(
    '<circle cx="24" cy="27" r="15" fill="#E53935"/>' +
    '<path d="M24 12c-2.5-5 2-8 2-8s7 2.5 4.5 8" fill="#43A047"/>' +
    '<path d="M24 12c2.5-5-2-8-2-8s-7 2.5-4.5 8" fill="#66BB6A"/>' +
    '<rect x="22" y="20" width="4" height="9" rx="2" fill="#fff"/>' +
    '<rect x="22" y="25" width="7" height="4" rx="2" fill="#fff"/>'
  ),
  '简易计算器': S(
    '<rect x="10" y="6" width="28" height="36" rx="5" fill="#546E7A"/>' +
    '<rect x="14" y="11" width="20" height="8" rx="2" fill="#C5E1A5"/>' +
    '<circle cx="17" cy="26" r="3" fill="#B0BEC5"/><circle cx="26" cy="26" r="3" fill="#B0BEC5"/><circle cx="35" cy="26" r="3" fill="#FFA726"/>' +
    '<circle cx="17" cy="35" r="3" fill="#B0BEC5"/><circle cx="26" cy="35" r="3" fill="#B0BEC5"/><circle cx="35" cy="35" r="3" fill="#66BB6A"/>'
  ),
  '联机五子棋': S(
    '<rect x="7" y="7" width="34" height="34" rx="4" fill="#FFCC80"/>' +
    '<path d="M7 18h34M7 30h34M18 7v34M30 7v34" stroke="#8D6E63" stroke-width="2"/>' +
    '<circle cx="18" cy="18" r="5" fill="#212121"/>' +
    '<circle cx="30" cy="30" r="5" fill="#fff" stroke="#9E9E9E" stroke-width="1.5"/>' +
    '<circle cx="30" cy="18" r="5" fill="#212121"/>'
  ),
  '背单词': S(
    '<path d="M24 10C20 6 12 5 8 7v30c4-2 12-1 16 3 4-4 12-5 16-3V7c-4-2-12-1-16 3z" fill="#42A5F5"/>' +
    '<path d="M24 10v30" stroke="#E3F2FD" stroke-width="2.5"/>' +
    '<rect x="13" y="15" width="7" height="2.5" rx="1.25" fill="#E3F2FD"/>' +
    '<rect x="13" y="21" width="7" height="2.5" rx="1.25" fill="#E3F2FD"/>' +
    '<rect x="28" y="15" width="7" height="2.5" rx="1.25" fill="#E3F2FD"/>'
  ),
  '薄荷备忘录': S(
    '<rect x="10" y="8" width="28" height="32" rx="4" fill="#fff" stroke="#80CBC4" stroke-width="2.5"/>' +
    '<path d="M30 14c-8 0-13 5-13 12 0 0 2-1.5 5-1.5C28 24.5 30 20 30 14z" fill="#26A69A"/>' +
    '<path d="M17 26c3-1 8-4 13-12" fill="none" stroke="#00897B" stroke-width="2" stroke-linecap="round"/>' +
    '<rect x="15" y="31" width="14" height="2.5" rx="1.25" fill="#B2DFDB"/>'
  ),
  '藏头诗创作': S(
    '<path d="M34 6L14 34l-2 8 8-2L40 12z" fill="#FF8F00"/>' +
    '<path d="M34 6l6 6-4 4-6-6z" fill="#5D4037"/>' +
    '<path d="M14 34l8 2-2.5 2.5L12 40l1.5-4.5z" fill="#37474F"/>' +
    '<rect x="8" y="42" width="20" height="3" rx="1.5" fill="#BCAAA4"/>'
  ),
  '跳一跳 3D': S(
    '<rect x="6" y="34" width="16" height="8" rx="3" fill="#78909C"/>' +
    '<rect x="28" y="26" width="16" height="8" rx="3" fill="#607D8B"/>' +
    '<circle cx="14" cy="26" r="6" fill="#EC407A"/>' +
    '<path d="M20 22c4-8 10-8 14-2" fill="none" stroke="#EC407A" stroke-width="2.5" stroke-dasharray="3 3" stroke-linecap="round"/>'
  ),
  '躲开鼠标的 Hello World': S(
    '<path d="M12 8l24 14-11 2-6 10z" fill="#37474F"/>' +
    '<path d="M32 30l6 10" stroke="#E53935" stroke-width="4" stroke-linecap="round"/>' +
    '<path d="M38 24l6 2M36 16l6-2" stroke="#FFA726" stroke-width="3" stroke-linecap="round"/>'
  ),
  '雷霆战机': S(
    '<path d="M24 4l4 14 12 8-12 2-2 16-2-16-12-2 12-8z" fill="#FDD835"/>' +
    '<path d="M24 4l4 14 12 8-12 2z" fill="#F9A825"/>' +
    '<circle cx="24" cy="22" r="4" fill="#37474F"/>'
  ),
  '🍅 番茄小钟': S(
    '<circle cx="24" cy="27" r="15" fill="#E53935"/>' +
    '<path d="M24 12c-2.5-5 2-8 2-8s7 2.5 4.5 8" fill="#43A047"/>' +
    '<path d="M24 12c2.5-5-2-8-2-8s-7 2.5-4.5 8" fill="#66BB6A"/>' +
    '<circle cx="24" cy="27" r="9" fill="#FFEBEE"/>' +
    '<rect x="22.75" y="21" width="2.5" height="7.5" rx="1.25" fill="#37474F"/>' +
    '<rect x="24" y="25.75" width="5" height="2.5" rx="1.25" fill="#E53935"/>'
  ),
}

let ok = 0, skip = 0
for (const [folder, svg] of Object.entries(icons)) {
  const dir = path.join(root, `${folder}.gacha`)
  if (!fs.existsSync(dir)) { console.log(`[skip] 目录不存在: ${folder}`); skip++; continue }
  const target = path.join(dir, 'icon.svg')
  fs.writeFileSync(target, svg, 'utf-8')
  ok++
}
console.log(`[done] 写入 ${ok} 个图标，跳过 ${skip} 个`)
