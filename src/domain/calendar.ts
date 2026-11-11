// カレンダーに出す項目の選び方と並び（docs/SPEC.md の 6.3・7.5・7.6・7.9・8.2・11.2・11.3）。ウィークリー・デイリー・イヤーの
// 画面と、その見た目の計算（*Model.ts）が使う。画面は表示用に直した記録（useData()。6.12 の修復を通した物）を渡す（知らない kind は
// 仕事、calendar 生まれで start が無い物は due か createdAt の日として、もう直っている）。
// 日付は 'YYYY-MM-DD' の文字のまま比べる（Date の暦を使わないので、端末の時差を変えても予定の日はずれない。6.4）。
// マンスリーの数は src/domain/items.ts の monthCounts・countOn・formatCount を使う（ここでは数え直さない）。
import { compareYmd, eachDate, hmToMinutes, isYmd, weekDates, yearRange } from './dates'
import { periodOf } from './items'
import { ITEM_KINDS, type AppData, type ID, type Item, type ItemKind } from './types'

/** カレンダーに出る項目と、その期間（6.3。from〜to は両端を含む） */
export interface CalItem {
  item: Item
  from: string
  to: string
  /** 複数日の予定（from < to） */
  multi: boolean
  /** 時刻のある予定（startTime がある） */
  timed: boolean
}

/**
 * カレンダーに出る項目（6.3）: calendar 生まれか、締め切り日のある list 生まれ。① list 生まれ・日付なしと ④ 開始日だけは出ない。
 * ゴミ箱の物は data.items に無いので出ない。並びは期間の初めの日 → 作った順（order → id）
 */
export function calendarItems(items: Readonly<Record<ID, Item>>): CalItem[] {
  const out: CalItem[] = []
  for (const item of Object.values(items)) {
    const p = periodOf(item)
    if (!p) continue
    out.push({ item, from: p.from, to: p.to, multi: p.from < p.to, timed: item.startTime !== null })
  }
  return out.sort((a, b) => compareYmd(a.from, b.from) || byOrder(a, b))
}

/** 期間が from〜to（両端を含む）に掛かる物 */
export function overlapping(list: readonly CalItem[], from: string, to: string): CalItem[] {
  return list.filter((c) => c.from <= to && c.to >= from)
}

// ---------- 同じ日の中の並び（7.5） ----------

/** 開始時刻だけの予定は「開始 + 30分」（24:00 まで）として比べる（11.3 の枠の終わりと同じ。開発） */
const START_ONLY_MINUTES = 30

/** 作った順（order の小さい順。同じ値は id の小さい順。どの端末でも同じ並び。6.1） */
function byOrder(a: CalItem, b: CalItem): number {
  const d = a.item.order - b.item.order
  if (d) return d
  return a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0
}

/** 並びの組: ① 複数日 → ② 時刻のある1日 → ③ 時刻の無い1日 */
const group = (c: CalItem): number => (c.multi ? 0 : c.timed ? 1 : 2)

const startMinutes = (c: CalItem): number => (c.item.startTime ? hmToMinutes(c.item.startTime) : 0)

function endMinutes(c: CalItem): number {
  if (c.item.endTime) return hmToMinutes(c.item.endTime)
  return Math.min(startMinutes(c) + START_ONLY_MINUTES, 1440)
}

/**
 * 7.5 の並び: 完了していない物 → 完了した物（④。中は同じ決まり）。それぞれの中は
 * ① 複数日（開始日の早い順 → 締め切り日の遅い順 → 作った順）→ ② 時刻のある1日（開始時刻 → 終了時刻 → 作った順）→
 * ③ 時刻の無い1日（作った順）
 */
function compareInDay(a: CalItem, b: CalItem): number {
  if (a.item.done !== b.item.done) return a.item.done ? 1 : -1
  const g = group(a) - group(b)
  if (g) return g
  if (a.multi) return compareYmd(a.from, b.from) || compareYmd(b.to, a.to) || byOrder(a, b)
  if (a.timed) return startMinutes(a) - startMinutes(b) || endMinutes(a) - endMinutes(b) || byOrder(a, b)
  return byOrder(a, b)
}

/**
 * ウィークリーの1日の予定の並び（複数日の予定はレーンに入れるので、ここには来ない。7.5・7.8）:
 * 時刻のある物（開始 → 終了。終了の無い物は開始 + 30分）→ 時刻の無い物（作った順）→ 完了した物（同じ決まりで）
 */
export function compareSingles(a: CalItem, b: CalItem): number {
  return compareInDay(a, b)
}

/**
 * デイリーのリストの並び（時刻の無い物だけ。7.5・11.2）: 複数日（開始日の早い順 → 締め切り日の遅い順 → 作った順）→
 * 1日の予定（作った順）→ 完了した物（同じ決まりで。完了した複数日は完了した物の先頭）
 */
export function compareDayList(a: CalItem, b: CalItem): number {
  return compareInDay(a, b)
}

// ---------- ウィークリー ----------

/** その週（日曜〜土曜）の、その区分の1日の予定（日付 → 7.5 の順。完了した物も含む。予定の無い日は空の配列） */
export function weekSingles(list: readonly CalItem[], sunday: string, kind: ItemKind): Record<string, CalItem[]> {
  const out: Record<string, CalItem[]> = {}
  for (const d of weekDates(sunday)) out[d] = []
  for (const c of list) {
    if (c.multi || c.item.kind !== kind) continue
    out[c.from]?.push(c)
  }
  for (const d in out) out[d].sort(compareSingles)
  return out
}

// ---------- デイリー ----------

/** デイリーのリストの行: 1日の予定・複数日の初日・間の日・最終日（11.2 の右の端の表記と「‹ 」の受けた表示を決める） */
export interface DayRow {
  c: CalItem
  role: 'single' | 'first' | 'middle' | 'last'
}

const roleOn = (c: CalItem, date: string): DayRow['role'] =>
  !c.multi ? 'single' : date === c.from ? 'first' : date === c.to ? 'last' : 'middle'

/**
 * デイリーの時間指定なしのリスト（11.2）: その区分の、期間にこの日が入る、時刻の無い項目（時刻の無い複数日の予定を含む）。
 * 時刻のある物はタイムスケジュールへ（dayTimed）。完了した物も含む。並びは 7.5
 */
export function dayList(list: readonly CalItem[], date: string, kind: ItemKind): DayRow[] {
  return list
    .filter((c) => !c.timed && c.item.kind === kind && c.from <= date && date <= c.to)
    .sort(compareDayList)
    .map((c) => ({ c, role: roleOn(c, date) }))
}

/** デイリーのタイムスケジュールに出す物（11.3）: 期間にこの日が入る、時刻のある項目（区分は混ぜる。日をまたぐ物を含む） */
export function dayTimed(list: readonly CalItem[], date: string): CalItem[] {
  return list.filter((c) => c.timed && c.from <= date && date <= c.to).sort(compareInDay)
}

/**
 * デイリーの区切りの見出しの数（11.2）: その日・その区分の、まだ完了していない予定の全部（時刻のある物も含む）。
 * マンスリーのその日の数（countOn）と同じ
 */
export function dayUndone(list: readonly CalItem[], date: string, kind: ItemKind): number {
  let n = 0
  for (const c of list) if (!c.item.done && c.item.kind === kind && c.from <= date && date <= c.to) n++
  return n
}

// ---------- イヤー ----------

/** イヤーの●（8.2）: 予定なし・まだ完了していない物がある・全部完了（不透明度 0.35。7.9） */
export type DotState = 'none' | 'open' | 'allDone'

/**
 * イヤーの日ごと・区分ごとの●（完了した物も含めて見る。7.9・8.2）。予定のある日だけを持つ（無い日は両方 'none'）。
 * 複数日の予定は期間中の毎日（月・年の境をまたいでも、その年の中の日だけ）
 */
export function yearDots(list: readonly CalItem[], y: number): Map<string, Record<ItemKind, DotState>> {
  const { from, to } = yearRange(y)
  const out = new Map<string, Record<ItemKind, DotState>>()
  for (const c of list) {
    const kind = c.item.kind
    if (!ITEM_KINDS.includes(kind) || c.to < from || c.from > to) continue
    for (const d of eachDate(c.from < from ? from : c.from, c.to > to ? to : c.to)) {
      let dots = out.get(d)
      if (!dots) {
        dots = { work: 'none', private: 'none' }
        out.set(d, dots)
      }
      if (!c.item.done) dots[kind] = 'open'
      else if (dots[kind] === 'none') dots[kind] = 'allDone'
    }
  }
  return out
}

// ---------- 休み ----------

/** 休みの日（off が true の物だけ。外した日の記録は残っているが休みではない。6.5） */
export function offDaySet(offDays: AppData['offDays']): ReadonlySet<string> {
  const out = new Set<string>()
  for (const r of Object.values(offDays)) if (r.off === true && isYmd(r.date)) out.add(r.date)
  return out
}
