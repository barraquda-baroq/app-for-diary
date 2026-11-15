// 3つのリストの行の「…」とメニュー（docs/SPEC.md の 3.6・3.8・13.5・14.2・15.4。開発）。メニューは NS の PopupMenu（src/ui/PopupMenu。
// 作り直さない。ページのどこかがスクロールすると閉じる）。PC（マウス）は行に乗せた時とキーボードで行の中に来た時（:focus-within）に
// 「…」を出し、指の端末はいつも出す（長押しのメニューは無い。0.4秒の並べ替えとぶつかるため。G12）。閉じるとフォーカスは「…」へ戻る。
// 開いている時の「戻る」（端からのフリックも）は、メニューだけを閉じる（common/listPopups。3.1・開発）。
// data-testid は「…」が list-{リスト}-more-{id}、開いたメニューが list-{リスト}-menu（common/testIds.ts）
import { useState } from 'react'
import type { ID } from '../../../domain/types'
import type { ListKey } from '../../../store/uiStore'
import { MoreIcon } from '../../../ui/icons'
import { PopupMenu, type PopupMenuItem } from '../../../ui/PopupMenu'
import { useListPopup } from './listPopups'
import { listTestIds } from './testIds'
import './lists.css'

export interface RowMenuProps {
  list: ListKey
  id: ID
  /** 行の名前（読み上げ「『x』のほかの操作」） */
  name: string
  /** メニューの項目（開く時に作る。［詳しく］［削除］など） */
  items: () => PopupMenuItem[]
}

/** 「…」の読み上げの名前 */
export const rowMenuLabel = (name: string) => `『${name}』のほかの操作`

export function RowMenu({ list, id, name, items }: RowMenuProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const label = rowMenuLabel(name)
  useListPopup(anchor !== null, () => setAnchor(null))
  return (
    <>
      <button
        type="button"
        className="icon-btn list-row-more"
        aria-label={label}
        title="ほかの操作"
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        onClick={(e) => {
          const el = e.currentTarget
          setAnchor((a) => (a ? null : el))
        }}
        data-testid={listTestIds.rowMore(list, id)}
      >
        <MoreIcon />
      </button>
      {anchor ? (
        <PopupMenu
          label={label}
          items={items()}
          placement={{ anchor }}
          onClose={() => setAnchor(null)}
          returnFocus={anchor}
          testId={listTestIds.rowMenu(list)}
        />
      ) : null}
    </>
  )
}
