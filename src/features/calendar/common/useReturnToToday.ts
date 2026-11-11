// 裏から戻った時に今日へ移す決まり（docs/SPEC.md の 6.4。FRAME-278・CALENDAR-030。D31）。
// 最後に押した・キーを打った時刻を覚え（capture の pointerdown・keydown。useInteractionClock。設定の画面などカレンダーの外での操作も
// 数えるよう、アプリの外枠（src/App.tsx）が1回だけ呼ぶ）、アプリが裏から戻った時（visibilitychange で
// 見えるようになった時）に、最後の操作から 6時間以上たっていて、見ている期間が前の「今日」（最後に操作した日）を含んでいれば、新しい今日を含む期間へ
// 置き換える（Q20 の「開いた時」と同じ扱い。見ている日も今日）。日付が変わっただけの時は動かさない（今日の印だけが移る。useToday）。
// 決める関数は calendarRoute.ts の returnToTodayTarget。トップの画面（TopPage）が1回だけ呼ぶ
import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { todayStr } from '../../../domain/dates'
import { isCalendarPath, paths } from '../../../routes'
import { useCalendarUi, usePrefs } from '../../../store/uiStore'
import { parseCalendarPath, resolveViewed, returnToTodayTarget } from './calendarRoute'
import { sheetOf } from './sheets'

/**
 * 最後の操作（押した・キーを打った）の時刻を覚える（D31。画面の中だけ）。ほかの部品が止めても拾えるよう capture で聞く。
 * アプリの外枠（src/App.tsx の RootLayout）が1回だけ呼ぶ（カレンダーを出していない設定の画面などでの操作も「最後の操作」に数える。
 * カレンダーへ戻ってすぐ裏へ回した時に、設定の画面に入る前の操作から 6時間と数えて今日へ移らないように）
 */
export function useInteractionClock(): void {
  useEffect(() => {
    const touch = () => useCalendarUi.getState().touch()
    window.addEventListener('pointerdown', touch, { capture: true, passive: true })
    window.addEventListener('keydown', touch, { capture: true })
    return () => {
      window.removeEventListener('pointerdown', touch, { capture: true })
      window.removeEventListener('keydown', touch, { capture: true })
    }
  }, [])
}

export function useReturnToToday(): void {
  const location = useLocation()
  const navigate = useNavigate()
  // 出来事の中で今の行き先を読む（付け直さずに済むよう ref に置く）
  const here = useRef(location)
  here.current = location

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return
      const ui = useCalendarUi.getState()
      // 前の「今日」は、最後に操作した時の今日（その時に見ていた期間が今日を含んでいたか。開いたまま 0時を過ぎて今日の印だけが
      // 移った後に裏へ回った時も、操作していなければ移す）
      const prevToday = todayStr(ui.lastInteraction)
      const { pathname, state } = here.current
      // 登録・詳細の画面を開いている間は動かさない（書きかけを消さない）
      if (!isCalendarPath(pathname) || pathname === paths.top() || sheetOf(state)) return
      const today = todayStr()
      const parsed = parseCalendarPath(pathname, today, usePrefs.getState().lastMode)
      if (!parsed || parsed.replaceTo) return
      const viewed = parsed.date ?? resolveViewed(parsed, ui.viewed, today)
      const target = returnToTodayTarget({
        now: Date.now(),
        lastInteraction: ui.lastInteraction,
        prevToday,
        today,
        mode: parsed.mode,
        viewed,
      })
      if (!target) return
      ui.setViewed(today)
      if (target !== pathname) void navigate(target, { replace: true })
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [navigate])
}
