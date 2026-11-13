// 登録・詳細の小さな画面の外枠（docs/SPEC.md の 3.8・4.3・12.2・12.3。X2）。L は真ん中の小さな画面（幅 520px・角丸 14px）、
// M・S は下からのシート（最大 92dvh・上の角丸 16px）。どれも src/ui/Modal（Esc・背景・［×］で閉じる）。
// - 画面全体の地を区分の色（--work-sheet／--private-sheet）にする（data-kind。item.css の .it-sheet）
// - 上の辺にラベルの色の帯（高さ 6px）を付ける（data-label。角丸に沿って切れる。src/styles.css の .modal.label-band）。
//   ラベルが無い・知らないキーなら帯を付けない（6.12）
// - ディープダークでは地が --surface になり区分の色で見分けられないので、題の左に区分のアイコン（かばん・家。14px）を出す
//   （ほかの外観では出さない。item.css）
// 区分・ラベルを中で選び替えると、地と帯の色もその場で替わる（包む画面が今の値を kind・label に渡す）。
// 印はカード・行と同じ決め方（common/parts の itemAttrs。知らない区分は仕事、知らないラベルは帯なし。6.12）
import type { ReactNode } from 'react'
import type { LabelKey } from '../../domain/labels'
import type { ItemKind } from '../../domain/types'
import { KindIcon } from '../../ui/icons'
import { Modal } from '../../ui/Modal'
import { itemAttrs } from '../calendar/common/parts/itemLook'
import { testIds } from '../calendar/common/testIds'
import './item.css'

export interface ItemSheetProps {
  /** 題（登録の画面は「予定を登録」、詳細は「予定」） */
  title: string
  kind: ItemKind
  label: LabelKey | null
  onClose: () => void
  /** 下のボタンの列（登録の画面の［やめる］［登録］） */
  footer?: ReactNode
  /** 開いた時にフォーカスする要素のセレクタ */
  initialFocus?: string
  /** 背景（小さな画面の全体を包む .modal-backdrop）に足すクラス（登録の画面の iPhone・iPad の it-edge-guard） */
  backdropClassName?: string
  children: ReactNode
}

export function ItemSheet({ title, kind, label, onClose, footer, initialFocus, backdropClassName, children }: ItemSheetProps) {
  const attrs = itemAttrs({ kind, label })
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={footer}
      initialFocus={initialFocus}
      className="it-sheet"
      testId={testIds.itemSheet}
      dataKind={attrs['data-kind']}
      dataLabel={attrs['data-label'] ?? null}
      titleIcon={<KindIcon kind={attrs['data-kind']} />}
      backdropClassName={backdropClassName}
    >
      {children}
    </Modal>
  )
}
