// 3つのリスト（docs/SPEC.md の 13.〜15.）の字の決まり: 入れた字の1行目と残り（件名とメモ）、件名の 200字の上限で切った残り、
// 「今週金曜」の日、お知らせ・読み上げに出す 20字の名前、Task List の入力欄の下の［開始日］［締め切り日］の字。
// 契約の形だけ（S3-STUB）: 名前と形はこれで決まり、中身は段階3の WP1 が入れる。今の関数は空の結果を返すだけで、決まりはまだ無い
// （どの画面もまだ呼ばない）。日付は 'YYYY-MM-DD' の文字のまま比べる。字数はコードポイントで数える（Array.from）

/**
 * 入れた字を件名とメモに分ける（13.2・15.4）: 改行は CRLF を LF にそろえ、頭の空の行を飛ばし、最初の空でない行の前後の空白を
 * 除いた物が件名、その後ろ（終わりの空白を除く）がメモ。どの行も空なら null（足さない）
 */
export function splitEntry(text: string): { title: string; memo: string } | null {
  void text
  return null
}

/**
 * 件名を上限（既定 200字）で切る。あふれた分は overflow で返す（Favorite から Task List へ移す・［予定にする］で、メモの頭へ回す。D25・D29）
 */
export function fitTitle(title: string, max = 200): { title: string; overflow: string } {
  void max
  return { title, overflow: '' }
}

/**
 * ［締め切り日］の「今週金曜」の日（13.2・13.5）: 今日を含む日曜〜土曜の週の金曜（金曜は今日）。土曜は次の金曜で、字は「来週金曜」
 */
export function fridayOf(today: string): { date: string; label: '今週金曜' | '来週金曜' } {
  return { date: today, label: '今週金曜' }
}

/** お知らせ・読み上げに出す名前: 最初の空でない行を 20字で切り、切った時は「…」を付ける（「『…』を削除しました」など） */
export function name20(text: string): string {
  return text
}

/** Task List の入力欄の下の［開始日］［締め切り日］に日を選んだ時の字（'開始 11/10'・'〆 11/20'。13.2） */
export function chipLabel(kind: 'start' | 'due', date: string): string {
  void kind
  return date
}
