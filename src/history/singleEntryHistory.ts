// iPhone・iPad のアプリの履歴（docs/SPEC.md の 3.1。22. の ■31〜■33）。ブラウザの履歴をいつも1つのままにする: 書くのは今の履歴の
// 置き換え（history.replaceState）だけで、積む（pushState）・戻る・進む（history.go・back・forward）・ページごと開く
// （location.assign）は使わない。iPhone（WebKit）の画面の端からの「戻る」「進む」の身振り（ページがめくれる動き）は、その向きに
// 履歴がある時だけ始まる（WebKit の ViewGestureController の canSwipeInDirection）ので、履歴が1つなら身振りは始まらず、端から
// 払った指はページに来る。それをページの中で受け取って（flick）、動き無しで切り替える（開いた直後の形。作者の「iphone版に合わせて
// もらっていいです」■33）。src/App.tsx が createAppHistory（src/history/appHistory.ts）で、iPhone・iPad の時だけこれを作る。
//
// - アプリの中の行き先の並び（カレンダー・登録・詳細の画面・MIM・設定）は、ここで持つ（下がカレンダー）。ルーターが積むと並びに積み、
//   置き換えると今の物を替え、戻る・進む（navigate(-1)・書きかけの確かめの戻す・続ける）は並びの中で動いて、ブラウザと同じく後で
//   （マイクロタスクで）POP として差と一緒に渡す。どれもブラウザの履歴には、今の行き先で今の物を置き換えて書くだけ
// - カレンダーの行き先は、いつも下のカレンダーに置く（ほかの画面から移る時は、その上を捨ててカレンダーを置き換える。Android・PC の
//   AppHistory の土台と同じ）
// - 画面の端からのフリック（flick。-1 = 左の端から右へ＝戻る、1 = 右の端から左へ＝進む）は popRules.ts の decidePop の通り:
//   カレンダーではモードを1つ回し（handlers.ring）、登録・詳細の画面・ほかの画面では1つ戻る（登録の画面は、書きかけでも聞かずに捨てる:
//   戻る前に handlers.flickDiscard。■27）。確かめのダイアログが出ていればそれだけを閉じ（handlers.consumePop）、ドラッグの途中と
//   ログインの画面では何もしない
// - 読み込み直す・裏で閉じられて開き直す（WebKit がページを捨てた時）時のために、今の物の下の行き先を履歴の state（ds1.below）に置く
//   （設定・MIM・詳細の画面の下の、見ていたカレンダーが戻る）。無い時（前の版の state・直接開いた）は、小さな画面なら同じ行き先の
//   小さな画面の無い所、設定・MIM・見つからないならトップを下に置く（ログインには置かない）
// - スクロールの位置: ブラウザは戻る・進むが無いので位置を戻さない。積む時・並びの中で動く時に今の位置を控え、行き先の替わる POP
//   （設定・MIM からカレンダーへ戻る）では、ルーターがその行き先を描いた時（drawn。src/ui/Layout.tsx の ScrollOnNavigate が、描いた
//   直後・絵にする前に知らせる）にその位置へ戻す。ルーターは POP を区切って描くので、前の画面（設定・MIM）が何コマか残る: その間は
//   送らない（出ている設定の画面が下へ跳ばない）。小さな画面を閉じる時は、行き先が同じで、小さな画面の間も位置はそのまま
//   （src/ui/Modal.tsx）
// - 前の版・ほかのページが残した履歴（更新した直後の［更新する］の読み込み直し・Google のログインの行き来の後・アドレス欄で # を
//   書き換えた時など。アプリを閉じて開き直すまで残る）: その履歴へ iPhone の身振りで来た時（popstate）は、着いた履歴を今の行き先で
//   置き換え（idx は着いた物のまま。これで身振りの後に3秒固まることも無い）、古い行き先はルーターに渡さず（閉じた画面を開き直さない）、
//   フリックと同じことを1回する（着いた idx が前なら戻る）。ページの中で受け取った払いと同じ払いの popstate が続けて来た時
//   （FLICK_DEDUPE_MS の内）は、2回しない。アプリが作っていない履歴（state の無い #）は、ブラウザの履歴が増えていれば今の次に積まれた
//   物（アドレス欄で書き換えた時など）、増えていなければ今の物を置き換えた物（location.replace の # の置き換え。表示できなかった時の
//   案内のリンク: src/ui/ErrorBoundary.tsx）として受け取る
// - 書けなかった時（WebKit の 10秒に 100回の上限で SecurityError）は、アプリの中の並びを正として、後でもう一度書く
// - 何をしたかは、設定で記録を取る時だけ控える（src/history/swipeLog.ts。開いた時の start に、ブラウザの履歴の数）
import { createPath, NavigationType, parsePath, type Location } from 'react-router-dom'
import type { AppHistoryOptions, DsHistory, HistoryHandlers, HistoryWindow, LeaveResult } from './appHistory'
import {
  encodeHashLocation,
  hashHref,
  hashURL,
  makeKey,
  metaOf,
  readHashLocation,
  stateOf,
  toLocation,
  type Listener,
  type To,
} from './hashLocation'
import { decidePop, type ExitStyle, type PopDirection, type PopSource, type ScreenKind } from './popRules'
import { swipeLog } from './swipeLog'

/** 使う window の物（AppHistory の物に、ページのスクロールの位置を足した物。単体テストでは作り物を渡す） */
export type SingleEntryWindow = HistoryWindow & {
  readonly scrollY?: number
  scrollTo?(x: number, y: number): void
}

export interface SingleEntryOptions extends AppHistoryOptions {
  window: SingleEntryWindow
  /** ログインの画面の行き先か（下に何も置かず、端から払っても何もしない） */
  isLoginPath?: (pathname: string) => boolean
  /** ホーム画面から開いたか（開いた時の記録に添えるだけ） */
  standalone?: boolean
}

/** 今の履歴の形（E2E・単体テスト用。src/history/appHistory.ts の HistoryShape と並ぶ） */
export interface SingleHistoryShape {
  kind: 'single'
  source: PopSource
  exit: ExitStyle
  /** 後で渡す POP・描いた後のスクロールの戻しが残っている */
  busy: boolean
  /** アプリの中の行き先の数と、今いる所（0 が下） */
  depth: number
  index: number
  /** ブラウザの履歴の数（history.length。無ければ null） */
  len: number | null
  /** 前の版・ほかのページの履歴が残っている（開いた時に2つ以上・前の版の印の state・外から積まれた・その履歴へ来た） */
  inherited: boolean
  /** 印の履歴の土台は無い */
  base: null
  /** 今のブラウザの履歴の idx（ルーターが出しているのもいつもここ） */
  cur: number
  shownIdx: number
  exitArmed: false
}

/** ページの中で受け取った払いと、同じ払いの popstate を1つとみなす長さ（WebKit は左の端の身振りで、離す出来事を約 7ms 先に送る） */
export const FLICK_DEDUPE_MS = 400
/** 書けなかった時に、もう一度書くまで */
export const WRITE_RETRY_MS = 1000
/**
 * ルーターが行き先を描いてから、スクロールの位置を戻すのを試し続ける長さの上限（ms。描いた直後に一度送り、ページがまだ短くて届かない
 * 時は、描く時ごとにもう一度）
 */
export const SCROLL_RESTORE_MS = 1500
/**
 * ルーターが行き先を描くのを待つ長さの上限（ms。描いた知らせ（drawn）が来ないまま過ぎたら、スクロールの位置は戻さない。描くのが
 * 遅い CI の WebKit・重いイヤーでも届く長さ）
 */
export const DRAW_WAIT_MS = 5000
/** 戻すのを待っている間にこれが来たら、やめる（利用者が自分で触れた・スクロールし始めた） */
const USER_INPUT = ['touchstart', 'pointerdown', 'wheel', 'keydown'] as const
/** 1回描くのを待つ長さの上限 */
const FRAME_TIMEOUT_MS = 200
/** トップ（src/routes.ts の paths.top()。設定・MIM などを直接開いた時に下に置く） */
const TOP_PATH = '/'

/** アプリの中の行き先の1つ（控えたスクロールの位置と） */
interface Entry {
  location: Location
  y: number
}

/** スクロールの位置を戻すのを待っている物（key の行き先を描いたら、y へ戻し始める。cancel でやめる） */
interface PendingRestore {
  key: string
  drawn: () => void
  cancel: () => void
}

/** 履歴の state の ds1 に置く、下の行き先の1つ */
interface Below {
  path: string
  usr: unknown
  key: string
  y: number
}

function belowOf(value: unknown): Below[] | null {
  const ds1 = (stateOf(value) as { ds1?: { below?: unknown } } | null)?.ds1
  const below = ds1 && typeof ds1 === 'object' ? ds1.below : undefined
  if (!Array.isArray(below)) return null
  return below.filter((b): b is Below =>
    Boolean(b && typeof b === 'object' && typeof (b as Below).path === 'string' && typeof (b as Below).key === 'string'),
  )
}

function fromBelow(b: Below): Entry {
  const parsed = parsePath(b.path)
  return {
    location: {
      pathname: parsed.pathname ?? TOP_PATH,
      search: parsed.search ?? '',
      hash: parsed.hash ?? '',
      state: b.usr ?? null,
      key: b.key,
    },
    y: typeof b.y === 'number' ? b.y : 0,
  }
}

/** 下に置く、何も無い所の行き先（React Router の最初の行き先と同じく key は default） */
function bottom(pathname: string, search = ''): Location {
  return { pathname, search, hash: '', state: null, key: 'default' }
}

/**
 * iPhone・iPad のアプリの履歴（react-router の History の形）。src/App.tsx が createAppHistory で1つだけ作り、UNSAFE_createRouter に
 * 渡す。画面の端からのフリックは、ページの中で受け取った所が flick を呼ぶ
 */
export class SingleEntryHistory implements DsHistory {
  /** 画面から受け取る動き */
  handlers: HistoryHandlers = {}
  private listener: Listener | null = null
  private act: NavigationType = NavigationType.Pop
  /** アプリの中の行き先の並びと、今いる所 */
  private stack: Entry[]
  private index: number
  /** 今のブラウザの履歴の idx（書く時もこの idx のまま。前の版が残した履歴へ来た時は、着いた物の idx） */
  private winIdx: number
  private inherited: boolean
  /** 最後に、ページの中の払い（flick）・popstate で何かをした時刻（同じ払いを2回しない） */
  private flickActedAt = -Infinity
  private popActedAt = -Infinity
  /** 利用者の「戻る」「進む」（popstate）が最後に来た時刻 */
  private lastUserPopAt = -Infinity
  /** 後で渡す POP の数・描いた後のスクロールの戻し（数え直しの番号） */
  private pending = 0
  private restoring: PendingRestore | null = null
  private moveGen = 0
  /** 最後に見たブラウザの履歴の数（state の無い popstate が、積まれた物か置き換えた物かを分ける） */
  private lastLen: number | null
  private retryTimer: number | null = null
  private disposed = false
  private readonly idleWaiters: (() => void)[] = []
  private readonly win: SingleEntryWindow

  constructor(private readonly opts: SingleEntryOptions) {
    const win = (this.win = opts.window)
    let st = stateOf(win.history.state)
    const old = metaOf(st) !== null
    if (typeof st?.idx !== 'number') {
      try {
        win.history.replaceState({ ...st, idx: 0 }, '')
      } catch {
        // 書けない（次に書く時に書く）
      }
      st = stateOf(win.history.state)
    }
    this.winIdx = typeof st?.idx === 'number' ? st.idx : 0
    const len = this.historyLength()
    this.lastLen = len
    this.inherited = old || (len ?? 1) > 1
    const current = readHashLocation(win)
    this.stack = [...this.underneath(st, current), { location: current, y: 0 }]
    this.index = this.stack.length - 1
    win.addEventListener('popstate', this.onPop)
    let nav: number | null = null
    try {
      nav = win.navigation?.entries().length ?? null
    } catch {
      nav = null
    }
    swipeLog('start', {
      len,
      idx: this.winIdx,
      old,
      standalone: opts.standalone ?? null,
      nav,
      depth: this.stack.length,
      screen: this.screen(current),
    })
  }

  get action(): NavigationType {
    return this.act
  }

  get location(): Location {
    return this.stack[this.index].location
  }

  createHref(to: To): string {
    return hashHref(this.win, to)
  }

  createURL(to: To): URL {
    return hashURL(this.win, to)
  }

  encodeLocation(to: To): { pathname: string; search: string; hash: string } {
    return encodeHashLocation(this.win, to)
  }

  listen(listener: Listener): () => void {
    this.listener = listener
    return () => {
      if (this.listener === listener) this.listener = null
    }
  }

  /** ルーターが積む（カレンダーの行き先は、下のカレンダーを置き換える） */
  push(to: To, state?: unknown): void {
    const location = toLocation(to, state, this.location.pathname)
    this.act = NavigationType.Push
    if (this.screen(location) === 'calendar') {
      this.toCalendar(location)
      return
    }
    this.stack[this.index].y = this.scrollY()
    this.stack.splice(this.index + 1)
    this.stack.push({ location, y: 0 })
    this.index += 1
    this.moved()
    this.log('vpush')
    this.write()
  }

  /** ルーターが置き換える（カレンダーの行き先は、下のカレンダーを置き換える。後ろの行き先は残す） */
  replace(to: To, state?: unknown): void {
    const location = toLocation(to, state, this.location.pathname)
    this.act = NavigationType.Replace
    if (this.screen(location) === 'calendar') {
      this.toCalendar(location)
      return
    }
    this.stack[this.index] = { location, y: this.stack[this.index].y }
    this.log('vreplace')
    this.write()
  }

  /**
   * ルーターの戻る・進む（navigate(-1)・書きかけの確かめで止めた「戻る」を戻す・続ける）: 並びの中で動き（端を越える分は端まで。
   * 動けなければ何もしない）、ブラウザの今の物を行き先で置き換え、POP は後で（マイクロタスクで）差と一緒に渡す（ブラウザの go と
   * 同じく、ルーターが POP を受け取った中で呼んでも入れ子にならない）。行き先が替わる時は、描いた後に控えたスクロールの位置へ戻す
   */
  go(delta: number): void {
    const from = this.index
    const target = Math.max(0, Math.min(this.stack.length - 1, from + delta))
    if (target === from) return
    this.stack[from].y = this.scrollY()
    const before = this.stack[from].location
    this.index = target
    this.act = NavigationType.Pop
    this.moved()
    const entry = this.stack[target]
    this.log('vpop')
    this.write()
    this.deliverLater(entry.location, target - from, entry.location.pathname !== before.pathname ? entry.y : null)
  }

  /**
   * iPhone・iPad の画面の端から内へ払った（ページの中で受け取った所が呼ぶ。-1 = 左の端から右へ＝戻る、1 = 右の端から左へ＝進む）。
   * 同じ払いの popstate がもう来て何かをした直後（FLICK_DEDUPE_MS の内）は何もしない
   */
  flick(side: -1 | 1): void {
    const now = this.now()
    const screen = this.screen(this.location)
    if (now - this.popActedAt < FLICK_DEDUPE_MS) {
      swipeLog('flick', { side, screen, action: 'same-pop' })
      return
    }
    const action = this.respond(side < 0 ? 'back' : 'forward')
    swipeLog('flick', { side, screen, action })
    if (action !== 'nothing' && action !== 'drag') this.flickActedAt = now
  }

  /** アプリを閉じる（iPhone・iPad では聞かないので呼ばれない。離れない） */
  leave(_onArmEnd?: () => void): Promise<LeaveResult> {
    return Promise.resolve('stayed')
  }

  /** もう一度［戻る］で閉じる所（ホーム画面の Android だけ。ここでは何もしない） */
  armExit(_ms: number, _onEnd: () => void): Promise<boolean> {
    return Promise.resolve(false)
  }

  /** 後で渡す POP と、描いた後のスクロールの戻しが済むまで待つ（E2E 用） */
  whenIdle(): Promise<void> {
    if (!this.busy()) return Promise.resolve()
    return new Promise((resolve) => this.idleWaiters.push(resolve))
  }

  /** 今の履歴の形（E2E・単体テスト用） */
  shape(): SingleHistoryShape {
    const len = this.win.history.length
    return {
      kind: 'single',
      source: this.opts.source,
      exit: this.opts.exit ?? 'ask',
      busy: this.busy(),
      depth: this.stack.length,
      index: this.index,
      len: typeof len === 'number' ? len : null,
      inherited: this.inherited,
      base: null,
      cur: this.winIdx,
      shownIdx: this.winIdx,
      exitArmed: false,
    }
  }

  /**
   * ルーターが行き先（key）を描いた（src/ui/Layout.tsx の ScrollOnNavigate が useLayoutEffect で、描いた直後・絵にする前に
   * appHistory.ts の historyDrawn から呼ぶ）。設定・MIM から戻った POP の行き先なら、控えたスクロールの位置へ戻し始める
   */
  drawn(key: string): void {
    const r = this.restoring
    if (r && r.key === key) r.drawn()
  }

  /** 利用者の「戻る」「進む」（前の版が残した履歴への iPhone の身振り）が、その時刻（now と同じ時計）より後に来たか */
  userPopSince(t: number): boolean {
    return this.lastUserPopAt >= t
  }

  /** 片付ける（テスト用） */
  dispose(): void {
    this.disposed = true
    this.restoring?.cancel()
    this.win.removeEventListener('popstate', this.onPop)
    if (this.retryTimer !== null) this.win.clearTimeout(this.retryTimer)
    this.retryTimer = null
  }

  // ---------- 中身 ----------

  private now(): number {
    return this.opts.now?.() ?? performance.now()
  }

  private screen(location: { pathname: string; state: unknown }): ScreenKind {
    return this.opts.screenOf({ pathname: location.pathname, state: location.state })
  }

  private isLogin(pathname: string): boolean {
    return this.opts.isLoginPath?.(pathname) ?? false
  }

  private scrollY(): number {
    const y = this.win.scrollY
    return typeof y === 'number' && Number.isFinite(y) ? y : 0
  }

  private busy(): boolean {
    return this.pending > 0 || this.restoring !== null
  }

  /** 行き先が動いた（後で渡す POP・待っているスクロールの戻しは、前の行き先の物になる: 戻しはやめる） */
  private moved(): void {
    this.moveGen += 1
    this.restoring?.cancel()
  }

  private historyLength(): number | null {
    const len = this.win.history.length
    return typeof len === 'number' ? len : null
  }

  private log(kind: string): void {
    swipeLog(kind, { depth: this.stack.length, index: this.index, screen: this.screen(this.location) })
  }

  /**
   * 開いた時の今の物の下の行き先: 履歴の state に控えた物（読み込み直した時）。無ければ、小さな画面なら同じ行き先の小さな画面の無い所、
   * 設定・MIM・見つからないならトップ（ログインとカレンダーには置かない）
   */
  private underneath(st: unknown, current: Location): Entry[] {
    const saved = belowOf(st)
    if (saved) return saved.map(fromBelow)
    const under = this.synthesize(current)
    return under ? [{ location: under, y: 0 }] : []
  }

  private synthesize(location: Location): Location | null {
    if (this.isLogin(location.pathname)) return null
    switch (this.screen(location)) {
      case 'calendar':
        return null
      case 'register':
      case 'detail':
        return bottom(location.pathname, location.search)
      case 'other':
        return bottom(TOP_PATH)
    }
  }

  /** カレンダーの行き先を、下のカレンダー（無ければ今の所）に置き、その上は捨てる（ルーターには、頼まれた積む・置き換えのまま） */
  private toCalendar(location: Location): void {
    let at = this.stack.findIndex((e, i) => i <= this.index && this.screen(e.location) === 'calendar')
    if (at === -1) at = this.index
    const collapsed = at < this.index
    if (collapsed) this.stack.splice(at + 1)
    this.stack[at] = { location, y: this.stack[at].y }
    this.index = at
    this.moved()
    this.log(collapsed ? 'vcollapse' : 'vreplace')
    this.write()
  }

  /** ブラウザの今の履歴を、今の行き先で置き換える（下の行き先も state に置く）。書けなければ後でもう一度 */
  private write(): void {
    const entry = this.stack[this.index]
    const below: Below[] = this.stack.slice(0, this.index).map((e) => ({
      path: createPath(e.location),
      usr: e.location.state,
      key: e.location.key,
      y: e.y,
    }))
    if (this.retryTimer !== null) {
      this.win.clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
    try {
      this.win.history.replaceState(
        { usr: entry.location.state, key: entry.location.key, idx: this.winIdx, ds1: { below } },
        '',
        hashHref(this.win, entry.location),
      )
    } catch (error) {
      const name = (error as { name?: string } | null)?.name ?? 'Error'
      swipeLog('write-fail', { name })
      // 写せない state（DataCloneError）は、もう一度書いても同じ
      if (name === 'DataCloneError' || this.disposed) return
      this.retryTimer = this.win.setTimeout(() => {
        this.retryTimer = null
        if (!this.disposed) this.write()
      }, WRITE_RETRY_MS)
    }
  }

  /**
   * POP を後で（マイクロタスクで）渡す（delta は差。null は差の無い置き換え）。行き先が替わったなら、ルーターがそれを描いた時に
   * スクロールの位置を戻す（渡す前に待ち始める: ルーターがすぐ描いても、描いた知らせを取りこぼさない）
   */
  private deliverLater(location: Location, delta: number | null, scrollTo: number | null): void {
    this.pending += 1
    const gen = this.moveGen
    queueMicrotask(() => {
      this.pending -= 1
      if (scrollTo !== null && gen === this.moveGen && !this.disposed) this.restoreAfterDraw(location.key, scrollTo, gen)
      if (!this.disposed) this.listener?.({ action: NavigationType.Pop, location, delta })
      this.settleIdle()
    })
  }

  /**
   * ルーターが key の行き先を描いた時（drawn）に、その位置 y へスクロールする: 描いた直後（絵にする前）に一度送り、次に描く時に確かめる
   * （ページがまだ短くて届かなければ、届くまで描く時ごとにもう一度。描いてから SCROLL_RESTORE_MS まで）。描く前は送らない（出ている
   * 前の画面を送らない）。描いた知らせが DRAW_WAIT_MS 来ない・ほかへ動いた・利用者が触れた時はやめる
   */
  private restoreAfterDraw(key: string, y: number, gen: number): void {
    this.restoring?.cancel()
    let touched = false
    let started = false
    let until = 0
    const onInput = () => {
      touched = true
    }
    for (const type of USER_INPUT) this.win.addEventListener(type, onInput)
    const waitTimer = this.win.setTimeout(() => finish(), DRAW_WAIT_MS)
    const live = () => !touched && gen === this.moveGen && !this.disposed
    const finish = () => {
      if (this.restoring !== pending) return
      this.restoring = null
      this.win.clearTimeout(waitTimer)
      for (const type of USER_INPUT) this.win.removeEventListener(type, onInput)
      this.settleIdle()
    }
    const step = () => {
      if (this.restoring !== pending) return
      if (!live()) {
        finish()
        return
      }
      this.win.scrollTo?.(0, y)
      if (Math.abs(this.scrollY() - y) <= 1 || this.now() >= until) {
        finish()
        return
      }
      this.nextFrame(step)
    }
    const pending: PendingRestore = {
      key,
      drawn: () => {
        if (started) return
        started = true
        this.win.clearTimeout(waitTimer)
        if (!live()) {
          finish()
          return
        }
        until = this.now() + SCROLL_RESTORE_MS
        this.win.scrollTo?.(0, y)
        this.nextFrame(step)
      },
      cancel: finish,
    }
    this.restoring = pending
  }

  /** 次に描く時（描かない時（見えていない・テストの作り物）でも、FRAME_TIMEOUT_MS で先へ進む） */
  private nextFrame(run: () => void): void {
    let done = false
    const once = () => {
      if (done) return
      done = true
      this.win.clearTimeout(timer)
      run()
    }
    const timer = this.win.setTimeout(once, FRAME_TIMEOUT_MS)
    if (this.win.requestAnimationFrame) this.win.requestAnimationFrame(once)
    else this.win.setTimeout(once, 16)
  }

  private settleIdle(): void {
    if (this.busy()) return
    for (const resolve of this.idleWaiters.splice(0)) resolve()
  }

  /**
   * 端からのフリック（と、前の版が残した履歴への身振り）ですること（記録に書く名前を返す）: ドラッグの途中は何もせず、確かめの
   * ダイアログはそれだけを閉じ、ログインの画面では何もしない。ほかは decidePop の通り（カレンダーはモードを回す・ほかは1つ戻る）
   */
  private respond(direction: PopDirection): string {
    if (this.handlers.dragging?.()) return 'drag'
    if (this.handlers.consumePop?.()) return 'dialog'
    const location = this.location
    if (this.isLogin(location.pathname)) return 'nothing'
    const screen = this.screen(location)
    const action = decidePop('edge-flick', screen, direction)
    switch (action.kind) {
      case 'ring':
        // モードを回す所がまだ無い（読み込み中・設定を直接開いてカレンダーがまだ無い）: 何もしなかった（同じ払いの popstate は使う）
        if (!this.handlers.ring) return 'nothing'
        this.handlers.ring(action.dir)
        return action.dir === 1 ? 'ring+1' : 'ring-1'
      case 'back-one':
        // 登録の画面: 書きかけでも確かめずに捨てて閉じる（■27）。ルーターに渡す前に、閉じてよいと知らせる
        if (screen === 'register') this.handlers.flickDiscard?.()
        this.backOne()
        return screen === 'register' ? 'discard' : screen === 'detail' ? 'close' : 'back'
      default:
        return 'nothing'
    }
  }

  /** 1つ戻る（下に何も無い時は、開いた時と同じく下に置いてから） */
  private backOne(): void {
    if (this.index === 0) {
      const under = this.synthesize(this.location)
      if (!under) return
      this.stack.unshift({ location: under, y: 0 })
      this.index = 1
    }
    this.go(-1)
  }

  /**
   * popstate: 前の版・ほかのページが残した履歴へ、iPhone の身振り（など）で来た。着いた履歴を今の行き先で置き換え（idx は着いた物の
   * まま）、古い行き先はルーターに渡さずに、フリックと同じことを1回する（着いた idx が前なら戻る）。アプリが作っていない履歴（state に
   * idx が無い）は、ブラウザの履歴が増えていれば今の次に積まれた物として、増えていなければ今の物を置き換えた物（# の置き換え）として
   * 受け取り、ルーターに POP で渡す
   */
  private readonly onPop = (): void => {
    const st = stateOf(this.win.history.state)
    const arrived = typeof st?.idx === 'number' ? st.idx : null
    const from = this.winIdx
    const now = this.now()
    const len = this.historyLength()
    const grew = len === null || this.lastLen === null || len > this.lastLen
    this.lastLen = len
    swipeLog('pop', { idx: arrived, from })
    if (arrived === null && !grew) {
      // # を置き換えて移った（location.replace。表示できなかった時の案内のリンク）: 今の行き先を置き換える（履歴は増えていない）
      const location = { ...readHashLocation(this.win), key: st?.key ?? makeKey() }
      this.act = NavigationType.Pop
      if (this.screen(location) === 'calendar') this.toCalendar(location)
      else {
        this.stack[this.index] = { location, y: this.stack[this.index].y }
        this.moved()
        this.log('vreplace')
        this.write()
      }
      this.deliverLater(this.location, null, null)
      return
    }
    this.lastUserPopAt = now
    this.inherited = true
    if (arrived === null) {
      // 外から積まれた（アドレス欄・# のリンク）: 今の次に積まれた物として受け取る
      const location = { ...readHashLocation(this.win), key: st?.key ?? makeKey() }
      this.winIdx = from + 1
      this.stack[this.index].y = this.scrollY()
      this.stack.splice(this.index + 1)
      this.stack.push({ location, y: 0 })
      this.index += 1
      this.act = NavigationType.Pop
      this.moved()
      this.log('outside')
      this.write()
      this.deliverLater(location, 1, null)
      return
    }
    this.winIdx = arrived
    // 着いた履歴を今の行き先で置き換える（これが身振りの後に最初に知らせる同じページの中の動き: 置き換えなら固まらない）
    this.write()
    swipeLog('adopt', { idx: arrived })
    if (arrived === from) return
    if (now - this.flickActedAt < FLICK_DEDUPE_MS) {
      swipeLog('pop-skip', { idx: arrived })
      return
    }
    const action = this.respond(arrived < from ? 'back' : 'forward')
    swipeLog('pop-act', { action })
    if (action !== 'nothing' && action !== 'drag') this.popActedAt = now
  }
}
