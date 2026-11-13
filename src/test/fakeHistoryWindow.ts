// アプリの履歴（src/history/appHistory.ts）の単体テスト用の作り物の window。ブラウザの履歴（同じページの中の履歴の並びと今いる所）をまねる:
// pushState は今より後ろを捨てて積み、replaceState は今の物を替え、go は次の処理で動いて popstate を送る（範囲の外へは動かない）。
// history.scrollRestoration は今の履歴の物で、pushState で積んだ履歴にも写る（ブラウザと同じ）。
// foreign の履歴（ほかのページ）へ動いた時は、popstate の代わりに pagehide を送る（ページが離れた）。
// 利用者の「戻る」「進む」は userGo（ブラウザの go と同じ動き）、アドレス欄で # を書き換えた時は typeHash。navigationApi の時は
// Chromium の Navigation API（navigation.entries()・currentEntry）もまねる: 今いる所と続いた、ほかのページでない履歴だけを数える。
// requestAnimationFrame は 16ms ごとの描く時（setTimeout）。アプリが呼んだ履歴は calls に控える（popstate を送っている間か・同じ物の
// 置き換えかも）。
// iPhone の WebKit の身振りの絵もまねる（docs/SPEC.md の 3.1。WebKit のソースで読んだ物。パスは WebKit の Source/WebKit・WebCore の下）:
// - 履歴を離れる時（pushState の時・go で動く時・利用者の身振り（userGo）を始めた時）に、その時に描かれていた画面（painted。show で
//   替えた画面は、2回描いた後に描かれる）を、離れる履歴の絵として控える（描く物の数と一緒に。weights・ballast）。身振りの絵を出している
//   間は控えない（ViewSnapshotStore.cpp の recordSnapshot）。replaceState は絵を残し、pushState で捨てた後ろの履歴の絵は消える
// - swipes の時の userGo は身振り: 始めた時に行き先の履歴を決め（ViewGestureControllerIOS.mm の beginSwipeGesture）、その絵を出す
//   （slid に控える）。指を離す（fingerMs の後）と、決めた履歴へ動く。その履歴が切り捨てられていれば動かず、絵を3秒出したまま
//   （hazards の dropped）、今いる履歴なら読み込み直しになる（reload。HistoryController.cpp の itemsAreClones）
// - 指を離すと、身振りが終わる動き（animMs）の間は描かない（requestAnimationFrame はその後。WebPage.cpp の swipeAnimationDidStart）。
//   その間に送る popstate は hasUAVisualTransition が true（Document.cpp の dispatchPopstateEvent）、ほかは false
// - 着いた後も、描く物の数が行き先の絵の半分を超えて、動きの後 overlayMs たつまで（超えなければ3秒）絵を出したまま（overlayEnds に
//   長さ）。ただし身振りの popstate を送っている間（その後のマイクロタスクまで）にページが最初に呼んだ書き込みが pushState なら、
//   絵は3秒外れない（ViewGestureController.cpp の didSameDocumentNavigationForMainFrame: 最初に知らせたのが置き換えか戻る・進むの時
//   だけ、読み込みの確かめを済ませる。WebKit は popstate を送ってから戻る・進むを知らせる: FrameLoader.cpp の loadInSameDocument）
// - 絵を出している間は、次の身振りは始まらない（refused に数える。ViewGestureControllerIOS.mm の shouldBeginInteractiveTransition）
// - focused の時は、身振りの始まりに window の blur、動きの後に focus を送る（ページの部品から一番目の応答者が外れる。WKWebViewIOS.mm）。
//   edgeTouch の時は、身振りの始まりの前にページへ指を下ろした出来事（pointerdown・touchstart）を送る（離す出来事は送らない。
//   WKTouchEventsGestureRecognizer.mm）
// - strict の時は、popstate を送っている間（その後のマイクロタスクまで）の pushState で投げる（どの時も violations に控える）
import type { HistoryWindow } from '../history/appHistory'

/** 控えた絵（その時に描かれていた画面と、描く物の数） */
export interface Picture {
  screen: string
  weight: number
}

interface Entry {
  state: unknown
  url: string
  /** ほかのページの履歴（アプリより前） */
  foreign?: boolean
  /** 「戻る」「進む」で来た時にスクロールの位置を戻すか（history.scrollRestoration） */
  scroll?: 'auto' | 'manual'
  /** 身振りの絵（WebKit が離れる時に写す物） */
  picture?: Picture
}

/** アプリが呼んだ履歴の1つ */
export interface HistoryCall {
  op: 'pushState' | 'replaceState' | 'go'
  /** go の差 */
  delta?: number
  /** 積む・置き換える state の印（back・fwd。無ければ null） */
  mark?: string | null
  /** 置き換えで、今の物と同じ state・URL（履歴は替わらない） */
  same?: boolean
  /** popstate を送っている間（その後のマイクロタスクまで）に呼んだ */
  inPop: boolean
  /** 呼んだ時刻（Date.now） */
  at: number
}

/** 身振りの結果: refused = 前の絵を出している間で始まらない、none = その向きに履歴が無く始まらない、started = 始めた */
export type SwipeResult = 'refused' | 'none' | 'started'

export interface FakeWindowOptions {
  /** アプリより前のほかのページの履歴の数 */
  before?: number
  navigationApi?: boolean
  /** userGo を iPhone の端からの身振りとしてまねる */
  swipes?: boolean
  /** 身振りが終わる動きの長さ（swipes の時。描かない間） */
  animMs?: number
  /** 身振りの始まりに window の blur、動きの後に focus を送る */
  focused?: boolean
  /** 身振りの始まりの前に、指を下ろした出来事（pointerdown・touchstart）を送る（離す出来事は送らない） */
  edgeTouch?: boolean
  /** popstate を送っている間の pushState で投げる */
  strict?: boolean
}

/** popstate を送っている間とみなすマイクロタスクの数（その後の処理を待つ Promise のつながりより長く） */
const POP_MICROTASK_HOPS = 50

type Handler = (event: Event) => void

/** popstate を送っている間（その後のマイクロタスクまで）に呼んだ、置き換え・積む */
interface PopWindow {
  calls: ('pushState' | 'replaceState')[]
}

export class FakeWindow implements HistoryWindow {
  entries: Entry[]
  index: number
  /** ページが離れた（foreign の履歴へ動いた） */
  left = false
  closeCalls = 0
  readonly navigator = { userActivation: { isActive: false } }
  readonly document = { querySelector: () => null, visibilityState: 'visible' }
  /** Navigation API（navigationApi の時だけ） */
  readonly navigation?: { readonly currentEntry: { readonly index: number } | null; entries(): { index: number }[] }
  /** 今の画面（DOM）と、描かれている画面（show から2回描いた後） */
  screen = 'calendar'
  painted = 'calendar'
  /** 画面ごとの描く物の数（無い画面は 100） */
  weights: Record<string, number> = {}
  /** 見えない描く物の数（ballast） */
  ballastCount = 0
  /** 身振りの絵を出している */
  overlay = false
  /** 身振りが終わる動きの後、身振りの絵を外すまで（描く物が足りている時） */
  overlayMs = 100
  /** 身振りが終わる動きの長さ */
  animMs: number
  /** 身振りの間に出した絵（行き先の履歴の絵の画面。絵の無い履歴は none） */
  readonly slid: string[] = []
  /** 着いてから身振りの絵を外すまでの長さ */
  readonly overlayEnds: number[] = []
  /** 身振りの行き先が着いた時に無かった（dropped）・今いる履歴だった（reload） */
  readonly hazards: string[] = []
  /** 前の絵を出している間で、始まらなかった身振りの数 */
  refused = 0
  /** アプリが呼んだ履歴 */
  readonly calls: HistoryCall[] = []
  /** popstate を送っている間に呼んだ pushState */
  readonly violations: string[] = []
  private readonly handlers = new Map<string, Set<Handler>>()
  /** typeHash の数（その前に呼んだ go を取り消す） */
  private typed = 0
  /** 身振りが終わる動きが終わる時刻（Date.now。その前は描かない） */
  private animUntil = -Infinity
  private popWindow: PopWindow | null = null
  private showSeq = 0
  private touchSeq = 900
  private frameSeq = 0

  /** userGo を iPhone の端からの身振りとしてまねる（絵を出す・出している間は次の身振りが始まらない） */
  private readonly swipes: boolean
  private readonly focused: boolean
  private readonly edgeTouch: boolean
  private readonly strict: boolean

  constructor(
    hash = '#/',
    {
      before = 0,
      navigationApi = false,
      swipes = false,
      animMs = 300,
      focused = false,
      edgeTouch = false,
      strict = false,
    }: FakeWindowOptions = {},
  ) {
    this.swipes = swipes
    this.animMs = swipes ? animMs : 0
    this.focused = focused
    this.edgeTouch = edgeTouch
    this.strict = strict
    this.entries = [
      ...Array.from({ length: before }, (_, i) => ({ state: null, url: `https://other.example/${i}`, foreign: true })),
      { state: null, url: `https://app.example/${hash}` },
    ]
    this.index = before
    if (navigationApi) {
      const win = this
      this.navigation = {
        get currentEntry() {
          return { index: win.index - win.sameOriginRange()[0] }
        },
        entries: () => {
          const [from, to] = win.sameOriginRange()
          return Array.from({ length: to - from + 1 }, (_, index) => ({ index }))
        },
      }
    }
  }

  /** 今いる所と続いた、ほかのページでない履歴の範囲（初めと終わりの位置） */
  private sameOriginRange(): [number, number] {
    let from = this.index
    let to = this.index
    while (from > 0 && !this.entries[from - 1].foreign) from -= 1
    while (to < this.entries.length - 1 && !this.entries[to + 1].foreign) to += 1
    return [from, to]
  }

  readonly history = (() => {
    const win = this
    return {
      get state(): unknown {
        return win.entries[win.index].state
      },
      get length(): number {
        return win.entries.length
      },
      get scrollRestoration(): 'auto' | 'manual' {
        return win.entries[win.index].scroll ?? 'auto'
      },
      set scrollRestoration(mode: 'auto' | 'manual') {
        win.entries[win.index].scroll = mode
      },
      pushState: (data: unknown, _unused: string, url?: string | null) => win.pushState(data, url),
      replaceState: (data: unknown, _unused: string, url?: string | null) => win.replaceState(data, url),
      go: (delta: number) => {
        win.calls.push({ op: 'go', delta, inPop: win.popWindow !== null, at: Date.now() })
        win.move(delta)
      },
    }
  })()

  readonly location = (() => {
    const win = this
    return {
      get href(): string {
        return win.entries[win.index].url
      },
      get hash(): string {
        const url = win.entries[win.index].url
        const i = url.indexOf('#')
        return i === -1 ? '' : url.slice(i)
      },
      origin: 'https://app.example',
      assign: (url: string) => {
        throw new Error(`ページごと開いた: ${url}`)
      },
    }
  })()

  /** アプリが呼んだ置き換え・積むを控える（popstate を送っている間の pushState は violations にも。strict なら投げる） */
  private note(op: 'pushState' | 'replaceState', data: unknown, url: string | null | undefined): void {
    const cur = this.entries[this.index]
    const mark = (data as { ds?: { mark?: string } } | null)?.ds?.mark ?? null
    const same = op === 'replaceState' && JSON.stringify(data) === JSON.stringify(cur.state) && this.resolve(url) === cur.url
    const inPop = this.popWindow !== null
    this.calls.push({ op, mark, same, inPop, at: Date.now() })
    if (!this.popWindow) return
    this.popWindow.calls.push(op)
    if (op !== 'pushState') return
    this.violations.push(`popstate の中の pushState（${mark ?? 'mark なし'}）`)
    if (this.strict) throw new Error('popstate を送っている間に pushState を呼んだ')
  }

  private pushState(data: unknown, url?: string | null): void {
    this.note('pushState', data, url)
    this.record()
    const scroll = this.entries[this.index].scroll
    this.entries = this.entries.slice(0, this.index + 1)
    this.entries.push({ state: structuredClone(data), url: this.resolve(url), scroll })
    this.index += 1
  }

  /** 今の履歴を替える（同じ履歴のまま。身振りの行き先も、替えた履歴のまま） */
  private replaceState(data: unknown, url?: string | null): void {
    this.note('replaceState', data, url)
    const entry = this.entries[this.index]
    entry.url = this.resolve(url)
    entry.state = structuredClone(data)
  }

  /** 描かない間（身振りが終わる動き）なら、その後に回す */
  private afterFreeze(run: () => void, ms: number): void {
    const fire = () => {
      const frozen = this.animUntil - Date.now()
      if (frozen > 0) setTimeout(fire, frozen)
      else run()
    }
    setTimeout(fire, ms)
  }

  /** 画面を替える（描かれるのは、2回描いた後。身振りが終わる動きの間は描かない） */
  show(screen: string): void {
    this.screen = screen
    const seq = ++this.showSeq
    this.afterFreeze(() => {
      if (seq === this.showSeq) this.painted = screen
    }, 32)
  }

  /** 描く物の数（今の画面と、見えない描く物） */
  weight(screen = this.screen): number {
    return (this.weights[screen] ?? 100) + this.ballastCount
  }

  /** 今の履歴を離れる: 描かれている画面を絵に控える（身振りの絵を出している間は控えない） */
  private record(): void {
    if (this.overlay || this.entries[this.index].foreign) return
    this.entries[this.index].picture = { screen: this.painted, weight: this.weight(this.painted) }
  }

  /** 履歴ごとの絵の画面（無ければ -） */
  pictures(): string[] {
    return this.entries.map((e) => e.picture?.screen ?? '-')
  }

  /** ページの go（次の処理で、離れる履歴の絵を控えてから動いて popstate。範囲の外なら何もしない。その前に typeHash が来たら動かない） */
  move(delta: number): void {
    const typed = this.typed
    setTimeout(() => {
      if (this.left || typed !== this.typed) return
      const target = this.index + delta
      if (target < 0 || target >= this.entries.length) return
      this.record()
      this.arrive(target)
    }, 0)
  }

  private arrive(target: number): PopWindow | null {
    this.index = target
    if (this.entries[target].foreign) {
      this.left = true
      this.dispatch('pagehide', new Event('pagehide'))
      return null
    }
    return this.dispatchPop()
  }

  /** popstate を送る（身振りが終わる動きの間なら hasUAVisualTransition が true）。その後のマイクロタスクまでを、送っている間とみなす */
  private dispatchPop(): PopWindow {
    const w: PopWindow = { calls: [] }
    this.popWindow = w
    const event = Object.assign(new Event('popstate'), { hasUAVisualTransition: Date.now() < this.animUntil })
    try {
      this.dispatch('popstate', event)
    } finally {
      let hops = 0
      const hop = () => {
        if (++hops < POP_MICROTASK_HOPS) void Promise.resolve().then(hop)
        else if (this.popWindow === w) this.popWindow = null
      }
      void Promise.resolve().then(hop)
    }
    return w
  }

  requestAnimationFrame(callback: () => void): number {
    this.afterFreeze(callback, 16)
    return ++this.frameSeq
  }

  /** 履歴ごとのスクロールの戻し方（manual の物だけ m、ほかは a） */
  scrollModes(): string {
    return this.entries.map((e) => (e.scroll === 'manual' ? 'm' : 'a')).join('')
  }

  /**
   * ブラウザの「戻る」「進む」（次の処理で動いて popstate。範囲の外なら何もしない）。swipes の時は iPhone の端からの身振り: 身振りの
   * 絵を出している間は始まらない（refused）。その向きに履歴が無ければ始まらない（none）。始めた時に今の履歴の絵を控え、行き先の履歴を
   * 決めてその絵を出し（slid）、fingerMs の後に指を離す（lift）
   */
  userGo(delta: number, { fingerMs = 0 }: { fingerMs?: number } = {}): SwipeResult {
    if (!this.swipes) {
      this.move(delta)
      return 'started'
    }
    if (this.overlay) {
      this.refused += 1
      return 'refused'
    }
    const start = this.index + delta
    if (start < 0 || start >= this.entries.length) return 'none'
    const target = this.entries[start]
    if (this.edgeTouch) this.touchDown()
    this.record()
    this.overlay = true
    this.slid.push(target.picture?.screen ?? 'none')
    if (this.focused) this.dispatch('blur', new Event('blur'))
    setTimeout(() => this.lift(target), fingerMs)
    return 'started'
  }

  /**
   * 身振りの指を離した: 始めた時に決めた履歴へ動く（切り捨てられていれば dropped、今いる履歴なら reload。どちらも popstate は無い）。
   * 身振りが終わる動きの間は描かず、その後に絵を外す（上の初めの説明）
   */
  private lift(target: Entry): void {
    if (this.left) return
    const at = Date.now()
    const i = this.entries.indexOf(target)
    if (i === -1) {
      this.hazards.push('dropped')
      setTimeout(() => this.endOverlay(at), 3000)
      return
    }
    if (i === this.index) {
      this.hazards.push('reload')
      this.endOverlay(at)
      return
    }
    this.animUntil = at + this.animMs
    const w = this.arrive(i)
    if (!w) return
    if (this.focused) setTimeout(() => this.dispatch('focus', new Event('focus')), this.animMs)
    const threshold = (target.picture?.weight ?? 0) / 2
    const check = () => {
      if (this.left) return
      const waited = Date.now() - at
      const stuck = w.calls[0] === 'pushState'
      if (waited >= 3000 || (!stuck && this.weight() > threshold)) {
        this.endOverlay(at)
        return
      }
      setTimeout(check, Math.min(16, 3000 - waited))
    }
    setTimeout(check, this.animMs + this.overlayMs)
  }

  private endOverlay(at: number): void {
    this.overlay = false
    this.overlayEnds.push(Date.now() - at)
  }

  /** 指を下ろした出来事（身振りの指: 離す出来事は来ない） */
  private touchDown(): void {
    const pointerId = ++this.touchSeq
    this.dispatch(
      'pointerdown',
      Object.assign(new Event('pointerdown'), { pointerType: 'touch', pointerId, isPrimary: true, buttons: 1 }),
    )
    this.dispatch('touchstart', Object.assign(new Event('touchstart'), { touches: { length: 1 } }))
  }

  /**
   * アドレス欄で # の後ろを書き換えた（ブラウザが state の無い履歴を積んで popstate）。その前に呼んで、まだ動いていないページの go は
   * 取り消す（新しく積んだ時に消える。Chromium では、積んだ後に、積んだ所から動くこともある: 書き換えた後に go を呼んでまねる）
   */
  typeHash(hash: string): void {
    this.typed += 1
    this.entries = this.entries.slice(0, this.index + 1)
    this.entries.push({ state: null, url: `https://app.example/${hash}` })
    this.index += 1
    this.dispatchPop()
  }

  /** 押した（capture で聞いている所へ送る。指は pointerup で「押した」になる） */
  press(pointerType: 'mouse' | 'touch' = 'mouse'): void {
    this.navigator.userActivation.isActive = true
    const down = Object.assign(new Event('pointerdown'), { pointerType })
    this.dispatch('pointerdown', down)
    const up = Object.assign(new Event('pointerup'), { pointerType })
    this.dispatch('pointerup', up)
    this.dispatch('click', new Event('click'))
  }

  addEventListener(type: string, listener: Handler): void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set())
    this.handlers.get(type)!.add(listener)
  }

  removeEventListener(type: string, listener: Handler): void {
    this.handlers.get(type)?.delete(listener)
  }

  dispatch(type: string, event: Event): void {
    for (const h of [...(this.handlers.get(type) ?? [])]) h(event)
  }

  setTimeout(handler: () => void, ms: number): number {
    return setTimeout(handler, ms) as unknown as number
  }

  clearTimeout(id: number): void {
    clearTimeout(id)
  }

  close(): void {
    this.closeCalls += 1
  }

  /** 今の # の後ろ */
  hashPath(): string {
    return this.location.hash.slice(1)
  }

  /** 履歴の並び（印の履歴は [back]・[fwd]、ほかのページは [other]） */
  describe(): string[] {
    return this.entries.map((e, i) => {
      if (e.foreign) return '[other]'
      const st = e.state as { ds?: { mark?: string }; usr?: { sheet?: { kind: string } } } | null
      const hash = e.url.slice(e.url.indexOf('#') + 1)
      const mark = st?.ds?.mark ? `[${st.ds.mark}]` : ''
      const sheet = st?.usr?.sheet ? `+${st.usr.sheet.kind}` : ''
      return `${i === this.index ? '*' : ''}${mark || hash}${mark ? '' : sheet}`
    })
  }

  private resolve(url: string | null | undefined): string {
    const cur = this.entries[this.index].url
    if (url === undefined || url === null) return cur
    if (url.startsWith('#')) return `${cur.slice(0, cur.indexOf('#') === -1 ? cur.length : cur.indexOf('#'))}${url}`
    return url
  }
}
