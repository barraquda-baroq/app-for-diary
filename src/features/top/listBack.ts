// S・M で開いているリストを、端からのフリック（iPhone・iPad。左右どちらでも）・OS の［戻る］（Android・PC）で畳む（docs/SPEC.md の
// 3.1・D1・■34 の作者の答え）。履歴の決まり（src/history/popRules.ts の close-list）が、カレンダーの画面で listOpenNow が true の時に
// closeShownList を呼ぶ（src/App.tsx が履歴の handlers に渡す）。「進む」は何もしない。履歴に積まない。■25（もう一度［戻る］で閉じる）は構えない。
// - closeShownList: 見ているリスト（stackModel.ts の listToClose）の入力欄の打ちかけを捨て（common/listDraft.ts の discardListDraft。
//   聞かない・足さない。その場の直しは捨てない）、ページの位置を跳ばさずに畳む（stackedFold.ts の foldListInPlace。カレンダーへ
//   スクロールで戻さない・フォーカスはそのリストの中にあった時だけそのリストの見出しの畳む・開くボタンへ）
// - 見出しの［▾］で畳む・切り替えの列で別のリストへ移る・幅が L になる時は、打ちかけを今までどおり残す（ここを通らない）
// 契約の形だけ（S3-STUB）: 今は listOpenNow がいつも false、closeShownList は何もしない（どこからもまだ呼ばない。中身は段階3の WP6 が入れる）

/** 今、畳むリストがあるか（useStackedLists の layout・shown・collapsed を listToClose に渡す。L・ほかの画面では false） */
export function listOpenNow(): boolean {
  return false
}

/** 見ているリストを畳む（上の決まり。畳むリストが無ければ何もしない） */
export function closeShownList(): void {}
