// カレンダーの操作の列（docs/SPEC.md の 3.7）。段階0の src/features/top/CalendarArea.tsx から移し、行き先とつないだ。
// 左に 大きく淡い数字 → 期間の小さな表記 → ［‹］［›］→［今日］、右に［年｜月｜週｜日］→［休み］→［＋ 登録］→［Task View］。
// - ［年｜月｜週｜日］は見ている日を保ってモードを替え（履歴に積む）、［‹］［›］［今日］は期間を移す（置き換える）（3.1）
// - ［休み］（マンスリーだけ）は休みを付ける状態の入り・終わり（押した状態。帯と、マスを押した時はマンスリー。9.5）
// - ［＋ 登録］（月・週・日）は登録の画面を開く（デイリーではその日、ほかは今日が開始日。区分は仕事。12.2・D50）
// - ［Task View］（年・月）は段階4で作るので、今はお知らせだけ
// そのモードに無いボタンは visibility: hidden で消し、ほかのボタンの位置を動かさない（D23）
import { parseYmd, todayYmd } from '../../../domain/dates'
import { notify } from '../../../store/uiStore'
import { ChevronLeftIcon, ChevronRightIcon, ListCheckIcon, PlusIcon } from '../../../ui/icons'
import { periodHeading } from './calendarHeading'
import { testIds } from './testIds'
import type { CalendarMode } from './types'
import './frame.css'

/** ［年｜月｜週｜日］の並び */
export const MODES: readonly { mode: CalendarMode; label: string; name: string }[] = [
  { mode: 'year', label: '年', name: 'イヤー' },
  { mode: 'month', label: '月', name: 'マンスリー' },
  { mode: 'week', label: '週', name: 'ウィークリー' },
  { mode: 'day', label: '日', name: 'デイリー' },
]

/** そのモードに出すボタン（docs/SPEC.md の 3.7） */
export const SHOWN: Record<'off' | 'add' | 'taskView', readonly CalendarMode[]> = {
  off: ['month'],
  add: ['month', 'week', 'day'],
  taskView: ['year', 'month'],
}

const UNIT: Record<CalendarMode, string> = { year: '年', month: '月', week: '週', day: '日' }

export interface CalendarToolbarProps {
  mode: CalendarMode
  /** 見ている日（'YYYY-MM-DD'） */
  viewed: string
  /** 期間の見出し（h1）の id（S・M の切り替えの列が「カレンダー」へ飛んだ時にフォーカスする） */
  headingId?: string
  /** 休みを付ける状態か（［休み］を押した状態にする） */
  offMode: boolean
  onMode: (mode: CalendarMode) => void
  onShift: (dir: 1 | -1) => void
  onToday: () => void
  onOff: () => void
  onAdd: () => void
}

export function CalendarToolbar({
  mode,
  viewed,
  headingId,
  offMode,
  onMode,
  onShift,
  onToday,
  onOff,
  onAdd,
}: CalendarToolbarProps) {
  const heading = periodHeading(mode, parseYmd(viewed) ?? todayYmd())
  const unit = UNIT[mode]
  const hidden = (key: keyof typeof SHOWN) => (SHOWN[key].includes(mode) ? '' : ' cal-tool-hidden')
  return (
    <div className="cal-toolbar" data-testid={testIds.calendarToolbar}>
      <div className="cal-toolbar-left">
        <h1 id={headingId} tabIndex={-1} className="cal-period" data-testid={testIds.calPeriod}>
          <span className="numeral cal-numeral" aria-hidden="true" data-testid={testIds.calNumeral}>
            {heading.numeral}
          </span>
          <span className="cal-period-label" aria-hidden="true">
            <span className="caps">{heading.top}</span>
            <span className="caps">{heading.bottom || ' '}</span>
          </span>
          <span className="visually-hidden">{heading.spoken}</span>
        </h1>
        <div className="cal-nav">
          <button
            type="button"
            className="icon-btn"
            onClick={() => onShift(-1)}
            aria-label={`前の${unit}`}
            title={`前の${unit}`}
            data-testid={testIds.calPrev}
          >
            <ChevronLeftIcon />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => onShift(1)}
            aria-label={`次の${unit}`}
            title={`次の${unit}`}
            data-testid={testIds.calNext}
          >
            <ChevronRightIcon />
          </button>
          <button type="button" className="btn btn-sm" onClick={onToday} data-testid={testIds.calToday}>
            今日
          </button>
        </div>
      </div>
      <div className="cal-toolbar-right">
        <div className="segmented cal-modes" role="group" aria-label="カレンダーのモード">
          {MODES.map((m) => (
            <button
              key={m.mode}
              type="button"
              aria-pressed={mode === m.mode}
              title={m.name}
              onClick={() => onMode(m.mode)}
              data-testid={testIds.calMode(m.mode)}
            >
              {m.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={`btn btn-sm cal-off${hidden('off')}`}
          aria-pressed={mode === 'month' && offMode}
          title={offMode ? '休みを付けるのを終わる' : '休みを付ける'}
          onClick={onOff}
          data-testid={testIds.calOff}
        >
          休み
        </button>
        <button
          type="button"
          className={`btn btn-sm cal-add${hidden('add')}`}
          aria-label="登録"
          title="予定を登録"
          onClick={onAdd}
          data-testid={testIds.calAdd}
        >
          <PlusIcon />
          <span className="hide-mobile">登録</span>
        </button>
        <button
          type="button"
          className={`btn btn-sm cal-taskview${hidden('taskView')}`}
          aria-label="Task View"
          title="Task View"
          onClick={() => notify('Task View は段階4で作ります')}
          data-testid={testIds.calTaskView}
        >
          <ListCheckIcon />
          <span className="hide-mobile">Task View</span>
        </button>
      </div>
    </div>
  )
}
