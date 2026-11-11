// カレンダーの共通の部品（年・月・週・日の画面と、登録・詳細の画面が使う。docs/SPEC.md の 2.9・4.・7.・12.1・12.5）。
// 画面の package は、ほかの画面のファイルを直さずに、ここの部品を使う（例: import { DayPill, QuickAdd } from '../common/parts'）
export { AiTag, type AiTagProps } from './AiTag'
export { DayPill, type DayPillProps } from './DayPill'
export { DoneToggle, toggleDone, UNDO_LABEL, type DoneToggleProps } from './DoneToggle'
export { stopActivationKeys, stopPropagation } from './events'
export { HolidayName, type HolidayNameProps } from './HolidayName'
export { ItemMarks, LOCK_SELECTOR, type ItemMarksProps } from './ItemMarks'
export { ItemTime, type ItemTimeProps } from './ItemTime'
export { ItemTitle, type ItemTitleProps } from './ItemTitle'
export {
  aiTagText,
  cls,
  dayTone,
  displayTitle,
  hasAiTag,
  itemAttrs,
  kindOf,
  labelOf,
  type DayTone,
  type ItemAttrs,
} from './itemLook'
export { LabelDot, type LabelDotProps } from './LabelDot'
export { OffMark } from './OffMark'
export { QuickAdd, type QuickAddProps } from './QuickAdd'
export { useCalendarData, type CalendarData } from './useCalendarData'
export { FLASH_STALE_MS, flashKey, useFlashTarget, type FlashOptions } from './useFlashTarget'
