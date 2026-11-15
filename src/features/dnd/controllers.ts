// 掴んだ物の種類ごとの受け持ち（docs/SPEC.md の 7.11。D52）。TopDnd の1つの DragDropProvider が、掴み始め・動き・離した時を、
// 掴んだ物の種類（dragData.ts の dragTypeOf）の受け持ちへ渡す。ウィークリー（week/dnd の WeekDnd）は 'week-item'、
// Task List の行は 'task-row'、並べ替えは 'sort' を出している間だけ届ける。どの種類でも、掴み始めに TopDnd が
// useCalendarUi.setDragging(true)（「戻る」・端からのフリックを止める）・入力欄のフォーカスを外す・すばやく足すへ知らせる・指なら 15ms 震わせる。
// 契約の形だけ（S3-STUB）: 今は届けても何も呼ばない（ドラッグの入れ物はまだウィークリーの中。中身は段階3の WP5 が入れる）
import type { DragDropManager, DragEndEvent, DragMoveEvent, DragStartEvent } from '@dnd-kit/dom'
import type { DragType } from './dragData'

/** その種類の掴み始め・動き・離した時にすること */
export interface DragController {
  onDragStart?: (event: DragStartEvent, manager: DragDropManager) => void
  onDragMove?: (event: DragMoveEvent, manager: DragDropManager) => void
  onDragEnd?: (event: DragEndEvent, manager: DragDropManager) => void
}

/** 出している間、その種類の受け持ちを届ける（部品が外れると外す。controller は描き直しても同じ物を渡すこと） */
export function useDragController(type: DragType, controller: DragController): void {
  void type
  void controller
}
