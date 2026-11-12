// カレンダー・予定の画面の data-testid（段階2。E2E と部品のテストが同じ名前で探す。docs/SPEC.md の 2.9 の「主な要素に data-testid」）。
// 段階0からある操作の列の cal-*・calendar・.cal-cell はそのまま使う（e2e/frame.spec.ts）。日付は 'YYYY-MM-DD'、区分は work・private
import type { ID, ItemKind } from '../../../domain/types'
import type { LabelKey } from '../../../domain/labels'
import type { CalendarMode } from '../../../store/uiStore'

export const testIds = {
  // ----- 段階0からある物（操作の列。common/CalendarToolbar.tsx。段階0の src/features/top/CalendarArea.tsx から移した） -----
  calendar: 'calendar',
  calendarBody: 'calendar-body',
  calendarMonth: 'calendar-month',
  calendarToolbar: 'calendar-toolbar',
  calPeriod: 'cal-period',
  calNumeral: 'cal-numeral',
  calPrev: 'cal-prev',
  calNext: 'cal-next',
  calToday: 'cal-today',
  calMode: (mode: CalendarMode) => `cal-mode-${mode}`,
  calOff: 'cal-off',
  calAdd: 'cal-add',
  calTaskView: 'cal-taskview',

  // ----- モードの画面（中身ができるまでの仮の画面も同じ名前） -----
  view: (mode: CalendarMode) => `view-${mode}`,

  // ----- マンスリー（9.） -----
  monthCell: (date: string) => `month-cell-${date}`,
  monthCount: (date: string, kind: ItemKind) => `month-count-${date}-${kind}`,
  offBanner: 'off-banner',
  offEnd: 'off-end',

  // ----- ウィークリー（10.） -----
  weekCol: (date: string) => `week-col-${date}`,
  weekHead: (date: string) => `week-head-${date}`,
  weekOff: (date: string) => `week-off-${date}`,
  weekAdd: (date: string, kind: ItemKind) => `week-add-${date}-${kind}`,
  weekCard: (id: ID) => `week-card-${id}`,
  weekStart: (id: ID) => `week-start-${id}`,
  weekEnd: (id: ID) => `week-end-${id}`,
  weekReceived: (id: ID) => `week-received-${id}`,
  weekEdge: (id: ID) => `week-edge-${id}`,
  weekOverflow: (date: string, id: ID) => `week-overflow-${date}-${id}`,
  /** 掴んでいる間の、左右の端の目印の帯（前・次の週へ。7.11） */
  weekEdgeCue: 'week-edge-cue',

  // ----- デイリー（11.） -----
  dayHead: 'day-head',
  dayArea: (kind: ItemKind) => `day-area-${kind}`,
  dayRow: (id: ID) => `day-row-${id}`,
  dayAdd: (kind: ItemKind) => `day-add-${kind}`,
  dayTimeline: 'day-timeline',
  dayEvent: (id: ID) => `day-event-${id}`,
  dayMore: 'day-more',
  /** 「+n」を押して開く隠れた予定の一覧（PopupMenu） */
  dayMoreList: 'day-more-list',
  dayNow: 'day-now',

  // ----- イヤー（8.） -----
  yearCell: (date: string) => `year-cell-${date}`,
  yearMonth: (m: number) => `year-month-${m}`,

  // ----- どの画面にもある部品 -----
  /** 点線の丸（完了にする） */
  done: (id: ID) => `done-${id}`,
  quickAddInput: 'quick-add-input',
  /** すばやく足すの［足す］（入力欄の右の端の✓） */
  quickAddButton: 'quick-add-button',
  aiTag: (id: ID) => `ai-tag-${id}`,

  // ----- 登録・詳細・複製の画面（12.。欄は画面の並びの順） -----
  itemSheet: 'item-sheet',
  itemTitle: 'item-title',
  itemKind: (kind: ItemKind) => `item-kind-${kind}`,
  itemRequester: 'item-requester',
  itemStart: 'item-start',
  itemDue: 'item-due',
  itemDueClear: 'item-due-clear',
  itemDateError: 'item-date-error',
  itemStatusLine: 'item-status-line',
  itemStartTime: 'item-start-time',
  itemEndTime: 'item-end-time',
  itemTimeHint: 'item-time-hint',
  itemMemo: 'item-memo',
  itemLock: 'item-lock',
  itemListed: 'item-listed',
  /** ラベルの色（なしは 'none'） */
  itemLabel: (key: LabelKey | 'none') => `item-label-${key}`,
  /** 色の並びの下の、選んでいる（乗せている）色の付けた呼び名の1行（4.6） */
  itemLabelName: 'item-label-name',
  itemFooter: 'item-footer',
  itemRegister: 'item-register',
  itemCancel: 'item-cancel',
  itemDone: 'item-done',
  itemDuplicate: 'item-duplicate',
  itemMore: 'item-more',
  itemDelete: 'item-delete',
  dupStart: 'dup-start',
  dupDue: 'dup-due',
  dupSubmit: 'dup-submit',
} as const
