// Task List の中身（docs/SPEC.md の 13.）を記録から作るフック: 表示用に直した予定（useData()。6.12）・今日・今から
// src/domain/taskList.ts の taskListView を作り、同じ物を渡されている間は同じ物を返す（行は React.memo で浅く比べる）。
// today は Task List の中身の部品が1つの useToday() から渡す（掴んでいる間はその日のまま。D37）。nowMs は useNow(60秒)（168時間で隠す）。
// 契約の形だけ（S3-STUB）: 今は空の中身を返すだけ（中身は段階3の WP2 が入れる）。使わない引数は void で読む（名前を契約のまま残すため）
import type { TaskListView } from '../../../domain/taskList'

const EMPTY: TaskListView = { open: [], done: [], undone: 0 }

export function useTaskList(today: string, nowMs: number): TaskListView {
  void today
  void nowMs
  return EMPTY
}
