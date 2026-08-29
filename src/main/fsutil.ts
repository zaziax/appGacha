import fs from 'node:fs'
import path from 'node:path'

// Electron 37（Node 22.17）的 fs.cpSync 在 Windows 上遇到含非 BMP 字符（如 emoji）
// 的路径会原生崩溃（length_error basic_string，整个进程闪退）。蛋名经常带 emoji，
// 所以所有蛋目录拷贝一律走这个手写递归（copyFileSync 无此问题）。
export function copyDir(src: string, dest: string, filter?: (srcPath: string) => boolean): void {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name)
    const to = path.join(dest, entry.name)
    if (filter && !filter(from)) continue
    if (entry.isDirectory()) copyDir(from, to, filter)
    else if (entry.isFile()) {
      // SQLite WAL 瞬态文件不随蛋目录复制：-shm 是共享内存映射（零数据、重开即重建），
      // -wal 是预写日志（运行时被连接持有，Windows 下复制会触发文件锁 → UNKNOWN 错误）。
      if (entry.name.endsWith('-shm') || entry.name.endsWith('-wal')) continue
      fs.copyFileSync(from, to)
    }
  }
}
