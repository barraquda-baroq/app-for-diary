// アプリの履歴（src/history/appHistory.ts）の単体テスト用の作り物の window。ブラウザの履歴（同じページの中の履歴の並びと今いる所）をまねる:
// pushState は今より後ろを捨てて積み、replaceState は今の物を替え、go は次の処理で動いて popstate を送る（範囲の外へは動かない）。
// history.scrollRestoration は今の履歴の物で、pushState で積んだ履歴にも写る（ブラウザと同じ）。
// foreign の履歴（ほかのページ）へ動いた時は、popstate の代わりに pagehide を送る（ページが離れた）。
// 利用者の「戻る」「進む」は userGo（ブラウザの go と同じ動き）、アドレス欄で # を書き換えた時は typeHash。navigationApi の時は
// Chromium の Navigation API（navigation.entries()・currentEntry）もまねる: 今いる所と続いた、ほかのページでない履歴だけを数える。
// requestAnimationFrame は 16ms ごとの描く時（setTimeout）。アプリが呼んだ履歴は calls に控える（同じ物の置き換えかも）。
// swipes の時は、iPhone の WebKit の端からの身振りもまねる（WebKit のソースで読んだ物。パスは WebKit の Source/WebKit・WebCore の下。
// iPhone・iPad の1つの履歴の形 src/history/singleEntryHistory.ts の、前の版が残した履歴への身振りの確かめに使う）:
// - userGo は身振り: 始めた時に行き先の履歴を決め（ViewGestureControllerIOS.mm の beginSwipeGesture）、指を離す（fingerMs の後）と、
//   決めた履歴へ動く。その履歴が切り捨てられていれば動かず、身振りの絵を3秒出したまま、今いる履歴なら読み込み直しになる（どちらも
//   popstate は無い。HistoryController.cpp の itemsAreClones）。その向きに履歴が無ければ始まらない
// - 指を離すと、身振りが終わる動き（animMs）の間は描かない（requestAnimationFrame はその後。WebPage.cpp の swipeAnimationDidStart）。
//   その間に送る popstate は hasUAVisualTransition が true（Document.cpp の dispatchPopstateEvent）、ほかは false。着いた後も、動きの後
//   overlayMs たつまで身振りの絵を出したまま
// - 絵を出している間は、次の身振りは始まらない（refused。ViewGestureControllerIOS.mm の shouldBeginInteractiveTransition）
// iPhone・iPad の1つの履歴の形のテスト用に、ページのスクロールの位置（scrollY・scrollTo）と、前の版が残した履歴を並べる seed もある
import type { HistoryWindow } from '../history/appHistory'

interface Entry {
  state: unknown
  url: string
  /** ほかのページの履歴（アプリより前） */
  foreign?: boolean
  /** 「戻る」「進む」で来た時にスクロールの位置を戻すか（history.scrollRestoration） */
  scroll?: 'auto' | 'manual'
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
}

type Handler = (event: Event) => void

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
  /** 身振りの絵を出している */
  overlay = false
  /** 身振りが終わる動きの後、身振りの絵を外すまで */
  overlayMs = 100
  /** 身振りが終わる動きの長さ */
  animMs: number
  /** アプリが呼んだ履歴 */
  readonly calls: HistoryCall[] = []
  /** ページのスクロールの位置（scrollTo で替わる。ブラウザが「戻る」「進む」で戻す動きはまねない） */
  scrollY = 0
  private readonly handlers = new Map<string, Set<Handler>>()
  /** typeHash の数（その前に呼んだ go を取り消す） */
  private typed = 0
  /** 身振りが終わる動きが終わる時刻（Date.now。その前は描かない） */
  private animUntil = -Infinity
  private frameSeq = 0

  /** userGo を iPhone の端からの身振りとしてまねる（絵を出す・出している間は次の身振りが始まらない） */
  private readonly swipes: boolean

  constructor(hash = '#/', { before = 0, navigationApi = false, swipes = false, animMs = 300 }: FakeWindowOptions = {}) {
    this.swipes = swipes
    this.animMs = swipes ? animMs : 0
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
        win.calls.push({ op: 'go', delta, at: Date.now() })
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

  /** アプリが呼んだ置き換え・積むを控える */
  private note(op: 'pushState' | 'replaceState', data: unknown, url: string | null | undefined): void {
    const cur = this.entries[this.index]
    const mark = (data as { ds?: { mark?: string } } | null)?.ds?.mark ?? null
    const same = op === 'replaceState' && JSON.stringify(data) === JSON.stringify(cur.state) && this.resolve(url) === cur.url
    this.calls.push({ op, mark, same, at: Date.now() })
  }

  private pushState(data: unknown, url?: string | null): void {
    this.note('pushState', data, url)
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

  /** ページの go（次の処理で動いて popstate。範囲の外なら何もしない。その前に typeHash が来たら動かない） */
  move(delta: number): void {
    const typed = this.typed
    setTimeout(() => {
      if (this.left || typed !== this.typed) return
      const target = this.index + delta
      if (target < 0 || target >= this.entries.length) return
      this.arrive(target)
    }, 0)
  }

  /** その履歴へ着く（ほかのページなら離れる: pagehide。ページの中なら popstate） */
  private arrive(target: number): void {
    this.index = target
    if (this.entries[target].foreign) {
      this.left = true
      this.dispatch('pagehide', new Event('pagehide'))
      return
    }
    this.dispatchPop()
  }

  /** popstate を送る（身振りが終わる動きの間なら hasUAVisualTransition が true） */
  private dispatchPop(): void {
    this.dispatch('popstate', Object.assign(new Event('popstate'), { hasUAVisualTransition: Date.now() < this.animUntil }))
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
   * 絵を出している間は始まらない（refused）。その向きに履歴が無ければ始まらない（none）。始めた時に行き先の履歴を決め、fingerMs の後に
   * 指を離す（lift）
   */
  userGo(delta: number, { fingerMs = 0 }: { fingerMs?: number } = {}): SwipeResult {
    if (!this.swipes) {
      this.move(delta)
      return 'started'
    }
    if (this.overlay) return 'refused'
    const start = this.index + delta
    if (start < 0 || start >= this.entries.length) return 'none'
    const target = this.entries[start]
    this.overlay = true
    setTimeout(() => this.lift(target), fingerMs)
    return 'started'
  }

  /**
   * 身振りの指を離した: 始めた時に決めた履歴へ動く（切り捨てられていれば動かず、身振りの絵を3秒出したまま。今いる履歴なら読み込み
   * 直し。どちらも popstate は無い）。身振りが終わる動きの間は描かず、その後 overlayMs たったら絵を外す（上の初めの説明）
   */
  private lift(target: Entry): void {
    if (this.left) return
    const i = this.entries.indexOf(target)
    if (i === -1) {
      setTimeout(() => (this.overlay = false), 3000)
      return
    }
    if (i === this.index) {
      this.overlay = false
      return
    }
    this.animUntil = Date.now() + this.animMs
    this.arrive(i)
    if (this.left) return
    setTimeout(() => {
      if (!this.left) this.overlay = false
    }, this.animMs + this.overlayMs)
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

  /**
   * # を置き換えて移った（location.replace('#…')。表示できなかった時の案内のリンクなど）: ブラウザは今の履歴を、state の無い物に
   * 替えて popstate を送る（履歴は増えない）
   */
  replaceHash(hash: string): void {
    this.entries[this.index] = { ...this.entries[this.index], state: null, url: `https://app.example/${hash}` }
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

  /** ページをスクロールする（縦だけ使う） */
  scrollTo(_x: number, y: number): void {
    this.scrollY = y
  }

  /**
   * 履歴の並びを置き換える（前の版の印の履歴が残っている時など。hash は # からの行き先、state はその履歴の state）。index が今いる所
   */
  seed(list: { hash: string; state: unknown }[], index: number): void {
    this.entries = list.map((e) => ({ state: structuredClone(e.state), url: `https://app.example/${e.hash}` }))
    this.index = index
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
