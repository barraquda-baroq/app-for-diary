// Routine List（docs/SPEC.md の 14.・6.7）の決まり: 種類ごとの5つのかたまり（毎日・毎週・毎月・四半期・毎年。いつもこの順）、
// かたまりごとの済み・数、行に出す指定の字（'月・木'・'25日'・'3/15'）、済みの行の「11/16（月）に戻ります」、［指定］で選ぶ物。
// 戻る日の決まりそのもの（14.3）と、計算に使う指定（6.12）は routines.ts（latestResetDay・nextResetDay・isRoutineDone・effectiveSpec・
// checkDatesOf）にあり、ここはそれを使う（決め直さない）。
// today は端末の暦の今日（useToday()。0時を過ぎると変わり、チェックの記録は書き換えずに行が戻る。14.3）
import { WEEKDAYS_JA, parseYmd, shortDateLabel } from './dates'
import { ROUTINE_CYCLE_LABELS, checkDatesOf, effectiveSpec, isRoutineDone, maxYearDay, nextResetDay } from './routines'
import { ROUTINE_CYCLES, type AppData, type ID, type Routine, type RoutineCheck, type RoutineCycle } from './types'
import { byOrder } from './util'

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
  /** '11/16（月）に戻ります'（年が今日と違う時は年も。開発） */
  returnText: string
}

/** 種類ごとのかたまり（見出し 32px・'済み数/全部'・畳む・開く。空のかたまりは名前と＋だけを淡く。開発） */
export interface RoutineGroupView {
  cycle: RoutineCycle
  /** 毎日・毎週・毎月・四半期・毎年 */
  name: string
  /** まだの行・済みの行（どちらも order の小さい順・id。済みの行も手で並べた順のまま。開発） */
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
  // チェックの記録をルーチンごとに分けておく（ルーチンの数だけ全部の記録を見直さない）。済みの判定は routines.ts の checkDatesOf のまま
  const checks = new Map<ID, Record<ID, RoutineCheck>>()
  for (const c of Object.values(data.routineChecks)) {
    const own = checks.get(c.routineId) ?? {}
    own[c.id] = c
    checks.set(c.routineId, own)
  }
  const rows = new Map<RoutineCycle, RoutineRowView[]>(ROUTINE_CYCLES.map((c) => [c, []]))
  for (const routine of Object.values(data.routines)) {
    const spec = effectiveSpec(routine)
    const dates = checkDatesOf({ routineChecks: checks.get(routine.id) ?? {} }, routine.id)
    const nextReset = nextResetDay(spec, today)
    rows.get(spec.cycle)!.push({
      id: routine.id,
      routine,
      cycle: spec.cycle,
      specLabel: routineSpecLabel(routine),
      done: isRoutineDone(spec, dates, today),
      nextReset,
      returnText: returnText(nextReset, today),
    })
  }
  let undone = 0
  const groups = ROUTINE_CYCLES.map((cycle): RoutineGroupView => {
    const all = rows.get(cycle)!.sort((a, b) => byOrder(a.routine, b.routine))
    const open = all.filter((r) => !r.done)
    const done = all.filter((r) => r.done)
    undone += open.length
    return {
      cycle,
      name: ROUTINE_CYCLE_LABELS[cycle],
      open,
      done,
      doneCount: done.length,
      total: all.length,
      empty: all.length === 0,
    }
  })
  return { groups, undone }
}

/**
 * 行に出す指定の字（14.1）: 毎週の曜日は日曜から「・」でつなぐ（'月'・'月・木'・'日・月'）。毎月は '25日'、毎年は '3/15'（0 で埋めない）。
 * 毎日・四半期・指定なしは ''（「—」も出さない）。種類に合わない・範囲の外の指定は指定なしとして読む（effectiveSpec。6.12）
 */
export function routineSpecLabel(r: Pick<Routine, 'cycle' | 'weekdays' | 'monthDay' | 'yearMonth' | 'yearDay'>): string {
  const s = effectiveSpec(r)
  if (s.cycle === 'weekly') return s.weekdays.map((w) => WEEKDAYS_JA[w]).join('・')
  if (s.cycle === 'monthly' && s.monthDay !== null) return `${s.monthDay}日`
  if (s.cycle === 'yearly' && s.yearMonth !== null && s.yearDay !== null) return `${s.yearMonth}/${s.yearDay}`
  return ''
}

/**
 * 済みの行の戻る日の字（14.2）: '11/16（月）に戻ります'。年が今日と違う時は年も '2027/1/1（金）に戻ります'（開発）。
 * PC で済んだ行に乗せた時と、［詳しく］のパネルの戻る日の行に出す
 */
export function returnText(nextReset: string, today: string): string {
  const v = parseYmd(nextReset)
  const t = parseYmd(today)
  const label = shortDateLabel(nextReset)
  return `${v && t && v.y !== t.y ? `${v.y}/` : ''}${label}に戻ります`
}

/** ［指定］で選んでいる物（足す前・パネルで直す前。曜日は 0＝日〜6＝土） */
export interface SpecDraft {
  weekdays: number[]
  monthDay: number | null
  yearMonth: number | null
  yearDay: number | null
}

const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max

/**
 * 種類を替えた時の指定（その種類に合う物だけを残し、ほかは空に）: 毎週は 0〜6 の曜日を小さい順・重なりなしに、毎月は 1〜31 の日、
 * 毎年は 1〜12 の月とその月にある日（2/29 は選べる。月を選んだ後に日を選ぶ途中の、片方だけの値も残す）。毎日・四半期は指定を持たない。
 * 暦に無い組み合わせ（2/30 など）の日は空にする。そのまま addRoutine・updateRoutine に渡せる形（毎年の片方だけは routineProblems が断る）
 */
export function specForCycle(cycle: RoutineCycle, draft: SpecDraft): SpecDraft {
  const out: SpecDraft = { weekdays: [], monthDay: null, yearMonth: null, yearDay: null }
  if (cycle === 'weekly') {
    out.weekdays = [...new Set(draft.weekdays.filter((w) => isInt(w, 0, 6)))].sort((a, b) => a - b)
  } else if (cycle === 'monthly') {
    out.monthDay = isInt(draft.monthDay, 1, 31) ? draft.monthDay : null
  } else if (cycle === 'yearly') {
    out.yearMonth = isInt(draft.yearMonth, 1, 12) ? draft.yearMonth : null
    out.yearDay = isInt(draft.yearDay, 1, out.yearMonth === null ? 31 : maxYearDay(out.yearMonth)) ? draft.yearDay : null
  }
  return out
}

/** ［指定］のボタンの字（選んでいなければ '指定'、選んでいればその指定の字。毎年は月と日の両方を選ぶまで '指定'） */
export function specButtonLabel(cycle: RoutineCycle, draft: SpecDraft): string {
  return routineSpecLabel({ cycle, ...specForCycle(cycle, draft) }) || '指定'
}
