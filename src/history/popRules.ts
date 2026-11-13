// ブラウザの「戻る」「進む」（popstate）が来た時に何をするか（docs/SPEC.md の 3.1。22. の段階2の終わりの確かめの「画面の外からの
// フリックの決め」と ■22・■23・■25）。端末（何から来たか・閉じ方）・出している画面・向きだけで決める純粋な関数（React・ブラウザに
// 頼らない）。動かすのは src/history/appHistory.ts（履歴の形を保つ所）
//
// 何から来たか（src/ui/device.ts）:
// - edge-flick: iPhone・iPad の画面の端からのフリック（左の端から右へ払う＝戻る、右の端から左へ払う＝進む）。OS の戻るボタンは無い
// - os-back: Android の戻るボタン・戻る身振り、PC のブラウザの戻る・進む
// カレンダーでの OS の「戻る」の閉じ方（src/ui/device.ts の exitStyleOf）:
// - ask: 「Diary Studio を閉じますか？」と聞く（Android のブラウザのタブ・PC。■22）
// - press-again: 聞かずに「もう一度［戻る］を押すと閉じます」と出し、出ている間のもう一度の［戻る］で閉じる（ホーム画面から開いた
//   Android のアプリ。■25）
//
// | 画面 | 端からのフリック（iPhone・iPad） | OS の戻る（Android のタブ・PC） | OS の戻る（ホーム画面の Android） | OS の進む |
// |---|---|---|---|---|
// | カレンダー（何も開いていない） | 戻る: 日→週→月→年→日、進む: 年→月→週→日→年（モードを1つ回す） | 閉じるかを聞く | もう一度［戻る］で閉じる所にする | 何もしない |
// | 登録の画面 | 左右どちらでも閉じる（1つ戻る。書きかけも聞かずに捨てる。■27） | 1つ戻る（書きかけなら「書きかけを捨てますか？」。12.2） | 同じ | 何もしない |
// | 詳細の画面 | 左右どちらでも閉じる（1つ戻る） | 1つ戻る（閉じる） | 同じ | 何もしない |
// | ほかの画面（MIM・設定。段階3のリストも） | 左右どちらでも1つ戻る（カレンダーの方へ） | 1つ戻る | 同じ | 何もしない |

/** popstate が何から来るか（src/ui/device.ts が端末から決める） */
export type PopSource = 'edge-flick' | 'os-back'

/** カレンダーでの OS の「戻る」の閉じ方（src/ui/device.ts が端末と表示の形から決める。端からのフリックでは使わない） */
export type ExitStyle = 'ask' | 'press-again'

/** 出している画面の種類（src/features/calendar/common/calendarHistory.ts の screenOf） */
export type ScreenKind = 'calendar' | 'register' | 'detail' | 'other'

/** 来た向き（戻る＝履歴の前へ、進む＝後ろへ） */
export type PopDirection = 'back' | 'forward'

/**
 * することの種類。
 * - stay: 出していた所へ戻し、ほかは何もしない
 * - ring: 出していた所へ戻し、カレンダーのモードを1つ回す（dir 1 = 年→月→週→日→年、-1 = 日→週→月→年→日）
 * - ask-exit: 出していた所へ戻し、アプリを閉じるかを聞く
 * - arm-exit: 出していた所へ戻し、（書きかけを保存してから）もう一度［戻る］で閉じる所にする（聞かない）
 * - back-one: 出していた画面の1つ前の履歴へ（閉じる。ルーターに渡して描く）
 */
export type PopAction =
  | { kind: 'stay' }
  | { kind: 'ring'; dir: 1 | -1 }
  | { kind: 'ask-exit' }
  | { kind: 'arm-exit' }
  | { kind: 'back-one' }

const STAY: PopAction = { kind: 'stay' }
const BACK_ONE: PopAction = { kind: 'back-one' }

/** 「戻る」「進む」が来た時にすること（上の表）。exit はカレンダーでの OS の「戻る」の閉じ方（既定は聞く） */
export function decidePop(source: PopSource, screen: ScreenKind, direction: PopDirection, exit: ExitStyle = 'ask'): PopAction {
  if (source === 'edge-flick') {
    switch (screen) {
      case 'calendar':
        return { kind: 'ring', dir: direction === 'forward' ? 1 : -1 }
      case 'register':
      case 'detail':
      case 'other':
        return BACK_ONE
    }
  }
  if (direction === 'forward') return STAY
  if (screen !== 'calendar') return BACK_ONE
  return exit === 'press-again' ? { kind: 'arm-exit' } : { kind: 'ask-exit' }
}
