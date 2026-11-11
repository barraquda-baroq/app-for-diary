// カレンダーの部品が予定を出す時の小さな決まり（docs/SPEC.md の 4.3・4.6・6.12・7.1・7.7）。画面の部品（ここの parts と、
// 年・月・週・日・登録と詳細の画面）が同じ決め方をするよう1か所に置く。React・ストアを読まない純粋な関数だけ
import { weekdayOfYmd } from '../../../../domain/dates'
import { holidayName } from '../../../../domain/holidays'
import { isLabelKey, type LabelKey } from '../../../../domain/labels'
import { UNTITLED } from '../../../../domain/repair'
import { ITEM_KINDS, type Item, type ItemKind } from '../../../../domain/types'

/**
 * 画面に出す件名（6.12）。表示用に直した記録（useData()）では空の件名がもう「（件名なし）」になっているが、直す前の物を
 * 渡されても同じに出す（カード・行・詳細の題・お知らせの『件名』。ITEMS-036）
 */
export function displayTitle(item: Pick<Item, 'title'>): string {
  return typeof item.title === 'string' && item.title.trim() ? item.title : UNTITLED
}

/** 画面に出す区分（知らない kind は仕事。6.12） */
export function kindOf(item: Pick<Item, 'kind'>): ItemKind {
  return ITEM_KINDS.includes(item.kind) ? item.kind : 'work'
}

/** 画面に出すラベル（知らないキーは「ラベルなし」= null。4.6・6.12・FRAME-193） */
export function labelOf(item: Pick<Item, 'label'>): LabelKey | null {
  return isLabelKey(item.label) ? item.label : null
}

/** カード・行・予定の枠・詳細の画面に付ける印（data-kind・data-label）。src/styles.css がここから区分の色とラベルの色を引く */
export interface ItemAttrs {
  'data-kind': ItemKind
  /** ラベルが無い・知らないキーの時は付けない（一辺・帯・線は付けず、●は土台の色。4.3・FRAME-193・CALENDAR-264） */
  'data-label'?: LabelKey
}

export function itemAttrs(item: Pick<Item, 'kind' | 'label'>): ItemAttrs {
  const label = labelOf(item)
  return label ? { 'data-kind': kindOf(item), 'data-label': label } : { 'data-kind': kindOf(item) }
}

/** 日付と曜日の色（7.1）: 日曜と祝日は --sun、土曜は --sat、ほかは色なし。祝日の土曜は祝日の色 */
export type DayTone = 'sun' | 'sat' | null

export function dayTone(date: string): DayTone {
  const w = weekdayOfYmd(date)
  if (w === 0 || holidayName(date) !== null) return 'sun'
  return w === 6 ? 'sat' : null
}

/** AI の札を付けるか（Claude が足した物 = by が connector。作者が手で作った物を Claude が直しても付けない。7.7・I6） */
export function hasAiTag(item: Pick<Item, 'by'>): boolean {
  return item.by === 'connector'
}

/** AI の札の字（ai が 'claude' なら「Claude」、知らない値・無い時は「AI」。7.7・6.1） */
export function aiTagText(item: Pick<Item, 'ai'>): string {
  return item.ai === 'claude' ? 'Claude' : 'AI'
}

/** クラスの名前を並べる（false・null・undefined・空は除く） */
export function cls(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(' ')
}
