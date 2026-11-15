// Task List（docs/SPEC.md の 13.・6.3・6.4）の決まり: 4通り（①なし・②締め切り日だけ・③両方・④開始日だけ）とカレンダー生まれの見分け、
// 行に出す物（日付の列の字・M・S の上の行・期限切れ・今日）、並び（13.4）、済みと 168時間で隠す決まり、入力欄から足す物、
// 日付を直す時の決まり、日付の列のメニュー（13.5）。画面は表示用に直した記録（useData()。6.12）を渡す。
// 契約の形だけ（S3-STUB）: 名前と形はこれで決まり、中身は段階3の WP1 が入れる。今の関数は空の結果を返すだけで、決まりはまだ無い
// （どの画面もまだ呼ばない）。使わない引数は void で読む（名前を契約のまま残すため）。
// 日付は 'YYYY-MM-DD' の文字のまま比べる。today は端末の暦の今日（useToday()。リストごとに1つ）、nowMs は今（useNow(60秒)。
// Task List の 168時間だけに使う）
import type { ItemInput } from './ops'
import type { ID, Item } from './types'

/** ① none（日付なし）・② due（締め切り日だけ）・③ span（開始日と締め切り日）・④ start（開始日だけ）は Task List 生まれ（6.3）。
 * calendar はカレンダー生まれで Task List にも出している物 */
export type TaskCase = 'none' | 'due' | 'span' | 'start' | 'calendar'

/** その予定の通り（Task List 生まれは日付の持ち方で4通り、カレンダー生まれは calendar） */
export function taskCaseOf(item: Pick<Item, 'origin' | 'start' | 'due'>): TaskCase {
  void item
  return 'none'
}

/**
 * L の日付の列（40px）の字。1日の物は to の 'M/D'、複数日は sub に 'M/D〜'・main に 'M/D'、④は 'M/D〜'、①は '—'（faint: 淡い字）。
 * 年は列に出さず、aria に年まで入れた日付を持つ（D32）
 */
export interface TaskDateText {
  sub: string | null
  main: string
  faint: boolean
  aria: string
}

/** Task List の1行に出す物（行の部品は React.memo で、これと記録を浅く比べる） */
export interface TaskRowView {
  id: ID
  item: Item
  case: TaskCase
  /** カレンダーに出ている（6.3） */
  onCalendar: boolean
  /** 期間の終わり（6.3）: Task List 生まれは締め切り日、カレンダー生まれは締め切り日か無ければ開始日。①④は null */
  to: string | null
  /** L の日付の列 */
  date: TaskDateText
  /** M・S の上の行（'' の時は行を出さない。D27） */
  stackedLine: string
  /** 期限切れ（to が今日より前で、まだ済んでいない） */
  overdue: boolean
  /** to が今日（太さ 600） */
  today: boolean
  done: boolean
  /** ［日付を決める］を出す（Task List 生まれの①④。13.5） */
  canDecideDate: boolean
  /** ［Task List から外す］を出す（カレンダーに出ている間だけ。6.3） */
  canUnlist: boolean
}

/** Task List の中身: まだの行（並びは 13.4）・済みの行（済んだ順の新しい方から）・まだ済んでいない数（見出し・切り替えの列の数） */
export interface TaskListView {
  open: TaskRowView[]
  done: TaskRowView[]
  undone: number
}

/**
 * Task List に出す行（isInTaskList の物。済んで 168時間を過ぎた物は出さない: ちょうど 168時間はまだ出し、168時間と 1ミリ秒で隠す）。
 * まだの行の並び（D10）: カレンダーに出ている物を to の早い順（期限切れが上）、同じ to は作った順・id、その後に①④を作った新しい順・id。
 * 仕事とプライベートは混ぜる。済みの行は doneAt の新しい順・id
 */
export function taskListView(items: Iterable<Item>, today: string, nowMs: number): TaskListView {
  void items
  void today
  void nowMs
  return { open: [], done: [], undone: 0 }
}

/** まだの行の並び（taskListView と同じ決まり。負なら a が上） */
export function compareOpenTasks(a: TaskRowView, b: TaskRowView): number {
  void a
  void b
  return 0
}

/** 済みの行の並び（doneAt の新しい順・id） */
export function compareDoneTasks(a: TaskRowView, b: TaskRowView): number {
  void a
  void b
  return 0
}

/** L の日付の列の字（TaskDateText） */
export function taskDateText(item: Item): TaskDateText {
  void item
  return { sub: null, main: '—', faint: true, aria: '' }
}

/**
 * M・S の上の行（D27）: Task List 生まれの1日 '〆11/20'、複数日 '11/10〜11/20'、④ '11/10〜'、①は依頼者だけか ''、
 * カレンダー生まれは '11/20'・'11/10〜11/20'（〆を付けない）。依頼者があれば '・{依頼者}' を足す
 */
export function taskStackedLine(item: Item): string {
  void item
  return ''
}

/** Task List の入力欄で入れた物（件名の字と［開始日］［締め切り日］［依頼者］。書きかけも同じ形。D23） */
export interface TaskEntry {
  text: string
  start: string | null
  due: string | null
  requester: string
}

/**
 * 入力欄から足す物（13.2）: Task List 生まれ・仕事・Task List に出す・ラベルなし（D33）。開始日と締め切り日は editDates と同じに
 * そろえる。件名が空・200字を超える時は足さずに理由を返す（字は欄に残す。D29）
 */
export function taskInputOf(entry: TaskEntry): { ok: true; input: ItemInput } | { ok: false; message: string } {
  void entry
  return { ok: false, message: '' }
}

/**
 * 日付の列のメニュー・［日付を決める］・入力欄の下の日付で日を直す時（itemInput.editDates を包む。6.3 のそろえ方・6.4 で断る時は
 * DATE_REFUSED）。Task List 生まれで締め切り日を消して Task List から外れていた物は、listed を true に戻して relisted（6.3 のお知らせ）。
 * カレンダー生まれは開始日を消せない
 */
export function taskDateEdit(
  item: Item,
  edit: { start?: string | null; due?: string | null },
): { ok: true; patch: Pick<Item, 'start' | 'due' | 'endTime' | 'listed'>; relisted: boolean } | { ok: false; message: string } {
  void item
  void edit
  return { ok: false, message: '' }
}

/** 日付の列のメニューで直す所（開始日・締め切り日） */
export type TaskDateField = 'start' | 'due'

/**
 * 日付の列のメニューの1つを押した時にすること: set はその日にする（今日・明日・今週金曜／来週金曜）、pick は小さな月の暦を開く
 * （［日付を選ぶ］。断られる日は選べない）、clear は消す（［なし］・カレンダー生まれの締め切り日の「1日の予定にする（締め切り日を消す）」）、
 * show は ［カレンダーで見る］（その日のデイリーへ、置き換えで移る。D24）
 */
export type TaskDateAction =
  | { type: 'set'; field: TaskDateField; date: string }
  | { type: 'pick'; field: TaskDateField }
  | { type: 'clear'; field: TaskDateField }
  | { type: 'show'; date: string }

/** 日付の列のメニューの1つ（refused: 押すと 6.4 で断られる速い選び。押すと DATE_REFUSED を4秒出して値は変えない。D30） */
export interface TaskDateOption {
  label: string
  action: TaskDateAction
  refused: boolean
}

/**
 * 日付の列のメニュー（13.5）。締め切り日: 今日・明日・今週金曜（土曜は来週金曜）・日付を選ぶ・なし（カレンダー生まれは
 * 「1日の予定にする（締め切り日を消す）」）。開始日: 日付を選ぶ・なし（カレンダー生まれは「なし」を出さない）。show は
 * ［カレンダーで見る］（カレンダーに出ている時だけ。to の日へ。無ければ null）。M・S は「…」の［日付…］から開く（D46）。
 * §3.2 で開いていた形はここで決めた: 項目ごとに字と押した時にすること（TaskDateAction）と断られるかを持つ
 */
export interface DateMenuModel {
  due: TaskDateOption[]
  start: TaskDateOption[]
  show: TaskDateOption | null
}

/** 日付の列のメニューの中身（DateMenuModel） */
export function taskDateMenu(item: Item, today: string): DateMenuModel {
  void item
  void today
  return { due: [], start: [], show: null }
}
