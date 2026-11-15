// Favorite List の中身（docs/SPEC.md の 15.）を記録から作るフック: 表示用に直したやりたいこと（useData()。6.12）・今日から
// src/domain/favoriteList.ts の favoriteListView を作り、同じ物を渡されている間は同じ物を返す（行は React.memo で浅く比べる）。
// today は Favorite List の中身の部品が1つの useToday() から渡す（足した日の年を出すか。掴んでいる間はその日のまま。D37）。
// 契約の形だけ（S3-STUB）: 今は空の中身を返すだけ（中身は段階3の WP4 が入れる）。使わない引数は void で読む（名前を契約のまま残すため）
import type { FavoriteListView } from '../../../domain/favoriteList'

const EMPTY: FavoriteListView = { open: [], done: [], undone: 0 }

export function useFavoriteList(today: string): FavoriteListView {
  void today
  return EMPTY
}
