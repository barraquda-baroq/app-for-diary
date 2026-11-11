// 予定の詳細の画面（docs/SPEC.md の 12.3。カレンダーから開いた時の題は「予定」）。中身（欄・自動の保存・複製・削除。WP9）が
// できるまでの仮の画面: 題と件名と［×］だけ。受け取る物（DetailSheetProps）は最後の形
import { useRecord } from '../../store/appStore'
import { Modal } from '../../ui/Modal'
import { testIds } from '../calendar/common/testIds'
import type { DetailSheetProps } from '../calendar/common/types'

export function DetailSheet({ id, onClose }: DetailSheetProps) {
  const item = useRecord('items', id)
  return (
    <Modal title="予定" onClose={onClose} testId={testIds.itemSheet} dataKind={item?.kind} dataLabel={item?.label}>
      <p data-testid={testIds.itemTitle}>{item ? item.title : 'この予定は見つかりません'}</p>
    </Modal>
  )
}
