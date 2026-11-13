// アプリの履歴（src/history/appHistory.ts）の単体テスト用の作り物の window。ブラウザの履歴（同じページの中の履歴の並びと今いる所）をまねる:
// pushState は今より後ろを捨てて積み、replaceState は今の物を替え、go は次の処理で動いて popstate を送る（範囲の外へは動かない）。
// history.scrollRestoration は今の履歴の物で、pushState で積んだ履歴にも写る（ブラウザと同じ）。
// foreign の履歴（ほかのページ）へ動いた時は、popstate の代わりに pagehide を送る（ページが離れた）。
// 利用者の「戻る」「進む」は userGo（ブラウザの go と同じ動き）、アドレス欄で # を書き換えた時は typeHash。navigationApi の時は
// Chromium の Navigation API（navigation.entries()・currentEntry）もまねる: 今いる所と続いた、ほかのページでない履歴だけを数える。
// requestAnimationFrame は 16ms ごとの描く時（setTimeout）。
// iPhone の WebKit の身振りの絵もまねる（docs/SPEC.md の 3.1。WebKit のソースで読んだ物）: 履歴を離れる時（pushState の時・go で
// 動く時・利用者の身振り（userGo）を始めた時）に、その時に描かれていた画面（painted。show で替えた画面は、2回描いた後に描かれる）を、
// 離れる履歴の絵として控える（描く物の数と一緒に。weights・ballast）。swipes の時の userGo は身振りで、行き先の履歴の絵を出し
// （slid に控える）、着いた後も、描く物の数が行き先の絵の半分を超えて overlayMs たつまで（超えなければ3秒）絵を出したまま
// （overlayEnds に長さ）。その間は絵を控えず、次の身振りも始まらない。replaceState は絵を残し、pushState で捨てた後ろの履歴の絵は消える
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

type Handler = (event: Event) => void

export class FakeWindow implements HistoryWindow {
  entries: Entry[]
  index: number
  /** ページが離れた（foreign の履歴へ動いた） */
  left = false
  closeCalls = 0
  readonly navigator = { userActivation: { isActive: false } }
  readonly document = { querySelector: () => null }
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
  /** 着いてから身振りの絵を外すまで（描く物が足りている時） */
  overlayMs = 100
  /** 身振りの間に出した絵（行き先の履歴の絵の画面。絵の無い履歴は none） */
  readonly slid: string[] = []
  /** 着いてから身振りの絵を外すまでの長さ */
  readonly overlayEnds: number[] = []
  private readonly handlers = new Map<string, Set<Handler>>()

  /** userGo を iPhone の端からの身振りとしてまねる（絵を出す・出している間は次の身振りが始まらない） */
  private readonly swipes: boolean

  constructor(
    hash = '#/',
    { before = 0, navigationApi = false, swipes = false }: { before?: number; navigationApi?: boolean; swipes?: boolean } = {},
  ) {
    this.swipes = swipes
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
      go: (delta: number) => win.move(delta),
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

  private pushState(data: unknown, url?: string | null): void {
    this.record()
    const scroll = this.entries[this.index].scroll
    this.entries = this.entries.slice(0, this.index + 1)
    this.entries.push({ state: structuredClone(data), url: this.resolve(url), scroll })
    this.index += 1
  }

  private replaceState(data: unknown, url?: string | null): void {
    const { scroll, picture } = this.entries[this.index]
    this.entries[this.index] = { state: structuredClone(data), url: this.resolve(url), scroll, picture }
  }

  /** 画面を替える（描かれるのは、2回描いた後） */
  show(screen: string): void {
    this.screen = screen
    setTimeout(() => {
      this.painted = screen
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

  /** ページの go（次の処理で、離れる履歴の絵を控えてから動いて popstate。範囲の外なら何もしない） */
  move(delta: number): void {
    setTimeout(() => {
      if (this.left) return
      const target = this.index + delta
      if (target < 0 || target >= this.entries.length) return
      this.record()
      this.arrive(target)
    }, 0)
  }

  private arrive(target: number): void {
    this.index = target
    if (this.entries[target].foreign) {
      this.left = true
      this.dispatch('pagehide', new Event('pagehide'))
      return
    }
    this.dispatch('popstate', new Event('popstate'))
  }

  requestAnimationFrame(callback: () => void): number {
    return setTimeout(callback, 16) as unknown as number
  }

  /** 履歴ごとのスクロールの戻し方（manual の物だけ m、ほかは a） */
  scrollModes(): string {
    return this.entries.map((e) => (e.scroll === 'manual' ? 'm' : 'a')).join('')
  }

  /**
   * ブラウザの「戻る」「進む」（次の処理で動いて popstate。範囲の外なら何もしない）。swipes の時は iPhone の端からの身振り: 身振りの
   * 絵を出している間は始まらない（WebKit と同じ）。始めた時に今の履歴の絵を控え、行き先の履歴の絵を出し（slid）、着いた後は、描く物の
   * 数が行き先の絵の半分を超えていれば overlayMs で、超えていなければ3秒で絵を外す
   */
  userGo(delta: number): void {
    if (!this.swipes) {
      this.move(delta)
      return
    }
    if (this.overlay) return
    const start = this.index + delta
    if (start < 0 || start >= this.entries.length) return
    this.record()
    this.overlay = true
    const picture = this.entries[start].picture
    this.slid.push(picture?.screen ?? 'none')
    setTimeout(() => {
      if (this.left) return
      const target = this.index + delta
      if (target < 0 || target >= this.entries.length) {
        this.overlay = false
        return
      }
      this.arrive(target)
      const threshold = (picture?.weight ?? 0) / 2
      const at = Date.now()
      setTimeout(() => {
        const end = this.weight() > threshold ? 0 : 3000 - this.overlayMs
        setTimeout(() => {
          this.overlay = false
          this.overlayEnds.push(Date.now() - at)
        }, end)
      }, this.overlayMs)
    }, 0)
  }

  /** アドレス欄で # の後ろを書き換えた（ブラウザが state の無い履歴を積んで popstate） */
  typeHash(hash: string): void {
    this.entries = this.entries.slice(0, this.index + 1)
    this.entries.push({ state: null, url: `https://app.example/${hash}` })
    this.index += 1
    this.dispatch('popstate', new Event('popstate'))
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
