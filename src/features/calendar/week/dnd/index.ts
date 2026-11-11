// ウィークリーのドラッグ（docs/SPEC.md の 7.10・7.11。dnd-kit を読み込むのはこのフォルダだけ）。ウィークリー（WP7）が呼ぶ約束:
// - WeekDnd: 週を包む（DragDropProvider。段階3で TopPage へ上げる。D52）
// - useItemDrag: カード・始点のカード・終点の●（と S の「● 件名」の行）を掴めるようにする（ref・isDragging・grabProps）
// - useDayDrop: その日・その区分の段を落とせる所にする（ref・state）
// 中身は WeekDnd.tsx（掴む・落とす）、gesture.ts（掴み方の決まり）、lockGesture.ts（ロック中の揺れ）、drop.ts（落とした時）、dnd.css
export { useDayDrop, useItemDrag, WeekDnd } from './WeekDnd'
export type { DayDrop, DragHandle, DropState, ItemDrag, WeekCtx } from './types'
