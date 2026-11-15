// Task List（docs/SPEC.md の 13.・6.3・6.4）の決まり: 4通り（①なし・②締め切り日だけ・③両方・④開始日だけ）とカレンダー生まれの見分け、
// 行に出す物（日付の列の字・M・S の上の行・期限切れ・今日）、並び（13.4）、済みと 168時間で隠す決まり、入力欄から足す物、
// 日付を直す時の決まり、日付の列のメニュー（13.5）。画面は表示用に直した記録（useData()。6.12）を渡す。
// カレンダーに出るか・期間・Task List に出るかは items.ts（isOnCalendar・periodOf・isInTaskList）、日付のそろえ方と 6.4 で断る決まりは
// itemInput.ts（editDates）をそのまま使う（ここで決め直さない）。
// 日付は 'YYYY-MM-DD' の文字のまま比べる。today は端末の暦の今日（useToday()。リストごとに1つ）、nowMs は今（useNow(60秒)。
// Task List の 168時間だけに使う）
import { addDaysYmd, isYmd, mdLabel } from './dates'
import { editDates, type When } from './itemInput'
import { REQUESTER_LIMIT_TEXT, TITLE_RANGE_TEXT, fullDateLabel, taskDateMenuText } from './itemText'
import { isInTaskList, periodOf } from './items'
import { fridayOf, splitEntry } from './listText'
import type { ItemInput } from './ops'
import { LIMITS, type ID, type Item } from './types'
import { charCount, compareStr } from './util'

/** ① none（日付なし）・② due（締め切り日だけ）・③ span（開始日と締め切り日）・④ start（開始日だけ）は Task List 生まれ（6.3）。
 * calendar はカレンダー生まれで Task List にも出している物 */
export type TaskCase = 'none' | 'due' | 'span' | 'start' | 'calendar'

/** その予定の通り（Task List 生まれは日付の持ち方で4通り、カレンダー生まれは calendar） */
export function taskCaseOf(item: Pick<Item, 'origin' | 'start' | 'due'>): TaskCase {
  if (item.origin !== 'list') return 'calendar'
  const start = isYmd(item.start)
  if (!isYmd(item.due)) return start ? 'start' : 'none'
  return start ? 'span' : 'due'
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
  const open: TaskRowView[] = []
  const done: TaskRowView[] = []
  for (const item of items) {
    if (!isInTaskList(item, nowMs)) continue
    const row = taskRowView(item, today)
    ;(row.done ? done : open).push(row)
  }
  open.sort(compareOpenTasks)
  done.sort(compareDoneTasks)
  return { open, done, undone: open.length }
}

/** 1行に出す物（Task List に出るかは見ない。taskListView が isInTaskList で選んだ物に使う） */
export function taskRowView(item: Item, today: string): TaskRowView {
  const p = periodOf(item)
  const to = p ? p.to : null
  const done = item.done === true
  return {
    id: item.id,
    item,
    case: taskCaseOf(item),
    onCalendar: p !== null,
    to,
    date: taskDateText(item),
    stackedLine: taskStackedLine(item),
    overdue: to !== null && to < today && !done,
    today: to === today,
    done,
    canDecideDate: item.origin === 'list' && p === null,
    canUnlist: p !== null,
  }
}

/** 日時の数（数でない・有限でない値は 0。表示用に直した記録では起きないが、並びを壊さないため） */
const ms = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/** まだの行の並び（taskListView と同じ決まり。負なら a が上） */
export function compareOpenTasks(a: TaskRowView, b: TaskRowView): number {
  if (a.to !== null && b.to !== null) {
    return compareStr(a.to, b.to) || ms(a.item.createdAt) - ms(b.item.createdAt) || compareStr(a.id, b.id)
  }
  if (a.to !== null) return -1
  if (b.to !== null) return 1
  return ms(b.item.createdAt) - ms(a.item.createdAt) || compareStr(a.id, b.id)
}

/** 済みの行の並び（doneAt の新しい順・id。doneAt の無い物はいちばん古い扱い） */
export function compareDoneTasks(a: TaskRowView, b: TaskRowView): number {
  return ms(b.item.doneAt) - ms(a.item.doneAt) || compareStr(a.id, b.id)
}

/** L の日付の列の字（TaskDateText）。aria は「2026年11月20日（金）」・「2026年11月10日（火）〜2026年11月20日（金）」・「…から」・「日付なし」 */
export function taskDateText(item: Item): TaskDateText {
  const p = periodOf(item)
  if (p && p.from === p.to) return { sub: null, main: mdLabel(p.to), faint: false, aria: fullDateLabel(p.to) }
  if (p) {
    return {
      sub: `${mdLabel(p.from)}〜`,
      main: mdLabel(p.to),
      faint: false,
      aria: `${fullDateLabel(p.from)}〜${fullDateLabel(p.to)}`,
    }
  }
  if (isYmd(item.start))
    return { sub: null, main: `${mdLabel(item.start)}〜`, faint: false, aria: `${fullDateLabel(item.start)}から` }
  return { sub: null, main: '—', faint: true, aria: '日付なし' }
}

/**
 * M・S の上の行の2つの部分（日付の所と依頼者）。期限切れの色と太字は日付の所だけに付ける（D27）ので、画面はこれで分けて出す。
 * どちらも無ければ ''
 */
export function taskStackedParts(item: Item): { date: string; requester: string } {
  const requester = typeof item.requester === 'string' ? item.requester.trim() : ''
  const p = periodOf(item)
  let date = ''
  if (p) {
    const oneDay = p.from === p.to
    const range = oneDay ? mdLabel(p.to) : `${mdLabel(p.from)}〜${mdLabel(p.to)}`
    date = item.origin === 'list' && oneDay ? `〆${range}` : range
  } else if (isYmd(item.start)) date = `${mdLabel(item.start)}〜`
  return { date, requester }
}

/**
 * M・S の上の行（D27）: Task List 生まれの1日 '〆11/20'、複数日 '11/10〜11/20'、④ '11/10〜'、①は依頼者だけか ''、
 * カレンダー生まれは '11/20'・'11/10〜11/20'（〆を付けない）。依頼者があれば '・{依頼者}' を足す
 */
export function taskStackedLine(item: Item): string {
  const { date, requester } = taskStackedParts(item)
  return [date, requester].filter((x) => x !== '').join('・')
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
 * そろえる。件名（最初の空でない行。前後の空白を除いて数える）が空・200字を超える時、依頼者が 60字を超える時は足さずに理由を返す
 * （字は欄に残す。D29）。2行目からはメモ（listText.splitEntry）
 */
export function taskInputOf(entry: TaskEntry): { ok: true; input: ItemInput } | { ok: false; message: string } {
  const parts = splitEntry(entry.text)
  if (!parts || charCount(parts.title) > LIMITS.title) return { ok: false, message: TITLE_RANGE_TEXT }
  const requester = entry.requester.trim()
  if (charCount(requester) > LIMITS.requester) return { ok: false, message: REQUESTER_LIMIT_TEXT }
  const r = editDates(NO_DATES, { start: entry.start, due: entry.due })
  if (!r.ok) return r
  return {
    ok: true,
    input: {
      origin: 'list',
      title: parts.title,
      kind: 'work',
      start: r.when.start,
      due: r.when.due,
      startTime: null,
      endTime: null,
      listed: true,
      locked: false,
      label: null,
      requester,
      memo: parts.memo,
    },
  }
}

/** 入力欄の日付の初め（list 生まれ・日付も時刻も無い） */
const NO_DATES: When = { origin: 'list', start: null, due: null, startTime: null, endTime: null }

/**
 * 入力欄の下の［開始日］［締め切り日］で日を選んだ・×で外した時の書きかけ（13.2）: 6.3 のそろえ方（開始日を締め切り日より後にしたら
 * 締め切り日を開始日に、締め切り日を開始日より前にしたら開始日を締め切り日に）を当てる。時刻を持たないので 6.4 で断られることは無い
 * （日付の形が正しくない時だけ、今の書きかけのまま）
 */
export function taskEntryWithDates(entry: TaskEntry, edit: { start?: string | null; due?: string | null }): TaskEntry {
  const r = editDates({ ...NO_DATES, start: entry.start, due: entry.due }, edit)
  return r.ok ? { ...entry, start: r.when.start, due: r.when.due } : entry
}

/**
 * 日付の列のメニュー・［日付を決める］・入力欄の下の日付で日を直す時（itemInput.editDates を包む。6.3 のそろえ方・6.4 で断る時は
 * DATE_REFUSED）。Task List 生まれで締め切り日を消して Task List から外れていた物は、listed を true に戻して relisted（6.3 のお知らせ。
 * 締め切り日がもともと無かった物は、listed を true にするだけでお知らせは出さない）。カレンダー生まれは開始日を消せない
 */
export function taskDateEdit(
  item: Item,
  edit: { start?: string | null; due?: string | null },
): { ok: true; patch: Pick<Item, 'start' | 'due' | 'endTime' | 'listed'>; relisted: boolean } | { ok: false; message: string } {
  const when: When = {
    origin: item.origin === 'list' ? 'list' : 'calendar',
    start: item.start,
    due: item.due,
    startTime: item.startTime,
    endTime: item.endTime,
  }
  const r = editDates(when, edit)
  if (!r.ok) return r
  // 締め切り日の無い Task List 生まれは、いつも Task List に出す（どこにも出ない項目を作らない。ops.updateItem と同じ）
  const back = item.origin === 'list' && r.when.due === null
  // お知らせを出すのは、この直しで締め切り日が消えてカレンダーから外れ、Task List から外していた物を戻した時だけ
  const relisted = back && isYmd(item.due) && !item.listed
  return {
    ok: true,
    patch: { start: r.when.start, due: r.when.due, endTime: r.when.endTime, listed: back ? true : item.listed },
    relisted,
  }
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
 * 項目ごとに字と押した時にすること（TaskDateAction）と断られるかを持つ。
 * 「なし」（clear）はその日付がある時だけ、カレンダー生まれの「1日の予定にする」は複数日の時だけ出す（消しても何も変わらない物は
 * 出さない。開発）。refused は今日・明日・金曜・なしを
 * taskDateEdit に通して断られる物（1日の予定で終了 < 開始になる。6.4・D30）。［日付を選ぶ］は断られる日を暦の側で選べなくする
 */
export interface DateMenuModel {
  due: TaskDateOption[]
  start: TaskDateOption[]
  show: TaskDateOption | null
}

/** 日付の列のメニューの中身（DateMenuModel） */
export function taskDateMenu(item: Item, today: string): DateMenuModel {
  const list = item.origin === 'list'
  const opt = (label: string, action: TaskDateAction): TaskDateOption => ({ label, action, refused: refusedBy(item, action) })
  const p = periodOf(item)
  const due = quickDueOptions(today).map((o) => opt(o.label, o.action))
  due.push(opt(taskDateMenuText.pick, { type: 'pick', field: 'due' }))
  // カレンダー生まれの「1日の予定にする」は、複数日の時だけ（締め切り日が開始日と同じ1日の物は、消しても何も変わらない）
  if (item.due !== null && (list || (p !== null && p.from !== p.to)))
    due.push(opt(list ? taskDateMenuText.none : taskDateMenuText.oneDay, { type: 'clear', field: 'due' }))
  const start = [opt(taskDateMenuText.pick, { type: 'pick', field: 'start' })]
  if (list && item.start !== null) start.push(opt(taskDateMenuText.none, { type: 'clear', field: 'start' }))
  const show: TaskDateOption | null = p
    ? { label: taskDateMenuText.show, action: { type: 'show', date: p.to }, refused: false }
    : null
  return { due, start, show }
}

/** 締め切り日の速い選び（今日・明日・今週金曜／来週金曜） */
function quickDueOptions(today: string): { label: string; action: TaskDateAction }[] {
  const fri = fridayOf(today)
  return [
    { label: taskDateMenuText.today, action: { type: 'set', field: 'due', date: today } },
    { label: taskDateMenuText.tomorrow, action: { type: 'set', field: 'due', date: addDaysYmd(today, 1) } },
    { label: fri.label, action: { type: 'set', field: 'due', date: fri.date } },
  ]
}

/** その選びを押すと 6.4 などで断られるか（set・clear だけ。pick・show は断られない） */
function refusedBy(item: Item, a: TaskDateAction): boolean {
  if (a.type === 'set') return !taskDateEdit(item, { [a.field]: a.date }).ok
  if (a.type === 'clear') return !taskDateEdit(item, { [a.field]: null }).ok
  return false
}

/**
 * 入力欄の下の［開始日］［締め切り日］の選び（13.2）: 開始日は 今日・明日・日付を選ぶ、締め切り日は 今日・明日・今週金曜（土曜は
 * 来週金曜）・日付を選ぶ。書きかけは時刻を持たないので断られる物は無い（refused はいつも false）。選んだ値は taskEntryWithDates で書きかけへ
 */
export function taskChipOptions(field: TaskDateField, today: string): TaskDateOption[] {
  const quick: { label: string; action: TaskDateAction }[] =
    field === 'due'
      ? quickDueOptions(today)
      : [
          { label: taskDateMenuText.today, action: { type: 'set', field: 'start', date: today } },
          { label: taskDateMenuText.tomorrow, action: { type: 'set', field: 'start', date: addDaysYmd(today, 1) } },
        ]
  quick.push({ label: taskDateMenuText.pick, action: { type: 'pick', field } })
  return quick.map((o) => ({ ...o, refused: false }))
}
