// 登録・詳細・複製の画面の入力の決まり（docs/SPEC.md の 6.3・6.4・12.2・12.4・12.7）。画面の入力をそろえるのは、ここ1か所だけ
// （src/domain/ops.ts の addItem はそろえない。updateItem は日付のそろえ方の一部だけ。そろえてから actions に渡す。ITEMS-194）。
// 日付の欄を決めた時は editDates、時刻の欄を決めた時は editTimes を、欄ごとに1回だけ当てる（両方を一度に当てない）。
// そうすると「最後に直した欄の決まりで決める」（時刻なら翌日にする、日付ならその日付にはできない。AMB-ITEMS-29）がそのまま守られる。
// 時刻は保存の形 'HH:MM'（'24:00' は終了だけ）で受け渡す。画面の表記（時の頭の 0 を落とす）は src/domain/dates.ts の displayHm で。
import { addDaysYmd, daysBetween, hmToMinutes, isHm, isYmd, minutesToHm, pad2 } from './dates'
import { periodOf } from './items'
import type { ItemKind, ItemOrigin } from './types'

/** 日付と時刻の欄（生まれで決まりが変わるので一緒に持つ） */
export interface When {
  origin: ItemOrigin
  start: string | null
  due: string | null
  startTime: string | null
  endTime: string | null
}

/**
 * 欄を決めた結果。ok の時は、そろえた後の値（そのまま actions に渡せる）と、入力欄の下に出す文（翌日にした時の「翌日 02:00 まで」。
 * 無ければ null）。ok でない時は、その値にはできない理由（日付の欄の下に出して、元の値に戻す）
 */
export type WhenResult = { ok: true; when: When; hint: string | null } | { ok: false; message: string }

/** 日付を動かして、1日の予定で終了 < 開始になる時の文（6.4・CALENDAR-043・ITEMS-222） */
export const DATE_REFUSED = '終わりの時刻が始まりより早いので、この日付にはできません（先に時刻を直してください）'

const START_REQUIRED = 'カレンダーの予定には開始日が要ります'
const BAD_DATE = '日付の形が正しくありません'
const BAD_TIME = '時刻の形が正しくありません'
const NO_24_START = '開始時刻に 24:00 は使えません'

/** 1日の予定の時刻を翌日までにした時の文（「翌日 02:00 まで」。6.4・CALENDAR-040・ITEMS-231） */
export function nextDayHint(endTime: string): string {
  return `翌日 ${endTime} まで`
}

/** 渡した欄のうち keys の物だけを重ねる（undefined は「渡していない」。日付の欄の決まりで時刻を、時刻の欄の決まりで日付を変えない） */
function merge(cur: When, patch: Partial<When>, keys: readonly (keyof When)[]): When {
  const next = { ...cur }
  for (const k of keys) if (patch[k] !== undefined) Object.assign(next, { [k]: patch[k] })
  return next
}

/** カレンダーに出る期間が1日か（list 生まれで締め切り日の無い物は期間が無いので、1日ではない） */
function oneDay(w: When): boolean {
  const p = periodOf(w)
  return p !== null && p.from === p.to
}

/**
 * 日付の欄を決めた（6.3・6.4・12.4）。
 * - 開始日を締め切り日より後にしたら締め切り日を開始日に、締め切り日を開始日より前にしたら開始日を締め切り日にそろえる（1日の予定になる。
 *   list 生まれも同じ。CALENDAR-018..020）。両方を一度に渡して開始日が後なら、締め切り日を開始日にそろえる
 * - 締め切り日を消すと、calendar 生まれは開始日の1日の予定に、list 生まれはカレンダーから外れる（時刻は消さずに残す。ITEMS-213・272）
 * - calendar 生まれの開始日は消せない（ITEMS-225）
 * - そろえた結果、1日の予定で終了 < 開始になる時は、その日付にはできない（DATE_REFUSED。翌日にはしない。CALENDAR-023・041・042）
 * - 1日の予定で終了 = 開始になる時は、終了時刻を空にする（複数日の予定ではそのまま。CALENDAR-022・D36）
 */
export function editDates(cur: When, patch: Partial<Pick<When, 'start' | 'due'>>): WhenResult {
  const next = merge(cur, patch, ['start', 'due'])
  if ((next.start !== null && !isYmd(next.start)) || (next.due !== null && !isYmd(next.due))) {
    return { ok: false, message: BAD_DATE }
  }
  if (next.origin === 'calendar' && next.start === null) return { ok: false, message: START_REQUIRED }
  if (next.start !== null && next.due !== null && next.start > next.due) {
    if (patch.start !== undefined) next.due = next.start
    else next.start = next.due
  }
  if (next.startTime !== null && next.endTime !== null && oneDay(next)) {
    const st = hmToMinutes(next.startTime)
    const et = hmToMinutes(next.endTime)
    if (et < st) return { ok: false, message: DATE_REFUSED }
    if (et === st) next.endTime = null
  }
  return { ok: true, when: next, hint: null }
}

/**
 * 時刻の欄を決めた（6.4・12.4）。渡さなかった欄は今の値のまま（何も渡さなければ、今の値をこの決まりでそろえる。登録の画面の［登録］の時）。
 * - 開始時刻を空にすると終了時刻も消す。開始時刻の無い終了時刻は持てない（CALENDAR-037・ITEMS-229）
 * - 開始時刻に 24:00 は使えない（CALENDAR-033）
 * - 終了に 00:00 は「締め切り日が始まる 0時」と読む: 1日の予定は 24:00（翌日にしない）、複数日の予定は締め切り日を1日前にして 24:00
 *   （前の日が開始日なら1日の予定になる。CALENDAR-035・038・AMB-ITEMS-04）
 * - 1日の予定で終了 = 開始なら終了時刻を空に（CALENDAR-022・ITEMS-233）。複数日の予定ではそのまま（D36）
 * - 1日の予定で終了 < 開始なら翌日までの2日の予定にし（calendar 生まれは締め切り日 = 開始日の翌日、list 生まれは開始日 = 元の締め切り日・
 *   締め切り日 = その翌日）、hint に「翌日 02:00 まで」を返す（CALENDAR-039・040・ITEMS-230・231）
 * - カレンダーに出ていない list 生まれ（①④）は期間が無いので、終了の 00:00 を 24:00 と読むだけ（時刻はそのまま残す。ITEMS-213）
 */
export function editTimes(cur: When, patch: Partial<Pick<When, 'startTime' | 'endTime'>>): WhenResult {
  const next = merge(cur, patch, ['startTime', 'endTime'])
  if (next.startTime === null) next.endTime = null
  if (next.startTime === '24:00') return { ok: false, message: NO_24_START }
  if (next.startTime !== null && !isHm(next.startTime)) return { ok: false, message: BAD_TIME }
  if (next.endTime !== null && !isHm(next.endTime, true)) return { ok: false, message: BAD_TIME }
  if (next.endTime === '00:00') {
    next.endTime = '24:00'
    const p = periodOf(next)
    if (p && p.from < p.to) next.due = addDaysYmd(p.to, -1)
  }
  let hint: string | null = null
  if (next.startTime !== null && next.endTime !== null && oneDay(next)) {
    const st = hmToMinutes(next.startTime)
    const et = hmToMinutes(next.endTime)
    if (et === st) next.endTime = null
    else if (et < st) {
      const day = periodOf(next)!.from
      if (next.origin === 'list') next.start = day
      next.due = addDaysYmd(day, 1)
      hint = nextDayHint(next.endTime)
    }
  }
  return { ok: true, when: next, hint }
}

/**
 * 打った時刻を読む（12.2・AMB-ITEMS-07）。全角の数字・「：」も読み（NFKC）、`H`・`HH`（時だけ）・`H:MM`・`HH:MM`・`HMM`・`HHMM` を受ける。
 * 空は null（時刻なし）、読めない・範囲の外は undefined（元の値に戻して理由を出す）。24:00 は終了だけ。終了の 0:00 は '00:00' のまま返す
 * （1日の予定か複数日の予定かで読み方が変わるので、editTimes が決める）
 */
export function parseTime(text: string, which: 'start' | 'end'): string | null | undefined {
  const s = text.normalize('NFKC').trim()
  if (s === '') return null
  let h: number
  let m: number
  const colon = /^(\d{1,2})(?::(\d{2}))?$/.exec(s)
  if (colon) {
    h = Number(colon[1])
    m = colon[2] === undefined ? 0 : Number(colon[2])
  } else if (/^\d{3,4}$/.test(s)) {
    h = Number(s.slice(0, -2))
    m = Number(s.slice(-2))
  } else return undefined
  if (m > 59) return undefined
  if (h === 24 && m === 0) return which === 'end' ? '24:00' : undefined
  if (h > 23) return undefined
  return `${pad2(h)}:${pad2(m)}`
}

const STEP_MIN = 5

/**
 * 時刻の一覧（5分刻み。12.2・CALENDAR-044）。開始は 00:00〜23:55、終了は 00:05〜23:55 と最後に 24:00
 * （0:00 は 24:00 と同じ意味になるので終了の一覧には置かない。AMB-ITEMS-06）
 */
export function timeOptions(which: 'start' | 'end'): string[] {
  const out: string[] = []
  for (let m = which === 'start' ? 0 : STEP_MIN; m < 1440; m += STEP_MIN) out.push(minutesToHm(m))
  if (which === 'end') out.push('24:00')
  return out
}

/** 一覧の中で、その時刻の所（5分に切り捨て、一覧の端にそろえる） */
function snapToOption(which: 'start' | 'end', minute: number): string {
  const first = which === 'start' ? 0 : STEP_MIN
  const last = which === 'start' ? 1440 - STEP_MIN : 1440
  return minutesToHm(Math.min(last, Math.max(first, Math.floor(minute / STEP_MIN) * STEP_MIN)))
}

/**
 * 時刻の一覧を開いた時に見せる所（AMB-ITEMS-07）: 値があればその値の所、終了で値が無く開始がある時は開始の1時間後の所（24:00 まで）、
 * ほかは 9:00 の所。返す値はいつも timeOptions(which) の中の1つ（打った 9:07 は 9:05 の所）
 */
export function timeListAnchor(which: 'start' | 'end', value: string | null, startTime: string | null): string {
  if (value !== null && isHm(value, which === 'end')) return snapToOption(which, hmToMinutes(value))
  if (which === 'end' && startTime !== null && isHm(startTime)) return snapToOption(which, hmToMinutes(startTime) + 60)
  return '09:00'
}

/**
 * 登録の画面（12.2）の初めの値。start は開始日（デイリーからはその日、ほかは今日）、kind は開いた場所で決まる時の区分（無ければ仕事。
 * ITEMS-002・D50）、startTime・endTime はタイムスケジュールの空いた所を押した時の時刻、title・memo は段階3の Favorite の「予定にする」から。
 * src/features/calendar/common/types.ts の RegisterInit と同じ形（src/domain は features を読まないので、ここにも置く）
 */
export interface RegisterInit {
  start: string
  kind?: ItemKind
  startTime?: string
  endTime?: string
  title?: string
  memo?: string
}

/** 登録の画面の初めの値（calendar 生まれ・締め切り日は空。時刻は 6.4 でそろえる。12.2） */
export function registerDefaults(init: RegisterInit): When & { kind: ItemKind; title: string; memo: string } {
  const base: When = {
    origin: 'calendar',
    start: init.start,
    due: null,
    startTime: init.startTime ?? null,
    endTime: init.endTime ?? null,
  }
  const r = editTimes(base, {})
  const when = r.ok ? r.when : { ...base, startTime: null, endTime: null }
  return { ...when, kind: init.kind ?? 'work', title: init.title ?? '', memo: init.memo ?? '' }
}

/**
 * 複製する日を選ぶ小さな画面で、開始日を選んだ時の日付（12.7・ITEMS-255）。元が複数日の予定なら、締め切り日を元と同じ日数になるよう入れる
 * （11/10〜11/12 の予定で 11/17 を選ぶと 11/17〜11/19。直せる）。元が1日の予定（とカレンダーに出ていない物）は締め切り日を入れない（null）。
 * 開始日を空にした時は両方 null
 */
export function duplicateDates(src: When, pickedStart: string | null): { start: string | null; due: string | null } {
  if (pickedStart === null || !isYmd(pickedStart)) return { start: null, due: null }
  const p = periodOf(src)
  if (!p || p.from === p.to) return { start: pickedStart, due: null }
  return { start: pickedStart, due: addDaysYmd(pickedStart, daysBetween(p.from, p.to)) }
}

/**
 * 字数の上限で切る（件名 200字・依頼者 60字。上限を超えて打てない・貼れない。コードポイントで数える: 絵文字 200字は入り、201字は入らない。
 * 12.4・ITEMS-003・237）。入力欄の maxLength は UTF-16 で数えるので使わない
 */
export function limitChars(text: string, max: number): string {
  const chars = Array.from(text)
  return chars.length <= max ? text : chars.slice(0, max).join('')
}
