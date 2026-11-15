// 3つのリストのまだ済んでいない数（docs/SPEC.md の 3.5・3.6）。トップの画面が1回だけ呼び、見出しと切り替えの列に渡す
// （畳んでいるリストも数える）。Task List は出している行のうち済んでいない物、Routine List は今日まだ済んで
// いないルーチン、Favorite List は済んでいない物。
// 契約の形だけ（S3-STUB）: 今はどれも 0 を返すだけ（トップの画面はまだ読まない。中身は段階3の WP0 が入れる）
import type { ListCounts } from './types'

const ZERO: ListCounts = { routine: 0, task: 0, favorite: 0 }

export function useListCounts(): ListCounts {
  return ZERO
}
