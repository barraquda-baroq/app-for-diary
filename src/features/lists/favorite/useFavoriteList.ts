// Favorite List の中身（docs/SPEC.md の 15.）を記録から作るフック: 表示用に直したやりたいこと（useApp の data.favorites。useData() と
// 同じ記録。6.12）・今日から src/domain/favoriteList.ts の favoriteListView を作る。表・today が同じ間は作り直さない（ほかの表が
// 替わっても）。作り直しても、行に出す物が前と同じ行は前と同じ物を返す（common/stableRows。行は記録ごとの React.memo）。
// today は Favorite List の中身の部品が1つの useToday() から渡す（足した日の年を出すか。掴んでいる間はその日のまま（開発））
import { useMemo } from 'react'
import { favoriteListView, type FavoriteListView, type FavoriteRowView } from '../../../domain/favoriteList'
import type { Favorite } from '../../../domain/types'
import { useApp } from '../../../store/appStore'
import { keep } from '../common/stableRows'

/** 記録ごとの前の行 */
const rowOf = new WeakMap<Favorite, FavoriteRowView>()

const keepRow = (row: FavoriteRowView): FavoriteRowView => keep(rowOf, row.favorite, row)

export function useFavoriteList(today: string): FavoriteListView {
  const favorites = useApp((s) => s.data.favorites)
  return useMemo(() => {
    const view = favoriteListView(Object.values(favorites), today)
    return { open: view.open.map(keepRow), done: view.done.map(keepRow), undone: view.undone }
  }, [favorites, today])
}
