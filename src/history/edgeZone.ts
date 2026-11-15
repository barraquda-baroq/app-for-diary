// iPhone・iPad の画面の端の幅（docs/SPEC.md の 3.1・18.1 の「開発」。22. の「端からのフリックの3回目の直した版（788e842）を試した
// 答え」）: 画面の左右の端から、この幅の中で押した指が端からのフリックの指。初めは EDGE_ZONE_PX（36px。作者「もうちょっと画面端判定を
// 甘くしてもらった方が操作しやすい」で 20px から広げた）。設定の「開発」（src/features/appSettings/DevSettings.tsx。iPhone・iPad だけ）の
// 「端の幅」で EDGE_ZONE_CHOICES（20・28・36・44px）から選び、端末（localStorage の diary-studio:edge-zone）に覚える（同期しない）。
// 無い・知らない値は初めの幅。端末に覚えられない時（localStorage が使えない）は、このページの間だけ選んだ幅を使う。
// 端を決めるのはどれも edgeOfScreen（src/history/edgeFlick.ts）で、押すたびにここを読む: 端からのフリックを受け取る所（edgeFlick.ts）・
// なぞって前後の期間へ移る所（端の指を数えない。src/features/calendar/common/useSwipe.ts）・すばやく足すの、端を押した指を外を押したと
// まだ扱わない所（src/features/calendar/common/parts/QuickAdd.tsx）。なので選ぶと読み込み直さずにすぐ効き、1回の払いでモードと期間の
// 両方が替わることも無い。Android・PC（端からのフリックが無い）では読まない
import { EDGE_ZONE_CHOICES, EDGE_ZONE_PX } from '../features/calendar/common/swipe'

/** 端末に覚える所の名前 */
export const EDGE_ZONE_KEY = 'diary-studio:edge-zone'

/** 端末に覚えられなかった時に、このページの間だけ使う幅（覚えられた時は null） */
let unsaved: number | null = null

/** 選べる幅か */
function isChoice(px: number): boolean {
  return (EDGE_ZONE_CHOICES as readonly number[]).includes(px)
}

/** 覚えていた字から幅を読む（無い・知らない値は初めの幅） */
function parse(raw: string | null): number {
  if (raw === null) return EDGE_ZONE_PX
  const px = Number(raw)
  return isChoice(px) && String(px) === raw ? px : EDGE_ZONE_PX
}

/** 今の端の幅（px） */
export function edgeZonePx(): number {
  if (unsaved !== null) return unsaved
  try {
    return parse(localStorage.getItem(EDGE_ZONE_KEY))
  } catch {
    return EDGE_ZONE_PX
  }
}

/** 端の幅を選ぶ（選べる幅だけ。端末に覚え、すぐ効く） */
export function setEdgeZonePx(px: number): void {
  if (!isChoice(px)) return
  try {
    localStorage.setItem(EDGE_ZONE_KEY, String(px))
    unsaved = null
  } catch {
    // 覚えられない（このページの間だけ）
    unsaved = px
  }
}
