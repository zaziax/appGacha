import { app } from 'electron'
import path from 'node:path'
import { EggStorage } from './eggStorage'

let storage: EggStorage | undefined
export function eggStorage(): EggStorage {
  const base = app.isPackaged ? app.getPath('userData') : app.getAppPath()
  return storage ??= new EggStorage(path.join(app.getPath('userData'), 'egg-storage.json'), path.join(base, 'eggs'), [app.getPath('userData'), app.getAppPath()])
}

// 用户数据（蛋柜/装配舱/失败档）：开发态放仓库目录（样例蛋随 git 走），
// 打包后 appPath 在只读 asar 内，必须落 userData
export function dataRoot(...p: string[]): string {
  if (p[0] === 'eggs') {
    eggStorage().assertAvailable()
    return path.join(eggStorage().directory, ...p.slice(1))
  }
  const base = app.isPackaged ? app.getPath('userData') : app.getAppPath()
  return path.join(base, ...p)
}

// 随应用分发的只读资源（蛋模板等）。打包后 template/assets 走 extraResources，
// 落在 resources/（asar 之外）——继续用 getAppPath() 会指到 asar 内部不存在的路径（ENOENT）。
export function appRoot(...p: string[]): string {
  const base = app.isPackaged ? process.resourcesPath : app.getAppPath()
  return path.join(base, ...p)
}
