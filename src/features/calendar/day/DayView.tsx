// デイリー（docs/SPEC.md の 11.。予定の一覧とタイムスケジュール）。中身（WP8）ができるまでの仮の画面。
// 受け取る物（ViewProps）は最後の形
import { testIds } from '../common/testIds'
import type { ViewProps } from '../common/types'

export function DayView(_props: ViewProps) {
  return (
    <div className="empty cal-empty" data-testid={testIds.view('day')}>
      デイリー（日）の画面は段階2で作ります
    </div>
  )
}
