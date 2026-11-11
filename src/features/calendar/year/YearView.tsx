// イヤー（docs/SPEC.md の 8.・7.1〜7.4・7.9・7.12・4.12。D07・D28・D53）。年間のカレンダーで、予定のある日に●を付けるだけの画面
// （ここでは何も直せない。休みも付けられない。CALENDAR-203）。
// - 並べ方はカレンダーの領域の幅で決める（CalendarView が測った area。870px 以上は「月を行・日を列」、狭いと小さな月。8.1）。
//   ウインドウの幅を変えると、測り直した幅ですぐに並べ直す（CALENDAR-206）
// - 中身は yearModel.ts が決め（日付・曜日・色・今日・休み・●・読み上げ）、ここと YearRows・YearMinis・YearCell はそれを描くだけ
// - 押した時（7.12・8.4）: 日のマスはその日の月のマンスリーへ（見ている日はその日）、月の見出しはその月の1日を見ている日にして
//   マンスリーへ（どちらもモードが替わるので履歴に積む）
// - L（パネルの高さが決まっている）は、この画面の中だけでスクロールする（縦に収まらない時。CALENDAR-217）。測る箱（.cal-body）は
//   スクロールさせない: 測る箱にスクロールバーが出たり消えたりすると、ふつうのスクロールバーの端末（Windows など）では領域の幅が
//   その分（15px ほど）変わり、870px の少し上で「行が縦に収まらない → スクロールバー → 870px を切って小さな月」と替わってしまう
//   （小さな月が縦に収まればスクロールバーが消えて行に戻り、行ったり来たりする）。この画面が自分でスクロールすれば、スクロールバーは
//   測る箱の中に出るので、測った幅は変わらない（e2e/year.spec.ts の「ふつうのスクロールバー」）。S・M は中身の高さ（ページと一緒に
//   スクロール。D15）
// - キーボード（PC）: 日のマスの中で Tab で止まるのは1つのマス（初めは見ている日。フォーカスが来たマスに移り、‹ ›・今日で見ている日が
//   替わると見ている日に戻る）だけ。マスの間は矢印キー・Home・End で動く（行き先は yearModel.ts の yearMove。年の外へは出ない）。
//   月の見出しは、それぞれ Tab で止まるボタン。受け持ったキーは preventDefault する（ページをスクロールしない。段階5で ← →（前後の
//   期間。3.10）を入れる時は、preventDefault 済みの物を見送る）
import { useCallback, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { cls, useCalendarData } from '../common/parts'
import { testIds } from '../common/testIds'
import type { ViewProps } from '../common/types'
import { useCalendarNav } from '../common/useCalendarRoute'
import { YearMinis } from './YearMinis'
import { buildYear, dotsRow, miniColumns, rowsCellPx, yearLayout, yearMove } from './yearModel'
import { YearRows } from './YearRows'
import './year.css'

export function YearView({ viewed, today, width, area }: ViewProps) {
  const y = Number(viewed.slice(0, 4))
  const { list, off } = useCalendarData()
  const months = useMemo(() => buildYear(y, list, off, today), [y, list, off, today])
  const nav = useCalendarNav()
  const layout = yearLayout(area.width)

  const onCell = useCallback((date: string) => nav.openMonth(date), [nav])
  const onMonth = useCallback((first: string) => nav.openMonth(first), [nav])

  // Tab で止まるマス: フォーカスが来たマス（その後で見ている日が替わっていなければ）、無ければ見ている日（年の行き先では、いつもその年の
  // 日。D02）。見ている日が替わったら（‹ ›・［今日］・スワイプ）、描く時にフォーカスの来たマスを忘れて、見ている日に戻す
  const [focus, setFocus] = useState<{ viewed: string; date: string | null }>({ viewed, date: null })
  if (focus.viewed !== viewed) setFocus({ viewed, date: null })
  const onFocusCell = useCallback((date: string) => setFocus((f) => (f.date === date ? f : { ...f, date })), [])
  const focused = focus.viewed === viewed ? focus.date : null
  const inYear = (d: string | null): d is string => d !== null && d.slice(0, 4) === viewed.slice(0, 4)
  const tabDate = inYear(focused) ? focused : viewed

  const root = useRef<HTMLDivElement>(null)
  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.nativeEvent.isComposing) return
      const from = (e.target as HTMLElement).closest<HTMLElement>('.yr-cell')?.dataset.date
      if (from === undefined) return
      const to = yearMove(from, e.key, layout)
      if (to === null) return
      // 年の端で動けない時（行き先が同じ日）も受け持ち、ページをスクロールさせない（マンスリーのマス目の端と同じ）
      e.preventDefault()
      if (to !== from) root.current?.querySelector<HTMLElement>(`.yr-cell[data-date="${to}"]`)?.focus()
    },
    [layout],
  )

  return (
    <div
      ref={root}
      className={cls('yr', `is-${layout}`, width === 'L' && 'is-scroll', width === 'S' && 'is-compact')}
      data-testid={testIds.view('year')}
      data-layout={layout}
      onKeyDown={onKeyDown}
    >
      {layout === 'rows' ? (
        <YearRows
          y={y}
          months={months}
          dots={dotsRow(rowsCellPx(area.width))}
          tabDate={tabDate}
          onCell={onCell}
          onMonth={onMonth}
          onFocusCell={onFocusCell}
        />
      ) : (
        <YearMinis
          y={y}
          months={months}
          columns={miniColumns(area.width, width)}
          tabDate={tabDate}
          onCell={onCell}
          onMonth={onMonth}
          onFocusCell={onFocusCell}
        />
      )}
    </div>
  )
}
