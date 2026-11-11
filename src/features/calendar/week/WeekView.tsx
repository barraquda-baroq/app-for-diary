// ウィークリー（docs/SPEC.md の 10.。L・M は7日を横、S は縦）。中身（WP7）ができるまでの仮の画面。受け取る物（ViewProps）は最後の形
import { testIds } from '../common/testIds'
import type { ViewProps } from '../common/types'

export function WeekView(_props: ViewProps) {
  return (
    <div className="empty cal-empty" data-testid={testIds.view('week')}>
      ウィークリー（週）の画面は段階2で作ります
    </div>
  )
}
