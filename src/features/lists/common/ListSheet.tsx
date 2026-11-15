// ルーチン・やりたいことの［詳しく］のパネルの外枠（docs/SPEC.md の 3.6・3.8・14.2・15.4。開発）: L は右の列の上に重ねるパネル
// （幅 300px・右の列と同じ高さ・右から 180ms）、S・M は下からのシート（最大 92dvh・上の角丸 16px）。どれも src/ui/Modal（Esc・［×］・
// 外を押して閉じる）。地はふつうの面の色（--surface。区分を持たないので区分の色にしない）、題の左に RepeatIcon（Routine）・HeartIcon
// （Favorite）。保存のボタンは置かず、直したそばから保存する（中身は routine/RoutinePanel・favorite/FavoritePanel）。下の端に段階5の
// 提案の置き場を空けておく（中身の側）。L のパネルの出し方は Modal の placement 'side'（Modal が描くたびに幅の区分で決める）
import type { ReactNode } from 'react'
import { Modal } from '../../../ui/Modal'
import './lists.css'

export interface ListSheetProps {
  title: string
  /** 題の左のアイコン（RepeatIcon・HeartIcon） */
  icon: ReactNode
  onClose: () => void
  testId: string
  /** 開いた時にフォーカスする要素のセレクタ */
  initialFocus?: string
  children: ReactNode
}

export function ListSheet({ title, icon, onClose, testId, initialFocus, children }: ListSheetProps) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      className="list-sheet"
      testId={testId}
      titleIcon={icon}
      initialFocus={initialFocus}
      placement="side"
    >
      {children}
    </Modal>
  )
}
