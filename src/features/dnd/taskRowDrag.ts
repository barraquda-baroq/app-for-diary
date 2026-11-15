// Task List の行をカレンダーへ掴んで落とす（docs/SPEC.md の 13.6・7.10・7.11）。掴めるのは L でマウスの時、カレンダーを出している
// （MIM・Task View でない）時、ロックしていない時だけ（ロック中は揺れる。開発）。落とす決まりは src/domain/listDrop.ts。
// 行の部品は返す物を行に付ける（ref・rowProps を広げる。disabled の間は掴まない）。
// 契約の形だけ（S3-STUB）: 今はいつも disabled（掴めない。中身は段階3の WP8a が入れる）
import type { HTMLAttributes } from 'react'
import type { Item } from '../../domain/types'

export interface TaskRowDrag {
  /** 掴む要素（行）に付ける */
  ref: (el: Element | null) => void
  /** 今その行を掴んで動かしている */
  isDragging: boolean
  /** 行に広げて渡す（ロック中に掴もうとした時の揺れ・カーソル。開発） */
  rowProps: HTMLAttributes<HTMLElement>
  /** 掴めない（L でない・マウスでない・カレンダーを出していない・ロック中の揺れだけ） */
  disabled: boolean
}

const INERT: TaskRowDrag = { ref: () => {}, isDragging: false, rowProps: {}, disabled: true }

export function useTaskRowDrag(item: Item): TaskRowDrag {
  void item
  return INERT
}
