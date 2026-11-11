// カレンダーの画面どうしの約束の型（段階2。docs/SPEC.md の 2.9・3.1・3.8・12.2）。
// 1つのモードの画面（year・month・week・day）が受け取る物、登録の画面の初めの値、小さな画面（登録・詳細）を開いている印。
// 型だけを置く（React・ストアの中身を読まない）
import type { RegisterInit } from '../../../domain/itemInput'
import type { ID } from '../../../domain/types'
import type { CalendarMode } from '../../../store/uiStore'
import type { WidthClass } from '../../../ui/hooks'

export type { CalendarMode, WidthClass }

/**
 * 1つのモードの画面（YearView・MonthView・WeekView・DayView）が受け取る物。common/CalendarView が行き先（3.1）と
 * 測った領域の大きさから作って渡す。日付はどれも 'YYYY-MM-DD'
 */
export interface ViewProps {
  mode: CalendarMode
  /** 見ている日（月・年の行き先では引き継いだ日。週は日曜とは限らない。D02） */
  viewed: string
  /** 今日（端末の暦。0時を過ぎると変わる。7.3） */
  today: string
  /** 画面の幅の区分（3.2。CSS の 599/600/899/900px と同じ） */
  width: WidthClass
  /**
   * カレンダーの領域（モードの画面を入れる所）の大きさ（px。ResizeObserver で測る）。CSS の幅の区分とは別に、領域の幅で決める所
   * （イヤーの 870px・ウィークリーの列の 120px）に使う（D53）
   */
  area: { width: number; height: number }
}

// 登録の画面（12.2）の初めの値 RegisterInit（start・kind・startTime・endTime・title・memo）。形は src/domain/itemInput.ts に
// 1つだけ置き（registerDefaults が読む）、ここからも同じ型を出す（2つの形がずれないように）
export type { RegisterInit }

/**
 * 小さな画面（登録・詳細）を開いている印。行き先は変えず、履歴の state.sheet に置く（「戻る」で閉じる。D03）。
 * 詳細は予定の id だけを持つ（中身はデータから読む）
 */
export type SheetState = { kind: 'register'; init: RegisterInit } | { kind: 'detail'; id: ID }

/** 履歴の state（小さな画面を開いた時に積む。MIM の印 mimFromCalendar などほかの物と並ぶ） */
export interface SheetLocationState {
  sheet?: SheetState | null
}

/** 登録の画面（src/features/item/RegisterSheet.tsx）が受け取る物。onClose は ×・Esc・背景・登録の後に呼ぶ（履歴を1つ戻す） */
export interface RegisterSheetProps {
  init: RegisterInit
  onClose: () => void
}

/** 詳細の画面（src/features/item/DetailSheet.tsx）が受け取る物。onClose は ×・Esc・背景・削除の後に呼ぶ（履歴を1つ戻す） */
export interface DetailSheetProps {
  id: ID
  onClose: () => void
}
