// pdfmake 需要 vfs 字体才能渲染文本。把字体注入后默认导出 pdfMake。
import pdfMake from 'pdfmake/build/pdfmake.min'
import pdfFonts from 'pdfmake/build/vfs_fonts'

pdfMake.vfs = pdfFonts.pdfMake.vfs

export default pdfMake
