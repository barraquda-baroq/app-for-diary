// アプリの履歴（docs/SPEC.md の 3.1。22. の段階2の終わりの確かめの「画面の外からのフリックの決め」・■22・■23・■25）。HashRouter と同じ
// ハッシュの行き先の履歴（react-router の createHashHistory と同じ形: state は { usr, key, idx }）を自分で持ち、ルーターが書く・戻る所と、
// ブラウザの「戻る」「進む」（popstate）が来た所の両方を、ここ1か所で扱う。src/App.tsx が1つだけ作ってデータのルーターに渡す。
//
// 履歴の形: カレンダーの画面は、いつも1つの履歴（「土台」。state.ds.base がその番号）に置き、その前に「戻る」の印、後ろに「進む」の印の
// 履歴を1つずつ置く（どちらも同じ行き先で、state.ds.mark が back・fwd）。カレンダーの中の行き来（モードの切り替え・‹ ›・なぞる・［今日］・
// イヤーのマスからマンスリーなど）は、どれも土台を置き換えるだけで、履歴は増えない。登録・詳細の画面・MIM・設定は土台の後ろに積み、
// 閉じると1つ戻って土台へ。ほかの画面からカレンダーへ移る時（左のアイコン・［‹ カレンダーに戻る］）も、土台まで戻ってそこを置き換える。
// - 「戻る」「進む」が来たら、出していた画面と端末（src/ui/device.ts）で、することを決める（popRules.ts の decidePop）: カレンダーでは
//   印の履歴へ移った所から土台へ戻し（ルーターには渡さない。途中の行き先を描かない）、iPhone ではモードを1つ回し（handlers.ring）、
//   Android のブラウザのタブ・PC では閉じるかを聞き（handlers.askExit）、ホーム画面から開いた Android のアプリでは聞かずに、もう一度
//   ［戻る］で閉じる所にする（handlers.armExit が書きかけを保存してから armExit を呼ぶ。下）。ほかは1つ戻る（iPhone の登録の画面も
//   詳細の画面と同じく閉じる。書きかけは聞かずに捨てる: ルーターに渡す前に handlers.flickDiscard を呼ぶ。■27）
// - 自分で戻る・進む（history.go）間に来た popstate は、ルーターに渡さない。書き込み・戻る・進むは1つずつ順に行い、動いている間に
//   来たものは待たせる。すばやく続けた「戻る」「進む」のうち、戻している間に来た物は捨てる（積み上がらず、行ったり来たりしない）
// - 印の履歴を作るのは、押し終えた・キーを打った直後だけ（開いた直後はまだ作らず、最初に押し終えた時（指・マウスを離した時。ドラッグ
//   なら落とし終えた時）に作る）。iPhone（WebKit）は、押してから 10秒より後に積まれた履歴を身振りの行き先から外し、Chromium は、
//   押していないのに積んだページの履歴を「戻る」ボタンの行き先から外す（history manipulation intervention）。外されると、iPhone の
//   フリックは効かず、Android の戻るボタンは聞かずにアプリを閉じる
// - 押している間（指・マウス・ペンが1つでも下りている）・ドラッグの途中（handlers.dragging）は、アプリが自分から履歴を動かさない: 印の
//   履歴を作る・「進む」の印を置く・カレンダーの履歴へ戻る・ルーターの戻る・進む・閉じるは、押し終えてドラッグも終わるまで待つ
//   （指の動き（長押しで掴む・動かす・落とす）の途中で履歴を動かさないため。PC のマウスは押した時（mousedown）から「押した」と数える
//   ので、前は開いて最初にマウスで掴むと、掴む前に印を作っていた。指は離した時（pointerup・touchend）に数えるので、指の長押しでは落とす
//   最中（離した時）に作っていた）。ルーターの置き換え（カレンダーの中の行き来。押している間の週の替わりなど）は、履歴を動かさない
//   （今の物を書き換えるだけ）のでその場で書く。「戻る」「進む」が来た所から出していた所へ戻すのは待たない（押し終えるのを待っている
//   物があっても、その前に行う。待つ間に、もう一度の「戻る」でアプリを離れないように）
// - 離す出来事が来ないまま残った指（画面の端の身振りを端末が取った時など。src/ui/useSwipe.ts と同じ）は、次に指を下ろした時・画面に
//   触れている指が無くなった時（touchend）に捨てる。ほかの物も、その物の出来事が PRESS_STALE_MS 来なければ離したとみなす
// - history.scrollRestoration は auto のまま: 設定・MIM から「戻る」でカレンダーへ戻った時のページのスクロールの位置は、ブラウザが
//   戻す（src/ui/Layout.tsx の scrollsToTop は「戻る」「進む」では動かさない）。ただし「戻る」「進む」の印の履歴（と、印を作る・置く時に
//   自分で戻る間の土台）だけは manual にする（押し終えた時に続いているスクロール（払った指の惰性）を、印を積んだ時の位置へ戻さない・
//   フリックで印の履歴へ移った時に、前の位置へ跳ばない）。土台に着いたら auto に戻す
// - iPhone の身振りの絵（3.1 の「端からのフリックの間に見える絵」）: WebKit は、端からのフリックの間、行き先の履歴の絵を出す。絵は、
//   その履歴を最後に離れた時（pushState・go・身振りの始まり）に、その時に描かれていた画面を写した物で、身振りの絵を出している間
//   （指を離した後の動きの間と、着いた後も画面が描き直されて、描く物が行き先の絵の半分を超えるなどするまで。長くて3秒）は写さない。
//   行き先は身振りを始めた時に決まる（その後にアプリが動いて、行き先が今いる所になると読み込み直し、切り捨てると3秒止まる）。
//   なので iPhone では:
//   - 払いの popstate で最初に、今の履歴を同じ物で置き換える（onPop。WebKit は、払いの後に最初に知らせた同じページの中の動きが積む
//     （pushState）だと身振りの絵を3秒外さず、その間はページを押せない）。popstate の中（とその後のマイクロタスク）では積まない
//   - モードを回す払いの後は、払いの popstate の中で土台へ戻る1回のほかは、履歴を動かさない（絵は写し直さない。印の絵は作った時・
//     閉じた後に写したカレンダーのまま）
//   - 端からのフリックで詳細の画面などを閉じた時は、押した直後なら、動きの間（popstate の後の処理）に閉じた画面の履歴を切り捨てて
//     「進む」の印を積み直す（dropClosed。絵はまだ無い）。身振りの絵が消えた頃（SWIPE_SETTLE_*）に1度だけ、その印へ行って戻り
//     （recordForward）、印の絵を今のカレンダーにする（押した直後でなければ、その時に閉じた画面の履歴を印に替える）。指が下りて
//     いる間は行かない・戻らない（行った後なら、そこで待つ: parked）
//   - 印の履歴を作る（build）のは、画面がカレンダーだけで描かれた後
//   - 登録・詳細の画面をルーターの戻るで閉じる時は、戻る前に隠して描かせる（hideBeforeLeave。閉じた画面の履歴の絵に残さない）
//   - モードを回した時、新しいモードの描く物が行き先の絵の半分に届かなければ、見えない描く物を足してすぐ絵を外させる（afterRing。
//     絵を出している間にアプリの中で回した時は topUpBallast で足し直す）
//   - 身振りに取られた指（離す出来事が来ない）は、身振りの「戻る」「進む」が来た時に離したとみなす。身振りの始まりに来る window の
//     blur では、指は離したとみなさない
//   - 何をしたかは、設定で記録を取る時だけ控える（src/history/swipeLog.ts）
// - 読み込み直した時は、今の履歴の state（idx・ds）をそのまま使う（履歴を増やさない。印の履歴で読み込み直した時は土台へ戻る）
// - アプリを閉じる（leave。「Diary Studio を閉じますか？」の［閉じる］）: アプリの最初の履歴（idx 0）より前へ戻る。前が無い時（ほかの
//   アプリから開いたブラウザのタブなど）は window.close() を試し、それも効かなければ、最初の履歴へ戻って「もう一度［戻る］で閉じる」所に
//   する（Android。下のホーム画面から開いた Android のアプリの所と同じく、押し終えた・キーを打った・押したまま ARM_HOLD_MS たった時に
//   終えて出していた所へ戻る。時間の限りは無い）か、そのまま（PC）
// - もう一度［戻る］で閉じる所（armExit。ホーム画面から開いた Android のアプリのカレンダーでの「戻る」。■25）: 最初の履歴へ戻り、決めた
//   長さ（お知らせを出している間）だけその所にする。その間のもう一度の「戻る」で、ブラウザがアプリの前へ戻る（ホーム画面のアプリは
//   閉じる）。時間が過ぎた・押し終えた・キーを打った・押したまま ARM_HOLD_MS たった（長押しで掴む前）時は、押している間でも待たずに
//   出していた所へ戻る（お知らせが消えた後・掴んでいる間の「戻る」でアプリを離れないように。次の「戻る」でまたその所にする。履歴は
//   増えない）。頼まれてから（書きかけを保存している間に）押し終えた・キーを打った時は、その所にしない
// 画面の決まり（どの行き先がカレンダー・登録・詳細か）は、ここでは持たない（screenOf で受け取る）
import { createPath, NavigationType, parsePath, type Location, type RouterInit } from 'react-router-dom'
import { decidePop, type ExitStyle, type PopSource, type ScreenKind } from './popRules'
import { swipeLog, swipeLogEnabled } from './swipeLog'

type RouterHistory = RouterInit['history']
type Update = Parameters<Parameters<RouterHistory['listen']>[0]>[0]
type Listener = (update: Update) => void
type To = Parameters<RouterHistory['push']>[0]

/** 使う window の物（単体テストでは作り物を渡す） */
export interface HistoryWindow {
  history: {
    readonly state: unknown
    /** このタブの履歴の数（ほかのページの分も。無ければ数えない） */
    readonly length?: number
    /** 今の履歴へ「戻る」「進む」で来た時に、ブラウザがスクロールの位置を戻すか（この後に積む履歴も同じになる。無ければ変えない） */
    scrollRestoration?: 'auto' | 'manual'
    pushState(data: unknown, unused: string, url?: string | null): void
    replaceState(data: unknown, unused: string, url?: string | null): void
    go(delta: number): void
  }
  location: { readonly href: string; readonly hash: string; readonly origin: string; assign(url: string): void }
  document: {
    querySelector(selector: string): { getAttribute(name: string): string | null } | null
    /** ページが見えているか（隠れた時は、押している物は無い） */
    readonly visibilityState?: string
  }
  addEventListener(type: string, listener: (event: Event) => void, options?: boolean | AddEventListenerOptions): void
  removeEventListener(type: string, listener: (event: Event) => void, options?: boolean | EventListenerOptions): void
  setTimeout(handler: () => void, ms: number): number
  clearTimeout(id: number): void
  close(): void
  /** 次に描く時（無ければ 16ms 後とみなす） */
  requestAnimationFrame?(callback: () => void): number
  navigator?: { userActivation?: { readonly isActive: boolean } }
  /** Navigation API（Chromium など。無いブラウザでは使わない）: 今いる所と続いた、同じ origin の履歴だけを数える */
  navigation?: { readonly currentEntry: { readonly index: number } | null; entries(): ArrayLike<unknown> } | null
}

/** 画面から受け取る動き（App・カレンダーが置く） */
export interface HistoryHandlers {
  /** iPhone の端からのフリックで、カレンダーのモードを1つ回す（1 = 年→月→週→日→年、-1 = 日→週→月→年→日） */
  ring?: (dir: 1 | -1) => void
  /** Android のブラウザのタブ・PC のカレンダーでの「戻る」で、アプリを閉じるかを聞く */
  askExit?: () => void
  /**
   * ホーム画面から開いた Android のアプリのカレンダーでの「戻る」で、聞かずに、書きかけを保存してから armExit を呼ぶ（もう一度［戻る］で
   * 閉じる所にして「もう一度［戻る］を押すと閉じます」を出す。src/features/top/closeApp.ts）
   */
  armExit?: () => void
  /**
   * 「戻る」「進む」が来た時に、画面を動かす前に片付ける物があれば片付けて true（出していた所へ戻すだけにする）: 開いている確かめの
   * ダイアログを閉じる（その下の詳細の画面などは閉じない）・掴んでいる間（掴んでから離すまで）は何もしない
   */
  consumePop?: () => boolean
  /** ドラッグの途中か（押し終えても、落とし終えるまで履歴を動かさない。src/App.tsx が dragActive を置く） */
  dragging?: () => boolean
  /**
   * iPhone: 画面がカレンダーだけか（小さな画面・確かめ・メニュー・すばやく足すの入力欄・掴んだカード・めくる動き・起動アニメーションが
   * 無く、ページが見えている）。印の履歴を作る・「進む」の印の絵を写すのは、この時だけ（src/history/swipePicture.ts）
   */
  cleanScreen?: () => boolean
  /**
   * iPhone: 登録・詳細の画面をルーターの戻るで閉じる前に、小さな画面と確かめを隠す（離れる履歴の絵に残さない）。返す関数は、隠した物が
   * 残っていれば出し直す（戻れなかった時）
   */
  hideSheets?: () => () => void
  /** iPhone: ページの描く物の数の見積もり（WebKit が身振りの絵を外すのを待つ目安。見えない描く物は数えない） */
  renderWeight?: () => number
  /** iPhone: 見えない描く物を count 個置く（0 で外す） */
  ballast?: (count: number) => void
  /**
   * iPhone の端からのフリックで登録の画面を閉じる直前（ルーターに渡す前）: 書きかけの確かめ（useBlocker）を通さずに捨てる（■27。
   * src/features/item/RegisterSheet.tsx が置く。Android・PC の OS の戻るは呼ばない）
   */
  flickDiscard?: () => void
}

export interface AppHistoryOptions {
  window: HistoryWindow
  /** popstate が何から来るか（src/ui/device.ts） */
  source: PopSource
  /** カレンダーでの OS の「戻る」の閉じ方（src/ui/device.ts。既定は聞く） */
  exit?: ExitStyle
  /** ［閉じる］で閉じられなかった時に、最初の履歴へ戻って「もう一度［戻る］で閉じる」所にするか（Android） */
  armOnLeaveFail: boolean
  /** 行き先の画面の種類 */
  screenOf: (location: { pathname: string; state: unknown }) => ScreenKind
  /** 今（ミリ秒。テスト用。既定は performance.now: 時計を合わせても・E2E で Date を止めても進む） */
  now?: () => number
}

/** 今の履歴の形（E2E・単体テスト用） */
export interface HistoryShape {
  /** popstate が何から来るか（端末で決めた物。src/ui/device.ts） */
  source: PopSource
  /** カレンダーでの OS の「戻る」の閉じ方（端末と表示の形で決めた物。src/ui/device.ts） */
  exit: ExitStyle
  /** 履歴を動かしている途中（戻る・進むの popstate を待っている・順番を待っている物がある） */
  busy: boolean
  /** 今いる履歴の idx */
  cur: number
  /** 土台の idx（まだ作っていなければ null） */
  base: number | null
  /** ルーターが出している履歴の idx */
  shownIdx: number
  /** あると分かっている履歴のいちばん大きい idx */
  top: number
  /** 押した時に土台と印の履歴を作る */
  buildPending: boolean
  /** 最初の履歴へ戻った、もう一度「戻る」で閉じる所（閉じられなかった・ホーム画面の Android の1回目の「戻る」） */
  exitArmed: boolean
  /** 押している間・ドラッグの途中（アプリから履歴を動かすのを待っている） */
  held: boolean
  /** iPhone: ブラウザが身振りの絵を出しているとみなす間（端からのフリックが来てから） */
  swipePicture: boolean
  /** iPhone: 土台の後ろの「進む」の印の絵を写すのを待っている・写している・その印で指を離すのを待っている（recordForward） */
  recording: boolean
  /** iPhone: 土台の後ろの履歴の絵が、まだ今のカレンダーでない（閉じた画面の絵・絵が無い） */
  forwardDirty: boolean
}

/** アプリを閉じた結果: left = 離れた、armed = 最初の履歴へ戻った（もう一度［戻る］で閉じる）、stayed = 離れられなかった */
export type LeaveResult = 'left' | 'armed' | 'stayed'

/** 自分で始めた戻る・進むの popstate を待つ長さの上限（来ない時は、今の履歴の state を読み直して先へ進む） */
export const TRAVEL_TIMEOUT_MS = 1000
/** 閉じる時に、アプリの前の履歴へ移ってページが離れるのを待つ長さ */
export const LEAVE_WAIT_MS = 700
/** window.close() を試してから待つ長さ */
export const CLOSE_WAIT_MS = 300
/** 押した・キーを打った直後とみなす長さ（navigator.userActivation が無いブラウザだけ。WebKit の 10秒・Chromium の 5秒より短く） */
const ACTIVATION_FALLBACK_MS = 4000
/** 押し終えたのにドラッグが続いている（落とした後の片付けの間）時に、もう一度見るまでの長さ */
export const FREE_POLL_MS = 50
/**
 * 押している物（1つずつ）が、これより長くその物の出来事を送ってこなければ、離したのを見落としたとみなす（いつまでも履歴を動かせなく
 * ならないように）
 */
export const PRESS_STALE_MS = 10_000
/**
 * ホーム画面から開いた Android のアプリのもう一度［戻る］で閉じる所で、指（マウス・ペン）を下ろしたまま、これより長くたったら（長押し。
 * 取り消されていない物だけ）、離すのを待たずに出していた所へ戻る。指で掴む（src/features/calendar/week/dnd/gesture.ts の
 * TOUCH_HOLD_MS = 400）・一覧の長押しのメニュー（500）より短く、掴む前に戻る。Android の戻る身振りは、下ろした指を身振りと分かった所で
 * 取り消す見込みなので、身振りの「戻る」では戻らない（開発）
 */
export const ARM_HOLD_MS = 300
/** 聞く出来事（押す・離す・キーを打つ。capture で、アプリの部品より先に聞く） */
const INPUT_EVENTS = [
  'pointerdown',
  'pointermove',
  'pointerup',
  'pointercancel',
  'mousedown',
  'touchstart',
  'touchend',
  'touchcancel',
  'keydown',
  'keyup',
  'click',
] as const
/** 押し終えた出来事（ここで、待っていた物を進め、最初に押し終えた時なら印の履歴を作る） */
const PRESS_END_EVENTS = new Set(['pointerup', 'pointercancel', 'touchend', 'touchcancel', 'keyup', 'click'])
/**
 * iPhone: 端からのフリックが来てから、ブラウザが身振りの絵を出しているとみなす間: 最初に描く時（身振りが終わる動きの間は描かない）の
 * 後に、さらに SWIPE_SETTLE_FRAMES 回描いて SWIPE_SETTLE_MS 待つまで（WebKit は、描く物が足りていれば、動きの後の1〜2回の描く時で
 * 外す）
 */
export const SWIPE_SETTLE_FRAMES = 3
export const SWIPE_SETTLE_MS = 100
/** iPhone: 画面を替えてから描かれたとみなすまで（PAINT_FRAMES 回描いて PAINT_MS 待つ。WebKit は描き終えた絵を写す） */
export const PAINT_FRAMES = 2
export const PAINT_MS = 50
/**
 * iPhone: 指を下ろしてから、これより短い間は、離していても自分から「進む」の印へ行かない（念のため。指が下りている間は、いつも行かない）
 */
export const TOUCH_QUIET_MS = 100
/** 1回描くのを待つ長さの上限（描かない時（見えていない・テストの作り物）でも止まらないように） */
const FRAME_TIMEOUT_MS = 1000
/**
 * iPhone: モードを回した後の描く物を、行き先の絵の描く物の数のこの割合までは足す（WebKit が身振りの絵を外すのを待つ物の1つが、
 * 描く物が絵の半分を超えること。数は見積もりなので、余裕を見る）
 */
export const BALLAST_FRACTION = 0.8
/** 行き先の絵の描く物の数が分からない時の見積もり（今の画面の何倍か） */
const UNKNOWN_PICTURE_FACTOR = 2
/** 見えない描く物の上限 */
const BALLAST_MAX = 6000

/** 履歴の state の DS の印 */
interface Meta {
  /** 土台（カレンダーを置く履歴）の idx */
  base: number
  /** 印の履歴（back = 土台の前、fwd = 土台・積んだ画面の後ろ） */
  mark?: 'back' | 'fwd'
}

/** 履歴の state（react-router の形に ds を足した物） */
interface EntryState {
  usr?: unknown
  key?: string
  idx?: number
  ds?: Meta
}

function stateOf(value: unknown): EntryState | null {
  return value && typeof value === 'object' ? (value as EntryState) : null
}

function metaOf(value: unknown): Meta | null {
  const ds = stateOf(value)?.ds
  return ds && typeof ds === 'object' && typeof ds.base === 'number' ? ds : null
}

/** react-router と同じ形の key */
function makeKey(): string {
  return Math.random().toString(36).substring(2, 10)
}

const PROTOCOL_RELATIVE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i

/** ルーターが渡す行き先か（key を持つ物） */
function isLocation(to: unknown): to is Location {
  return Boolean(to && typeof to === 'object' && typeof (to as Location).key === 'string')
}

/** 1つの動き（書き込み・戻る・進む。戻る・進むを待つ物は Promise を返す） */
type Op = () => void | Promise<unknown>

/**
 * アプリの履歴（react-router の History の形）。src/App.tsx が createAppHistory で1つだけ作り、UNSAFE_createRouter に渡す
 */
export class AppHistory implements RouterHistory {
  /** 画面から受け取る動き */
  handlers: HistoryHandlers = {}
  private listener: Listener | null = null
  private act: NavigationType = NavigationType.Pop
  /** 今いる履歴の idx（ページの最初の履歴が 0） */
  private cur: number
  /** 土台の idx（まだ作っていなければ null） */
  private base: number | null
  /** あると分かっている履歴のいちばん大きい idx（これより後ろに履歴があるかを見る） */
  private top: number
  /** top は読み込み直した時の当て推量（土台の後ろに1つあるとみなした。アプリが積むまで。閉じる時の近道には使わない） */
  private topGuessed = false
  /** 閉じる途中で、window.close() を試して待っている（その間に来た「戻る」「進む」は何もしない。doLeave が終わりに片付ける） */
  private closing = false
  /** ルーターが出している行き先と、その履歴の idx */
  private shown: Location
  private shownIdx: number
  /** 押した時に土台と印の履歴を作る */
  private buildPending = false
  /** 読み込み直した所が印の履歴だった（ルーターが聞き始めたら土台へ戻る） */
  private startOnMarker = false
  /** 最初の履歴へ戻った、もう一度「戻る」で閉じる所（閉じられなかった・armExit）。押し終えたら土台へ戻る */
  private exitArmed = false
  /** armExit の所を終える時の見張り（決めた長さが過ぎたら土台へ戻る）と、終わった時に知らせる先 */
  private armTimer: number | null = null
  private armEnd: (() => void) | null = null
  /** armExit の所で、下ろしたままの指を見張る（ARM_HOLD_MS） */
  private armHoldTimer: number | null = null
  /**
   * armExit にする「戻る」が来てから、その所にするまで（書きかけを保存している間）: 来た時に押していたか（その押し方を離したのは数えない）と、
   * その後に押し終えた・キーを打ったか（その所にしない）
   */
  private armBack: { held: boolean; pressed: boolean } | null = null
  private leaveGen = 0
  private pageHidden = false
  private lastActivation = -Infinity
  /**
   * 下りている指・マウス・ペン（pointerId → 押し方の種類と、その物の最後の出来事の時刻。離したのを見落とした物は、PRESS_STALE_MS で
   * 外す）
   */
  private readonly pointers = new Map<number | string, { type: string; at: number }>()
  /** 画面に触れている指の数（touch の出来事。WebKit はスクロールに取った指を pointer では離す）と、その最後の出来事の時刻 */
  private touches = 0
  private touchAt = -Infinity
  /** 押し終えてドラッグも終わるのを待っている物 */
  private readonly freeWaiters: (() => void)[] = []
  /**
   * 「戻る」「進む」が来た所から出していた所へ戻す動き（rush）。順番を待っている物より先に行い、押し終えるのを待っている物があれば、
   * その待つ間に行う
   */
  private readonly urgent: Op[] = []
  private freeTimer: number | null = null
  /** iPhone の詳細の画面などの後ろに置く「進む」の印を、押している間だったので後に回した */
  private forwardPending = false
  /** 押し終えた時の印の履歴を作る（置く）動きを、もう順番に入れた */
  private markQueued = false
  /** iPhone: 最後に端からのフリックが来た時刻（それより前の指の出来事は、身振りに取られた物） */
  private swipeAt = -Infinity
  /** iPhone: ブラウザが身振りの絵を出しているとみなす間（と、その数え直しの番号） */
  private afterSwipe = false
  private swipeGen = 0
  /** iPhone: 土台の後ろの履歴の絵が、まだ今のカレンダーでない（閉じた画面の絵・積み直した「進む」の印で絵が無い） */
  private forwardDirty = false
  /** iPhone: recordForward を、描かれるのを待ってから順番に入れる・行っている */
  private recordScheduled = false
  private recordRunning = false
  /**
   * iPhone: recordForward で土台の後ろへ行った後に指が下りたので、そこで待っている（離した時に戻る。marker = そこを「進む」の印に
   * した。restore = 土台のスクロールの戻し方を元に戻す）
   */
  private parked: { marker: boolean; restore: (target: number) => Promise<void> | void } | null = null
  /** 利用者の「戻る」「進む」（アプリが自分で動いた物でない）が最後に来た時刻 */
  private lastUserPopAt = -Infinity
  /** iPhone: 最後に指を下ろした時刻（touchstart） */
  private touchStartAt = -Infinity
  /** iPhone: 最後に回した時の、行き先の絵の描く物の数（topUpBallast） */
  private lastPicture = 0
  /** iPhone: 履歴（idx）ごとの、絵を写した時の描く物の数（自分で離れた時と、身振りの始まりで控える） */
  private readonly weights = new Map<number, number>()
  /** iPhone: 端からのフリックが来た時の描く物の数・置いている見えない描く物の数 */
  private popWeight = 0
  private ballastCount = 0
  /** 自分で始めた戻る・進むの popstate を待っている物（expect は着くはずの idx） */
  private waiting: { finish: (came: boolean) => void; expect: number } | null = null
  /** アプリが作っていない履歴へ来た数（来たら、自分で動いている途中の物はやめる: travelTo・写し直す・閉じる） */
  private outsideGen = 0
  private readonly queue: Op[] = []
  private running = false
  private readonly idleWaiters: (() => void)[] = []
  private readonly win: HistoryWindow

  constructor(private readonly opts: AppHistoryOptions) {
    const win = (this.win = opts.window)
    let st = stateOf(win.history.state)
    if (typeof st?.idx !== 'number') {
      win.history.replaceState({ ...st, idx: 0 }, '')
      st = stateOf(win.history.state)
    }
    this.cur = this.top = st?.idx ?? 0
    this.shownIdx = this.cur
    this.shown = this.readLocation()
    const meta = metaOf(st)
    this.base = meta ? meta.base : null
    if (meta?.mark && meta.base !== this.cur) this.startOnMarker = true
    // 読み込み直した土台の後ろには、作った時の印の履歴か、閉じた画面の履歴がある
    if (this.base !== null && this.cur === this.base) this.top = this.cur + 1
    this.topGuessed = this.top > this.cur
    if (this.base === null && this.screen(this.shown) === 'calendar') this.buildPending = true
    win.addEventListener('popstate', this.onPop)
    win.addEventListener('pagehide', this.onPageHide)
    win.addEventListener('pageshow', this.onPageShow)
    win.addEventListener('blur', this.onBlur)
    win.addEventListener('visibilitychange', this.onVisibility)
    for (const type of INPUT_EVENTS) win.addEventListener(type, this.onInput, true)
  }

  get action(): NavigationType {
    return this.act
  }

  get location(): Location {
    return this.readLocation()
  }

  createHref(to: To): string {
    const base = this.win.document.querySelector('base')
    let href = ''
    if (base && base.getAttribute('href')) {
      const url = this.win.location.href
      const hashIndex = url.indexOf('#')
      href = hashIndex === -1 ? url : url.slice(0, hashIndex)
    }
    return `${href}#${typeof to === 'string' ? to : createPath(to)}`
  }

  createURL(to: To): URL {
    const origin = this.win.location.origin !== 'null' ? this.win.location.origin : this.win.location.href
    let href = (typeof to === 'string' ? to : createPath(to)).replace(/ $/, '%20')
    if (PROTOCOL_RELATIVE.test(href)) href = origin + href
    return new URL(href, origin)
  }

  encodeLocation(to: To): { pathname: string; search: string; hash: string } {
    const url = this.createURL(to)
    return { pathname: url.pathname, search: url.search, hash: url.hash }
  }

  listen(listener: Listener): () => void {
    this.listener = listener
    if (this.startOnMarker && this.base !== null) {
      this.startOnMarker = false
      const base = this.base
      this.run(async () => {
        await this.untilFree()
        await this.travelTo(base)
        this.deliver()
      })
    }
    return () => {
      if (this.listener === listener) this.listener = null
    }
  }

  push(to: To, state?: unknown): void {
    const location = this.toLocation(to, state)
    this.run(() => this.write('push', location))
  }

  replace(to: To, state?: unknown): void {
    const location = this.toLocation(to, state)
    this.run(() => this.write('replace', location))
  }

  /**
   * ルーターの戻る・進む（navigate(-1)・書きかけの確かめで止めた「戻る」を戻す・続ける）。ルーターが出している所から数え（土台へ
   * 戻している途中に呼ばれても）、来た所はルーターに渡す。iPhone で登録・詳細の画面を閉じる時は、戻る前に隠して描かせる
   */
  go(delta: number): void {
    const target = this.shownIdx + delta
    this.run(async () => {
      await this.untilFree()
      // iPhone: 「進む」の印で指を離すのを待っていた（recordForward）: 先に土台へ戻る
      await this.unpark()
      // 押し終えるのを待つ間に、利用者の「戻る」「進む」でもうそこを出していた（押している間に［×］と OS の戻るの両方で閉じた時など）
      if (delta !== 0 && this.shownIdx === target && this.cur === target) return
      const gen = this.swipeGen
      const shown = await this.hideBeforeLeave(delta)
      // 隠して描かせる間に来た「戻る」「進む」から戻す動き（rush）を先に済ませ、押されていれば離してドラッグも終わるまで待つ（押して
      // いる間は履歴を動かさない）。待った時は、もう一度描かせる
      while (shown && (await this.untilFree())) await this.painted()
      // 隠して待つ間に、利用者の「戻る」「進む」でもう閉じていた
      if (shown && this.shownIdx === target && this.cur === target) {
        shown(true)
        return
      }
      // 身振りの絵を出している間に離れると、離れる履歴の絵は写らない（前の絵のまま）
      const covered = this.afterSwipe
      await this.travelTo(target)
      this.deliver()
      shown?.(this.cur === target)
      // iPhone: 閉じた画面の履歴の絵が、閉じる前の画面のまま（隠さない画面（MIM・設定）・隠す間や身振りの絵の間にフリックが来た）。
      // 落ち着いてから、その履歴を「進む」の印に替えて今のカレンダーの絵にする
      if (!shown || covered || gen !== this.swipeGen) this.markForwardDirty()
    })
  }

  /**
   * アプリを閉じる（「Diary Studio を閉じますか？」の［閉じる］）。閉じられずに、もう一度［戻る］で閉じる所にした時（'armed'）は、その所が
   * 終わった時（押し終えた・長押し・ほかの「戻る」「進む」など。armExit と同じ。時間の限りは無い）に onArmEnd を呼ぶ
   */
  leave(onArmEnd?: () => void): Promise<LeaveResult> {
    return new Promise((resolve) => this.run(() => this.doLeave(onArmEnd).then(resolve)))
  }

  /**
   * もう一度［戻る］で閉じる所にする（ホーム画面から開いた Android のアプリのカレンダーでの「戻る」。docs/SPEC.md の 3.1・■25）:
   * 押し終えてドラッグも終わってから、アプリの最初の履歴（idx 0）へ移り、ms の間だけその所にする（その間のもう一度の「戻る」で、
   * ブラウザがアプリの前へ戻る＝閉じる）。時間が過ぎた・押し終えた・キーを打った・押したまま ARM_HOLD_MS たった・ほかの「戻る」
   * 「進む」が来た・アプリが自分で土台へ戻った・ほかの画面を開いた時に終わり、onEnd を呼んで出していた所へ戻る（次の「戻る」でまたこの
   * 所にする）。返す Promise は、その所にした時 true、できなかった時（カレンダーを出していない・最初の履歴へ移れなかった・「戻る」の後に
   * 押し終えた・キーを打った）false（その時 onEnd は呼ばない）
   */
  armExit(ms: number, onEnd: () => void): Promise<boolean> {
    return new Promise((resolve) =>
      this.run(async () => {
        await this.untilFree()
        // 「戻る」の後に（書きかけを保存している間に）押し終えた・キーを打った: カレンダーを使い続けている
        const pressed = this.armBack?.pressed === true
        this.armBack = null
        if (pressed || this.base === null || this.shownIdx === 0 || this.screen(this.shown) !== 'calendar') {
          resolve(false)
          return
        }
        await this.travelTo(0)
        if (this.cur !== 0) {
          if (this.cur !== this.shownIdx) await this.travelTo(this.shownIdx)
          resolve(false)
          return
        }
        this.exitArmed = true
        this.armEnd = onEnd
        this.armTimer = this.win.setTimeout(() => this.expireArmed(), ms)
        resolve(true)
      }),
    )
  }

  /** 履歴を動かし終えるまで待つ（E2E 用） */
  whenIdle(): Promise<void> {
    if (!this.running && !this.waiting) return Promise.resolve()
    return new Promise((resolve) => this.idleWaiters.push(resolve))
  }

  /** 今の履歴の形（E2E・単体テスト用） */
  shape(): HistoryShape {
    return {
      source: this.opts.source,
      exit: this.opts.exit ?? 'ask',
      busy: this.running || this.waiting !== null,
      cur: this.cur,
      base: this.base,
      shownIdx: this.shownIdx,
      top: this.top,
      buildPending: this.buildPending,
      exitArmed: this.exitArmed,
      held: !this.free(),
      swipePicture: this.afterSwipe,
      recording: this.recordScheduled || this.recordRunning || this.parked !== null,
      forwardDirty: this.forwardDirty,
    }
  }

  /** 片付ける（テスト用） */
  dispose(): void {
    this.win.removeEventListener('popstate', this.onPop)
    this.win.removeEventListener('pagehide', this.onPageHide)
    this.win.removeEventListener('pageshow', this.onPageShow)
    this.win.removeEventListener('blur', this.onBlur)
    this.win.removeEventListener('visibilitychange', this.onVisibility)
    this.swipeGen++
    for (const type of INPUT_EVENTS) this.win.removeEventListener(type, this.onInput, true)
    this.stopFreeTimer()
    if (this.armTimer !== null) this.win.clearTimeout(this.armTimer)
    if (this.armHoldTimer !== null) this.win.clearTimeout(this.armHoldTimer)
    this.armTimer = this.armHoldTimer = null
  }

  // ---------- 中身 ----------

  private now(): number {
    return this.opts.now?.() ?? performance.now()
  }

  private screen(location: { pathname: string; state: unknown }): ScreenKind {
    return this.opts.screenOf({ pathname: location.pathname, state: location.state })
  }

  private idx(): number | null {
    const idx = stateOf(this.win.history.state)?.idx
    return typeof idx === 'number' ? idx : null
  }

  /** 今の window の行き先（react-router の createHashHistory と同じ読み方） */
  private readLocation(): Location {
    const parsed = parsePath(this.win.location.hash.substring(1))
    let pathname = parsed.pathname ?? '/'
    if (!pathname.startsWith('/') && !pathname.startsWith('.')) pathname = `/${pathname}`
    const st = stateOf(this.win.history.state)
    return { pathname, search: parsed.search ?? '', hash: parsed.hash ?? '', state: st?.usr ?? null, key: st?.key ?? 'default' }
  }

  private toLocation(to: To, state: unknown): Location {
    if (isLocation(to)) return to
    const parts = typeof to === 'string' ? parsePath(to) : to
    return { pathname: this.shown.pathname, search: '', hash: '', ...parts, state: state ?? null, key: makeKey() }
  }

  /** 順に行う（動いていなければすぐ始める: ルーターの書き込みは今までどおりその場で履歴に書く） */
  private run(op: Op): void {
    this.queue.push(op)
    if (!this.running) void this.drain()
  }

  /**
   * 「戻る」「進む」が来た所から出していた所へ戻す: 順番を待っている物より先に行い、押し終えるのを待っている物（untilFree）があれば、
   * その待つ間に行う（押している間に来た「戻る」で印の履歴に残ったままにして、もう一度の「戻る」でアプリを離れないように）
   */
  private rush(op: Op): void {
    this.urgent.push(op)
    if (!this.running) void this.drain()
    else for (const resolve of this.freeWaiters.splice(0)) resolve()
  }

  private async drain(): Promise<void> {
    this.running = true
    try {
      while (this.urgent.length > 0 || this.queue.length > 0) {
        const op = (this.urgent.length > 0 ? this.urgent : this.queue).shift()!
        try {
          const result = op()
          if (result) await result
        } catch (error) {
          console.error('履歴の書き込みに失敗しました', error)
        }
      }
    } finally {
      this.running = false
      if (!this.waiting) for (const resolve of this.idleWaiters.splice(0)) resolve()
    }
  }

  /** この履歴に書く DS の印（土台が無ければ書かない） */
  private meta(): { ds?: Meta } {
    return this.base === null ? {} : { ds: { base: this.base } }
  }

  private replaceHere(location: Location): void {
    swipeLog('replace', { idx: this.cur })
    this.win.history.replaceState(
      { usr: location.state, key: location.key, idx: this.cur, ...this.meta() },
      '',
      this.createHref(location),
    )
    this.shown = location
    this.shownIdx = this.cur
  }

  private pushHere(location: Location): void {
    const idx = this.cur + 1
    const url = this.createHref(location)
    // 積む画面と、今の履歴（土台など。戻った時にブラウザが位置を戻す）は auto にする（印を作る・置く時に manual にした所を、土台へ
    // 戻り終える前に利用者の「戻る」「進む」が来て auto に戻せなかった時の念のため。印の履歴は替えない）
    const h = this.win.history
    if (h.scrollRestoration === 'manual' && !metaOf(h.state)?.mark) {
      try {
        h.scrollRestoration = 'auto'
      } catch {
        // 変えられない
      }
    }
    this.notePush()
    swipeLog('push', { idx })
    try {
      this.win.history.pushState({ usr: location.state, key: location.key, idx, ...this.meta() }, '', url)
    } catch (error) {
      // react-router と同じ: 積めない時（Safari の回数の上限など）は、ページごとその行き先を開く
      if ((error as { name?: string } | null)?.name === 'DataCloneError') throw error
      this.win.location.assign(url)
      return
    }
    // 土台の後ろの履歴（閉じた画面・「進む」の印）は、積んだ物に替わった
    if (this.cur === this.base) this.forwardDirty = false
    this.cur = this.top = idx
    this.topGuessed = false
    this.shown = location
    this.shownIdx = idx
  }

  private write(kind: 'push' | 'replace', location: Location): void | Promise<void> {
    this.act = kind === 'push' ? NavigationType.Push : NavigationType.Replace
    const screen = this.screen(location)
    if (screen === 'calendar') return this.writeCalendar(location)
    if (this.exitArmed && this.cur !== this.shownIdx) {
      // もう一度［戻る］で閉じる所（最初の履歴）でほかの画面を開いた（押したまま開いた時など）: 終えて、出していた所へ戻ってから書く
      // （最初の履歴の後ろに積んで、土台と「進む」の印を書きつぶさないように）
      this.endArmed()
      return this.travelTo(this.shownIdx).then(() => this.write(kind, location))
    }
    if (this.parked) {
      // iPhone: 「進む」の印で指を離すのを待っている（recordForward）: 離して土台へ戻ってから書く（印の後ろに積まないように）
      return this.untilFree()
        .then(() => this.unpark())
        .then(() => this.write(kind, location))
    }
    if (kind === 'replace') this.replaceHere(location)
    else this.pushHere(location)
    // iPhone: 登録・詳細の画面・MIM・設定の後ろにも「進む」の印を置く（右の端からのフリックでも閉じる・戻る）。登録の画面を詳細の画面に
    // 置き換えた時（複製のお知らせの［開く］）は、もう後ろにある
    if (this.opts.source === 'edge-flick' && this.base !== null && this.top <= this.cur && this.activated()) {
      // 押している間（長押しで開いた時など）は、押し終えてから置く
      if (this.free()) return this.addForward()
      this.forwardPending = true
    }
  }

  /** カレンダーの行き先は、いつも土台に置く（積まずに置き換える。積んだ画面から移る時は土台まで戻ってから） */
  private writeCalendar(location: Location): void | Promise<void> {
    if (this.base === null) {
      // 押している間（掴んだまま端で週が替わった時など）は今の履歴を置き換え、押し終えた時に作る。iPhone で画面にカレンダーのほかの物が
      // 出ている時も（印の絵に写さない）
      if (this.activated() && this.free() && !this.covered()) return this.build(location)
      this.replaceHere(location)
      this.buildPending = true
      return
    }
    if (this.cur === this.base) {
      this.replaceHere(location)
      return
    }
    const base = this.base
    return this.untilFree()
      .then(() => this.unpark())
      .then(async () => {
        const left = this.cur
        const wasMark = Boolean(metaOf(this.win.history.state)?.mark)
        await this.travelTo(base)
        // 戻れなかった時は、今いる所を土台にする
        if (this.cur !== base) this.base = this.cur
        this.replaceHere(location)
        // iPhone: 積んだ画面（設定など）から土台へ戻った（その画面の履歴が、離れた時の絵で後ろに残る）
        if (left > base && !wasMark) this.markForwardDirty()
      })
  }

  /**
   * 土台と印の履歴を作る: 今の履歴を「戻る」の印に替え、その後ろに土台（この行き先）と「進む」の印を積んで、土台へ1つ戻る。
   * 押し終えた・キーを打った直後で、押している物もドラッグも無い時だけ（ブラウザに外されないように・指の動きを邪魔しないように）
   */
  private build(location: Location): Promise<void> | void {
    if (this.base !== null) return
    this.buildPending = false
    const at = this.cur
    const base = at + 1
    const href = this.createHref(location)
    const h = this.win.history
    // 「戻る」の印・土台・「進む」の印は、スクロールの位置を戻させない（この後に積む物も同じになる）。土台へ戻り終えたら、土台だけ戻す
    const restore = this.manualScroll()
    swipeLog('build', { base })
    h.replaceState({ usr: location.state, key: location.key, idx: at, ds: { base, mark: 'back' } }, '', href)
    this.notePush()
    h.pushState({ usr: location.state, key: location.key, idx: base, ds: { base } }, '', href)
    this.cur = base
    this.notePush()
    h.pushState({ usr: null, key: makeKey(), idx: base + 1, ds: { base, mark: 'fwd' } }, '', href)
    this.base = base
    this.cur = this.top = base + 1
    this.shown = location
    this.shownIdx = base
    this.forwardDirty = false
    // iPhone: 印の絵は、ここで写した物のまま（写し直さない。作るのは画面がカレンダーだけで描かれた後: markAfterPress）
    return this.travelTo(base).then(() => restore(base))
  }

  /** 今の履歴の後ろに「進む」の印を積んで、1つ戻る（印は、スクロールの位置を戻させない。build と同じ） */
  private addForward(): Promise<void> {
    const back = this.cur
    const restore = this.manualScroll()
    this.notePush()
    swipeLog('push', { idx: back + 1, mark: 'fwd' })
    this.win.history.pushState(
      { usr: null, key: makeKey(), idx: back + 1, ds: { base: this.base ?? back, mark: 'fwd' } },
      '',
      this.win.location.href,
    )
    this.cur = this.top = back + 1
    return this.travelTo(back).then(() => restore(back))
  }

  /**
   * 今の履歴（とこの後に積む履歴）を、「戻る」「進む」で来た時にスクロールの位置を戻させない（manual）にする。返す関数は、戻り終えた
   * 履歴（idx が target の物）を元（auto）に戻す: ブラウザは戻る・進むを終えた後（popstate を送った後）に位置を戻すので、次の処理まで
   * 待ってから（その間に来たルーターの書き込みは順番を待つ。積んだ履歴に manual を写さないように）。その間に利用者の「戻る」「進む」で
   * ほかの履歴へ移っていたら、そこ（印の履歴）は替えない
   */
  private manualScroll(): (target: number) => Promise<void> | void {
    const h = this.win.history
    const before = h.scrollRestoration
    if (before === undefined || before === 'manual') return () => {}
    try {
      h.scrollRestoration = 'manual'
    } catch {
      return () => {}
    }
    return (target) =>
      this.wait(0).then(() => {
        if (this.idx() !== target) return
        try {
          h.scrollRestoration = before
        } catch {
          // 変えられない
        }
      })
  }

  /**
   * その idx の履歴へ移る（来た popstate はルーターに渡さない。思った所と違えば、もう2回まで移り直す。アプリが作っていない履歴が来たら
   * （利用者の行き先として描いた）、そこで止める）
   */
  private async travelTo(target: number): Promise<void> {
    const outside = this.outsideGen
    for (let attempt = 0; attempt < 3 && this.cur !== target && outside === this.outsideGen; attempt++) {
      if (!(await this.traverse(target - this.cur, TRAVEL_TIMEOUT_MS))) break
    }
    // 「もう一度［戻る］で閉じる」所は、最初の履歴にいる間だけ（自分で土台へ戻った時（今日へ戻すなど）も、押した時と同じく外す）
    if (this.cur !== 0 && this.exitArmed) this.endArmed()
  }

  /** 「もう一度［戻る］で閉じる」所を終える（見張りを止め、armExit の onEnd に知らせる。出していた所へ戻すのは呼んだ所） */
  private endArmed(): void {
    this.exitArmed = false
    if (this.armTimer !== null) {
      this.win.clearTimeout(this.armTimer)
      this.armTimer = null
    }
    if (this.armHoldTimer !== null) {
      this.win.clearTimeout(this.armHoldTimer)
      this.armHoldTimer = null
    }
    const end = this.armEnd
    this.armEnd = null
    try {
      end?.()
    } catch (error) {
      console.error('もう一度［戻る］で閉じる所の片付けに失敗しました', error)
    }
  }

  /** armExit の長さが過ぎた（もう一度の「戻る」が来なかった）: 出していた所へ戻る */
  private expireArmed(): void {
    this.armTimer = null
    if (this.exitArmed) this.leaveArmed()
  }

  /**
   * もう一度［戻る］で閉じる所を終えて、出していた所へ戻る。押している間・ドラッグの途中でも待たない（rush。お知らせが消えた後・掴んでいる間に、
   * 最初の履歴に残ったまま、もう一度の「戻る」でアプリを離れないように）
   */
  private leaveArmed(): void {
    this.endArmed()
    const shownIdx = this.shownIdx
    this.rush(() => this.travelTo(shownIdx))
  }

  /**
   * もう一度［戻る］で閉じる所で指を下ろした: 下ろしたまま ARM_HOLD_MS たったら（長押し。取り消された指・離した指は見ない）、出していた
   * 所へ戻る
   */
  private watchArmHold(id: number | string): void {
    if (this.armHoldTimer !== null) this.win.clearTimeout(this.armHoldTimer)
    this.armHoldTimer = this.win.setTimeout(() => {
      this.armHoldTimer = null
      if (this.exitArmed && (this.pointers.has(id) || this.handlers.dragging?.())) this.leaveArmed()
    }, ARM_HOLD_MS)
  }

  /** 戻る・進む（delta）。popstate が来たら true（来ないまま timeout を過ぎたら、今の state を読み直して false） */
  private traverse(delta: number, timeout: number): Promise<boolean> {
    return new Promise((resolve) => {
      let done = false
      const finish = (came: boolean) => {
        if (done) return
        done = true
        this.win.clearTimeout(timer)
        if (this.waiting === waiting) this.waiting = null
        if (!came) this.cur = this.idx() ?? this.cur
        this.top = Math.max(this.top, this.cur)
        resolve(came)
      }
      const waiting = { finish, expect: this.cur + delta }
      this.waiting = waiting
      const timer = this.win.setTimeout(() => finish(false), timeout)
      this.noteLeave(this.cur)
      swipeLog('go', { delta, from: this.cur })
      this.win.history.go(delta)
    })
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => this.win.setTimeout(resolve, ms))
  }

  /**
   * 押している物（指・マウス・ペン）があるか（離したのを見落とした物は、その物の最後の出来事から PRESS_STALE_MS で外す。ほかの物を
   * 押し続けても、外す時は延びない）
   */
  private pressing(): boolean {
    if (this.pointers.size === 0 && this.touches === 0) return false
    const now = this.now()
    for (const [id, p] of this.pointers) if (now - p.at > PRESS_STALE_MS) this.pointers.delete(id)
    if (this.touches > 0 && now - this.touchAt > PRESS_STALE_MS) this.touches = 0
    // iPhone: 端からのフリックが来る前から出来事の無い指は、身振りに取られて離した（離す出来事は来ない。身振りの「戻る」「進む」は
    // 指を離した時に来る）
    for (const [id, p] of this.pointers) if (p.type === 'touch' && p.at <= this.swipeAt) this.pointers.delete(id)
    if (this.touches > 0 && this.touchAt <= this.swipeAt) this.touches = 0
    return this.pointers.size > 0 || this.touches > 0
  }

  /** 押している物もドラッグも無い（アプリから履歴を動かしてよい） */
  private free(): boolean {
    return !this.pressing() && !this.handlers.dragging?.()
  }

  /**
   * 押し終えてドラッグも終わるまで待つ（今そうなら、すぐ）。順番の中の動き（run）からだけ呼ぶ: 待つ間に来た「戻る」「進む」から戻す
   * 動き（rush）は、待ったままにせず、ここで先に行う。待った・戻す動きを行った時は true（すぐ返した時は false）
   */
  private async untilFree(): Promise<boolean> {
    let waited = false
    for (;;) {
      while (this.urgent.length > 0) {
        waited = true
        const op = this.urgent.shift()!
        try {
          const result = op()
          if (result) await result
        } catch (error) {
          console.error('履歴の書き込みに失敗しました', error)
        }
      }
      if (this.free()) return waited
      waited = true
      await new Promise<void>((resolve) => {
        this.freeWaiters.push(resolve)
        this.watchFree()
      })
    }
  }

  /** 指の pointer で残っている物を捨てる（離す出来事が来ないまま残った物。画面に触れている指が無い・新しく下ろした指が最初の1本） */
  private dropTouchPointers(): void {
    for (const [id, p] of this.pointers) if (p.type === 'touch') this.pointers.delete(id)
  }

  /** touch の出来事の、画面に触れている指の数（touchend・touchcancel で 0 になったら、指の pointer の残りも捨てる） */
  private countTouches(event: Event, ended: boolean): void {
    this.touches = (event as TouchEvent).touches?.length ?? 0
    this.touchAt = this.now()
    if (ended && this.touches === 0) this.dropTouchPointers()
  }

  /** 待っている物がある間、押し終えるのを見落とさないように、少しずつ見直す（落とした後の片付け・離したのを見落とした物） */
  private watchFree(): void {
    if (this.freeTimer !== null) return
    this.freeTimer = this.win.setTimeout(() => {
      this.freeTimer = null
      this.afterPress()
    }, FREE_POLL_MS)
  }

  private stopFreeTimer(): void {
    if (this.freeTimer === null) return
    this.win.clearTimeout(this.freeTimer)
    this.freeTimer = null
  }

  /**
   * 押し終えた（離した・キーを離した・押した物の click）時と、その後に見直す時: 押している物もドラッグも無くなっていれば、待っていた物を
   * 進め、押し終えた直後なら印の履歴を作る・「進む」の印を置く。まだなら少し後に見直す
   */
  private afterPress(): void {
    if (!this.free()) {
      if (this.freeWaiters.length > 0 || this.buildPending || this.forwardPending || this.parked) this.watchFree()
      return
    }
    this.stopFreeTimer()
    for (const resolve of this.freeWaiters.splice(0)) resolve()
    // iPhone: 「進む」の印で指を離すのを待っていた: 土台へ戻る。押している間・身振りの絵の間は写さなかった印の絵を、写す
    if (this.parked) this.run(() => this.unpark())
    else if (this.forwardDirty && !this.afterSwipe) this.scheduleRecord()
    if (this.markQueued || !this.activated()) return
    const atBase = this.base !== null && this.cur === this.base && this.shownIdx === this.base && this.top <= this.base
    if (!this.buildPending && !this.forwardPending && !(atBase && !this.running)) return
    this.markQueued = true
    this.run(() => this.markAfterPress())
  }

  /**
   * 押し終えた後の印: まだ土台が無ければ土台と印の履歴を作り、土台（や iPhone の登録・詳細の画面など）の後ろに履歴が無ければ「進む」の
   * 印を置く。順番が来た時に、もう一度確かめる（その間にまた押した・ブラウザが「押した直後」と数えなくなった時は、次に押し終えた時に）。
   * iPhone の土台の前後の印は、画面がカレンダーだけで描かれてから作る（印の絵は写し直さないので。上の物が出ていれば次に押し終えた時に）
   */
  private async markAfterPress(): Promise<void> {
    this.markQueued = false
    if (!this.free() || !this.activated()) return
    if (this.buildPending) {
      if (!this.canBuild() || this.covered()) return
      if (this.flicks) {
        await this.painted()
        if (!this.free() || !this.activated() || !this.canBuild() || this.covered()) return
      }
      return this.build(this.shown)
    }
    const pending = this.forwardPending
    this.forwardPending = false
    if (this.base === null || this.cur !== this.shownIdx || this.top > this.cur) return
    // 土台の後ろに履歴が無い（アドレス欄から来た所を土台にした時など）。iPhone の登録・詳細の画面などで、開いた時に押していて置かなかった
    const screen = this.screen(this.shown)
    if (this.cur === this.base) {
      if (this.covered()) return
      return this.addForward()
    }
    if (pending && this.flicks && screen !== 'calendar') return this.addForward()
  }

  /** 土台と印の履歴を作れる（まだ無く、ルーターが出している所にいて、カレンダーを出している） */
  private canBuild(): boolean {
    return this.base === null && this.cur === this.shownIdx && this.screen(this.shown) === 'calendar'
  }

  /** iPhone: 画面にカレンダーのほかの物が出ている（印の絵に写る） */
  private covered(): boolean {
    return this.flicks && this.handlers.cleanScreen?.() === false
  }

  /** 押した・キーを打った直後か（この後に積む履歴を、ブラウザが行き先から外さないか） */
  private activated(): boolean {
    const ua = this.win.navigator?.userActivation
    if (ua) return ua.isActive
    return this.now() - this.lastActivation < ACTIVATION_FALLBACK_MS
  }

  // ---------- iPhone の身振りの絵（docs/SPEC.md の 3.1。上の初めの説明） ----------

  /** 端からのフリックの端末（iPhone・iPad）か */
  private get flicks(): boolean {
    return this.opts.source === 'edge-flick'
  }

  /** ページの描く物の数の見積もり（無ければ 0） */
  private weigh(): number {
    return this.handlers.renderWeight?.() ?? 0
  }

  /** 今いる履歴を離れる（go）: WebKit はこの時の画面をこの履歴の絵に写す（身振りの絵を出している間は写さない）。描く物の数を控える */
  private noteLeave(idx: number): void {
    if (!this.flicks || this.afterSwipe) return
    const weight = this.weigh()
    if (weight > 0) this.weights.set(idx, weight + this.ballastCount)
  }

  /** 今の後ろに積む（pushState）: 後ろの履歴は無くなり（絵も消える）、今いる履歴は離れる */
  private notePush(): void {
    if (!this.flicks) return
    for (const idx of [...this.weights.keys()]) if (idx > this.cur) this.weights.delete(idx)
    this.noteLeave(this.cur)
  }

  /**
   * 利用者の「戻る」「進む」（端からのフリック）が来た: WebKit は身振りを始めた時に、離れた履歴（from）の絵をその時の画面で写し、
   * 着いた後もしばらく身振りの絵を出す（その間は絵を写さない）。その間とみなす長さを数え始める（指を離した後の動きの間は描かないので、
   * 最初に描く時の後に、さらに SWIPE_SETTLE_FRAMES 回描いて SWIPE_SETTLE_MS 待つまで。終わったら、見えない描く物を外し、土台の後ろの
   * 履歴の絵が今のカレンダーでなければ写す）。身振りに取られた指は離したとみなす（pressing）
   */
  private noteSwipe(from: number): void {
    this.lastUserPopAt = this.now()
    if (!this.flicks) return
    this.swipeAt = this.now()
    this.popWeight = this.weigh()
    if (this.popWeight > 0) this.weights.set(from, this.popWeight + this.ballastCount)
    // 足し直す目安は、この払いでモードを回した時だけ（閉じた払いの絵の間には足さない）
    this.lastPicture = 0
    this.afterSwipe = true
    const gen = ++this.swipeGen
    const at = this.now()
    void this.frames(1)
      .then(() => {
        // 動きの後に最初に描いた時（記録: 動きの長さの目安）
        if (gen === this.swipeGen) swipeLog('raf1', { ms: Math.round(this.now() - at) })
        return this.frames(SWIPE_SETTLE_FRAMES)
      })
      .then(() => this.wait(SWIPE_SETTLE_MS))
      .then(() => {
        if (gen !== this.swipeGen) return
        this.afterSwipe = false
        if (this.ballastCount > 0) {
          this.ballastCount = 0
          this.handlers.ballast?.(0)
        }
        swipeLog('settle', { forwardDirty: this.forwardDirty })
        if (this.forwardDirty) this.run(() => this.recordForward())
      })
  }

  /**
   * 端からのフリックでモードを回した直後: WebKit は、着いた後に画面が描き直され、描く物の数が行き先の履歴（target）の絵の半分を
   * 超えるなどするまで身振りの絵を外さない（長くて3秒。待つ物はほかにもある）。新しいモードが半分に届かない時（イヤーから月・日へ
   * など）は、見えない描く物を足して、その分は待たせない（身振りの絵を出しているとみなす間の終わりに外す）。新しいモードを数えるのは、
   * React が描いた後（popstate の中のルーターの更新は、その後の最初のマイクロタスクで描く）。身振りが終わる動きの間は、ブラウザは
   * 描かないので間に合う。土台の前後の絵は写し直さない（前のモードのまま）
   */
  private afterRing(target: number): void {
    if (!this.flicks) return
    const picture = Math.max(this.weights.get(target) ?? this.popWeight * UNKNOWN_PICTURE_FACTOR, this.popWeight)
    this.lastPicture = picture
    const { renderWeight, ballast } = this.handlers
    if (!renderWeight || !ballast) return
    const gen = this.swipeGen
    queueMicrotask(() => {
      if (gen !== this.swipeGen) return
      const need = Math.min(BALLAST_MAX, Math.ceil(picture * BALLAST_FRACTION) - renderWeight())
      if (need <= 0) return
      this.ballastCount = need
      ballast(need)
    })
  }

  /**
   * iPhone: 身振りの絵を出している間に、アプリの中でモードを回した（続けて払った分を画面の端で受け取った。src/ui/useSwipe.ts）: 新しい
   * モードの描く物が、前に回した時の行き先の絵の半分に届かなくなっていれば、見えない描く物を足し直す（React が描いた後に数える）
   */
  topUpBallast(): void {
    if (!this.flicks || !this.afterSwipe) return
    const { renderWeight, ballast } = this.handlers
    if (!renderWeight || !ballast) return
    const gen = this.swipeGen
    queueMicrotask(() => {
      if (gen !== this.swipeGen || !this.afterSwipe) return
      const need = Math.min(BALLAST_MAX, Math.ceil(this.lastPicture * BALLAST_FRACTION) - renderWeight())
      if (need <= this.ballastCount) return
      this.ballastCount = need
      ballast(need)
    })
  }

  /** 利用者の「戻る」「進む」（アプリが自分で動いた物でない）が、その時刻（now と同じ時計）より後に来たか */
  userPopSince(t: number): boolean {
    return this.lastUserPopAt >= t
  }

  /** n 回描くまで待つ（描かない時も、1回 FRAME_TIMEOUT_MS で先へ進む） */
  private frames(n: number): Promise<void> {
    return new Promise((resolve) => {
      const step = (left: number) => {
        if (left <= 0) {
          resolve()
          return
        }
        let done = false
        const next = () => {
          if (done) return
          done = true
          this.win.clearTimeout(timer)
          step(left - 1)
        }
        const timer = this.win.setTimeout(next, FRAME_TIMEOUT_MS)
        if (this.win.requestAnimationFrame) this.win.requestAnimationFrame(next)
        else this.win.setTimeout(next, 16)
      }
      step(n)
    })
  }

  /** 今の画面が描かれるまで待つ */
  private painted(): Promise<void> {
    return this.frames(PAINT_FRAMES).then(() => this.wait(PAINT_MS))
  }

  /**
   * iPhone: 土台の後ろの履歴の絵が今のカレンダーでなくなった（閉じた画面の絵のまま・積み直した「進む」の印で絵が無い）: 身振りの絵が
   * 消えた頃（noteSwipe の終わり）か、今なら描かれるのを待ってから、recordForward で写す。土台にいて、後ろに履歴がある時だけ
   */
  private markForwardDirty(): void {
    if (!this.flicks || this.base === null || this.cur !== this.base || this.top <= this.base) return
    this.forwardDirty = true
    if (!this.afterSwipe) this.scheduleRecord()
  }

  /** recordForward を、今の画面が描かれるのを待ってから順番に入れる（もう入れていれば何もしない） */
  private scheduleRecord(): void {
    if (this.recordScheduled) return
    this.recordScheduled = true
    void this.painted().then(() => this.run(() => this.recordForward()))
  }

  /**
   * recordForward をしてよいか（よくない時は、その訳）: 身振りの絵の間・自分で動いている途中でなく、土台でカレンダーだけを出していて
   * （後ろに履歴がある）、押している物もドラッグも無く、指を下ろしてから少したっている（TOUCH_QUIET_MS）
   */
  private recordBlocked(): string | null {
    const base = this.base
    if (this.afterSwipe) return 'swipe'
    if (this.waiting || this.parked) return 'moving'
    if (base === null || this.cur !== base || this.shownIdx !== base || this.idx() !== base) return 'away'
    if (this.top <= base) return 'none'
    if (this.screen(this.shown) !== 'calendar' || this.covered()) return 'covered'
    if (!this.free()) return 'held'
    if (this.now() - this.touchStartAt < TOUCH_QUIET_MS) return 'touch'
    if (this.exitArmed || this.closing) return 'exit'
    return null
  }

  /**
   * iPhone: 土台の後ろの履歴（閉じた画面の履歴・積み直した「進む」の印）の絵を、今のカレンダーにする: 1つ後ろへ行き、「進む」の印で
   * なければ印に替え（履歴は増やさない）、土台へ戻る（WebKit は離れる履歴の絵を写す）。モードを回す払いの後には行わない（払って閉じた
   * 後・ルーターの戻るで隠さずに閉じた後だけ）。
   * 身振りの行き先は、身振りを始めた時に決まる（ViewGestureControllerIOS.mm の beginSwipeGesture・willEndSwipeGesture）。動く間に
   * 身振りが始まると、行き先が今いる所（読み込み直し: HistoryController.cpp の itemsAreClones）・切り捨てた所（3秒止まる）になる
   * ので、動く前ごとに確かめ、指が下りていれば動かない: 行く前ならやめ（forwardDirty のまま。次に押し終えた時・身振りの絵が消えた時に
   * また）、行った後なら、そこで待つ（parked。離した時に戻り、その指の払いで土台へ着いた時はそのままモードを回す）。go を送ってから
   * 着くまで（ブラウザの中の数ミリ秒）に身振りが始まった時は避けられない（3.1 の残ること）
   */
  private async recordForward(): Promise<void> {
    this.recordScheduled = false
    if (!this.flicks || !this.forwardDirty) return
    const blocked = this.recordBlocked()
    if (blocked) {
      if (blocked === 'none') this.forwardDirty = false
      // 指を下ろしたばかり（もう離した）: 少し後にもう一度
      if (blocked === 'touch') this.win.setTimeout(() => this.scheduleRecord(), TOUCH_QUIET_MS)
      swipeLog('record-skip', { reason: blocked })
      return
    }
    const base = this.base as number
    const outside = this.outsideGen
    this.recordRunning = true
    try {
      const restore = this.manualScroll()
      await this.traverse(1, TRAVEL_TIMEOUT_MS)
      // アプリが作っていない履歴が来た（利用者の行き先として描いた）: そこから動かない
      if (outside !== this.outsideGen) return
      if (this.cur !== base + 1) {
        // 後ろに履歴が無かった（読み込み直した後の当て推量）・ほかの所へ着いた
        if (this.cur === base && this.idx() === base) {
          this.top = base
          this.forwardDirty = false
          await restore(base)
          return
        }
        swipeLog('record-away', { cur: this.cur })
        await this.leaveForBase(false, restore)
        return
      }
      this.toForwardMarker(base)
      await this.leaveForBase(true, restore)
    } finally {
      this.recordRunning = false
    }
  }

  /**
   * recordForward の終わり: 土台へ戻る（marker = 今いる所を「進む」の印にした: 離れる時にその絵を写す）。指が下りていれば戻らず、そこで
   * 待つ（parked。指の下りている間に動くと、その身振りの行き先が今いる所になりうる）
   */
  private async leaveForBase(marker: boolean, restore: (target: number) => Promise<void> | void): Promise<void> {
    if (!this.free()) {
      this.parked = { marker, restore }
      swipeLog('parked', { cur: this.cur })
      // 離したのを見落としても、いつまでも待たない（PRESS_STALE_MS）
      this.watchFree()
      return
    }
    const base = this.base as number
    const outside = this.outsideGen
    await this.travelTo(base)
    if (outside !== this.outsideGen) return
    if (this.cur === base && marker) this.forwardDirty = false
    await restore(base)
    swipeLog('recorded', { cur: this.cur })
  }

  /**
   * 「進む」の印で指を離すのを待っていた（parked）: 押している物もドラッグも無ければ土台へ戻る（印の絵を写す）。まだ押していれば待ち
   * 続ける
   */
  private async unpark(): Promise<void> {
    const parked = this.parked
    if (!parked || !this.free()) return
    this.parked = null
    const base = this.base
    if (base === null) return
    const outside = this.outsideGen
    if (this.cur !== base) await this.travelTo(base)
    if (outside !== this.outsideGen) return
    if (this.cur === base && parked.marker) this.forwardDirty = false
    await parked.restore(base)
    swipeLog('unpark', { cur: this.cur })
  }

  /**
   * 「進む」の印で待っている時（parked）に、利用者の払いで出していた所（土台）へ着いた: その印から払ったのと同じ（身振りの始まりに
   * ブラウザが印の絵を写した）。履歴は動かさずに、することを決める（カレンダーならモードを回す）
   */
  private popFromMarker(parked: NonNullable<AppHistory['parked']>, idx: number, from: number): void {
    if (parked.marker) this.forwardDirty = false
    void parked.restore(idx)
    const action = decidePop(this.opts.source, this.screen(this.shown), idx < from ? 'back' : 'forward', this.opts.exit ?? 'ask')
    swipeLog('pop-from-marker', { kind: action.kind })
    if (action.kind !== 'ring') return
    this.handlers.ring?.(action.dir)
    this.afterRing(idx)
  }

  /** 今いる履歴（土台の後ろ）が「進む」の印でなければ（閉じた画面の履歴）、「進む」の印に替える（絵は、この後に離れる時に写る） */
  private toForwardMarker(base: number): void {
    const h = this.win.history
    const meta = metaOf(h.state)
    if (meta?.mark === 'fwd' && meta.base === base) return
    swipeLog('replace', { idx: this.cur, mark: 'fwd' })
    h.replaceState({ usr: null, key: makeKey(), idx: this.cur, ds: { base, mark: 'fwd' } }, '', this.createHref(this.shown))
    try {
      h.scrollRestoration = 'manual'
    } catch {
      // 変えられない
    }
  }

  /**
   * iPhone: 端からのフリックで登録・詳細の画面・MIM・設定を閉じて土台へ着いた時（popstate の後の処理。身振りが終わる動きの間なので、
   * 次の身振りは始まらない）: 閉じた画面の履歴は土台の後ろに残り、右の端から払った時の行き先になる。その絵は身振りの始まりに写した
   * 閉じる前の画面。押した直後（navigator.userActivation。ブラウザが、積んだ履歴を行き先から外さない間）なら、すぐ土台の後ろに「進む」の
   * 印を積み直して閉じた画面の履歴を切り捨て、1つ戻る（積み直した印には、身振りの絵の後に recordForward で写すまで絵が無い: その間に
   * 払うと白が出る）。押してから時間がたっていれば積まない（recordForward が閉じた画面の履歴を印に替える。それまでに払うと、閉じた
   * 画面の絵が出る。3.1 の残ること）
   */
  private dropClosed(): Promise<void> | void {
    if (!this.flicks || this.base === null || this.top <= this.base) return
    if (this.cur !== this.base || this.shownIdx !== this.base || !this.free() || !this.activated()) return
    swipeLog('drop-closed', { base: this.base, top: this.top })
    return this.addForward()
  }

  /**
   * iPhone で登録・詳細の画面をルーターの戻るで閉じる時（［×］・Esc・背景・登録・削除）: 戻る前に小さな画面と確かめを隠して描かせる
   * （WebKit は離れる履歴の絵をその時の画面で写す。閉じた画面の履歴が「進む」の行き先に残っても、絵に小さな画面を残さない）。返す関数は、
   * 戻れなかった時に出し直す（戻れた時は、ルーターが外す。外さなかった物も、少し後に出し直す）
   */
  private async hideBeforeLeave(delta: number): Promise<((left: boolean) => void) | null> {
    if (!this.flicks || delta >= 0) return null
    const screen = this.screen(this.shown)
    if (screen !== 'register' && screen !== 'detail') return null
    const show = this.handlers.hideSheets?.()
    if (!show) return null
    await this.painted()
    return (left) => {
      if (left) this.win.setTimeout(show, FRAME_TIMEOUT_MS)
      else show()
    }
  }

  /** ルーターに渡す（描く）。今いる履歴の行き先を、出していた所からの差と一緒に */
  private deliver(): void {
    const location = this.readLocation()
    const delta = this.cur - this.shownIdx
    this.shown = location
    this.shownIdx = this.cur
    this.act = NavigationType.Pop
    const meta = metaOf(this.win.history.state)
    if (this.base === null && meta) this.base = meta.base
    if (this.base === null && this.screen(location) === 'calendar') this.buildPending = true
    this.listener?.({ action: NavigationType.Pop, location, delta })
  }

  private async doLeave(onArmEnd?: () => void): Promise<LeaveResult> {
    await this.untilFree()
    const gen = ++this.leaveGen
    const outside = this.outsideGen
    this.pageHidden = false
    // アプリの最初の履歴（idx 0）より前に、ほかのページの履歴が無いと分かる時（knownNothingBefore。ほかのアプリから開いたブラウザの
    // タブなど。ホーム画面から開いた Android のアプリもいつもこれだが、そこでは聞かずに armExit にするので、ここへは来ない）は、前へ
    // 戻って待つのを省く。window.close() も、履歴が2つ以上あるので効かない（試すだけ）
    let nothingBefore = this.knownNothingBefore()
    if (!nothingBefore) {
      // アプリの最初の履歴（idx 0）より前へ
      const came = await this.traverse(-(this.cur + 1), LEAVE_WAIT_MS)
      if (gen !== this.leaveGen || this.pageHidden) return 'left'
      // ページの中の履歴へ来た: 前へは戻れず（前が無い）、待つ間に利用者が「戻る」「進む」を押した（その「戻る」でアプリの最初の
      // 履歴へ来ていても、離れようとしたのと同じ）
      if (came) nothingBefore = true
    }
    try {
      this.win.close()
    } catch {
      // 閉じられない
    }
    if (!nothingBefore) {
      this.closing = true
      await this.wait(CLOSE_WAIT_MS)
      this.closing = false
      if (gen !== this.leaveGen || this.pageHidden) return 'left'
    }
    // 待つ間にアプリが作っていない履歴が来た（利用者の行き先として描いた）時は、そこに残る
    if (this.opts.armOnLeaveFail && outside === this.outsideGen) {
      await this.travelTo(0)
      this.exitArmed = this.cur === 0 && this.cur !== this.shownIdx
      if (this.exitArmed) {
        this.armEnd = onArmEnd ?? null
        return 'armed'
      }
    }
    // 待つ間に来た「戻る」「進む」で動いていたら、出していた所へ戻る
    if (this.cur !== this.shownIdx) await this.travelTo(this.shownIdx)
    return 'stayed'
  }

  /**
   * アプリの最初の履歴（idx 0）より前に、ほかのページの履歴が無いと分かるか: タブの履歴の数が、あると分かっているアプリの分だけの時
   * （読み込み直してからアプリがまだ積んでいない時は、土台の後ろの数は当て推量（topGuessed）なので、今いる所までで数える）。
   * Navigation API（Chromium）があれば、タブの履歴がどれもこのページの物（同じ origin で続いた物だけを数える entries() が、タブの
   * 履歴の数と同じ）で、今いる所の前がアプリの分だけの時も（読み込み直した後でも分かる）
   */
  private knownNothingBefore(): boolean {
    const length = this.win.history.length
    if (typeof length !== 'number') return false
    if (length <= (this.topGuessed ? this.cur : this.top) + 1) return true
    try {
      const nav = this.win.navigation
      return nav?.currentEntry?.index === this.cur && nav.entries().length === length
    } catch {
      return false
    }
  }

  private readonly onPop = (event: Event): void => {
    const st = stateOf(this.win.history.state)
    const idx = typeof st?.idx === 'number' ? st.idx : null
    const waiting = this.waiting
    const ua = (event as Event & { hasUAVisualTransition?: boolean }).hasUAVisualTransition
    // iPhone: 払いの popstate（自分で始めた戻る・進むが思った所へ着いた物でない）で最初にすること: 今の履歴を同じ物で置き換える。
    // WebKit は popstate を送ってから、戻る・進むを UI に知らせる（FrameLoader.cpp の loadInSameDocument: statePopped の後に
    // dispatchDidPopStateWithinPage）。身振りの絵を外すには読み込みの確かめが要り、それを済ませるのは、払いの後に最初に知らせた同じ
    // ページの中の動きが置き換えか戻る・進むの時だけ（ViewGestureController.cpp の didSameDocumentNavigationForMainFrame・
    // checkForActiveLoads）。最初が積む（pushState）だと絵は3秒外れず、その間はページを押せない（左の端から詳細を閉じた時に固まった）。
    // 置き換えを先に知らせれば、この後に何を書いても固まらない（置き換えは、履歴を身振りの行き先から外す印を付けない）
    if (this.flicks && ua !== false && !(waiting && idx === waiting.expect)) {
      try {
        this.win.history.replaceState(this.win.history.state, '')
      } catch {
        // 置き換えられない
      }
      swipeLog('guard', { idx })
    }
    swipeLog('pop', { idx, from: this.cur, ua: ua ?? null, expect: waiting?.expect ?? null })
    if (waiting) {
      if (idx === null) {
        // 自分で始めた戻る・進むを待つ間に、アプリが作っていない履歴が来た（アドレス欄・ページの location.hash で # を書き換えた。
        // ブラウザは新しく積み、待っていた動きは来ないか、書き換えた所から後で来る: その時は利用者の「戻る」「進む」と同じに扱う）:
        // 待っていた動きでなく利用者の行き先なので、外から来た物として描き（自分で動いている途中の物はやめる）、待つのを終える
        this.arriveFromOutside(st)
        waiting.finish(true)
        if (!this.running) for (const resolve of this.idleWaiters.splice(0)) resolve()
        return
      }
      // 自分で始めた戻る・進む。思った所と違っても（すばやく続けた「戻る」「進む」が先に来た）、今いる所から続ける
      const from = this.cur
      this.cur = idx
      // iPhone: 思った所と違う所へ着いた（利用者の端からのフリックが先に来た。その払いは何もしない）: その身振りの絵を出している間と
      // みなす（絵を写し直している途中なら、やめて後でもう一度）
      if (idx !== waiting.expect) this.noteSwipe(from)
      waiting.finish(true)
      if (!this.running) for (const resolve of this.idleWaiters.splice(0)) resolve()
      return
    }
    if (idx === null) {
      this.arriveFromOutside(st)
      return
    }
    const meta = metaOf(st)
    if (this.base === null && meta) this.base = meta.base
    const from = this.cur
    this.cur = idx
    this.top = Math.max(this.top, idx)
    this.noteSwipe(from)
    // iPhone: 「進む」の印で指を離すのを待っていた（recordForward）間に、その指などの払いが来た
    const parked = this.parked
    this.parked = null
    // 閉じる途中（window.close() を試して待つ間）に来た「戻る」「進む」: 閉じるかを聞き直さない（doLeave が終わりに、Android は
    // 最初の履歴で「もう一度［戻る］で閉じる」所にし、PC は出していた所へ戻る）
    if (this.closing) return
    if (this.exitArmed) {
      this.endArmed()
      if (from === 0) {
        // もう一度［戻る］で閉じる所（最初の履歴）から、アプリの中へ動いた（「進む」など）: 何もせず、出していた所へ戻る
        const shownIdx = this.shownIdx
        this.rush(() => this.travelTo(shownIdx))
        return
      }
    }
    if (idx === this.shownIdx) {
      if (parked) this.popFromMarker(parked, idx, from)
      return
    }
    if (this.base === null) {
      this.deliver()
      return
    }
    if (this.handlers.consumePop?.()) {
      // 確かめのダイアログを閉じた・掴んでいる間: 画面は動かさず、出していた所へ戻す
      const shownIdx = this.shownIdx
      this.rush(() => this.travelTo(shownIdx))
      return
    }
    const action = decidePop(
      this.opts.source,
      this.screen(this.shown),
      idx < this.shownIdx ? 'back' : 'forward',
      this.opts.exit ?? 'ask',
    )
    const shownIdx = this.shownIdx
    // 出していた所へ戻す（rush: 押し終えるのを待っている物があっても、待たない）
    switch (action.kind) {
      case 'stay':
        this.rush(() => this.travelTo(shownIdx))
        return
      case 'ring':
        this.rush(() => this.travelTo(shownIdx))
        this.handlers.ring?.(action.dir)
        this.afterRing(idx)
        return
      case 'ask-exit':
        this.rush(() => this.travelTo(shownIdx))
        this.handlers.askExit?.()
        return
      case 'arm-exit':
        // 聞かない。書きかけを保存してから、もう一度［戻る］で閉じる所にする（保存している間の「戻る」は、ここへまた来て土台へ戻る。
        // この後に押し終えた・キーを打った時は、その所にしない。今押している物を離したのは数えない）
        this.rush(() => this.travelTo(shownIdx))
        this.armBack = { held: this.pressing(), pressed: false }
        this.handlers.armExit?.()
        return
      case 'back-one': {
        const target = shownIdx - 1
        // iPhone の登録の画面: 書きかけでも確かめずに捨てて閉じる（■27）。ルーターに渡す前に、閉じてよいと知らせる（Android・PC の
        // OS の戻るは、これまでどおり useBlocker で確かめる）
        const discard = this.flicks && this.screen(this.shown) === 'register'
        if (this.cur === target) {
          if (discard) this.handlers.flickDiscard?.()
          this.deliver()
          this.markForwardDirty()
          // 閉じた画面の履歴を切り捨てるのは、popstate の後の処理で（popstate の中・その後のマイクロタスクでは積まない。身振りが
          // 終わる動きの間なので、次の身振りは始まらない）
          if (this.flicks) this.win.setTimeout(() => this.rush(() => this.dropClosed()), 0)
          return
        }
        this.rush(async () => {
          await this.travelTo(target)
          if (discard) this.handlers.flickDiscard?.()
          this.deliver()
          this.markForwardDirty()
          if (!this.flicks) return
          // 戻った popstate の後の処理で（上と同じ）
          await this.wait(0)
          await this.dropClosed()
        })
      }
    }
  }

  /** アプリが作っていない履歴（アドレス欄で # の後ろを書き換えた時など。state.idx が無い）に、今の次の番号を付ける */
  private adoptOutside(st: EntryState | null): number {
    const idx = this.cur + 1
    this.win.history.replaceState({ ...st, usr: st?.usr ?? null, key: st?.key ?? makeKey(), idx, ...this.meta() }, '')
    this.top = idx
    this.topGuessed = false
    return idx
  }

  /** アプリが作っていない履歴へ来た: 今の次に積まれた物として番号を付けて描く（カレンダーなら、そこを新しい土台にする） */
  private arriveFromOutside(st: EntryState | null): void {
    this.outsideGen += 1
    // 今の後ろに積まれた（土台の後ろの履歴は無くなった）
    this.parked = null
    this.forwardDirty = false
    const location = this.readLocation()
    if (this.base !== null && this.screen(location) === 'calendar') this.base = this.cur + 1
    this.cur = this.adoptOutside(st)
    this.deliver()
  }

  private readonly onInput = (event: Event): void => {
    const type = event.type
    const pointer = event as PointerEvent
    const pointerType = pointer.pointerType
    // ブラウザが「押した」と数える出来事（navigator.userActivation が無いブラウザだけ使う）
    if (
      type === 'keydown' ||
      type === 'mousedown' ||
      type === 'touchend' ||
      type === 'click' ||
      (type === 'pointerdown' && pointerType === 'mouse') ||
      (type === 'pointerup' && pointerType !== 'mouse')
    ) {
      this.lastActivation = this.now()
    }
    // 押している物を数える（pointerId の無い出来事は、押し方の種類で数える）
    const id = typeof pointer.pointerId === 'number' ? pointer.pointerId : (pointerType ?? 'pointer')
    switch (type) {
      case 'pointerdown':
        // 最初の1本の指（isPrimary）を下ろした: 前の指で、離す出来事が来ないまま残った物（画面の端の身振りを端末が取った時など。
        // src/ui/useSwipe.ts と同じ）は捨てる
        if (pointerType === 'touch' && pointer.isPrimary) this.dropTouchPointers()
        this.pointers.set(id, { type: pointerType ?? '', at: this.now() })
        break
      case 'pointermove': {
        const pressed = this.pointers.get(id)
        if (pressed === undefined) return
        // マウスで押していて、マウスのボタンが離れている（離した pointerup を見落とした: ウインドウの外で離したなど）。同じ番号の、
        // マウスでない押し方の物（テストの合成した指）は、マウスの動きでは離さない
        if (pressed.type === 'mouse' && pointerType === 'mouse' && pointer.buttons === 0) {
          this.pointers.delete(id)
          this.afterPress()
        } else {
          pressed.at = this.now()
          // 動いている指は、画面に触れている指の数も新しい（touchmove は聞かない）
          if (pressed.type === 'touch') this.touchAt = pressed.at
        }
        return
      }
      case 'pointerup':
      case 'pointercancel':
        this.pointers.delete(id)
        break
      case 'touchstart': {
        this.countTouches(event, false)
        this.touchStartAt = this.touchAt
        if (this.flicks) this.logTouch(type, event)
        // touch の出来事は、いつも押した所の要素へ送られ、その要素が描き直しで外れると window まで来ない（掴んで動かしたカードなど）。
        // 離したのを見落とさないように、押した要素でも聞く
        const target = event.target as EventTarget | null
        if (target && target !== (this.win as unknown as EventTarget) && typeof target.addEventListener === 'function') {
          target.addEventListener('touchend', this.onTouchEnd, { once: true })
          target.addEventListener('touchcancel', this.onTouchEnd, { once: true })
        }
        break
      }
      case 'touchend':
      case 'touchcancel':
        this.countTouches(event, true)
        if (this.flicks) this.logTouch(type, event)
        break
    }
    const pressEnd = type === 'pointerup' || type === 'touchend' || type === 'keydown'
    if (this.exitArmed) {
      // もう一度［戻る］で閉じる所（最初の履歴。ホーム画面から開いた Android のアプリの1回目の「戻る」の後（■25）と、ブラウザのタブで
      // ［閉じる］で閉じられなかった後。どちらも同じ）で、押し終えた（指・マウスを離した。スクロールに取られた指は touchend）・キーを
      // 打った: 出していた所へ戻り、それから押した物を動かす（capture で、アプリの部品より先に聞く。押した物の行き先の書き込みは、戻り
      // 終えるまで順番を待つ）。下ろしただけ・取り消された押し方（pointercancel・touchcancel）では戻らない: Android の戻る身振りは、
      // ページに指を下ろした出来事が来た後、身振りと分かった所で取り消す見込み（その身振りの「戻る」で閉じられるように）。下ろしたまま
      // ARM_HOLD_MS たった時（長押し）は、離すのを待たずに戻る
      if (pressEnd) this.leaveArmed()
      else if (type === 'pointerdown') this.watchArmHold(id)
    }
    const armBack = this.armBack
    if (armBack && pressEnd) {
      // armExit にする「戻る」の後に押し終えた・キーを打った（「戻る」が来た時に押していた物を離したのは数えない）
      if (type === 'keydown' || !armBack.held) armBack.pressed = true
      else if (!this.pressing()) armBack.held = false
    }
    if (PRESS_END_EVENTS.has(type)) this.afterPress()
  }

  /** 押した要素で聞いた touchend・touchcancel（外れた要素から window まで来なかった物。来た物と同じ数え方なので、2回来てもよい） */
  private readonly onTouchEnd = (event: Event): void => {
    this.countTouches(event, true)
    this.afterPress()
  }

  /** iPhone の指の出来事を記録に控える（記録を取っている時だけ。位置と、画面に触れている指の数） */
  private logTouch(type: string, event: Event): void {
    if (!swipeLogEnabled()) return
    const t = (event as TouchEvent).changedTouches?.[0]
    swipeLog(type, { x: t ? Math.round(t.clientX) : null, y: t ? Math.round(t.clientY) : null, touches: this.touches })
  }

  /**
   * ウインドウから離れた（ほかのアプリへ移った）: 押している物は無い（離したのが届かないことがある）。iPhone では、端からの身振りが
   * 始まるとページは window の blur を受ける（WebKit が身振りの間、ページの部品から一番目の応答者を外す: WKWebViewIOS.mm の
   * _navigationGestureDidBegin・WKContentViewInteraction.mm の resignFirstResponder）が、指は下りたまま（身振りの「戻る」「進む」が
   * 来た時に離したとみなす）。なので指（touch）は残し、マウス・ペンだけ離したとみなす（ほかのアプリへ移った時は pagehide・
   * visibilitychange で）
   */
  private readonly onBlur = (): void => {
    if (this.flicks) {
      for (const [id, p] of this.pointers) if (p.type !== 'touch') this.pointers.delete(id)
      swipeLog('blur', { touches: this.touches })
    } else {
      this.pointers.clear()
      this.touches = 0
    }
    this.afterPress()
  }

  /** ページが隠れた（ほかのアプリ・タブへ移った）: 押している物は無い */
  private readonly onVisibility = (): void => {
    if (this.win.document.visibilityState !== 'hidden') return
    swipeLog('hidden')
    this.pointers.clear()
    this.touches = 0
  }

  private readonly onPageHide = (): void => {
    this.pageHidden = true
    this.pointers.clear()
    this.touches = 0
  }

  private readonly onPageShow = (event: Event): void => {
    if (!(event as PageTransitionEvent).persisted) return
    // 閉じてほかのページへ移った後に「進む」で戻って来た（ページがそのまま残っていた）: 出していた所へ戻る
    this.leaveGen++
    this.pageHidden = false
    if (this.exitArmed) this.endArmed()
    this.waiting?.finish(false)
    this.cur = this.idx() ?? this.cur
    if (this.cur !== this.shownIdx) {
      const shownIdx = this.shownIdx
      this.run(async () => {
        await this.untilFree()
        await this.travelTo(shownIdx)
      })
    }
  }
}

/** アプリの履歴（src/App.tsx が1つだけ作る。単体テストは自分で作る） */
let current: AppHistory | null = null
/** 画面から受け取る動き（履歴を作る前に置かれても渡す） */
const handlers: HistoryHandlers = {}

/** アプリの履歴を作る（アプリで1回だけ） */
export function createAppHistory(opts: AppHistoryOptions): AppHistory {
  current?.dispose()
  current = new AppHistory(opts)
  current.handlers = handlers
  return current
}

/** 画面から受け取る動きを置く（undefined で外す）。返す関数で、置いた物を外す */
export function setHistoryHandler<K extends keyof HistoryHandlers>(key: K, handler: HistoryHandlers[K]): () => void {
  handlers[key] = handler
  return () => {
    if (handlers[key] === handler) delete handlers[key]
  }
}

/**
 * アプリを閉じる（アプリの履歴が無い時（テストのメモリーのルーター）は離れない）。もう一度［戻る］で閉じる所にした時は、その所が終わった
 * 時に onArmEnd を呼ぶ（AppHistory.leave）
 */
export function leaveApp(onArmEnd?: () => void): Promise<LeaveResult> {
  return current ? current.leave(onArmEnd) : Promise.resolve('stayed')
}

/** もう一度［戻る］で閉じる所にする（AppHistory.armExit。アプリの履歴が無い時は false） */
export function armExitApp(ms: number, onEnd: () => void): Promise<boolean> {
  return current ? current.armExit(ms, onEnd) : Promise.resolve(false)
}

/** 履歴を動かし終えるまで待つ（E2E の window.__ds.historyIdle） */
export function whenHistoryIdle(): Promise<void> {
  return current ? current.whenIdle() : Promise.resolve()
}

/** 今の履歴の形（E2E の window.__ds.historyShape） */
export function historyShape(): HistoryShape | null {
  return current?.shape() ?? null
}

/**
 * その時刻（performance.now）より後に、利用者の「戻る」「進む」（iPhone の端からのフリック）が来たか（src/ui/useSwipe.ts: 画面の端から
 * 払った指を、ブラウザが身振りにした時はアプリでは回さない）
 */
export function userPopSince(t: number): boolean {
  return current?.userPopSince(t) ?? false
}

/** iPhone: 身振りの絵を出している間に、アプリの中でモードを回した（AppHistory.topUpBallast。src/features/calendar/common/CalendarView.tsx） */
export function afterInPageRing(): void {
  current?.topUpBallast()
}
