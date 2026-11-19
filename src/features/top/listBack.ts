// S・M で開いているリストを、端からのフリック（iPhone・iPad。左右どちらでも）・OS の［戻る］（Android・PC）で畳む（docs/SPEC.md の
// 3.1・■34 の作者の答え）。履歴の決まり（src/history/popRules.ts の close-list）が、カレンダーの画面で listOpenNow が true の時に
// closeShownList を呼ぶ（src/App.tsx が履歴の handlers の listOpen・closeList に置く）。「進む」は何もしない。履歴に積まない。■25
// （もう一度［戻る］で閉じる）は構えない。
// - listOpenNow: 積んだ所の形・見ている所・畳んだ状態（useStackedLists。StackedTop が出す）を stackModel.ts の listToClose に渡す。
//   StackedTop を出していない時（L・ほかの画面）は形が無いので false。決めるのに画面（DOM・ルーター・matchMedia）は読まない。設定で
//   記録を取っている時だけ、決めた時の形とページの位置・見えている所（visualViewport）を list-decide に控える（src/history/swipeLog.ts。
//   ■36 の時の作者の報告（22.）で、打っている間に見ている所がどこと決まっていたかを後で調べるため。開発）
// - closeShownList: 見ているリストの入力欄の打ちかけを捨て（common/listDraft.ts の discardListDraft。聞かない・足さない。変換の途中なら
//   決めずに捨てる。その場の直しは捨てない）、ページの位置を跳ばさずに畳む（stackedFold.ts の foldListInPlace。カレンダーへ
//   スクロールで戻さない・フォーカスはそのリストの中にあった時だけそのリストの見出しの畳む・開くボタンへ）
// - 見出しの［▾］で畳む・切り替えの列で別のリストへ移る・幅が L になる時は、打ちかけを今までどおり残す（ここを通らない）
// - リストのメニュー・小窓（行の「…」・日付のメニュー・小さな月のカレンダー・チップのメニュー・［指定］の小窓）が開いている時の「戻る」は、
//   ここへ来る前に履歴の consumePop（closeApp.ts の consumeBackPress・common/listPopups.ts）がそれだけを閉じて使い切る（畳まない・
//   打ちかけも残す。開発）。畳んで打ちかけを捨てるのは、何も開いていない時の次の「戻る」
import { swipeLog, swipeLogEnabled } from '../../history/swipeLog'
import { useStackedLists, type ListKey } from '../../store/uiStore'
import { discardListDraft } from '../lists/common/listDraft'
import { listToClose } from './stackModel'
import { foldListInPlace } from './stackedFold'

/** 今、畳むリスト（無ければ null） */
function shownOpenList(): ListKey | null {
  const { layout, shown, collapsed } = useStackedLists.getState()
  return layout === null ? null : listToClose({ ...layout, shown, collapsed })
}

/** 今、畳むリストがあるか（L・ほかの画面では false） */
export function listOpenNow(): boolean {
  const list = shownOpenList()
  if (swipeLogEnabled()) logDecide(list)
  return list !== null
}

/**
 * 決めた時の形を控える（記録を取っている時だけ呼ぶ）: 幅・S の全面の MIM か・見ている所・その所を畳んでいるか・決めた物と、
 * ページの縦の位置・見えている所の上の端と高さ（px に丸める）
 */
function logDecide(result: ListKey | null): void {
  const { layout, shown, collapsed } = useStackedLists.getState()
  const vv = window.visualViewport
  swipeLog('list-decide', {
    width: layout?.width ?? null,
    fullMim: layout?.fullMim ?? null,
    shown,
    collapsed: shown === 'calendar' ? null : collapsed[shown],
    result,
    scrollY: Math.round(window.scrollY),
    vvTop: Math.round(vv?.offsetTop ?? 0),
    vvHeight: Math.round(vv?.height ?? window.innerHeight),
  })
}

/** 見ているリストを畳む（上の決まり。畳むリストが無ければ何もしない） */
export function closeShownList(): void {
  const list = shownOpenList()
  if (list === null) return
  discardListDraft(list)
  foldListInPlace(list)
}
