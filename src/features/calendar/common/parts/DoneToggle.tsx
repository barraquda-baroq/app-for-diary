// 完了の丸・●のボタン（docs/SPEC.md の 4.11・7.9・12.5・3.9・D29・D14）。予定全体で1回の完了を切り替える（どの日のカード・行で
// 押しても期間全体。もう一度押すと戻す）。
// - look="ring": 点線の丸（ウィークリーのカード・始点のカード 16px、タイムスケジュールの予定 16px、リスト 18px）。完了は丸を塗って✓
// - look="dot": ●（デイリーのリストの行頭。ラベルの色、無ければ土台の色。完了は色を残して中に✓。LabelDot）
// - 押せる所は 40px 四方を目安に、カード・予定の枠の外にははみ出さない大きさ（hit。高さ 24px の予定では 24）
// - 読み上げは「『件名』を完了にする」／「『件名』の完了を外す」
// - 完了にした時だけ「『件名』を完了にしました［元に戻す］」を 6秒出す（［元に戻す］で完了を外す）。完了を外した時は出さない。
//   詳細の中のチェック・Task List のチェックは toast={false}（その場で切り替わりが見えるため）
// - 完了にした・外したは、元に戻す・やり直すの並びに積む（ウィークリー・デイリーの間。お知らせの［元に戻す］も同じ並びを使う。7.13）。
//   詳細の中のチェックは積まない（詳細を開いてから閉じるまでを1つにまとめる方に入る）
// - カード・行の「押すと詳細」には渡さない（押した出来事を止める）
import type { CSSProperties } from 'react'
import { doneLabel, toastText, undoText } from '../../../../domain/itemText'
import type { Item } from '../../../../domain/types'
import { actions } from '../../../../store/actions'
import { getData } from '../../../../store/appStore'
import { attempt } from '../../../../store/uiStore'
import { itemChange, notifyUndoable, recordStep, UNDO_LABEL } from '../../../../store/undoStore'
import { DotCheckIcon } from '../../../../ui/icons'
import { testIds } from '../testIds'
import { stopActivationKeys } from './events'
import { cls, displayTitle } from './itemLook'
import { LabelDot } from './LabelDot'
import './parts.css'

/** ［元に戻す］の字（3.9。src/store/undoStore.ts の物） */
export { UNDO_LABEL }

export interface DoneToggleProps {
  item: Pick<Item, 'id' | 'title' | 'done' | 'kind' | 'label'>
  /** 見た目（既定は点線の丸） */
  look?: 'ring' | 'dot'
  /** 点線の丸の直径（ウィークリーのカード・タイムスケジュールの予定は 16px、リストは 18px。既定 16） */
  size?: 16 | 18
  /** 押せる所の一辺（px。既定は 40px。カード・予定の枠の中に収まる大きさにする） */
  hit?: number
  /** 完了にした時にお知らせを出す（既定 true） */
  toast?: boolean
  className?: string
  testId?: string
}

/**
 * 完了にする・外す。完了にした時だけ［元に戻す］付きのお知らせを出す（toast が true の時）。undoable なら元に戻す・やり直すの並びに
 * 積む（既定 true。詳細の中のチェックは false: 詳細を開いてから閉じるまでのまとめに入る。7.13）
 */
export function toggleDone(item: Pick<Item, 'id' | 'title' | 'done'>, toast = true, undoable = true): void {
  const next = !item.done
  const before = getData().items[item.id]
  const ok = attempt(() => {
    actions.setItemDone(item.id, next)
    return true
  })
  if (!ok || !undoable) return
  const step = recordStep(undoText.done(displayTitle(item), next), [itemChange(item.id, before, getData().items[item.id])])
  if (next && toast) notifyUndoable(toastText.done(displayTitle(item)), step)
}

export function DoneToggle({ item, look = 'ring', size = 16, hit, toast = true, className, testId }: DoneToggleProps) {
  const style = hit ? ({ '--dot-hit': `${hit}px` } as CSSProperties) : undefined
  return (
    <button
      type="button"
      className={cls('dot-check', 'cp-done', look === 'dot' && 'is-dot', className)}
      style={style}
      aria-label={doneLabel(displayTitle(item), item.done)}
      onClick={(e) => {
        e.stopPropagation()
        toggleDone(item, toast)
      }}
      onKeyDown={stopActivationKeys}
      data-done={item.done ? 'true' : 'false'}
      data-testid={testId ?? testIds.done(item.id)}
    >
      {look === 'dot' ? <LabelDot item={item} doneLook="check" /> : <DotCheckIcon done={item.done} size={size} />}
    </button>
  )
}
