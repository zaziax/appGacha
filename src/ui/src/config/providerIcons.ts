/**
 * 平台图标映射 — SVG 来自 @lobehub/icons-static-svg（零依赖，构建时内联为 data URL）
 * 新增平台时：1) ai-providers.json 加条目  2) 此处加一行 import + 映射
 */
import deepseek from '@lobehub/icons-static-svg/icons/deepseek-color.svg'
import openai from '@lobehub/icons-static-svg/icons/openai.svg'
import qwen from '@lobehub/icons-static-svg/icons/qwen-color.svg'
import moonshot from '@lobehub/icons-static-svg/icons/moonshot.svg'
import zhipu from '@lobehub/icons-static-svg/icons/zhipu-color.svg'
import ollama from '@lobehub/icons-static-svg/icons/ollama.svg'

/** AppGacha 平台自有图标（扭蛋，内联 data URI） */
const appgacha = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="13" r="9" fill="#fff" stroke="#5C4033" stroke-width="1.6"/><path d="M3.2 11.5a9 9 0 0 1 17.6 0z" fill="#D9534F" stroke="#5C4033" stroke-width="1.6"/><path d="M3 13h18" stroke="#5C4033" stroke-width="1.6"/><circle cx="12" cy="16" r="2.2" fill="#F6E7CB" stroke="#5C4033" stroke-width="1.4"/></svg>'
)

const map: Record<string, string> = {
  appgacha,
  deepseek,
  openai,
  qwen,
  moonshot,
  zhipu,
  ollama
}

/** 根据 provider icon 字段获取图标 URL；未匹配返回空串（UI 侧降级为 lucide 图标） */
export function providerIcon(icon: string): string {
  return map[icon] ?? ''
}
