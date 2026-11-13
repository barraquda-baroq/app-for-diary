// ブラウザの「戻る」「進む」（popstate）が来た時に何をするか（docs/SPEC.md の 3.1。22. の段階2の終わりの確かめの「画面の外からの
// フリックの決め」と ■22・■23）。端末（何から来たか）・出している画面・向きだけで決める純粋な関数（React・ブラウザに頼らない）。
// 動かすのは src/history/appHistory.ts（履歴の形を保つ所）
//
// 何から来たか（src/ui/device.ts）:
// - edge-flick: iPhone・iPad の画面の端からのフリック（左の端から右へ払う＝戻る、右の端から左へ払う＝進む）。OS の戻るボタンは無い
// - os-back: Android の戻るボタン・戻る身振り、PC のブラウザの戻る・進む
//
// | 画面 | 端からのフリック（iPhone・iPad） | OS の戻る（Android・PC） | OS の進む（PC） |
// |---|---|---|---|
// | カレンダー（何も開いていない） | 戻る: 日→週→月→年→日、進む: 年→月→週→日→年（モードを1つ回す） | 閉じるかを聞く | 何もしない |
// | 登録の画面 | 何もしない（開いたまま） | 1つ戻る（書きかけなら「書きかけを捨てますか？」。12.2） | 何もしない |
// | 詳細の画面 | 左右どちらでも閉じる（1つ戻る） | 1つ戻る（閉じる） | 何もしない |
// | ほかの画面（MIM・設定。段階3のリストも） | 左右どちらでも1つ戻る（カレンダーの方へ） | 1つ戻る | 何もしない |

/** popstate が何から来るか（src/ui/device.ts が端末から決める） */
export type PopSource = 'edge-flick' | 'os-back'

/** 出している画面の種類（src/features/calendar/common/calendarHistory.ts の screenOf） */
export type ScreenKind = 'calendar' | 'register' | 'detail' | 'other'

/** 来た向き（戻る＝履歴の前へ、進む＝後ろへ） */
export type PopDirection = 'back' | 'forward'

/**
 * することの種類。
 * - stay: 出していた所へ戻し、ほかは何もしない
 * - ring: 出していた所へ戻し、カレンダーのモードを1つ回す（dir 1 = 年→月→週→日→年、-1 = 日→週→月→年→日）
 * - ask-exit: 出していた所へ戻し、アプリを閉じるかを聞く
 * - back-one: 出していた画面の1つ前の履歴へ（閉じる。ルーターに渡して描く）
 */
export type PopAction = { kind: 'stay' } | { kind: 'ring'; dir: 1 | -1 } | { kind: 'ask-exit' } | { kind: 'back-one' }

const STAY: PopAction = { kind: 'stay' }
const BACK_ONE: PopAction = { kind: 'back-one' }

/** 「戻る」「進む」が来た時にすること（上の表） */
export function decidePop(source: PopSource, screen: ScreenKind, direction: PopDirection): PopAction {
  if (source === 'edge-flick') {
    switch (screen) {
      case 'calendar':
        return { kind: 'ring', dir: direction === 'forward' ? 1 : -1 }
      case 'register':
        return STAY
      case 'detail':
      case 'other':
        return BACK_ONE
    }
  }
  if (direction === 'forward') return STAY
  return screen === 'calendar' ? { kind: 'ask-exit' } : BACK_ONE
}
