// 登録・詳細の画面の欄の値（docs/SPEC.md の 6.2・6.12・12.2・12.3）。画面の中で持つ値の形と、開いた時の初めの値、「詳しく」を
// 開いて出すかの決め方。React・ストアを読まない純粋な関数だけ（DetailForm は登録・詳細・段階3の右の列のパネルのどれにも入る）。
// 欄を直した時の決まり（日付のそろえ方・翌日にする・00:00 を 24:00 に。12.4）は src/domain/itemInput.ts の editDates・editTimes が
// 持つ（ここでは当てない）。ほかに、詳細の画面で保存する日付・時刻の差分、書きかけか、メモの URL の切り出し
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
 * 端末の記録（raw）の件名を detailForm に渡す形にする: 記録が無ければ undefined（表示用の記録の件名のまま）、件名が文字でない
 * （null・項目が無い・古い形）なら空の件名として ''（表示用の記録では「（件名なし）」になっている。D48）
 */
export function rawTitleOf(raw: unknown): string | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const title = (raw as { title?: unknown }).title
  return typeof title === 'string' ? title : ''
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

/** 日付と時刻の欄の値（予定の記録から。editDates・editTimes に渡す形） */
export function whenOf(item: When): When {
  return { origin: item.origin, start: item.start, due: item.due, startTime: item.startTime, endTime: item.endTime }
}

/** 日付と時刻のうち、決まりを当てた後に変わった物だけ（詳細の画面で保存する物。変わっていなければ空） */
export function whenChanges(cur: When, next: When): Partial<Pick<When, 'start' | 'due' | 'startTime' | 'endTime'>> {
  const out: Partial<Pick<When, 'start' | 'due' | 'startTime' | 'endTime'>> = {}
  for (const k of ['start', 'due', 'startTime', 'endTime'] as const) if (next[k] !== cur[k]) out[k] = next[k]
  return out
}

/** 登録の画面が書きかけか（件名かメモに字がある。閉じる前に「書きかけを捨てますか？」と確かめる。12.2・ITEMS-186） */
export function hasDraftText(f: Pick<ItemForm, 'title' | 'memo'>): boolean {
  return f.title.trim() !== '' || f.memo.trim() !== ''
}

/**
 * list 生まれのタスクが今カレンダーに出ていないか（①④。締め切り日が無い）。時刻の欄と「Task List にも出す」を押せなくする
 * （12.3・D37・6.3。ITEMS-212・214）
 */
export function offCalendarTask(f: Pick<When, 'origin' | 'due'>): boolean {
  return f.origin === 'list' && f.due === null
}

/** 時刻の欄を押せない時に添える字（12.3・ITEMS-212） */
export const TIMES_NEED_DUE = '締め切り日を入れると時刻を入れられます'

/** メモの文章の切れ目（字か、押せるリンクにする URL） */
export type MemoPart = { text: string } | { url: string }

/** URL（http・https）。日本語の文の中の括弧・句読点・空白で切る */
const URL_RE = /https?:\/\/[^\s<>"'`「」『』（）()［］[\]{}、。，]+/gu
/** URL の終わりに付いた句読点は URL に入れない（「…を見てください https://example.com/a.」） */
const URL_TRAILING = /[.,;:!?．，：；！？]+$/u

/**
 * メモの文章を、字と URL に分ける（詳細の画面で、入力欄から離れている間は文章として出し、URL は押せるリンクにする。12.3・ITEMS-216）。
 * 書式は付けない（改行・空白はそのまま字に残す）
 */
export function memoParts(text: string): MemoPart[] {
  const out: MemoPart[] = []
  let last = 0
  const push = (t: string) => {
    if (!t) return
    const prev = out[out.length - 1]
    if (prev && 'text' in prev) prev.text += t
    else out.push({ text: t })
  }
  for (const m of text.matchAll(URL_RE)) {
    const raw = m[0]
    const url = raw.replace(URL_TRAILING, '')
    const at = m.index ?? 0
    push(text.slice(last, at))
    if (/^https?:\/\/./u.test(url)) out.push({ url })
    else push(url)
    push(raw.slice(url.length))
    last = at + raw.length
  }
  push(text.slice(last))
  return out
}
