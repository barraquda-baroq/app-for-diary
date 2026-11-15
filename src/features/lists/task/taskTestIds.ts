// Task List だけで使う data-testid（docs/SPEC.md の 13.2・13.3。3つのリストで共通の名前は common/testIds.ts の listTestIds）。
// 入力欄の下のチップの［×］と［依頼者］の小さな入力欄、行の依頼者をその場で直す欄。名前は listTestIds と同じ形（task-…）
import type { ID } from '../../../domain/types'

export const taskTestIds = {
  /** 入力欄の下のチップの［×］（開始日・締め切り日・依頼者を外す） */
  chipClear: (which: 'start' | 'due' | 'requester') => `task-chip-${which}-clear`,
  /** ［依頼者］を押すと開く小さな入力欄（候補付き） */
  chipRequesterInput: 'task-chip-requester-input',
  /** 行の依頼者をその場で直す欄（L。件名の欄は listTestIds.rowEdit） */
  requesterEdit: (id: ID) => `task-requester-edit-${id}`,
} as const
