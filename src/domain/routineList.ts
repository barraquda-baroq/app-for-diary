// Routine List（docs/SPEC.md の 14.・6.7）の決まり: 種類ごとの5つのかたまり（毎日・毎週・毎月・四半期・毎年。いつもこの順）、
// かたまりごとの済み・数、行に出す指定の字（'月・木'・'25日'・'3/15'）、済みの行の「11/16（月）に戻ります」、［指定］で選ぶ物。
// 戻る日の決まりそのもの（14.3）は routines.ts（latestResetDay・nextResetDay・isRoutineDone）にあり、ここはそれを使う。
// 契約の形だけ（S3-STUB）: 名前と形はこれで決まり、中身は段階3の WP1 が入れる。今の関数は空の結果を返すだけで、決まりはまだ無い
// （どの画面もまだ呼ばない）。使わない引数は void で読む（名前を契約のまま残すため）。
// today は端末の暦の今日（useToday()。0時を過ぎると変わり、チェックの記録は書き換えずに行が戻る。14.3）
import { ROUTINE_CYCLE_LABELS } from './routines'
import { ROUTINE_CYCLES, type AppData, type ID, type Routine, type RoutineCycle } from './types'

/** Routine List の1行に出す物 */
export interface RoutineRowView {
  id: ID
  routine: Routine
  /** 使う種類（知らない種類は毎日。6.12） */
  cycle: RoutineCycle
  /** 指定の字: '' ・'月・木'（日曜から）・'25日'・'3/15' */
  specLabel: string
  /** 済み（isRoutineDone(effectiveSpec(r), checkDatesOf(data, id), today)） */
  done: boolean
  /** 次に戻る日（nextResetDay） */
  nextReset: string
  /** '11/16（月）に戻ります'（年が今日と違う時は年も。D32） */
  returnText: string
}

/** 種類ごとのかたまり（見出し 32px・'済み数/全部'・畳む・開く。空のかたまりは名前と＋だけを淡く。D26） */
export interface RoutineGroupView {
  cycle: RoutineCycle
  /** 毎日・毎週・毎月・四半期・毎年 */
  name: string
  /** まだの行・済みの行（どちらも order の小さい順・id。済みの行も手で並べた順のまま。D10） */
  open: RoutineRowView[]
  done: RoutineRowView[]
  doneCount: number
  total: number
  empty: boolean
}

/** Routine List の中身（groups はいつも5つ・決まった順。undone はまだ済んでいない数） */
export interface RoutineListView {
  groups: RoutineGroupView[]
  undone: number
}

/** Routine List の中身（RoutineListView） */
export function routineListView(data: Pick<AppData, 'routines' | 'routineChecks'>, today: string): RoutineListView {
  void data
  void today
  return {
    groups: ROUTINE_CYCLES.map((cycle) => ({
      cycle,
      name: ROUTINE_CYCLE_LABELS[cycle],
      open: [],
      done: [],
      doneCount: 0,
      total: 0,
      empty: true,
    })),
    undone: 0,
  }
}

/** 行に出す指定の字（毎週の曜日は日曜から並べる: 日・月。毎月は '25日'、毎年は '3/15'。指定なしは ''） */
export function routineSpecLabel(r: Pick<Routine, 'cycle' | 'weekdays' | 'monthDay' | 'yearMonth' | 'yearDay'>): string {
  void r
  return ''
}

/** 済みの行の戻る日の字（'11/16（月）に戻ります'。年が今日と違う時は年も。D32） */
export function returnText(nextReset: string, today: string): string {
  void today
  return nextReset
}

/** ［指定］で選んでいる物（足す前・パネルで直す前。曜日は 0＝日〜6＝土） */
export interface SpecDraft {
  weekdays: number[]
  monthDay: number | null
  yearMonth: number | null
  yearDay: number | null
}

/** 種類を替えた時の指定（その種類に合う物だけを残す。曜日は小さい順に並べる。毎年の 2/29 は選べる） */
export function specForCycle(cycle: RoutineCycle, draft: SpecDraft): SpecDraft {
  void cycle
  return draft
}

/** ［指定］のボタンの字（選んでいなければ '指定'、選んでいればその指定の字） */
export function specButtonLabel(cycle: RoutineCycle, draft: SpecDraft): string {
  void cycle
  void draft
  return '指定'
}
