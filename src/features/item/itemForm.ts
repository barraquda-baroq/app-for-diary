// 登録・詳細の画面の欄の値（docs/SPEC.md の 6.2・6.12・12.2・12.3）。画面の中で持つ値の形と、開いた時の初めの値、「詳しく」を
// 開いて出すかの決め方。React・ストアを読まない純粋な関数だけ（DetailForm は登録・詳細・段階3の右の列のパネルのどれにも入る）。
// 欄を直した時の決まり（日付のそろえ方・翌日にする・00:00 を 24:00 に。12.4）は src/domain/itemInput.ts の editDates・editTimes が
// 持つ（ここでは当てない）
import { registerDefaults, type RegisterInit, type When } from '../../domain/itemInput'
import type { LabelKey } from '../../domain/labels'
import type { Item, ItemKind } from '../../domain/types'
import { kindOf, labelOf } from '../calendar/common/parts/itemLook'

/** 欄の値（並びは 件名 → 区分 → 日付 → 時刻 → 詳しく（ラベル・依頼者・ロック・Task List にも出す・メモ）。12.2） */
export interface ItemForm extends When {
  title: string
  kind: ItemKind
  /** ラベルのキー（知らないキーは「ラベルなし」= null として出す。6.12・ITEMS-025） */
  label: LabelKey | null
  requester: string
  locked: boolean
  listed: boolean
  memo: string
}

/** 日付の欄（開始日・締め切り日） */
export type DatePatch = Partial<Pick<When, 'start' | 'due'>>
/** 時刻の欄（開始・終了） */
export type TimePatch = Partial<Pick<When, 'startTime' | 'endTime'>>
/** 日付・時刻のほかの欄 */
export type FieldPatch = Partial<Pick<ItemForm, 'title' | 'kind' | 'label' | 'requester' | 'locked' | 'listed' | 'memo'>>

/**
 * 登録の画面の初めの値（12.2・ITEMS-172・177・183）: 件名は空（段階3の Favorite からは1行目）、区分は開いた場所で決まる時はその区分
 * （無ければ仕事）、開始日はデイリーからはその日・ほかは今日、締め切り日は空、時刻はタイムスケジュールから開いた時だけ。
 * 詳しくはラベルなし・依頼者なし・ロックなし・Task List に出さない・メモ空（段階3の Favorite からはメモに2行目から）
 */
export function registerForm(init: RegisterInit): ItemForm {
  const d = registerDefaults(init)
  return { ...d, label: null, requester: '', locked: false, listed: false }
}

/**
 * 詳細の画面の初めの値。item は表示用に直した記録（useData()。知らない kind は仕事・知らないラベルはラベルなし。6.12）。
 * rawTitle は端末の記録（raw）の件名: 件名が空の記録は、表示用の記録では「（件名なし）」になっているので、欄は空にして
 * プレースホルダで「（件名なし）」と出す（本当に「（件名なし）」という件名の記録と見分けるため。D48・AMB-ITEMS-26）
 */
export function detailForm(item: Item, rawTitle?: unknown): ItemForm {
  const blank = typeof rawTitle === 'string' && rawTitle.trim() === ''
  return {
    origin: item.origin,
    start: item.start,
    due: item.due,
    startTime: item.startTime,
    endTime: item.endTime,
    title: blank ? '' : item.title,
    kind: kindOf(item),
    label: labelOf(item),
    requester: item.requester,
    locked: item.locked,
    listed: item.listed,
    memo: item.memo,
  }
}

/**
 * 「詳しく」の中に入っている物があるか（詳細の画面は、あれば「詳しく」を開いて出す。D11・AMB-ITEMS-02）: ラベル・依頼者・ロック・
 * メモと、Task List にも出すが生まれの初めの値と違う時（calendar 生まれで出す・list 生まれで外した）
 */
export function hasDetails(f: Pick<ItemForm, 'origin' | 'label' | 'requester' | 'locked' | 'listed' | 'memo'>): boolean {
  const listedSet = f.origin === 'calendar' ? f.listed : !f.listed
  return f.label !== null || f.requester.trim() !== '' || f.locked || listedSet || f.memo.trim() !== ''
}

/** 件名の欄に入れられる字（改行は入れない: 貼った改行は空白にする。200字まではコードポイントで数えて src/domain の limitChars） */
export function oneLine(text: string): string {
  return text.replace(/\r\n?|\n/g, ' ')
}
