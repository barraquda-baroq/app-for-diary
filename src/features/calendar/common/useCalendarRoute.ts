// カレンダーの行き先と見ている日のフック（docs/SPEC.md の 3.1・3.7・6.13・7.12。D02・D05・D30）。
// - useCalendarRoute: 今の行き先からモード・期間・見ている日・今日を決め、正しくない行き先（トップ #/ を含む）を描く前に
//   置き換える。行き先が決めた見ている日を覚え（モードを替えた時に引き継ぐ）、描いたモードを lastMode に書く。CalendarView だけが呼ぶ
// - useCalendarNav: モードの切り替え（積む）・［‹］［›］・［今日］・スワイプ（置き換える）・7.12 の行き来（モードが替われば積み、
//   マンスリーの前後の月の日のように同じモードの中で期間を移るだけなら置き換える）。どの部品からも呼べる
// 行き先を読む・直す決まりそのものは calendarRoute.ts（純粋な関数）
import { useLayoutEffect, useMemo, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { todayStr, toYmd } from '../../../domain/dates'
import type { ItemKind } from '../../../domain/types'
import { calendarPath, paths } from '../../../routes'
import { useCalendarUi, usePrefs } from '../../../store/uiStore'
import { useToday } from '../../../ui/hooks'
import {
  clampToRouteYears,
  isRoutable,
  parseCalendarPath,
  resolveViewed,
  shiftViewed,
  type ParsedCalendarPath,
} from './calendarRoute'
import { useCurrentLocation } from './sheets'
import type { CalendarMode } from './types'

/** 今の行き先のカレンダー（日付はどれも 'YYYY-MM-DD'） */
export interface CalendarRoute {
  mode: CalendarMode
  /** 見ている日（月・年・日曜の週の行き先では覚えている日から決める。D02） */
  viewed: string
  /** 見ている期間の初めの日と最後の日 */
  from: string
  to: string
  /** 今日（端末の暦。0時を過ぎると変わる。7.3） */
  today: string
}

/** 行き先を読む（カレンダーの行き先でない時は、前回のモードの今日を含む期間として読む） */
function readRoute(pathname: string, today: string, lastMode: CalendarMode): ParsedCalendarPath {
  return parseCalendarPath(pathname, today, lastMode) ?? (parseCalendarPath(paths.top(), today, lastMode) as ParsedCalendarPath)
}

/** 見ている日（行き先が日を決めていなければ、覚えている日から。D02） */
function viewedOf(parsed: ParsedCalendarPath, remembered: string | null, today: string): string {
  return parsed.date ?? resolveViewed(parsed, remembered, today)
}

/**
 * 今の行き先のモード・期間・見ている日・今日（CalendarView が1回だけ呼ぶ。中の部品は ViewProps か useCalendarNav を使う）。
 * - トップ #/ は前回のモードの今日を含む期間へ、正しくない行き先は同じモードの今日を含む期間へ、日曜でない週はその週の日曜へ、
 *   描く前に置き換える（useLayoutEffect。置き換える前から置き換えた先と同じ物を描くので、トップの絵がちらつかない。FRAME-001・017・018）
 * - 行き先が決めた見ている日を覚える（モードを替えても引き継ぐ。FRAME-071。ほかの時は useCalendarNav が移る前に覚える）
 * - 描いたモードが lastMode と違えば書く（行き先を直接開いた・「戻る」で戻った時も。FRAME-261）
 * - 0時を過ぎて今日が変わっても、見ている日は変えない（今日の印だけが移る。FRAME-277・CALENDAR-029）
 */
export function useCalendarRoute(): CalendarRoute {
  const location = useLocation()
  const navigate = useNavigate()
  const lastMode = usePrefs((s) => s.lastMode)
  const setPrefs = usePrefs((s) => s.setPrefs)
  const remembered = useCalendarUi((s) => s.viewed)
  const setViewed = useCalendarUi((s) => s.setViewed)
  const todayYmd = useToday()
  const today = toYmd(todayYmd)
  const parsed = useMemo(() => readRoute(location.pathname, today, lastMode), [location.pathname, today, lastMode])
  const viewed = viewedOf(parsed, remembered, today)

  useLayoutEffect(() => {
    // 行き先が決めた見ている日（デイリーの日付・日曜でない週の日付・#/ と正しくない行き先の今日）を覚える。置き換えた先
    // （日曜の週・月・年）でも同じ日を見ている日にするため。行き先が日を決めない時は覚えている日から決めるので書かない
    // （［‹］［›］で先に覚えた次の日を、移る前の行き先で消さないように）
    if (parsed.date && useCalendarUi.getState().viewed !== parsed.date) setViewed(parsed.date)
    // 置き換える時も、履歴の state（MIM の印・小さな画面の印）はそのまま渡す
    if (parsed.replaceTo) void navigate(parsed.replaceTo, { replace: true, state: location.state })
    // 置き換える先・行き先の日が変わった時だけ（location.state は同じ行き先の中では変わらない）
  }, [parsed.replaceTo, parsed.date])

  useLayoutEffect(() => {
    if (parsed.mode !== usePrefs.getState().lastMode) setPrefs({ lastMode: parsed.mode })
  }, [parsed.mode])

  // 0時を過ぎて今日が変わった時、行き先が日を決めない月・年・日曜の週で、覚えている日が期間の外（無い）と、見ている日は今日から
  // 決めていたので、今日が期間の外へ出ると期間の初めの日に変わってしまう（11/30 → 12/1 になると、11月の見ている日が 11/1 になり、
  // 「週」で 11/1 の週へ）。その時は、それまでの見ている日を覚えて変えない。行き先が替わった・見ている日を覚え直した時（［今日］・
  // 裏から戻って6時間）は、そちらに従う
  const shown = useRef({ pathname: location.pathname, today, remembered, viewed })
  useLayoutEffect(() => {
    const before = shown.current
    shown.current = { pathname: location.pathname, today, remembered, viewed }
    if (
      before.today !== today &&
      before.pathname === location.pathname &&
      before.remembered === remembered &&
      before.viewed !== viewed
    ) {
      setViewed(before.viewed)
    }
  })

  return { mode: parsed.mode, viewed, from: parsed.from, to: parsed.to, today }
}

/** 行き来の操作（どれも見ている日を先に覚えてから移る。日付は 'YYYY-MM-DD'） */
export interface CalendarNav {
  /** ［年｜月｜週｜日］: 見ている日を保ってモードを替える（積む。今と同じモードなら何もしない。FRAME-014・071） */
  goMode: (mode: CalendarMode) => void
  /** ［‹］［›］・スワイプ: そのモードの期間で前後へ（置き換える。月・年は月末にそろえる。1900〜2199年の外へは移らない。FRAME-016・063） */
  shift: (dir: 1 | -1) => void
  /** ［今日］: 今日を含む期間へ（置き換える。見ている日は今日。FRAME-064） */
  goToday: () => void
  /**
   * 今のモードのまま、その日を含む期間へ（置き換える。見ている日はその日）。ウィークリーで掴んだまま前後の週へ移った後、落とさずに
   * やめた時に、掴んだ週へ戻す（7.11）
   */
  goTo: (date: string) => void
  /**
   * その日の月のマンスリーへ（見ている日はその日。7.12）。イヤーの日・月の見出しからはモードが替わるので積み、マンスリーの前後の月の
   * 日からは同じモードの中で期間を移るだけなので［›］［‹］と同じく置き換える（履歴に積むのはモードを替えた時。3.1・FRAME-014・016）
   */
  openMonth: (date: string) => void
  /**
   * その日のデイリーへ（積む。マンスリーの数字・マス、ウィークリーの日付の見出し。7.12。デイリーの中からなら置き換える）。flash に
   * 区分を渡すと、移った先でその区分の区切りと予定を 1.2秒目立たせる（'day-area:{区分}'・'day-events:{区分}'。マンスリーの数字から。D32）
   */
  openDay: (date: string, flash?: ItemKind) => void
}

/**
 * カレンダーの行き来（ボタン・スワイプ・7.12 のマス目などから呼ぶ）。今のモードと見ている日は、押した時の行き先（ルーターが今いる所）と
 * 覚えている日から決める（CalendarView の useCalendarRoute と同じ決め方）。返す物は描き直しても同じ物（行き先が変わっても作り直さない）
 */
export function useCalendarNav(): CalendarNav {
  const navigate = useNavigate()
  const here = useCurrentLocation()
  return useMemo(() => {
    /** 押した時の今のモード・見ている日・今日 */
    const current = () => {
      const today = todayStr()
      const lastMode = usePrefs.getState().lastMode
      const parsed = readRoute(here().pathname, today, lastMode)
      return { mode: parsed.mode, viewed: viewedOf(parsed, useCalendarUi.getState().viewed, today), today }
    }
    const ui = () => useCalendarUi.getState()
    /** そのモードのその日を含む期間へ（見ている日はその日。モードが替われば積み、同じモードなら置き換える） */
    const go = (mode: CalendarMode, date: string, replace = mode === current().mode) => {
      const viewed = clampToRouteYears(date)
      ui().setViewed(viewed)
      // マンスリーを離れると休みを付ける状態は終わる（D30）
      if (mode !== 'month') ui().setOffMode(false)
      void navigate(calendarPath(mode, viewed), { replace })
    }
    return {
      goMode: (mode) => {
        const { mode: now, viewed } = current()
        if (mode !== now) go(mode, viewed, false)
      },
      shift: (dir) => {
        const { mode, viewed } = current()
        const next = shiftViewed(mode, viewed, dir)
        if (isRoutable(mode, next)) go(mode, next, true)
      },
      goToday: () => {
        const { mode, today } = current()
        go(mode, today, true)
      },
      goTo: (date) => go(current().mode, date, true),
      openMonth: (date) => go('month', date),
      openDay: (date, flash) => {
        if (flash) ui().flashTarget(`day-area:${flash}`, `day-events:${flash}`)
        else {
          // 区分を渡さない時（マンスリーのマス・ウィークリーの日付の見出し）は目立たせない。前に数字から移った時のキーがまだ残って
          // いれば消す（キーは目立たせてから 1.2秒・どこにも出なければ 3秒で消えるので、その間に戻ってマスを押すと前の区分が目立つ。
          // CALENDAR-189・190）。区切り・予定のほかのキー（'item:{id}' など）はそのまま
          const f = ui().flash
          if (f?.keys.some((k) => k.startsWith('day-area:') || k.startsWith('day-events:'))) ui().clearFlash(f.seq)
        }
        go('day', date)
      },
    }
  }, [navigate, here])
}
