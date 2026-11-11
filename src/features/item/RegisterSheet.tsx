// 予定の登録の画面（docs/SPEC.md の 12.2。題は「予定を登録」。L は真ん中の小さな画面、M・S は下からのシート）。
// 中身（欄・ボタン・書きかけの確かめ。WP9）ができるまでの仮の画面: 題と［×］だけ。受け取る物（RegisterSheetProps）は最後の形
import { Modal } from '../../ui/Modal'
import { testIds } from '../calendar/common/testIds'
import type { RegisterSheetProps } from '../calendar/common/types'

export function RegisterSheet({ init, onClose }: RegisterSheetProps) {
  return (
    <Modal title="予定を登録" onClose={onClose} testId={testIds.itemSheet} dataKind={init.kind ?? 'work'}>
      <p className="empty">登録の欄は段階2で作ります</p>
    </Modal>
  )
}
