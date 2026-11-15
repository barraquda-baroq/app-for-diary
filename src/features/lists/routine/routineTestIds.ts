// Routine List の［詳しく］のパネルの中の data-testid（E2E と部品のテストが同じ名前で探す。パネルそのものは common/testIds.ts の
// listTestIds.routinePanel）。種類は daily・weekly・monthly・quarterly・yearly
import type { RoutineCycle } from '../../../store/uiStore'

export const routinePanelTestIds = {
  /** 件名の欄 */
  title: 'routine-panel-title',
  /** 種類の切り替えの1つ */
  cycle: (cycle: RoutineCycle) => `routine-panel-cycle-${cycle}`,
  /** 済んでいる間の「11/16（月）に戻ります」 */
  returnLine: 'routine-panel-return',
  /** ［削除］ */
  remove: 'routine-panel-delete',
} as const
