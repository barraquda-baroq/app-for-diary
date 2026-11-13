// アプリの履歴（docs/SPEC.md の 3.1。22. の段階2の終わりの確かめの「画面の外からのフリックの決め」・■22・■23）。HashRouter と同じ
// ハッシュの行き先の履歴（react-router の createHashHistory と同じ形: state は { usr, key, idx }）を自分で持ち、ルーターが書く・戻る所と、
// ブラウザの「戻る」「進む」（popstate）が来た所の両方を、ここ1か所で扱う。src/App.tsx が1つだけ作ってデータのルーターに渡す。
//
// 履歴の形: カレンダーの画面は、いつも1つの履歴（「土台」。state.ds.base がその番号）に置き、その前に「戻る」の印、後ろに「進む」の印の
// 履歴を1つずつ置く（どちらも同じ行き先で、state.ds.mark が back・fwd）。カレンダーの中の行き来（モードの切り替え・‹ ›・なぞる・［今日］・
// イヤーのマスからマンスリーなど）は、どれも土台を置き換えるだけで、履歴は増えない。登録・詳細の画面・MIM・設定は土台の後ろに積み、
// 閉じると1つ戻って土台へ。ほかの画面からカレンダーへ移る時（左のアイコン・［‹ カレンダーに戻る］）も、土台まで戻ってそこを置き換える。
// - 「戻る」「進む」が来たら、出していた画面と端末（src/ui/device.ts）で、することを決める（popRules.ts の decidePop）: カレンダーでは
//   印の履歴へ移った所から土台へ戻し（ルーターには渡さない。途中の行き先を描かない）、iPhone ではモードを1つ回し（handlers.ring）、
//   Android・PC では閉じるかを聞く（handlers.askExit）。登録の画面の iPhone のフリックは何もしない（開いたまま戻す）。ほかは1つ戻る
// - 自分で戻る・進む（history.go）間に来た popstate は、ルーターに渡さない。書き込み・戻る・進むは1つずつ順に行い、動いている間に
//   来たものは待たせる。すばやく続けた「戻る」「進む」のうち、戻している間に来た物は捨てる（積み上がらず、行ったり来たりしない）
// - 印の履歴を作るのは、押した・キーを打った直後だけ（開いた直後はまだ作らず、最初に押した時に作る）。iPhone（WebKit）は、押してから
//   10秒より後に積まれた履歴を身振りの行き先から外し、Chromium は、押していないのに積んだページの履歴を「戻る」ボタンの行き先から外す
//   （history manipulation intervention）。外されると、iPhone のフリックは効かず、Android の戻るボタンは聞かずにアプリを閉じる
// - 読み込み直した時は、今の履歴の state（idx・ds）をそのまま使う（履歴を増やさない。印の履歴で読み込み直した時は土台へ戻る）
// - アプリを閉じる（leave）: アプリの最初の履歴（idx 0）より前へ戻る。前が無い時（ホーム画面から開いた Android のアプリなど）は
//   window.close() を試し、それも効かなければ、最初の履歴へ戻って「もう一度［戻る］で閉じる」所にする（Android）か、そのまま（PC）
// 画面の決まり（どの行き先がカレンダー・登録・詳細か）は、ここでは持たない（screenOf で受け取る）
import { createPath, NavigationType, parsePath, type Location, type RouterInit } from 'react-router-dom'
import { decidePop, type PopSource, type ScreenKind } from './popRules'

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
    pushState(data: unknown, unused: string, url?: string | null): void
    replaceState(data: unknown, unused: string, url?: string | null): void
    go(delta: number): void
  }
  location: { readonly href: string; readonly hash: string; readonly origin: string; assign(url: string): void }
  document: { querySelector(selector: string): { getAttribute(name: string): string | null } | null }
  addEventListener(type: string, listener: (event: Event) => void, options?: boolean | AddEventListenerOptions): void
  removeEventListener(type: string, listener: (event: Event) => void, options?: boolean | EventListenerOptions): void
  setTimeout(handler: () => void, ms: number): number
  clearTimeout(id: number): void
  close(): void
  navigator?: { userActivation?: { readonly isActive: boolean } }
}

/** 画面から受け取る動き（App・カレンダーが置く） */
export interface HistoryHandlers {
  /** iPhone の端からのフリックで、カレンダーのモードを1つ回す（1 = 年→月→週→日→年、-1 = 日→週→月→年→日） */
  ring?: (dir: 1 | -1) => void
  /** Android・PC の「戻る」で、アプリを閉じるかを聞く */
  askExit?: () => void
  /**
   * 「戻る」「進む」が来た時に、画面を動かす前に片付ける物があれば片付けて true（出していた所へ戻すだけにする）: 開いている確かめの
   * ダイアログを閉じる（その下の詳細の画面などは閉じない）・ドラッグの途中は何もしない
   */
  consumePop?: () => boolean
}

export interface AppHistoryOptions {
  window: HistoryWindow
  /** popstate が何から来るか（src/ui/device.ts） */
  source: PopSource
  /** 閉じられなかった時に、最初の履歴へ戻って「もう一度［戻る］で閉じる」所にするか（Android） */
  armOnLeaveFail: boolean
  /** 行き先の画面の種類 */
  screenOf: (location: { pathname: string; state: unknown }) => ScreenKind
  /** 今（ミリ秒。テスト用） */
  now?: () => number
}

/** 今の履歴の形（E2E・単体テスト用） */
export interface HistoryShape {
  /** popstate が何から来るか（端末で決めた物。src/ui/device.ts） */
  source: PopSource
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
  /** 閉じられずに最初の履歴へ戻った所（もう一度「戻る」で閉じる） */
  exitArmed: boolean
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
/** 聞く出来事（押した・キーを打った。capture で、アプリの部品より先に聞く） */
const ACTIVATION_EVENTS = ['pointerdown', 'mousedown', 'pointerup', 'touchend', 'keydown', 'click'] as const

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
  /** ルーターが出している行き先と、その履歴の idx */
  private shown: Location
  private shownIdx: number
  /** 押した時に土台と印の履歴を作る */
  private buildPending = false
  /** 読み込み直した所が印の履歴だった（ルーターが聞き始めたら土台へ戻る） */
  private startOnMarker = false
  /** 閉じられずに最初の履歴へ戻った（もう一度「戻る」で閉じる）。押したら土台へ戻る */
  private exitArmed = false
  private leaveGen = 0
  private pageHidden = false
  private lastActivation = -Infinity
  private waiting: { finish: (came: boolean) => void } | null = null
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
    if (this.base === null && this.screen(this.shown) === 'calendar') this.buildPending = true
    win.addEventListener('popstate', this.onPop)
    win.addEventListener('pagehide', this.onPageHide)
    win.addEventListener('pageshow', this.onPageShow)
    for (const type of ACTIVATION_EVENTS) win.addEventListener(type, this.onActivation, true)
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
   * 戻している途中に呼ばれても）、来た所はルーターに渡す
   */
  go(delta: number): void {
    const target = this.shownIdx + delta
    this.run(async () => {
      await this.travelTo(target)
      this.deliver()
    })
  }

  /** アプリを閉じる（「Diary Studio を閉じますか？」の［閉じる］） */
  leave(): Promise<LeaveResult> {
    return new Promise((resolve) => this.run(() => this.doLeave().then(resolve)))
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
      busy: this.running || this.waiting !== null,
      cur: this.cur,
      base: this.base,
      shownIdx: this.shownIdx,
      top: this.top,
      buildPending: this.buildPending,
      exitArmed: this.exitArmed,
    }
  }

  /** 片付ける（テスト用） */
  dispose(): void {
    this.win.removeEventListener('popstate', this.onPop)
    this.win.removeEventListener('pagehide', this.onPageHide)
    this.win.removeEventListener('pageshow', this.onPageShow)
    for (const type of ACTIVATION_EVENTS) this.win.removeEventListener(type, this.onActivation, true)
  }

  // ---------- 中身 ----------

  private now(): number {
    return this.opts.now?.() ?? Date.now()
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

  private async drain(): Promise<void> {
    this.running = true
    try {
      while (this.queue.length > 0) {
        const op = this.queue.shift()!
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
    try {
      this.win.history.pushState({ usr: location.state, key: location.key, idx, ...this.meta() }, '', url)
    } catch (error) {
      // react-router と同じ: 積めない時（Safari の回数の上限など）は、ページごとその行き先を開く
      if ((error as { name?: string } | null)?.name === 'DataCloneError') throw error
      this.win.location.assign(url)
      return
    }
    this.cur = this.top = idx
    this.shown = location
    this.shownIdx = idx
  }

  private write(kind: 'push' | 'replace', location: Location): void | Promise<void> {
    this.act = kind === 'push' ? NavigationType.Push : NavigationType.Replace
    const screen = this.screen(location)
    if (screen === 'calendar') return this.writeCalendar(location)
    if (kind === 'replace') this.replaceHere(location)
    else this.pushHere(location)
    // iPhone: 詳細の画面・MIM・設定の後ろにも「進む」の印を置く（右の端からのフリックでも閉じる・戻る。登録の画面は置かない: 何もしない）。
    // 登録の画面を詳細の画面に置き換えた時（複製のお知らせの［開く］）も、後ろに無ければ置く
    if (
      this.opts.source === 'edge-flick' &&
      screen !== 'register' &&
      this.base !== null &&
      this.top <= this.cur &&
      this.activated()
    ) {
      return this.addForward()
    }
  }

  /** カレンダーの行き先は、いつも土台に置く（積まずに置き換える。積んだ画面から移る時は土台まで戻ってから） */
  private writeCalendar(location: Location): void | Promise<void> {
    if (this.base === null) {
      if (this.activated()) return this.build(location)
      this.replaceHere(location)
      this.buildPending = true
      return
    }
    if (this.cur === this.base) {
      this.replaceHere(location)
      return
    }
    const base = this.base
    return this.travelTo(base).then(() => {
      // 戻れなかった時は、今いる所を土台にする
      if (this.cur !== base) this.base = this.cur
      this.replaceHere(location)
    })
  }

  /**
   * 土台と印の履歴を作る: 今の履歴を「戻る」の印に替え、その後ろに土台（この行き先）と「進む」の印を積んで、土台へ1つ戻る。
   * 押した・キーを打った直後だけ（ブラウザに外されないように）
   */
  private build(location: Location): Promise<void> | void {
    if (this.base !== null) return
    this.buildPending = false
    const at = this.cur
    const base = at + 1
    const href = this.createHref(location)
    const h = this.win.history
    h.replaceState({ usr: location.state, key: location.key, idx: at, ds: { base, mark: 'back' } }, '', href)
    h.pushState({ usr: location.state, key: location.key, idx: base, ds: { base } }, '', href)
    h.pushState({ usr: null, key: makeKey(), idx: base + 1, ds: { base, mark: 'fwd' } }, '', href)
    this.base = base
    this.cur = this.top = base + 1
    this.shown = location
    this.shownIdx = base
    return this.travelTo(base)
  }

  /** 今の履歴の後ろに「進む」の印を積んで、1つ戻る */
  private addForward(): Promise<void> {
    const back = this.cur
    this.win.history.pushState(
      { usr: null, key: makeKey(), idx: back + 1, ds: { base: this.base ?? back, mark: 'fwd' } },
      '',
      this.win.location.href,
    )
    this.cur = this.top = back + 1
    return this.travelTo(back)
  }

  /** その idx の履歴へ移る（来た popstate はルーターに渡さない。思った所と違えば、もう2回まで移り直す） */
  private async travelTo(target: number): Promise<void> {
    for (let attempt = 0; attempt < 3 && this.cur !== target; attempt++) {
      if (!(await this.traverse(target - this.cur, TRAVEL_TIMEOUT_MS))) break
    }
    // 「もう一度［戻る］で閉じる」所は、最初の履歴にいる間だけ（自分で土台へ戻った時（今日へ戻すなど）も、押した時と同じく外す）
    if (this.cur !== 0) this.exitArmed = false
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
      const waiting = { finish }
      this.waiting = waiting
      const timer = this.win.setTimeout(() => finish(false), timeout)
      this.win.history.go(delta)
    })
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => this.win.setTimeout(resolve, ms))
  }

  /** 押した・キーを打った直後か（この後に積む履歴を、ブラウザが行き先から外さないか） */
  private activated(): boolean {
    const ua = this.win.navigator?.userActivation
    if (ua) return ua.isActive
    return this.now() - this.lastActivation < ACTIVATION_FALLBACK_MS
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

  private async doLeave(): Promise<LeaveResult> {
    const gen = ++this.leaveGen
    this.pageHidden = false
    // アプリの最初の履歴（idx 0）より前に、ほかのページの履歴が無いと分かる時（タブの履歴の数が、アプリの分だけ。ホーム画面から
    // 開いた Android のアプリはいつも）は、前へ戻って待つのを省く。window.close() も、履歴が2つ以上あるので効かない（試すだけ）
    const length = this.win.history.length
    const nothingBefore = typeof length === 'number' && length <= this.top + 1
    if (!nothingBefore) {
      // アプリの最初の履歴（idx 0）より前へ
      const came = await this.traverse(-(this.cur + 1), LEAVE_WAIT_MS)
      if (gen !== this.leaveGen || this.pageHidden) return 'left'
      if (came) {
        // 同じページの中の履歴へ来た（ふつうは無い）: 出していた所へ戻る
        await this.travelTo(this.shownIdx)
        return 'stayed'
      }
    }
    try {
      this.win.close()
    } catch {
      // 閉じられない
    }
    if (!nothingBefore) {
      await this.wait(CLOSE_WAIT_MS)
      if (gen !== this.leaveGen || this.pageHidden) return 'left'
    }
    if (!this.opts.armOnLeaveFail || this.cur === 0) return 'stayed'
    await this.travelTo(0)
    this.exitArmed = this.cur === 0 && this.cur !== this.shownIdx
    return this.exitArmed ? 'armed' : 'stayed'
  }

  private readonly onPop = (): void => {
    const st = stateOf(this.win.history.state)
    const idx = typeof st?.idx === 'number' ? st.idx : null
    const waiting = this.waiting
    if (waiting) {
      // 自分で始めた戻る・進む。思った所と違っても（すばやく続けた「戻る」「進む」が先に来た）、今いる所から続ける
      this.cur = idx ?? this.adoptOutside(st)
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
    if (this.exitArmed) {
      this.exitArmed = false
      if (from === 0) {
        // 閉じられずに最初の履歴へ戻っていた所から動いた: 何もせず、出していた所へ戻る
        const shownIdx = this.shownIdx
        this.run(() => this.travelTo(shownIdx))
        return
      }
    }
    if (idx === this.shownIdx) return
    if (this.base === null) {
      this.deliver()
      return
    }
    if (this.handlers.consumePop?.()) {
      // 確かめのダイアログを閉じた・ドラッグの途中: 画面は動かさず、出していた所へ戻す
      const shownIdx = this.shownIdx
      this.run(() => this.travelTo(shownIdx))
      return
    }
    const action = decidePop(this.opts.source, this.screen(this.shown), idx < this.shownIdx ? 'back' : 'forward')
    const shownIdx = this.shownIdx
    switch (action.kind) {
      case 'stay':
        this.run(() => this.travelTo(shownIdx))
        return
      case 'ring':
        this.run(() => this.travelTo(shownIdx))
        this.handlers.ring?.(action.dir)
        return
      case 'ask-exit':
        this.run(() => this.travelTo(shownIdx))
        this.handlers.askExit?.()
        return
      case 'back-one': {
        const target = shownIdx - 1
        if (this.cur === target) {
          this.deliver()
          return
        }
        this.run(async () => {
          await this.travelTo(target)
          this.deliver()
        })
      }
    }
  }

  /** アプリが作っていない履歴（アドレス欄で # の後ろを書き換えた時など。state.idx が無い）に、今の次の番号を付ける */
  private adoptOutside(st: EntryState | null): number {
    const idx = this.cur + 1
    this.win.history.replaceState({ ...st, usr: st?.usr ?? null, key: st?.key ?? makeKey(), idx, ...this.meta() }, '')
    this.top = idx
    return idx
  }

  /** アプリが作っていない履歴へ来た: 今の次に積まれた物として番号を付けて描く（カレンダーなら、そこを新しい土台にする） */
  private arriveFromOutside(st: EntryState | null): void {
    const location = this.readLocation()
    if (this.base !== null && this.screen(location) === 'calendar') this.base = this.cur + 1
    this.cur = this.adoptOutside(st)
    this.deliver()
  }

  private readonly onActivation = (event: Event): void => {
    const type = event.type
    const pointerType = (event as PointerEvent).pointerType
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
    if (this.exitArmed && (type === 'pointerdown' || type === 'keydown')) {
      // 閉じられずに最初の履歴へ戻っていた所で押した: 出していた所へ戻ってから、押した物を動かす
      this.exitArmed = false
      const shownIdx = this.shownIdx
      this.run(() => this.travelTo(shownIdx))
      return
    }
    if (!this.activated()) return
    if (this.buildPending) {
      if (this.base !== null || this.cur !== this.shownIdx || this.screen(this.shown) !== 'calendar') return
      this.run(() => this.build(this.shown))
      return
    }
    // 土台の後ろに履歴が無い（アドレス欄から来た所を土台にした時など）: 「進む」の印を置く
    if (this.base !== null && this.cur === this.base && this.shownIdx === this.base && this.top <= this.base && !this.running) {
      this.run(() => this.addForward())
    }
  }

  private readonly onPageHide = (): void => {
    this.pageHidden = true
  }

  private readonly onPageShow = (event: Event): void => {
    if (!(event as PageTransitionEvent).persisted) return
    // 閉じてほかのページへ移った後に「進む」で戻って来た（ページがそのまま残っていた）: 出していた所へ戻る
    this.leaveGen++
    this.pageHidden = false
    this.exitArmed = false
    this.waiting?.finish(false)
    this.cur = this.idx() ?? this.cur
    if (this.cur !== this.shownIdx) {
      const shownIdx = this.shownIdx
      this.run(() => this.travelTo(shownIdx))
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

/** アプリを閉じる（アプリの履歴が無い時（テストのメモリーのルーター）は離れない） */
export function leaveApp(): Promise<LeaveResult> {
  return current ? current.leave() : Promise.resolve('stayed')
}

/** 履歴を動かし終えるまで待つ（E2E の window.__ds.historyIdle） */
export function whenHistoryIdle(): Promise<void> {
  return current ? current.whenIdle() : Promise.resolve()
}

/** 今の履歴の形（E2E の window.__ds.historyShape） */
export function historyShape(): HistoryShape | null {
  return current?.shape() ?? null
}
