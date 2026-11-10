// 外観と起動アニメーション（src/launch/launch.js。index.html に埋め込むスクリプト）。NS の src/launch/launch.test.ts から（docs/SPEC.md の 5.10）。
// 埋め込むのと同じ中身（?raw）をこのページで動かして確かめる。canvas は jsdom に無いので、何も描かない偽物にする
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import source from './launch.js?raw'

type Appearance = 'white' | 'dark' | 'deep-dark'
interface Env {
  enabled: boolean
  webdriver: boolean
  forced: boolean
  shownInSession: boolean
  hidden?: boolean
  reducedMotion: boolean
}
interface ControllerOptions {
  still?: boolean
  setTimeout: (fn: () => void, ms: number) => number
  clearTimeout: (id: number) => void
  onFadeOut: (reason: string) => void
  onRemove: () => void
}
interface Controller {
  start(): void
  animationEnded(): void
  stillShown(): void
  appReady(): void
  skip(): void
  state(): string
}
interface Palette {
  bg: string
  laser: string
  core: string
  logo: string
  hot: string
  splitA: string
  splitB: string
  blend: string
  glow: number
  flicker: number
  vignette: string
  scanline: string
}
interface Player {
  stop(): void
  dispose(): void
  drawAt(t: number): void
}
type TimeName =
  | 'T_BOOK'
  | 'T_OPEN0'
  | 'T_SPREAD'
  | 'T_GRID'
  | 'T_TEXT'
  | 'T_COLLAPSE'
  | 'T_LINE'
  | 'T_OPEN'
  | 'T_OPENED'
  | 'T_SCAN0'
  | 'T_SCAN1'
  | 'FRAME'
  | 'GRID_STEP'
  | 'TEXT_STEP'
  | 'HOT'
interface LaunchApi {
  boot(): Appearance
  appReady(): void
  active(): boolean
  resolveAppearance(prefs: unknown, systemDark: boolean): Appearance
  animationTheme(appearance: string): string
  decide(env: Env): 'none' | 'play' | 'still'
  createController(o: ControllerOptions): Controller
  play(stage: HTMLElement, theme: string, opts?: { still?: boolean; at?: number }): Player
  workerSource(): string
  TIMING: { stillMs: number; capMs: number; fadeMs: number }
  DURATION: number
  PALETTES: Record<'light' | 'dark' | 'deep', Palette>
  TIMES: Record<TimeName, number>
  GLYPHS: Record<string, string[]>
  BOOK: { CLOSED: string[]; SPREAD: string[]; FRAMES: string[][]; CAL_COLS: number[]; CAL_ROWS: number[] }
  bookPitch(safeW: number, safeH: number, dpr: number): number
  textSize(p: number): number
  logoLit(): Uint8Array
}

const PREFS_KEY = 'diary-studio:prefs'
const w = window as unknown as {
  DiaryStudioLaunch?: LaunchApi
}

/** ページを開き直したことにする（スクリプトを読み込み直す。sessionStorage・localStorage は残る） */
function load(): LaunchApi {
  delete w.DiaryStudioLaunch
  new Function('window', 'document', source)(window, document)
  return w.DiaryStudioLaunch!
}

/** canvas の偽物（描く命令の数を数え、描いた絵（drawImage の1つ目）を控える） */
let draws = 0
let drawn: { width: number; height: number }[] = []
function fakeContext(): CanvasRenderingContext2D {
  const gradient = { addColorStop() {} }
  const props: Record<string, unknown> = {}
  return new Proxy(props, {
    get(t, key: string) {
      if (key in t) return t[key]
      if (key === 'createRadialGradient' || key === 'createLinearGradient') return () => gradient
      if (key === 'drawImage')
        return (img: { width: number; height: number }) => {
          draws++
          drawn.push(img)
        }
      return () => undefined
    },
    set(t, key: string, v) {
      t[key] = v
      return true
    },
  }) as unknown as CanvasRenderingContext2D
}

/** 端末の設定（prefers-color-scheme・prefers-reduced-motion） */
function media({ dark = false, reduced = false } = {}) {
  window.matchMedia = ((q: string) => ({
    matches: q.includes('dark') ? dark : q.includes('reduced-motion') ? reduced : false,
  })) as unknown as typeof window.matchMedia
}

function setWebdriver(on: boolean) {
  Object.defineProperty(navigator, 'webdriver', { value: on, configurable: true })
}

const overlay = () => document.getElementById('ds-launch')
/** 時計を進める（setTimeout・requestAnimationFrame） */
const t = (ms: number) => vi.advanceTimersByTime(ms)

beforeEach(() => {
  draws = 0
  drawn = []
  localStorage.clear()
  sessionStorage.clear()
  media()
  setWebdriver(false)
  window.history.replaceState(null, '', '/')
  document.head.innerHTML = '<meta name="theme-color" content="#ffffff">'
  document.documentElement.removeAttribute('data-theme')
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(fakeContext as never)
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  overlay()?.remove()
})

describe('外観（最初の描画の前）', () => {
  it('設定の外観を、端末の設定によらずそのまま使う。「端末の設定に合わせる」は端末がダークならダーク', () => {
    const api = load()
    for (const dark of [false, true]) {
      expect(api.resolveAppearance({ appearance: 'white' }, dark)).toBe('white')
      expect(api.resolveAppearance({ appearance: 'dark' }, dark)).toBe('dark')
      expect(api.resolveAppearance({ appearance: 'deep-dark' }, dark)).toBe('deep-dark')
    }
    expect(api.resolveAppearance({ appearance: 'system' }, true)).toBe('dark')
    expect(api.resolveAppearance({ appearance: 'system' }, false)).toBe('white')
    // 設定が無い・壊れている・知らない値は「端末の設定に合わせる」
    expect(api.resolveAppearance({}, true)).toBe('dark')
    expect(api.resolveAppearance(null, false)).toBe('white')
    expect(api.resolveAppearance({ appearance: 'sepia' }, true)).toBe('dark')
    expect(api.resolveAppearance({ appearance: 'light' }, false)).toBe('white')
    // 読むのは DS の項目名 appearance（NS の theme は読まない。docs/SPEC.md の 5.1）
    expect(api.resolveAppearance({ theme: 'deep-dark' }, false)).toBe('white')
  })

  it('外観 → アニメーションの色: ホワイトは light（白地に青）、ダークは dark（黒地に明るい青）、ディープダークは deep（黒地に暗い青）', () => {
    const api = load()
    expect(api.animationTheme('white')).toBe('light')
    expect(api.animationTheme('dark')).toBe('dark')
    expect(api.animationTheme('deep-dark')).toBe('deep')
    // 知らない外観はダーク
    expect(api.animationTheme('sepia')).toBe('dark')
  })

  it('色の組は外観ごとの青（docs/SPEC.md の 5.4 の表）。ダークのロゴはアイコンの青と同じ', () => {
    const { PALETTES } = load()
    expect(PALETTES.light).toEqual({
      bg: '#fbfcfe',
      laser: '#2f6fd9',
      core: '#1d4fb8',
      logo: '#25539a',
      hot: '#2f6fd9',
      splitA: '#ff4f8b',
      splitB: '#13b5c9',
      blend: 'source-over',
      glow: 0.85,
      flicker: 1,
      vignette: 'rgba(0,10,40,0.03)',
      scanline: 'rgba(0,0,0,0.016)',
    })
    expect(PALETTES.dark).toEqual({
      bg: '#050607',
      laser: '#5cc0ff',
      core: '#c2e3ff',
      logo: '#5cc0ff',
      hot: '#eef7ff',
      splitA: '#ff2b6e',
      splitB: '#2bffd2',
      blend: 'lighter',
      glow: 1,
      flicker: 1,
      vignette: 'rgba(0,0,0,0.6)',
      scanline: 'rgba(0,0,0,0.24)',
    })
    expect(PALETTES.deep).toEqual({
      bg: '#000000',
      laser: '#3d74c4',
      core: '#4f80c4',
      logo: '#3d74c4',
      hot: '#8fb6e6',
      splitA: '#5c1430',
      splitB: '#0e4a50',
      blend: 'lighter',
      glow: 0.45,
      flicker: 0.35,
      vignette: 'rgba(0,0,0,0.5)',
      scanline: 'rgba(0,0,0,0.24)',
    })
  })

  it('boot は <html data-theme> とブラウザの枠の色を決める（起動アニメーションを出さない時も）', () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ appearance: 'deep-dark', launchAnimation: false }))
    expect(load().boot()).toBe('deep-dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('deep-dark')
    expect(document.querySelector('meta[name="theme-color"]')!.getAttribute('content')).toBe('#0e0f11')
    expect(overlay()).toBeNull()

    media({ dark: true })
    localStorage.setItem(PREFS_KEY, '{壊れた')
    setWebdriver(true)
    expect(load().boot()).toBe('dark')
    expect(document.querySelector('meta[name="theme-color"]')!.getAttribute('content')).toBe('#17181b')
  })
})

describe('出すかどうか（decide）', () => {
  const base: Env = { enabled: true, webdriver: false, forced: false, shownInSession: false, reducedMotion: false }

  it('ウインドウ・タブの最初の1回だけ（再読み込みでは出さない）', () => {
    const { decide } = load()
    expect(decide(base)).toBe('play')
    expect(decide({ ...base, shownInSession: true })).toBe('none')
  })

  it('見えていないタブ（裏で開いた・ブラウザの先読み）では出さない（印はそのタブが見えた時に付ける。boot のテスト）', () => {
    const { decide } = load()
    expect(decide({ ...base, hidden: true })).toBe('none')
    expect(decide({ ...base, hidden: true, forced: true, webdriver: true })).toBe('none')
  })

  it('設定でオフにすると出さない（強制しても）', () => {
    const { decide } = load()
    expect(decide({ ...base, enabled: false })).toBe('none')
    expect(decide({ ...base, enabled: false, forced: true, webdriver: true })).toBe('none')
  })

  it('テスト（navigator.webdriver）では、強制した時だけ出す', () => {
    const { decide } = load()
    expect(decide({ ...base, webdriver: true })).toBe('none')
    expect(decide({ ...base, webdriver: true, forced: true })).toBe('play')
    // 強制しても、同じウインドウの再読み込みでは出さない
    expect(decide({ ...base, webdriver: true, forced: true, shownInSession: true })).toBe('none')
  })

  it('視差効果を減らす設定では、動かさずに最後の絵だけ出す', () => {
    const { decide } = load()
    expect(decide({ ...base, reducedMotion: true })).toBe('still')
    expect(decide({ ...base, reducedMotion: true, shownInSession: true })).toBe('none')
  })
})

describe('消すまでの流れ（createController）', () => {
  function setup(still = false) {
    const events: string[] = []
    const c = load().createController({
      still,
      setTimeout: (fn, ms) => window.setTimeout(fn, ms),
      clearTimeout: (id) => window.clearTimeout(id),
      onFadeOut: (reason) => events.push(`fade:${reason}@${Date.now() - t0}`),
      onRemove: () => events.push(`remove@${Date.now() - t0}`),
    })
    const t0 = Date.now()
    return { c, events }
  }

  beforeEach(() => {
    vi.useRealTimers()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  })

  it('アニメーションの終わりとアプリの知らせの両方がそろってから消し始め、0.25秒で取り除く', () => {
    const { c, events } = setup()
    c.start()
    expect(c.state()).toBe('playing')
    vi.advanceTimersByTime(2270)
    c.animationEnded()
    expect(events).toEqual([])
    vi.advanceTimersByTime(730)
    c.appReady()
    expect(events).toEqual(['fade:done@3000'])
    expect(c.state()).toBe('fading')
    vi.advanceTimersByTime(249)
    expect(events).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(events).toEqual(['fade:done@3000', 'remove@3250'])
    expect(c.state()).toBe('removed')
  })

  it('アプリが先に知らせてきたら、アニメーションの終わりを待つ', () => {
    const { c, events } = setup()
    c.start()
    vi.advanceTimersByTime(400)
    c.appReady()
    expect(events).toEqual([])
    vi.advanceTimersByTime(1870)
    c.animationEnded()
    expect(events).toEqual(['fade:done@2270'])
  })

  it('アプリが知らせてこなくても、5秒で消える', () => {
    const { c, events } = setup()
    c.start()
    c.animationEnded()
    vi.advanceTimersByTime(4999)
    expect(events).toEqual([])
    vi.advanceTimersByTime(1)
    expect(events).toEqual(['fade:cap@5000'])
    vi.advanceTimersByTime(250)
    expect(events).toEqual(['fade:cap@5000', 'remove@5250'])
  })

  it('押した・キーを押した時はすぐ消える（あとの知らせ・5秒の期限は何もしない）', () => {
    const { c, events } = setup()
    c.start()
    vi.advanceTimersByTime(300)
    c.skip()
    expect(events).toEqual(['fade:skip@300'])
    c.skip()
    c.animationEnded()
    c.appReady()
    vi.advanceTimersByTime(10_000)
    expect(events).toEqual(['fade:skip@300', 'remove@550'])
  })

  it('動かさない時は、最後の絵を描いてから0.5秒出して（アプリの知らせも待って）消す', () => {
    const { c, events } = setup(true)
    c.start()
    c.appReady()
    // 描く準備・Worker の立ち上がりの間は数えない
    vi.advanceTimersByTime(200)
    expect(events).toEqual([])
    c.stillShown()
    vi.advanceTimersByTime(499)
    expect(events).toEqual([])
    // 2度目の知らせ（Worker で描けずにページの中で描き直した時など）は数え直さない
    c.stillShown()
    vi.advanceTimersByTime(1)
    expect(events).toEqual(['fade:done@700'])
  })

  it('動かさない時、最後の絵を描けないままなら5秒で消える。動かす時の stillShown は何もしない', () => {
    const still = setup(true)
    still.c.start()
    still.c.appReady()
    vi.advanceTimersByTime(5000)
    expect(still.events).toEqual(['fade:cap@5000'])

    const moving = setup()
    moving.c.start()
    moving.c.appReady()
    moving.c.stillShown()
    vi.advanceTimersByTime(4999)
    expect(moving.events).toEqual([])
    moving.c.animationEnded()
    expect(moving.events).toEqual(['fade:done@4999'])
  })

  it('消し始めた後の stillShown は何もしない', () => {
    const { c, events } = setup(true)
    c.start()
    c.skip()
    c.stillShown()
    c.appReady()
    vi.advanceTimersByTime(10_000)
    expect(events).toEqual(['fade:skip@0', 'remove@250'])
  })
})

describe('絵の流れ（docs/SPEC.md の 5.3）', () => {
  it('時刻は順に増え、全体（2.27秒）は 5秒の期限より短い。潰れてから後の間隔は NS と同じ', () => {
    const { TIMES: T, DURATION, TIMING } = load()
    const order = [
      T.T_BOOK,
      T.T_OPEN0,
      T.T_SPREAD,
      T.T_GRID,
      T.T_TEXT,
      T.T_COLLAPSE,
      T.T_LINE,
      T.T_OPEN,
      T.T_OPENED,
      T.T_SCAN0,
      T.T_SCAN1,
      DURATION,
    ]
    for (let i = 1; i < order.length; i++) expect(order[i], `${i}`).toBeGreaterThan(order[i - 1])
    expect(DURATION).toBe(2.27)
    expect(DURATION * 1000).toBeLessThan(TIMING.capMs)
    // 温まる（WARMUP）0.40秒の後に日記帳。表紙は 0.03秒ずつ8コマで開いて見開きになる
    expect(T.T_BOOK).toBe(0.4)
    expect(T.T_OPEN0).toBe(0.62)
    expect(T.T_OPEN0 + 8 * T.FRAME).toBeCloseTo(T.T_SPREAD, 9)
    // 曜日の行 → 週の5行が 0.05秒ずつ（1.15秒まで）。言葉の7字は 0.05秒おき（1.30秒まで）で、潰れる前に灯り終わる
    expect(T.T_GRID + 5 * T.GRID_STEP).toBeCloseTo(1.15, 9)
    expect(T.T_TEXT).toBe(0.95)
    expect(T.T_TEXT + 7 * T.TEXT_STEP).toBeCloseTo(1.3, 9)
    expect(T.T_TEXT + 7 * T.TEXT_STEP).toBeLessThan(T.T_COLLAPSE)
    expect(T.HOT).toBe(0.06)
    const gaps = [T.T_LINE, T.T_OPEN, T.T_OPENED, T.T_SCAN0, T.T_SCAN1, DURATION].map((v, i, a) =>
      Number((v - (i ? a[i - 1] : T.T_COLLAPSE)).toFixed(3)),
    )
    expect(gaps).toEqual([0.13, 0.06, 0.15, 0.06, 0.32, 0.13])
  })

  it('どの時刻の絵も、どの外観でも描ける', () => {
    const api = load()
    for (const theme of ['light', 'dark', 'deep']) {
      const player = api.play(document.createElement('div'), theme, { still: true })
      for (let ms = 0; ms <= 2270; ms += 5) player.drawAt(ms / 1000)
      player.dispose()
    }
    expect(draws).toBeGreaterThan(0)
  })

  describe('描く絵（jsdom の大きさ 240×520・dpr 1 → 日記の点の間隔 6px）', () => {
    // 日記の絵の大きさ（実ピクセル）: 幅は 点を置く列の数 × 6 ＋ 余白（光の分。2 間隔）12 × 2、高さは 20行 × 6 ＋ 24
    const BOOK_H = 20 * 6 + 24
    const width = (cols: number) => cols * 6 + 24
    let player: Player
    beforeEach(() => {
      player = load().play(document.createElement('div'), 'dark', { still: true })
    })
    afterEach(() => player.dispose())
    /** t 秒の絵で描いた絵のうち、大きさ（高さ）が h の物（同じ絵は1つに） */
    const drawnAt = (t: number, h: number) => {
      drawn = []
      player.drawAt(t)
      return [...new Set(drawn.filter((c) => c.height === h))]
    }

    it('閉じた日記帳は 0.40秒に現れ、表紙は 0.62秒から 0.03秒ずつ8コマで開いて、0.86秒からは見開き', () => {
      expect(drawnAt(0.39, BOOK_H)).toEqual([])
      const closed = drawnAt(0.5, BOOK_H)
      expect(closed).toHaveLength(1)
      // コマ1〜8 の絵（コマの真ん中の時刻）
      const frames = [0, 1, 2, 3, 4, 5, 6, 7].map((f) => {
        const imgs = drawnAt(0.62 + 0.03 * f + 0.015, BOOK_H)
        expect(imgs, `コマ${f + 1}`).toHaveLength(1)
        return imgs[0]
      })
      expect(new Set(frames).size).toBe(8)
      expect(frames[0]).toBe(closed[0])
      // コマ1〜4 は表紙（背と 16列）、コマ5〜8 は左のページが 2→6→11→16 列ずつ足される
      expect(frames.map((c) => c.width)).toEqual([17, 17, 17, 17, 19, 23, 28, 33].map(width))
      // コマの切り替わり
      expect(drawnAt(0.649, BOOK_H)).toEqual([frames[0]])
      expect(drawnAt(0.651, BOOK_H)).toEqual([frames[1]])
      expect(drawnAt(0.829, BOOK_H)).toEqual([frames[6]])
      // 見開きは潰れるまで同じ絵
      for (const t of [0.86, 1.0, 1.2, 1.4]) expect(drawnAt(t, BOOK_H), `${t}`).toEqual([frames[7]])
      // 現れる時の 0.06秒だけ、色ずれの2枚（splitA・splitB）も描く
      expect(drawnAt(0.41, BOOK_H)).toHaveLength(3)
      // 一本の線になった後は描かない
      expect(drawnAt(1.6, BOOK_H)).toEqual([])
    })

    it('暦: 0.90秒に曜日の行、続いて週の5行が上から 0.05秒ずつ灯る', () => {
      // 灯った行の絵（1行の点 6px ＋ 余白 24）。灯ったばかり（0.06秒）は hot の色の別の絵
      const ROW_H = 6 + 24
      expect(drawnAt(0.88, ROW_H)).toHaveLength(0)
      expect(drawnAt(0.92, ROW_H)).toHaveLength(1)
      const rows = [0.97, 1.02, 1.07, 1.12, 1.17].map((t) => drawnAt(t, ROW_H))
      expect(rows.map((r) => r.length)).toEqual([2, 3, 4, 5, 6])
      // 灯ったばかりの行は 0.06秒たつと灯った色の絵に替わる
      expect(drawnAt(0.92, ROW_H)[0]).not.toBe(drawnAt(0.97, ROW_H)[0])
      expect(drawnAt(1.3, ROW_H)).toHaveLength(6)
    })

    it('言葉「日々を、記す。」は 0.95秒から1字ずつ 0.05秒おきに灯る（灯ったばかりの字は明るい絵を重ねる）', () => {
      // 1字の絵の高さ: 字の大きさ 12.16px（15 × 6 ÷ 7.4）× 1.4 ＋ 余白 8 × 2 → 34
      const CHAR_H = 34
      expect(drawnAt(0.94, CHAR_H)).toHaveLength(0)
      expect(drawnAt(0.96, CHAR_H)).toHaveLength(2)
      expect(drawnAt(1.02, CHAR_H)).toHaveLength(3)
      expect(drawnAt(1.35, CHAR_H)).toHaveLength(7)
      // 潰れて線になる前に消える
      expect(drawnAt(1.54, CHAR_H)).toHaveLength(0)
    })
  })
})

describe('日記の点の絵（docs/SPEC.md の 5.5）', () => {
  // prettier-ignore
  const CLOSED = [
    '#################',
    '##++++++++++#+++#',
    '##++++++++++#+++#',
    '##++++++++++#+++#',
    '##++######++#+++#',
    '##++#....#++#+++#',
    '##++#....#++#+++#',
    '##++#....#++#+++#',
    '##++######++#+++#',
    ...Array.from({ length: 10 }, () => '##++++++++++#+++#'),
    '#################',
  ]

  it('閉じた日記帳は 17列×20行（0列が背。題の札は 4〜9列×4〜8行、留めのゴムは 12列）', () => {
    const { BOOK } = load()
    expect(BOOK.CLOSED).toEqual(CLOSED)
  })

  it('見開きは 33列×20行。外の枠と背（16列）が明るい点、右のページに暦の点（3行目が曜日、6〜14行目の1行おきが週）', () => {
    const { BOOK } = load()
    expect(BOOK.SPREAD).toHaveLength(20)
    for (const row of BOOK.SPREAD) expect(row).toHaveLength(33)
    expect(BOOK.CAL_COLS).toEqual([18, 20, 22, 24, 26, 28, 30])
    expect(BOOK.CAL_ROWS).toEqual([3, 6, 8, 10, 12, 14])
    const page = '.'.repeat(15)
    expect(BOOK.SPREAD[0]).toBe('#'.repeat(33))
    expect(BOOK.SPREAD[19]).toBe('#'.repeat(33))
    // 曜日の点は灯るまで消えている点（'.'）、週の点は淡い点（'+'）
    expect(BOOK.SPREAD[3]).toBe(`#${page}#${page}#`)
    for (const r of [6, 8, 10, 12, 14]) expect(BOOK.SPREAD[r], `${r}`).toBe(`#${page}#${'.+'.repeat(7)}.#`)
    for (const r of [1, 2, 4, 5, 7, 9, 11, 13, 15, 16, 17, 18]) expect(BOOK.SPREAD[r], `${r}`).toBe(`#${page}#${page}#`)
  })

  it('表紙が開く8コマ: 閉じた日記帳を見開きの 16〜32列に重ね、表紙が 16→11→6→2 列に縮み、左のページが 2→6→11→16 列で開く', () => {
    const { BOOK } = load()
    const { FRAMES, SPREAD } = BOOK
    expect(FRAMES).toHaveLength(8)
    const edge = (r: number) => r === 0 || r === 19
    FRAMES.forEach((frame, f) => {
      expect(frame).toHaveLength(20)
      frame.forEach((row, r) => {
        expect(row, `コマ${f + 1} ${r}行`).toHaveLength(33)
        // 背（16列）は回る軸。どのコマでも明るい点のまま
        expect(row.charAt(16), `コマ${f + 1} ${r}行`).toBe('#')
      })
    })
    // コマ1 は閉じた日記帳（題の札とゴムは閉じている時だけ）
    expect(FRAMES[0]).toEqual(CLOSED.map((row) => ' '.repeat(16) + row))
    // コマ2〜4: 表紙の幅 w（縁は明るい点・中は淡い点）。隠れていない右のページはそのまま
    ;[11, 6, 2].forEach((w, i) => {
      FRAMES[i + 1].forEach((row, r) => {
        const cover = edge(r) ? '#'.repeat(w) : `#${'+'.repeat(w - 2)}#`
        expect(row, `表紙 ${w} 列 ${r}行`).toBe(`${' '.repeat(16)}#${cover}${SPREAD[r].slice(17 + w)}`)
      })
    })
    // コマ5〜7: 左のページが背から左へ w 列（外の縁は明るい点・中は消えている点）。右のページは全部見える
    ;[2, 6, 11].forEach((w, i) => {
      FRAMES[i + 4].forEach((row, r) => {
        const leaf = edge(r) ? '#'.repeat(w) : `#${'.'.repeat(w - 1)}`
        expect(row, `左のページ ${w} 列 ${r}行`).toBe(`${' '.repeat(16 - w)}${leaf}${SPREAD[r].slice(16)}`)
      })
    })
    // コマ8 で見開き
    expect(FRAMES[7]).toEqual(SPREAD)
  })

  it('点の間隔: 見開きが 横長の画面は幅の 62%・縦長は 88%、高さの半分に収まる（実ピクセルの整数）', () => {
    const { bookPitch } = load()
    // iPhone 14 の縦（ノッチ・ホームバーを除いて 390×763、dpr 3）: p ≈ 10.3px、見開きの幅 341px
    const pd = bookPitch(390, 763, 3)
    expect(pd).toBe(31)
    expect((33 * pd) / 3).toBeCloseTo(341, 0)
    // 縦長で高さが先に詰まる時
    expect(bookPitch(1000, 1040, 1)).toBe(26)
    // 横長（PC）: 高さで決まる時と幅で決まる時
    expect(bookPitch(1280, 800, 2)).toBe(40)
    expect(bookPitch(1000, 1000, 1)).toBe(Math.round((1000 * 0.62) / 33))
    // 小さすぎる画面でも 2 より小さくしない
    expect(bookPitch(20, 30, 1)).toBe(2)
  })

  it('言葉の字の大きさは max(1.6p, 16px)。ただし7字が左のページ（15p）に収まるよう 15p ÷ 7.4 まで', () => {
    const { textSize } = load()
    // iPhone 14 の縦: 16.5px
    expect(textSize(31 / 3)).toBeCloseTo(16.53, 2)
    expect(textSize(23)).toBeCloseTo(36.8, 6)
    expect(textSize(9)).toBe(16)
    expect(textSize(6)).toBeCloseTo(90 / 7.4, 6)
  })
})

describe('ロゴ「Diary Studio」（docs/SPEC.md の 5.7）', () => {
  it('点の字: D・a・r・y を足し、S・t・u・d・i・o は NS のまま。N・v・e・l は使わない', () => {
    const { GLYPHS } = load()
    expect(GLYPHS.D).toEqual(['11110', '10001', '10001', '10001', '10001', '10001', '11110'])
    expect(GLYPHS.a).toEqual(['00000', '00000', '01110', '00001', '01111', '10001', '01111'])
    expect(GLYPHS.r).toEqual(['00000', '00000', '10110', '11001', '10000', '10000', '10000'])
    expect(GLYPHS.y).toEqual(['00000', '00000', '10001', '10001', '01111', '00001', '01110'])
    expect(GLYPHS.S).toEqual(['01111', '10000', '10000', '01110', '00001', '00001', '11110'])
    expect(Object.keys(GLYPHS).sort()).toEqual(['D', 'S', 'a', 'd', 'i', 'o', 'r', 't', 'u', 'y'])
    for (const g of Object.values(GLYPHS)) {
      expect(g).toHaveLength(7)
      for (const row of g) expect(row).toMatch(/^[01]{5}$/)
    }
  })

  it('37列×18行の升目に Diary を (4, 1)、Studio を (1, 10) に置く（6列ずつ）', () => {
    const { GLYPHS, logoLit } = load()
    const lit = logoLit()
    expect(lit).toHaveLength(37 * 18)
    const expected = new Uint8Array(37 * 18)
    const put = (text: string, col0: number, row0: number) =>
      [...text].forEach((ch, q) =>
        GLYPHS[ch].forEach((row, r) =>
          [...row].forEach((v, b) => {
            if (v === '1') expected[(row0 + r) * 37 + col0 + q * 6 + b] = 1
          }),
        ),
      )
    put('Diary', 4, 1)
    put('Studio', 1, 10)
    expect([...lit]).toEqual([...expected])
    // D の左上（4列・1行）と、Studio の S の右上（5列・10行）
    expect(lit[1 * 37 + 4]).toBe(1)
    expect(lit[10 * 37 + 5]).toBe(1)
    // 升目の外の列（0列・36列）と、2行の間（8・9行）には点を置かない
    for (let r = 0; r < 18; r++) {
      expect(lit[r * 37]).toBe(0)
      expect(lit[r * 37 + 36]).toBe(0)
    }
    for (let c = 0; c < 37; c++) expect(lit[8 * 37 + c] + lit[9 * 37 + c]).toBe(0)
  })
})

describe('起動アニメーション（boot）', () => {
  it('Web 版の最初の読み込み: <html> の直下に画面いっぱいの重なりを出す（読み上げない・押せるものを置かない）', () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ appearance: 'dark' }))
    const api = load()
    api.boot()
    const el = overlay()!
    expect(el.parentElement).toBe(document.documentElement)
    expect(el.getAttribute('aria-hidden')).toBe('true')
    expect(el.getAttribute('data-testid')).toBe('launch-overlay')
    expect(el.getAttribute('data-launch-theme')).toBe('dark')
    expect(el.getAttribute('data-launch-mode')).toBe('play')
    expect(el.style.position).toBe('fixed')
    // 地の色（アニメーションの最初の絵とほぼ同じ）はその場で出る
    expect(el.style.background).toMatch(/#050607|rgb\(5, 6, 7\)/)
    expect(sessionStorage.getItem('diary-studio:launched')).toBe('1')
    expect(api.active()).toBe(true)
    // 描く準備は HTML を読み終えた後。Worker を使えない所（ここ）ではページの中で描き、下ごしらえは最初の描画の時
    expect(el.getAttribute('data-launch-renderer')).toBeNull()
    t(0)
    expect(el.getAttribute('data-launch-renderer')).toBe('page')
    expect(draws).toBe(0)
    t(16)
    expect(el.querySelectorAll('canvas')).toHaveLength(1)
    expect(draws).toBeGreaterThan(0)
    expect(el.querySelector('a, button, input, [tabindex]')).toBeNull()
  })

  it('アニメーションが終わっても、アプリの知らせまでは消えない。知らせが来たら0.25秒で消えて取り除く', () => {
    const api = load()
    api.boot()
    const el = overlay()!
    t(16)
    const canvas = el.querySelector('canvas')!
    t(3000)
    expect(el.style.opacity).toBe('1')
    expect(el.getAttribute('data-launch-end')).toBeNull()
    api.appReady()
    expect(el.style.opacity).toBe('0')
    expect(el.style.pointerEvents).toBe('none')
    expect(el.getAttribute('data-launch-end')).toBe('done')
    t(250)
    expect(overlay()).toBeNull()
    expect(api.active()).toBe(false)
    // canvas の中身を手放す
    expect(canvas.width).toBe(0)
  })

  it('アプリが先に知らせてきた時は、アニメーションが終わった所（約2.27秒）で消える', () => {
    const api = load()
    api.boot()
    api.appReady()
    t(1000)
    expect(overlay()!.style.opacity).toBe('1')
    // 描き始め（2回目の描画。32ms）から 2.27秒たつまでは消えない
    t(1200)
    expect(overlay()!.style.opacity).toBe('1')
    expect(overlay()!.getAttribute('data-launch-end')).toBeNull()
    t(300)
    expect(overlay()!.getAttribute('data-launch-end')).toBe('done')
    t(250)
    expect(overlay()).toBeNull()
  })

  it('押すとすぐ消え、アニメーションも止まる', () => {
    const api = load()
    api.boot()
    t(300)
    window.dispatchEvent(new Event('pointerdown'))
    const el = overlay()!
    expect(el.style.opacity).toBe('0')
    expect(el.getAttribute('data-launch-end')).toBe('skip')
    const before = draws
    t(200)
    expect(draws).toBe(before)
    t(50)
    expect(overlay()).toBeNull()
  })

  it('キーを押してもすぐ消える（下のアプリはすぐ押せる）', () => {
    load().boot()
    t(100)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
    expect(overlay()!.getAttribute('data-launch-end')).toBe('skip')
    expect(overlay()!.style.pointerEvents).toBe('none')
  })

  describe('重なりを押した時（指のタップ・長押し）', () => {
    const press = (target: EventTarget, type: string) => {
      const e =
        type === 'click'
          ? new MouseEvent(type, { bubbles: true, cancelable: true })
          : new Event(type, { bubbles: true, cancelable: true })
      target.dispatchEvent(e)
      return e
    }
    let appGot: string[]
    const app = (e: Event) => appGot.push(e.type)
    const PRESS = ['pointerup', 'pointercancel', 'touchend', 'mousedown', 'mouseup', 'click', 'contextmenu']
    beforeEach(() => {
      appGot = []
      for (const type of PRESS) document.addEventListener(type, app)
    })
    afterEach(() => {
      for (const type of PRESS) document.removeEventListener(type, app)
    })

    it('離すまでは押せるまま残し、押す操作の続き（離す・クリック）を止める。離して0.1秒で取り除く', () => {
      load().boot()
      t(300)
      const el = overlay()!
      press(el, 'pointerdown')
      expect(el.getAttribute('data-launch-end')).toBe('skip')
      expect(el.style.opacity).toBe('0')
      // 指を離した後のクリックは、その時に指の下にある所へ送られる。重なりが押せないと、下のアプリが押されてしまう
      expect(el.style.pointerEvents).not.toBe('none')
      t(400)
      expect(overlay()).toBe(el)
      expect(press(el, 'pointerup').defaultPrevented).toBe(true)
      // 指を離したのを止めると、そのタップのクリックは作られない
      expect(press(el, 'touchend').defaultPrevented).toBe(true)
      expect(press(el, 'mouseup').defaultPrevented).toBe(true)
      expect(press(el.querySelector('canvas') ?? el, 'click').defaultPrevented).toBe(true)
      expect(appGot).toEqual([])
      t(99)
      expect(overlay()).toBe(el)
      t(1)
      expect(overlay()).toBeNull()
      // 取り除いた後は、アプリへの操作を止めない
      const click = press(document.body, 'click')
      expect(click.defaultPrevented).toBe(false)
      expect(appGot).toEqual(['click'])
    })

    it('すぐ離した時は、離して0.1秒で押せなくなり、消え始めて0.25秒で取り除く', () => {
      load().boot()
      t(300)
      const el = overlay()!
      press(el, 'pointerdown')
      press(el, 'pointerup')
      press(el, 'click')
      t(99)
      expect(el.style.pointerEvents).not.toBe('none')
      t(1)
      expect(el.style.pointerEvents).toBe('none')
      expect(overlay()).toBe(el)
      t(150)
      expect(overlay()).toBeNull()
      expect(appGot).toEqual([])
    })

    it('押したまま（長押し）でも、消え始めて3秒で取り除く。長押しのメニューも止める', () => {
      load().boot()
      t(300)
      const el = overlay()!
      press(el, 'pointerdown')
      t(1000)
      expect(press(el, 'contextmenu').defaultPrevented).toBe(true)
      t(1999)
      expect(overlay()).toBe(el)
      expect(el.style.pointerEvents).not.toBe('none')
      t(1)
      expect(overlay()).toBeNull()
      expect(appGot).toEqual([])
    })

    it('重なりの外（消え始めた後の下のアプリ）への操作は止めない', () => {
      load().boot()
      t(300)
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
      expect(press(document.body, 'click').defaultPrevented).toBe(false)
      expect(press(document.body, 'pointerup').defaultPrevented).toBe(false)
      expect(appGot).toEqual(['click', 'pointerup'])
      t(250)
      expect(overlay()).toBeNull()
    })
  })

  it('アプリが知らせてこなくても、5秒で消える', () => {
    load().boot()
    t(4999)
    expect(overlay()!.style.opacity).toBe('1')
    t(1)
    expect(overlay()!.getAttribute('data-launch-end')).toBe('cap')
    t(250)
    expect(overlay()).toBeNull()
  })

  it('同じウインドウで読み込み直すと出さない。新しいウインドウ・タブ（sessionStorage が空）では出す', () => {
    load().boot()
    expect(overlay()).not.toBeNull()
    overlay()!.remove()
    load().boot()
    expect(overlay()).toBeNull()
    sessionStorage.clear()
    load().boot()
    expect(overlay()).not.toBeNull()
  })

  describe('見えていないタブ（裏で開いたタブ・ブラウザの先読み）で開いた時', () => {
    const hide = () => Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    const show = () => delete (document as { visibilityState?: string }).visibilityState
    const flag = () => sessionStorage.getItem('diary-studio:launched')
    afterEach(show)

    it('出さず、そのタブが見えた時に出したことにする（後の再読み込み・「新しい版にする」でも出さない）', () => {
      hide()
      load().boot()
      expect(overlay()).toBeNull()
      expect(flag()).toBeNull()
      // まだ見えていない間は印を付けない
      document.dispatchEvent(new Event('visibilitychange'))
      expect(flag()).toBeNull()
      show()
      document.dispatchEvent(new Event('visibilitychange'))
      expect(flag()).toBe('1')
      load().boot()
      expect(overlay()).toBeNull()
    })

    it('先読みしたページを開いた時（prerenderingchange）も、出したことにする', () => {
      hide()
      load().boot()
      show()
      document.dispatchEvent(new Event('prerenderingchange'))
      expect(flag()).toBe('1')
    })

    it('見えないうちに読み込み直したら、新しいページが見えた時に印を付ける（前のページを開いた時の分は残らない）', () => {
      hide()
      load().boot()
      load().boot()
      show()
      document.dispatchEvent(new Event('visibilitychange'))
      expect(flag()).toBe('1')
      load().boot()
      expect(overlay()).toBeNull()
    })

    it('設定でオフ・テスト（強制していない）で出さない時は、見えても印を付けない（オンに戻した後・強制した時に出る）', () => {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ launchAnimation: false }))
      hide()
      load().boot()
      show()
      document.dispatchEvent(new Event('visibilitychange'))
      expect(flag()).toBeNull()

      localStorage.clear()
      setWebdriver(true)
      hide()
      load().boot()
      show()
      document.dispatchEvent(new Event('visibilitychange'))
      expect(flag()).toBeNull()
      localStorage.setItem('diary-studio:launch', 'force')
      load().boot()
      expect(overlay()).not.toBeNull()
    })
  })

  it('設定でオフにすると出さない', () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ appearance: 'white', launchAnimation: false }))
    load().boot()
    expect(overlay()).toBeNull()
    expect(sessionStorage.getItem('diary-studio:launched')).toBeNull()
  })

  it('テスト（navigator.webdriver）では出さない。localStorage の diary-studio:launch = force か URL の launch=1 で出す', () => {
    setWebdriver(true)
    load().boot()
    expect(overlay()).toBeNull()

    localStorage.setItem('diary-studio:launch', 'force')
    load().boot()
    expect(overlay()).not.toBeNull()
    overlay()!.remove()

    localStorage.clear()
    sessionStorage.clear()
    window.history.replaceState(null, '', '/?launch=1#/settings')
    load().boot()
    expect(overlay()).not.toBeNull()
  })

  it('視差効果を減らす設定: 動かさずに最後の絵（ロゴ）を出し、描いてから0.5秒たってアプリの知らせもあれば消える', () => {
    media({ reduced: true })
    localStorage.setItem(PREFS_KEY, JSON.stringify({ appearance: 'white' }))
    const api = load()
    api.boot()
    const el = overlay()!
    expect(el.getAttribute('data-launch-mode')).toBe('still')
    expect(el.getAttribute('data-launch-theme')).toBe('light')
    t(16)
    const before = draws
    expect(before).toBeGreaterThan(0)
    api.appReady()
    // ロゴを描いた（16）時から0.5秒（開いてから 516）
    t(499)
    expect(el.style.opacity).toBe('1')
    expect(el.getAttribute('data-launch-end')).toBeNull()
    // 動かさない（描き直さない）
    expect(draws).toBe(before)
    t(1)
    expect(el.getAttribute('data-launch-end')).toBe('done')
  })

  it('canvas を使えない時は何も出さずに続ける（外観は決める）', () => {
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null)
    localStorage.setItem(PREFS_KEY, JSON.stringify({ appearance: 'dark' }))
    const api = load()
    expect(api.boot()).toBe('dark')
    expect(overlay()).toBeNull()
    expect(api.active()).toBe(false)
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(sessionStorage.getItem('diary-studio:launched')).toBeNull()
    // アプリの知らせは何もしない
    api.appReady()
  })

  it('描く途中で失敗したら、その場で消える（アプリの起動の邪魔をしない）', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const api = load()
    api.boot()
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null)
    t(16)
    expect(warn).toHaveBeenCalled()
    expect(overlay()!.getAttribute('data-launch-end')).toBe('skip')
    t(250)
    expect(overlay()).toBeNull()
  })

  it('出していない時のアプリの知らせは何もしない', () => {
    setWebdriver(true)
    const api = load()
    api.boot()
    expect(() => api.appReady()).not.toThrow()
    expect(api.active()).toBe(false)
  })
})

describe('Worker（別のスレッド）で描く', () => {
  interface Posted {
    type: string
    canvas?: unknown
    size?: { width: number; height: number; dpr: number; safe: Record<string, number> }
    theme?: string
    still?: boolean
  }
  class FakeWorker {
    static last: FakeWorker | null = null
    posted: Posted[] = []
    transfers: unknown[][] = []
    terminated = false
    onmessage: ((e: { data: unknown }) => void) | null = null
    onerror: (() => void) | null = null
    constructor(public url: string) {
      FakeWorker.last = this
    }
    postMessage(data: Posted, transfer?: unknown[]) {
      this.posted.push(data)
      this.transfers.push(transfer ?? [])
    }
    terminate() {
      this.terminated = true
    }
  }
  const offscreen = { offscreen: true }

  beforeEach(() => {
    FakeWorker.last = null
    vi.stubGlobal('Worker', FakeWorker)
    vi.stubGlobal('OffscreenCanvas', function OffscreenCanvas() {})
    Object.defineProperty(HTMLCanvasElement.prototype, 'transferControlToOffscreen', {
      value: () => offscreen,
      configurable: true,
    })
    URL.createObjectURL = vi.fn(() => 'blob:launch')
    URL.revokeObjectURL = vi.fn()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    delete (HTMLCanvasElement.prototype as { transferControlToOffscreen?: unknown }).transferControlToOffscreen
  })

  it('canvas を Worker に渡して描かせ、ページの中では描かない', () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ appearance: 'deep-dark' }))
    load().boot()
    t(0)
    const el = overlay()!
    expect(el.getAttribute('data-launch-renderer')).toBe('worker')
    const worker = FakeWorker.last!
    expect(worker.url).toBe('blob:launch')
    expect(worker.posted[0]).toMatchObject({ type: 'start', canvas: offscreen, theme: 'deep', still: false })
    expect(worker.posted[0].size).toMatchObject({ dpr: 1, safe: { top: 0, right: 0, bottom: 0, left: 0 } })
    expect(worker.transfers[0]).toEqual([offscreen])
    t(100)
    expect(draws).toBe(0)
  })

  it('Worker が描き終わり、アプリが知らせたら消える。取り除く時に Worker を止める', () => {
    const api = load()
    api.boot()
    t(0)
    const worker = FakeWorker.last!
    api.appReady()
    t(1000)
    expect(overlay()!.style.opacity).toBe('1')
    worker.onmessage!({ data: { type: 'end' } })
    expect(overlay()!.getAttribute('data-launch-end')).toBe('done')
    t(250)
    expect(overlay()).toBeNull()
    expect(worker.terminated).toBe(true)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:launch')
  })

  it('視差効果を減らす設定: Worker がロゴを描いた（started）時から0.5秒出す（Worker の立ち上がりは数えない）', () => {
    media({ reduced: true })
    const api = load()
    api.boot()
    t(0)
    const worker = FakeWorker.last!
    expect(worker.posted[0]).toMatchObject({ type: 'start', still: true })
    api.appReady()
    // Worker の立ち上がりが遅い（遅い端末）
    t(700)
    expect(overlay()!.style.opacity).toBe('1')
    worker.onmessage!({ data: { type: 'started' } })
    t(499)
    expect(overlay()!.style.opacity).toBe('1')
    expect(overlay()!.getAttribute('data-launch-end')).toBeNull()
    t(1)
    expect(overlay()!.getAttribute('data-launch-end')).toBe('done')
  })

  it('押すと Worker の絵を止めて消える', () => {
    load().boot()
    t(0)
    const worker = FakeWorker.last!
    window.dispatchEvent(new Event('pointerdown'))
    expect(worker.posted.map((m) => m.type)).toEqual(['start', 'stop'])
    t(250)
    expect(worker.terminated).toBe(true)
  })

  it('描く準備の前に押されたら、Worker を作らずに消える', () => {
    load().boot()
    window.dispatchEvent(new Event('pointerdown'))
    t(0)
    expect(FakeWorker.last).toBeNull()
    t(250)
    expect(overlay()).toBeNull()
  })

  it('Worker で描けなかったら、ページの中で描き直す', () => {
    load().boot()
    t(0)
    const worker = FakeWorker.last!
    worker.onerror!()
    expect(worker.terminated).toBe(true)
    const el = overlay()!
    expect(el.getAttribute('data-launch-renderer')).toBe('page')
    t(16)
    expect(el.querySelectorAll('canvas')).toHaveLength(1)
    expect(draws).toBeGreaterThan(0)
  })

  it('Worker のスクリプトはそれだけで動き、最後まで描いたら知らせる', () => {
    const api = load()
    let queue: ((ts: number) => void)[] = []
    const posted: string[] = []
    const scope = {
      OffscreenCanvas: function (this: { width: number; height: number }, w: number, h: number) {
        this.width = w
        this.height = h
        Object.assign(this, { getContext: fakeContext })
      },
      requestAnimationFrame: (cb: (ts: number) => void) => queue.push(cb),
      cancelAnimationFrame: () => {},
      postMessage: (m: { type: string }) => posted.push(m.type),
      onmessage: null as null | ((e: { data: unknown }) => void),
    }
    // ページの window・document を使わない
    new Function('self', 'window', 'document', api.workerSource())(scope, undefined, undefined)
    const target = { width: 0, height: 0, getContext: fakeContext }
    scope.onmessage!({
      data: { type: 'start', canvas: target, size: { width: 360, height: 760, dpr: 2, safe: {} }, theme: 'dark' },
    })
    expect(posted).toEqual(['started'])
    expect(target.width).toBe(720)
    expect(draws).toBeGreaterThan(0)
    for (let now = 16; now <= 2400; now += 16) {
      if (now === 2240) expect(posted).toEqual(['started'])
      const q = queue
      queue = []
      q.forEach((cb) => cb(now))
    }
    expect(posted).toEqual(['started', 'end'])
  })
})
