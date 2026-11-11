// 暦の日付の計算（docs/SPEC.md の 2.9・6.4・7.1）。日付は端末の現地の暦の日付（壁時計の値。時差では動かさない）、
// 週は日曜〜土曜、日の変わり目は端末の 0時。
// 段階0は画面の枠（カレンダーの操作の列・空のマンスリーのマス目・ログインの画面の日付・今日の印）に要る分、
// 段階1で 'YYYY-MM-DD'・'HH:MM'・'YYYY-MM' の文字の日付の道具と、無料枠の戻る時刻（2.8）を足した。
// 段階2でカレンダーの日付の範囲（週・月・年・毎日）と表記（「11/9」「11月10日（火）」「2026.11.10」・時刻の頭の 0 を落とす）を足した

/** 暦の日付（端末の現地の日付。m は 1〜12） */
export interface Ymd {
  y: number
  m: number
  d: number
}

/** 曜日の英字3文字（日曜始まり。docs/SPEC.md の 4.4・7.1） */
export const WEEKDAYS_EN = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const
/** 読み上げの曜日（「（火）」） */
export const WEEKDAYS_JA = ['日', '月', '火', '水', '木', '金', '土'] as const
/** 月の英字3文字 */
export const MONTHS_EN = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'] as const

/** 2桁にそろえる（11.08 の 08 など） */
export const pad2 = (n: number): string => String(n).padStart(2, '0')

/** 今の時刻の、端末の現地の暦の日付（今日・doneOn など「今」を暦の日付にする所だけで使う） */
const fromDate = (date: Date): Ymd => ({ y: date.getFullYear(), m: date.getMonth() + 1, d: date.getDate() })

/**
 * 暦の計算（月の日数・曜日・日を足す）に使う、その日の UTC の 0時。暦の日付は壁時計の値なので（6.4）、端末の時差に左右されない
 * UTC で数える（端末の暦の Date では、日付変更線をまたいで飛んだ日（Pacific/Kiritimati の 1994-12-31 など）を作れず、
 * 月の日数・曜日がずれる）。setUTCFullYear なので 0〜99年も 1900年代に読み替えない。d は 0 や月の日数より大きくてもよい（繰り上がる）
 */
function utcDay(y: number, m: number, d: number): Date {
  const t = new Date(0)
  t.setUTCFullYear(y, m - 1, d)
  return t
}
const fromUtcDay = (t: Date): Ymd => ({ y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() })

/** 今日（端末の現地の日付） */
export function todayYmd(now: Date = new Date()): Ymd {
  return fromDate(now)
}

export function sameDay(a: Ymd, b: Ymd): boolean {
  return a.y === b.y && a.m === b.m && a.d === b.d
}

/** その月の日数（うるう年の2月は 29） */
export function daysInMonth(y: number, m: number): number {
  return utcDay(y, m + 1, 0).getUTCDate()
}

/** 曜日（0 = 日曜） */
export function weekdayOf(v: Ymd): number {
  return utcDay(v.y, v.m, v.d).getUTCDay()
}

export function addDays(v: Ymd, days: number): Ymd {
  return fromUtcDay(utcDay(v.y, v.m, v.d + days))
}

/** その日を含む週（日曜始まり）の日曜 */
export function weekStart(v: Ymd): Ymd {
  return addDays(v, -weekdayOf(v))
}

/** 月を移る。その日が移った先の月に無い時は、その月の最終日にする（1/31 → 2/28、2028/2/29 → 12か月後 → 2/28。docs/SPEC.md の 3.7） */
export function addMonths(v: Ymd, months: number): Ymd {
  const index = v.y * 12 + (v.m - 1) + months
  const y = Math.floor(index / 12)
  const m = (index % 12) + 1
  return { y, m, d: Math.min(v.d, daysInMonth(y, m)) }
}

/** 次の 0時（端末の現地の時刻）までのミリ秒。今日の計算し直しのタイマーに使う（docs/SPEC.md の 6.4） */
export function msUntilNextDay(now: Date = new Date()): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  return next.getTime() - now.getTime()
}

export interface MonthCell {
  date: Ymd
  /** 前後の月の日（日付だけを --numeral の色で出す。docs/SPEC.md の 9.1） */
  outside: boolean
}

/** マンスリーのマス目の日付: その月に掛かる週（日曜始まり）の数だけ、7日ずつの行（4〜6行。docs/SPEC.md の 9.1） */
export function monthWeeks(y: number, m: number): MonthCell[][] {
  const first = { y, m, d: 1 }
  const start = weekStart(first)
  const rows = Math.ceil((weekdayOf(first) + daysInMonth(y, m)) / 7)
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: 7 }, (_, c) => {
      const date = addDays(start, r * 7 + c)
      return { date, outside: date.m !== m }
    }),
  )
}

/** ログインの画面の今日の曜日と日付（「TUE · 2026.11.10」。docs/SPEC.md の 2.5） */
export function coverDateLabel(v: Ymd): string {
  return `${WEEKDAYS_EN[weekdayOf(v)]} · ${v.y}.${pad2(v.m)}.${pad2(v.d)}`
}

// ---------- 文字の日付（'YYYY-MM-DD'・'HH:MM'・'YYYY-MM'。段階1。docs/SPEC.md の 6.4） ----------
// 日付は端末の暦の 'YYYY-MM-DD'、時刻は 'HH:MM'（24時間・0埋め）、月は 'YYYY-MM' の文字で持つ。文字のまま比べると暦の順になる

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const HM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/
const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/

/** 'YYYY-MM-DD' を読む（形が違う・暦に無い日は null） */
export function parseYmd(s: unknown): Ymd | null {
  if (typeof s !== 'string') return null
  const m = YMD_RE.exec(s)
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null
  return { y, m: mo, d }
}

/** 正しい 'YYYY-MM-DD' か（2026-02-29 のような暦に無い日は違う） */
export function isYmd(s: unknown): s is string {
  return parseYmd(s) !== null
}

/** 正しい 'HH:MM' か。'24:00' は終了時刻だけに使えるので、allow24 の時だけ正しいとする（6.4） */
export function isHm(s: unknown, allow24 = false): s is string {
  if (typeof s !== 'string') return false
  return HM_RE.test(s) || (allow24 && s === '24:00')
}

/** 正しい 'YYYY-MM' か */
export function isMonth(s: unknown): s is string {
  return typeof s === 'string' && MONTH_RE.test(s)
}

/** 'YYYY-MM-DD' にする */
export function toYmd(v: Ymd): string {
  return `${String(v.y).padStart(4, '0')}-${pad2(v.m)}-${pad2(v.d)}`
}

/** 日時（Date.now() のミリ秒）の、端末の暦の日付（doneOn・ルーチンのチェックの日・依頼を作った日。6.4） */
export function ymdOfMs(ms: number): string {
  return toYmd(fromDate(new Date(ms)))
}

/** 今日の 'YYYY-MM-DD'（端末の暦） */
export function todayStr(nowMs: number = Date.now()): string {
  return ymdOfMs(nowMs)
}

/** 日付の比べ（a が前なら負。形の正しい 'YYYY-MM-DD' どうしは文字の比べと同じ） */
export function compareYmd(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** 日を足す（'YYYY-MM-DD'） */
export function addDaysYmd(s: string, days: number): string {
  const v = parseYmd(s)
  if (!v) throw new Error(`日付の形が違います: ${s}`)
  return toYmd(addDays(v, days))
}

/** 曜日（0 = 日曜。'YYYY-MM-DD'） */
export function weekdayOfYmd(s: string): number {
  const v = parseYmd(s)
  if (!v) throw new Error(`日付の形が違います: ${s}`)
  return weekdayOf(v)
}

/** 日付の月（'YYYY-MM'） */
export function monthOf(s: string): string {
  return s.slice(0, 7)
}

/** 月を足す（'YYYY-MM'。負の数で前の月） */
export function addMonthsToMonth(month: string, months: number): string {
  const y = Number(month.slice(0, 4))
  const m = Number(month.slice(5, 7))
  const index = y * 12 + (m - 1) + months
  return `${String(Math.floor(index / 12)).padStart(4, '0')}-${pad2((index % 12) + 1)}`
}

/** n か月前の月（今月の3か月前 = monthsBefore('2026-11', 3) = '2026-08'。月の束の境。6.11） */
export function monthsBefore(month: string, n: number): string {
  return addMonthsToMonth(month, -n)
}

/** その月の何日目かの日付（無ければその月の最終日。2027-02 の 31日 → 2027-02-28。14.3） */
export function dayInMonthClamped(y: number, m: number, d: number): string {
  return toYmd({ y, m, d: Math.min(d, daysInMonth(y, m)) })
}

/** 'HH:MM' の分（'24:00' は 1440） */
export function hmToMinutes(s: string): number {
  return Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5))
}

/** 日付の表記「11/10（火）」（ゴミ箱の場所・Claude の操作の記録） */
export function shortDateLabel(s: string): string {
  const v = parseYmd(s)
  if (!v) return s
  return `${v.m}/${v.d}（${WEEKDAYS_JA[weekdayOf(v)]}）`
}

// ---------- カレンダーの日付と時刻（段階2。docs/SPEC.md の 3.1・6.4・7.1・7.7・11.1・12.3） ----------
// カレンダーの画面は日付を 'YYYY-MM-DD' の文字のまま扱う（Ymd は今日を求める所だけ。toYmd で1回だけ文字にする）

/** 曜日の読み上げ（「日曜日」。7.1・4.12） */
export const WEEKDAYS_JA_LONG = ['日曜日', '月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日'] as const

/** 行き先（#/year/…）に使える年（3.1。外の年は今年へ直す）。祝日の表がある年（1970〜2050）とは別（src/domain/holidays.ts） */
export const ROUTE_YEARS = { from: 1900, to: 2199 } as const

/** 'YYYY-MM-DD' を読む（形が違えば投げる） */
function mustYmd(s: string): Ymd {
  const v = parseYmd(s)
  if (!v) throw new Error(`日付の形が違います: ${s}`)
  return v
}

/** 画面の時刻の表記（時の頭の 0 を落とす: '09:05' → '9:05'、'00:30' → '0:30'、'24:00' はそのまま。保存は 'HH:MM' のまま。7.7） */
export function displayHm(hm: string): string {
  return /^\d\d:\d\d$/.test(hm) && hm.startsWith('0') ? hm.slice(1) : hm
}

/** 分（0〜1440）を 'HH:MM' に（1440 は '24:00'。外の値は端にそろえ、端数は切り捨てる） */
export function minutesToHm(min: number): string {
  const m = Math.min(1440, Math.max(0, Math.floor(Number.isFinite(min) ? min : 0)))
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`
}

/** from から to までの日数（同じ日は 0、to が前なら負。時差・夏時間で狂わないよう暦の日付だけで数える） */
export function daysBetween(from: string, to: string): number {
  const a = mustYmd(from)
  const b = mustYmd(to)
  return Math.round((utcDay(b.y, b.m, b.d).getTime() - utcDay(a.y, a.m, a.d).getTime()) / 86_400_000)
}

/** from から to までの毎日（両端を含む。to が前なら空） */
export function eachDate(from: string, to: string): string[] {
  const n = daysBetween(from, to)
  const out: string[] = []
  for (let i = 0; i <= n; i++) out.push(addDaysYmd(from, i))
  return out
}

/** その日を含む週（日曜始まり）の日曜（'YYYY-MM-DD'。7.1） */
export function weekStartOf(date: string): string {
  return toYmd(weekStart(mustYmd(date)))
}

/** 日曜から土曜までの7日（年をまたぐ週も 2026-12-27〜2027-01-02 のように続く） */
export function weekDates(sunday: string): string[] {
  return eachDate(sunday, addDaysYmd(sunday, 6))
}

/** 月（'YYYY-MM'）の初めの日と最後の日 */
export function monthRange(ym: string): { from: string; to: string } {
  if (!isMonth(ym)) throw new Error(`月の形が違います: ${ym}`)
  const y = Number(ym.slice(0, 4))
  const m = Number(ym.slice(5, 7))
  return { from: `${ym}-01`, to: `${ym}-${pad2(daysInMonth(y, m))}` }
}

/** 年の 1月1日と 12月31日 */
export function yearRange(y: number): { from: string; to: string } {
  const yy = String(y).padStart(4, '0')
  return { from: `${yy}-01-01`, to: `${yy}-12-31` }
}

/** 月日の表記「11/9」（0 で埋めない。期間の表記・ウィークリーの見出し。7.7） */
export function mdLabel(date: string): string {
  const v = mustYmd(date)
  return `${v.m}/${v.d}`
}

/** 日本語の文の中の日付「11月10日（火）」（詳細の日付・マスの読み上げ。4.4・4.12） */
export function jaDateLabel(date: string): string {
  const v = mustYmd(date)
  return `${v.m}月${v.d}日（${WEEKDAYS_JA[weekdayOf(v)]}）`
}

/** 点で区切った日付「2026.11.10」（デイリーの日の見出し。11.1） */
export function dottedDate(date: string): string {
  const v = mustYmd(date)
  return `${String(v.y).padStart(4, '0')}.${pad2(v.m)}.${pad2(v.d)}`
}

// ---------- 無料枠の戻る時刻（2.8・18.4） ----------

/** Firestore の無料枠が戻る時刻のタイムゾーン（米国太平洋時間） */
export const QUOTA_TIME_ZONE = 'America/Los_Angeles'

/** その時刻の、あるタイムゾーンの壁時計の値をミリ秒にした物（UTC として読む） */
function wallMs(ms: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(new Date(ms))
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0)
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
}

/** 次の太平洋時間の 0時（ミリ秒。今がちょうど 0時なら次の日の 0時） */
export function nextQuotaResetMs(nowMs: number, timeZone: string = QUOTA_TIME_ZONE): number {
  const wall = new Date(wallMs(nowMs, timeZone))
  const midnight = Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate() + 1)
  // 壁時計の 0時を UTC に直す（時差は夏時間で変わるので、求めた時刻の時差でもう一度直す）
  const offsetAt = (ms: number) => wallMs(ms, timeZone) - ms
  let t = midnight - offsetAt(midnight)
  t = midnight - offsetAt(t)
  return t
}

/**
 * 無料枠が戻る時刻を、端末の時刻の 'HH:MM' で（「16:00 ごろに戻ります」。日本では 17:00、米国の夏時間の間は 16:00。2.8）。
 * displayTimeZone はテスト用（無い時は端末のタイムゾーン）
 */
export function quotaResumeAt(nowMs: number, displayTimeZone?: string): string {
  const t = nextQuotaResetMs(nowMs)
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    ...(displayTimeZone ? { timeZone: displayTimeZone } : {}),
  }).format(new Date(t))
}
