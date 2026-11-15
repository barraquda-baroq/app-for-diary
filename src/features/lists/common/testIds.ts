// 3つのリストの data-testid（E2E と部品のテストが同じ名前で探す。docs/SPEC.md の 2.9 の「主な要素に data-testid」）。
// 段階0からある list-{リスト}・-count・-fold・-body・-input と routine-toggle-all は名前を替えない（e2e/frame.spec.ts・
// e2e/smoke.spec.ts・src/features/top/TopPage.test.tsx が探す）。リストは routine・task・favorite、id は記録の id、
// 種類は daily・weekly・monthly・quarterly・yearly
import type { ID } from '../../../domain/types'
import type { ListKey, RoutineCycle } from '../../../store/uiStore'

export const listTestIds = {
  // ----- 段階0からある物（見出し・畳む所・入力欄） -----
  section: (list: ListKey) => `list-${list}`,
  count: (list: ListKey) => `list-${list}-count`,
  fold: (list: ListKey) => `list-${list}-fold`,
  body: (list: ListKey) => `list-${list}-body`,
  input: (list: ListKey) => `list-${list}-input`,
  /** Routine List の［すべて開く／畳む］（14.2） */
  routineToggleAll: 'routine-toggle-all',

  // ----- 入力欄（3.6・12.1） -----
  /** ［足す］（✓） */
  add: (list: ListKey) => `list-${list}-add`,
  /** Task List の入力欄の下の［開始日］［締め切り日］［依頼者］（13.2） */
  taskChip: (which: 'start' | 'due' | 'requester') => `task-chip-${which}`,
  /** Routine List の入力欄の［日｜週｜月｜四半期｜年］の1つ（14.2） */
  routineCycle: (cycle: RoutineCycle) => `routine-cycle-${cycle}`,
  /** Routine List の入力欄の［指定］と、開いた選ぶ所（14.2） */
  routineSpecButton: 'routine-spec-button',
  routineSpecPicker: 'routine-spec-picker',

  // ----- 行（3.6） -----
  row: (list: ListKey, id: ID) => `list-${list}-row-${id}`,
  rowCheck: (list: ListKey, id: ID) => `list-${list}-check-${id}`,
  rowTitle: (list: ListKey, id: ID) => `list-${list}-title-${id}`,
  /** その場で直している欄（件名・依頼者・やりたいことの字） */
  rowEdit: (list: ListKey, id: ID) => `list-${list}-edit-${id}`,
  /** 行の「…」と、開いたメニュー（NS の PopupMenu） */
  rowMore: (list: ListKey, id: ID) => `list-${list}-more-${id}`,
  rowMenu: (list: ListKey) => `list-${list}-menu`,
  /** PC の並べ替えの掴む所（14.2・15.2） */
  rowGrip: (list: ListKey, id: ID) => `list-${list}-grip-${id}`,

  // ----- 「済み n件」（3.6） -----
  /** Task List・Favorite List の「済み n件」の行 */
  done: (list: 'task' | 'favorite') => `list-${list}-done`,
  /** Routine List の種類ごとの「済み n件」の行 */
  routineDone: (cycle: RoutineCycle) => `routine-done-${cycle}`,
  /** Favorite List の［済みを片付ける］（15.3） */
  favoriteClearDone: 'favorite-clear-done',

  // ----- Task List（13.） -----
  /** 区分の切り替え（かばん・家） */
  taskKind: (id: ID) => `task-kind-${id}`,
  /** L の日付の列（押すと日付のメニュー。13.5） */
  taskDate: (id: ID) => `task-date-${id}`,
  /** 日付のメニュー（L の日付の列・M と S の「…」の［日付…］から） */
  taskDateMenu: 'task-date-menu',
  taskRequester: (id: ID) => `task-requester-${id}`,
  /** M・S の上の行（'〆11/20・営業部' など） */
  taskLine: (id: ID) => `task-line-${id}`,

  // ----- Routine List（14.） -----
  routineGroup: (cycle: RoutineCycle) => `routine-group-${cycle}`,
  routineGroupFold: (cycle: RoutineCycle) => `routine-group-fold-${cycle}`,
  /** 空のかたまりの＋（押すと入力欄へ、その種類を選んで。開発） */
  routineGroupAdd: (cycle: RoutineCycle) => `routine-group-add-${cycle}`,
  /** 行の指定の字（'月・木' など） */
  routineSpecLabel: (id: ID) => `routine-spec-label-${id}`,
  /** 済みの行の「11/16（月）に戻ります」 */
  routineReturn: (id: ID) => `routine-return-${id}`,
  routinePanel: 'routine-panel',

  // ----- Favorite List（15.） -----
  /** 3行を超えた時の「続き」 */
  favoriteMore: (id: ID) => `favorite-more-${id}`,
  /** 足した日 */
  favoriteAdded: (id: ID) => `favorite-added-${id}`,
  favoritePanel: 'favorite-panel',
} as const
