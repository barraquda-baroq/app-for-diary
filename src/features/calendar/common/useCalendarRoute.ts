// カレンダーの行き先と見ている日のフック（docs/SPEC.md の 3.1・3.7・6.13・7.12。D02・D05・D30）。
// - useCalendarRoute: 今の行き先からモード・期間・見ている日・今日を決め、正しくない行き先（トップ #/ を含む）を描く前に
//   置き換える。行き先が決めた見ている日を覚え（モードを替えた時に引き継ぐ）、描いたモードを lastMode に書く。CalendarView だけが呼ぶ
// - useCalendarNav: モードの切り替え（積む）・［‹］［›］・［今日］・スワイプ（置き換える）・7.12 の行き来（積む）。どの部品からも呼べる
// 行き先を読む・直す決まりそのものは calendarRoute.ts（純粋な関数）
import { useLayoutEffect, useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { todayStr, toYmd } from '../../../domain/dates'
import type { ItemKind } from '../../../domain/types'
import { calendarPath, paths } from '../../../routes'
import { useCalendarUi, usePrefs } from '../../../store/uiStore'
import { useToday } from '../../../ui/hooks'
import { isRoutable, parseCalendarPath, resolveViewed, shiftViewed, type ParsedCalendarPath } from './calendarRoute'
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
  /** その日の月のマンスリーへ（積む。イヤーの日・月の見出し、マンスリーの前後の月の日。7.12） */
  openMonth: (date: string) => void
  /**
   * その日のデイリーへ（積む。マンスリーの数字・マス、ウィークリーの日付の見出し。7.12）。flash に区分を渡すと、
   * 移った先でその区分の区切りと予定を 1.2秒目立たせる（'day-area:{区分}'・'day-events:{区分}'。マンスリーの数字から。D32）
   */
  openDay: (date: string, flash?: ItemKind) => void
}

/**
 * カレンダーの行き来（ボタン・スワイプ・7.12 のマス目などから呼ぶ）。今のモードと見ている日は、押した時の行き先と覚えている日から
 * 決める（CalendarView の useCalendarRoute と同じ決め方）
 */
export function useCalendarNav(): CalendarNav {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  return useMemo(() => {
    /** 押した時の今のモード・見ている日・今日 */
    const current = () => {
      const today = todayStr()
      const lastMode = usePrefs.getState().lastMode
      const parsed = readRoute(pathname, today, lastMode)
      return { mode: parsed.mode, viewed: viewedOf(parsed, useCalendarUi.getState().viewed, today), today }
    }
    const ui = () => useCalendarUi.getState()
    const push = (mode: CalendarMode, date: string) => {
      ui().setViewed(date)
      // マンスリーを離れると休みを付ける状態は終わる（D30）
      if (mode !== 'month') ui().setOffMode(false)
      void navigate(calendarPath(mode, date))
    }
    const replace = (mode: CalendarMode, date: string) => {
      ui().setViewed(date)
      void navigate(calendarPath(mode, date), { replace: true })
    }
    return {
      goMode: (mode) => {
        const { mode: now, viewed } = current()
        if (mode !== now) push(mode, viewed)
      },
      shift: (dir) => {
        const { mode, viewed } = current()
        const next = shiftViewed(mode, viewed, dir)
        if (isRoutable(mode, next)) replace(mode, next)
      },
      goToday: () => {
        const { mode, today } = current()
        replace(mode, today)
      },
      openMonth: (date) => push('month', date),
      openDay: (date, flash) => {
        if (flash) ui().flashTarget(`day-area:${flash}`, `day-events:${flash}`)
        push('day', date)
      },
    }
  }, [navigate, pathname])
}
