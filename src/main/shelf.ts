// 收藏柜 IPC 注册层：按域拆分到 channels/，本文件退化为聚合入口（barrel）。
// 对外 API 不变——index.ts 依旧从这里 import registerShelfChannels / registerWindowControls /
// bindWindowStateEvents / importGachaFile。
import { registerEggChannels, importGachaFile } from './channels/eggChannels'
import { registerGachaChannels } from './channels/gachaChannels'
import { registerSettingsChannels } from './channels/settingsChannels'
import { registerSpaceChannels } from './channels/spaceChannels'
import { registerAuthChannels } from './channels/authChannels'
import { registerBillingChannels } from './channels/billingChannels'
import { registerSyncChannels } from './channels/syncChannels'
import { registerUpdateChannels } from './channels/updateChannels'
import { registerWindowControls, bindWindowStateEvents } from './channels/windowChannels'

export { importGachaFile }
export { registerWindowControls, bindWindowStateEvents }

export function registerShelfChannels(): void {
  registerEggChannels()
  registerGachaChannels()
  registerSettingsChannels()
  registerSpaceChannels()
  registerAuthChannels()
  registerBillingChannels()
  registerSyncChannels()
  registerUpdateChannels()
}
