// KaTeX：渲染 LaTeX 数学公式。运行时注入官方样式，蛋只需 import 本文件，无需手写 <link>。
// 字体走本地文件（CSP font-src 'self' 禁止 data: URI），CSS 内 url(fonts/…) 相对 katex.min.css 自身解析。
import katex from 'katex'

const link = document.createElement('link')
link.rel = 'stylesheet'
link.href = './vendor/katex/katex.min.css'
document.head.appendChild(link)

export default katex
