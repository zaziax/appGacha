import { useState, useSyncExternalStore } from 'react'
import { shelf } from '../shelf'
import { getGachaState, subscribeGacha, beginGacha, clearGachaResult, dismissResult } from '../gachaStore'
import { GachaMachine } from './GachaMachine'
import { stageText } from '../App'

interface Props {
  onClose: () => void
  onToast: (msg: string) => void
}

export function WishDialog({ onClose, onToast }: Props) {
  const gacha = useSyncExternalStore(subscribeGacha, getGachaState)
  const [text, setText] = useState('')

  // 面板由扭蛋状态推导：进行中→进度；有结果→揭晓；否则→许愿表单
  const pane = gacha.running ? 'progress' : gacha.result ? 'result' : 'form'

  const start = async () => {
    const wish = text.trim()
    if (wish.length < 2) return
    try {
      if (gacha.upgrade) {
        await shelf.upgrade(gacha.upgrade.eggId, wish)
      } else {
        await shelf.wish(wish)
      }
      beginGacha(gacha.upgrade)
      setText('')
    } catch (err) {
      onToast((err as Error).message)
    }
  }

  const closeResult = () => {
    clearGachaResult()
    onClose()
  }

  return (
    <div className="mask" onClick={e => { if (e.target === e.currentTarget && pane !== 'progress') onClose() }}>
      <div className="dialog">
        {pane === 'form' && (
          <div>
            <h2>{gacha.upgrade ? `给「${gacha.upgrade.name}」许愿升级 ✦` : '许个愿 ✦'}</h2>
            <p className="dialog-sub">
              {gacha.upgrade
                ? '说出想改进的地方，机芯会在原有功能和数据的基础上改造它。升级前会自动整蛋备份。'
                : '说出你想要的小应用，机芯会为你扭一颗出来。数据、提醒、AI 它都会自带。'}
            </p>
            <textarea
              rows={4}
              autoFocus
              value={text}
              onChange={e => setText(e.target.value)}
              placeholder={gacha.upgrade
                ? '例如：加一个夜间模式，并统计每天的使用次数'
                : '例如：我想要一个番茄钟，25 分钟专注 + 5 分钟休息，结束时提醒我，并统计每天完成了几个番茄'}
            />
            <div className="dialog-actions">
              <button className="primary" onClick={start}>投币，开扭！</button>
              <button onClick={onClose}>再想想</button>
            </div>
          </div>
        )}

        {pane === 'progress' && (
          <div className="wish-progress">
            <h2>{stageText(gacha.stage)}</h2>
            <GachaMachine stage={gacha.stage} />
            <p className="dialog-sub">{gacha.detail || '装配舱就位'}</p>
            <div className="dialog-actions">
              <button onClick={onClose}>后台运行，先去忙别的</button>
            </div>
          </div>
        )}

        {pane === 'result' && gacha.result && (
          <div className="wish-result">
            <h2>
              {gacha.result.ok
                ? (gacha.result.upgraded ? `咔哒！「${gacha.result.name}」升级完成 ◓` : `咔哒！「${gacha.result.name}」出蛋了 ◓`)
                : (gacha.result.upgraded ? '这次升级没成…' : '这次没扭出好蛋…')}
            </h2>
            <p className="dialog-sub">
              {gacha.result.ok
                ? (gacha.result.upgraded ? '数据完好，代码焕然一新（不满意可在蛋卡片上「还原」）' : '已放进你的收藏柜')
                : `${gacha.result.error ?? ''}${gacha.result.upgraded ? '（蛋还是原来的样子，没有被动过）' : ''}`}
            </p>
            <div className="dialog-actions">
              {gacha.result.ok && gacha.result.eggId && (
                <button className="primary" onClick={() => {
                  shelf.open(gacha.result!.eggId!).catch(err => onToast(err.message))
                  closeResult()
                }}>打开看看</button>
              )}
              {!gacha.result.ok && (
                <button onClick={() => dismissResult()}>再来一发 ◓</button>
              )}
              <button onClick={closeResult}>关闭</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
