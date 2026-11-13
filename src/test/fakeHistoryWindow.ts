// アプリの履歴（src/history/appHistory.ts）の単体テスト用の作り物の window。ブラウザの履歴（同じページの中の履歴の並びと今いる所）をまねる:
// pushState は今より後ろを捨てて積み、replaceState は今の物を替え、go は次の処理で動いて popstate を送る（範囲の外へは動かない）。
// foreign の履歴（ほかのページ）へ動いた時は、popstate の代わりに pagehide を送る（ページが離れた）。
// 利用者の「戻る」「進む」は userGo（ブラウザの go と同じ動き）、アドレス欄で # を書き換えた時は typeHash
import type { HistoryWindow } from '../history/appHistory'

interface Entry {
  state: unknown
  url: string
  /** ほかのページの履歴（アプリより前） */
  foreign?: boolean
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
  private readonly handlers = new Map<string, Set<Handler>>()

  constructor(hash = '#/', { before = 0 }: { before?: number } = {}) {
    this.entries = [
      ...Array.from({ length: before }, (_, i) => ({ state: null, url: `https://other.example/${i}`, foreign: true })),
      { state: null, url: `https://app.example/${hash}` },
    ]
    this.index = before
  }

  readonly history = (() => {
    const win = this
    return {
      get state(): unknown {
        return win.entries[win.index].state
      },
      pushState: (data: unknown, _unused: string, url?: string | null) => win.pushState(data, url),
      replaceState: (data: unknown, _unused: string, url?: string | null) => win.replaceState(data, url),
      go: (delta: number) => win.userGo(delta),
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
    this.entries = this.entries.slice(0, this.index + 1)
    this.entries.push({ state: structuredClone(data), url: this.resolve(url) })
    this.index += 1
  }

  private replaceState(data: unknown, url?: string | null): void {
    this.entries[this.index] = { state: structuredClone(data), url: this.resolve(url) }
  }

  /** ブラウザの「戻る」「進む」（次の処理で動いて popstate。範囲の外なら何もしない） */
  userGo(delta: number): void {
    setTimeout(() => {
      if (this.left) return
      const target = this.index + delta
      if (target < 0 || target >= this.entries.length) return
      this.index = target
      if (this.entries[target].foreign) {
        this.left = true
        this.dispatch('pagehide', new Event('pagehide'))
        return
      }
      this.dispatch('popstate', new Event('popstate'))
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
