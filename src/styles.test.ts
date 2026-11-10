// 色のトークン（src/styles.css）が仕様書の表のとおりか、字の色が地の上で読めるか、部品が色を直接書いていないか、
// 幅の区分の値がスクリプトとそろっているかを確かめる（docs/SPEC.md の 4.3・4.5・4.6・4.11）
import { describe, expect, it } from 'vitest'
import { WIDTH_L, WIDTH_M } from './ui/hooks'

// テストでは CSS を import すると（?raw でも）中身が空になるので、ファイルを読む。node:fs の型はアプリの tsconfig に無いので、
// 名前を変数にして読み込み、使う関数の形だけを書く
const NODE_FS = 'node:fs'
const { readFileSync, readdirSync } = (await import(/* @vite-ignore */ NODE_FS)) as {
  readFileSync: (path: string, encoding: 'utf8') => string
  readdirSync: (path: string, options: { recursive: true }) => string[]
}
// jsdom の URL は node:fs が受け取らないので、ファイルの場所の文字列にして渡す
const read = (relative: string) => readFileSync(decodeURIComponent(new URL(relative, import.meta.url).pathname), 'utf8')
const css = read('./styles.css')
const menuCss = read('./ui/menu.css')
/** src/ の下のすべての CSS（画面ごとの CSS も。[src/ からの場所, 中身]）。段階2以降で画面の CSS が増えても確かめから漏れないように */
// （new URL('.', import.meta.url) は Vite が開発サーバーの URL に書き換えるので、import.meta.url のファイルの場所から作る）
const SRC_DIR = decodeURIComponent(new URL(import.meta.url).pathname).replace(/[^/]*$/, '')
const ALL_CSS: readonly (readonly [string, string])[] = readdirSync(SRC_DIR, { recursive: true })
  .filter((f) => f.endsWith('.css'))
  .sort()
  .map((f) => [f, readFileSync(`${SRC_DIR}${f}`, 'utf8')] as const)

/** docs/SPEC.md の 4.5 の表（トークン: [ホワイト, ダーク, ディープダーク]） */
const SPEC_TOKENS: Record<string, readonly [string, string, string]> = {
  '--bg': ['#f6f6f4', '#101113', '#08090a'],
  '--surface': ['#ffffff', '#17181b', '#0e0f11'],
  '--surface-2': ['#fafaf9', '#1c1d21', '#121315'],
  '--surface-3': ['#efefec', '#25272c', '#191a1d'],
  '--stripe': ['#f2f2ef', '#1f2125', '#131417'],
  '--rule': ['#dcdcd7', '#2a2c31', '#1e1f23'],
  '--rule-strong': ['#7a7e86', '#5f636b', '#3e4045'],
  '--border': ['#e0e0dc', '#2e3036', '#202125'],
  '--border-strong': ['#c8c8c2', '#43464e', '#2d2f33'],
  '--text': ['#25282e', '#e6e5e1', '#aeaca6'],
  '--text-muted': ['#5c6068', '#a8aab0', '#8a8984'],
  '--text-faint': ['#62666e', '#90939a', '#858480'],
  '--numeral': ['#858991', '#6b6e76', '#66676b'],
  '--accent': ['#4a6c92', '#9fb9d6', '#8a96a8'],
  '--accent-strong': ['#3b5a7e', '#c3d4e8', '#a3adbc'],
  '--accent-soft': ['#e5ecf4', '#1f2a37', '#15181d'],
  '--on-accent': ['#ffffff', '#10161e', '#0b0c0e'],
  '--primary': ['#56789e', '#3d5675', '#1b1e24'],
  '--primary-hover': ['#4a6c92', '#47628a', '#22262d'],
  '--primary-border': ['var(--primary)', 'var(--primary)', '#2e333c'],
  '--on-primary': ['#ffffff', '#eef3f9', '#b1bac7'],
  '--today-bg': ['var(--primary)', 'var(--primary)', '#2c313a'],
  '--today-ring': ['#4a6c92', '#9fb9d6', '#8a96a8'],
  '--switch-on': ['var(--accent)', '#4d6a8f', '#4a5262'],
  '--cover': ['#a3bbd3', '#2b3a4c', '#15181d'],
  '--on-cover': ['#15202c', '#e6edf5', '#aeb4bd'],
  '--sat': ['#3f69a3', '#8a9bb5', '#808b9b'],
  '--sun': ['#ac4257', '#c79199', '#a08589'],
  '--off-fill': ['#ebebee', '#272a30', '#1c1e22'],
  '--off-text': ['#5c6068', '#a8aab0', '#8a8984'],
  '--work-soft': ['#e4edf8', '#1d2938', '#141518'],
  '--work-area': ['#f1f5fb', '#1a212b', 'var(--surface)'],
  '--work-sheet': ['#ecf2fa', '#1c2532', 'var(--surface)'],
  '--work-marker': ['#d3e3f7', '#2a3d55', 'transparent'],
  '--work-text': ['#2d5288', '#9fc1ec', '#aeaca6'],
  '--work-line': ['#7a92b3', '#7a9cc9', '#6d727b'],
  '--private-soft': ['#fae5ed', '#33202a', '#141518'],
  '--private-area': ['#fcf1f5', '#261c22', 'var(--surface)'],
  '--private-sheet': ['#fbedf3', '#2c1f26', 'var(--surface)'],
  '--private-marker': ['#f6d3e1', '#4a2a3a', 'transparent'],
  '--private-text': ['#a23d5e', '#f1a8c3', '#aeaca6'],
  '--private-line': ['#b97f93', '#c48aa1', '#6d727b'],
  '--on-label': ['#17181b', '#17181b', '#e6e5e1'],
  '--done-bg': ['#ededeb', '#222326', '#0b0c0d'],
  '--done-text': ['#80848b', '#73767d', '#666561'],
  '--overdue': ['#b5525f', '#e2919d', '#9b8589'],
  '--danger': ['#b0402d', '#f08a77', '#b98a82'],
  '--danger-soft': ['#f8e6e2', '#331d19', '#1c1412'],
  '--toast-bg': ['#2b2f38', '#2a2c31', '#141518'],
  '--toast-text': ['#ffffff', '#e6e4de', '#aeaca6'],
  '--backdrop': ['rgb(15 17 22 / 45%)', 'rgb(0 0 0 / 62%)', 'rgb(0 0 0 / 70%)'],
  '--selection': ['#cfdcec', '#2f4560', '#262c36'],
  '--shadow-lift': ['0 6px 20px rgb(30 30 40 / 18%)', '0 6px 20px rgb(0 0 0 / 55%)', '0 6px 20px rgb(0 0 0 / 70%)'],
  '--brand-filter': ['none', 'brightness(0.95)', 'grayscale(0.85) brightness(0.6)'],
  '--qr-bg': ['#ffffff', '#ffffff', '#ffffff'],
  '--qr-fg': ['#000000', '#000000', '#000000'],
}

/** docs/SPEC.md の 4.6 の表（キー: [ホワイト, ダーク, ディープダーク]。並びは番号の順） */
const SPEC_LABELS: readonly (readonly [string, string, string, string])[] = [
  ['rose-l', '#e499a4', '#febdc6', '#816f71'],
  ['coral-l', '#e39e86', '#fdc1ac', '#81706b'],
  ['apricot-l', '#d7a672', '#f2c89c', '#7d7267'],
  ['lemon-l', '#c0b26e', '#ded299', '#787566'],
  ['lime-l', '#a0bc7e', '#c3dba6', '#717769'],
  ['mint-l', '#7cc39d', '#a6e1c0', '#6a7970'],
  ['teal-l', '#65c3c0', '#96e1de', '#667978'],
  ['sky-l', '#6dbddc', '#9bdcf6', '#67777e'],
  ['blue-l', '#8db3ea', '#b5d3ff', '#6d7582'],
  ['wisteria-l', '#aea8e8', '#cecaff', '#737381'],
  ['violet-l', '#c99fd6', '#e6c2f1', '#7a717d'],
  ['peony-l', '#dd9ab9', '#f8bdd8', '#7f6f76'],
  ['rose-d', '#c26576', '#ea909e', '#5e4e50'],
  ['coral-d', '#c26b4c', '#e99578', '#5e4f49'],
  ['apricot-d', '#b57727', '#dca05d', '#5b5046'],
  ['lemon-d', '#9a861b', '#c0af58', '#565345'],
  ['lime-d', '#71943f', '#9abb6e', '#4f5548'],
  ['mint-d', '#339c6d', '#6ac396', '#48564e'],
  ['teal-d', '#039a97', '#44c4c0', '#455756'],
  ['sky-d', '#0994ba', '#54bce2', '#46555c'],
  ['blue-d', '#5787ce', '#82b0f3', '#4b535f'],
  ['wisteria-d', '#8379ca', '#aaa3f0', '#52515e'],
  ['violet-d', '#a46eb5', '#cb98db', '#584f5b'],
  ['peony-d', '#bb6690', '#e391b8', '#5c4e54'],
]

const THEMES = ['white', 'dark', 'deep-dark'] as const
type Theme = (typeof THEMES)[number]
const SELECTORS: Record<Theme, string> = {
  white: ':root',
  dark: ":root[data-theme='dark']",
  'deep-dark': ":root[data-theme='deep-dark']",
}

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '')

/** いちばん外側の規則（@media の中は含めない）を、セレクタと中身の組にする */
function topLevelRules(source: string): { selector: string; body: string }[] {
  const src = stripComments(source)
  const rules: { selector: string; body: string }[] = []
  let depth = 0
  let selStart = 0
  let bodyStart = 0
  let selector = ''
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (ch === '{') {
      if (depth === 0) {
        selector = src.slice(selStart, i).trim()
        bodyStart = i + 1
      }
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0) {
        rules.push({ selector, body: src.slice(bodyStart, i) })
        selStart = i + 1
      }
    }
  }
  return rules
}

function declarations(body: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const part of body.split(';')) {
    const m = /^\s*(--[\w-]+)\s*:\s*([\s\S]+?)\s*$/.exec(part)
    if (m) map.set(m[1], m[2].replace(/\s+/g, ' '))
  }
  return map
}

const rules = topLevelRules(css)

/** 外観ごとに、その外観で効く変数の値（ホワイトの :root に、ダーク・ディープダークの規則を重ねた物） */
function themeVars(theme: Theme): Map<string, string> {
  const base = new Map<string, string>()
  for (const r of rules.filter((r) => r.selector === ':root')) for (const [k, v] of declarations(r.body)) base.set(k, v)
  if (theme === 'white') return base
  const own = rules.filter((r) => r.selector === SELECTORS[theme])
  expect(own, `${theme} の規則`).toHaveLength(1)
  for (const [k, v] of declarations(own[0].body)) base.set(k, v)
  return base
}

/** その外観の、その規則だけに書いた値（ホワイトは :root、ほかは :root[data-theme=…]） */
function ownVars(theme: Theme): Map<string, string> {
  const map = new Map<string, string>()
  for (const r of rules.filter((r) => r.selector === SELECTORS[theme])) for (const [k, v] of declarations(r.body)) map.set(k, v)
  return map
}

const VARS = Object.fromEntries(THEMES.map((t) => [t, themeVars(t)])) as Record<Theme, Map<string, string>>

/** var(--x) をたどって 16 進の色にする */
function color(theme: Theme, name: string): string {
  let v = VARS[theme].get(name)
  for (let i = 0; i < 10 && v; i++) {
    const m = /^var\((--[\w-]+)\)$/.exec(v)
    if (!m) break
    v = VARS[theme].get(m[1])
  }
  expect(v, `${theme} の ${name}`).toMatch(/^#[0-9a-f]{6}$/)
  return v as string
}

const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map(linear)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
/** WCAG のコントラスト比 */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
function oklab(hex: string): [number, number, number] {
  const [r, g, b] = channels(hex).map(linear)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}
/** OKLab の色の差 */
function deltaE(a: string, b: string): number {
  const p = oklab(a)
  const q = oklab(b)
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])
}

describe('色のトークン（docs/SPEC.md の 4.5）', () => {
  it.each(THEMES.map((t, i) => [t, i] as const))('%s: 表のトークンを、その外観の規則に表の値どおりに書いている', (theme, i) => {
    const own = ownVars(theme)
    for (const [name, values] of Object.entries(SPEC_TOKENS)) {
      expect(own.get(name), `${theme} の ${name}`).toBe(values[i])
    }
  })

  it.each(THEMES.map((t, i) => [t, i] as const))(
    '%s: ラベルの24色を --label-キー に表の値どおりに書いている（4.6）',
    (theme, i) => {
      const own = ownVars(theme)
      expect(SPEC_LABELS).toHaveLength(24)
      for (const [key, ...values] of SPEC_LABELS) {
        expect(own.get(`--label-${key}`), `${theme} の --label-${key}`).toBe(values[i])
      }
    },
  )

  it('ラベルのキーごとに data-label の印から --label を引ける', () => {
    const byLabel = new Map(rules.map((r) => [r.selector, declarations(r.body)]))
    for (const [key] of SPEC_LABELS) {
      expect(byLabel.get(`[data-label='${key}']`)?.get('--label')).toBe(`var(--label-${key})`)
    }
  })

  it('区分の印（data-kind）から、区分の地・ハイライト・数字・線の色を引ける', () => {
    const byKind = new Map(rules.map((r) => [r.selector, declarations(r.body)]))
    for (const kind of ['work', 'private']) {
      const d = byKind.get(`[data-kind='${kind}']`)
      for (const part of ['soft', 'area', 'sheet', 'marker', 'text', 'line']) {
        expect(d?.get(`--kind-${part}`), `${kind} の --kind-${part}`).toBe(`var(--${kind}-${part})`)
      }
    }
  })

  it('NS の緑の --active* は、くすんだ青に置き換えている', () => {
    for (const theme of THEMES) {
      expect(VARS[theme].get('--active')).toBe('var(--accent)')
      expect(VARS[theme].get('--active-soft')).toBe('var(--accent-soft)')
      expect(VARS[theme].get('--active-fill')).toBe('var(--primary)')
      expect(VARS[theme].get('--on-active')).toBe('var(--on-primary)')
    }
  })

  it('NS から持ってくる変数（4.5 の表に無い物）が3つの外観にある', () => {
    for (const theme of THEMES) {
      const own = ownVars(theme)
      for (const name of [
        '--segmented-on',
        '--switch-knob',
        '--warn',
        '--warn-soft',
        '--toast-border',
        '--toast-error-bg',
        '--toast-error-text',
        '--shadow',
        '--shadow-sm',
        '--shadow-lg',
      ]) {
        expect(own.has(name), `${theme} の ${name}`).toBe(true)
      }
    }
  })

  it('件名のハイライトは 4.5 の名前（--work-marker・--private-marker）だけで、仮の別名（--*-highlight）を持たない', () => {
    expect(stripComments(css)).not.toMatch(/--(work|private)-highlight/)
    for (const theme of THEMES) {
      expect(VARS[theme].has('--work-marker'), theme).toBe(true)
      expect(VARS[theme].has('--private-marker'), theme).toBe(true)
    }
  })

  it('小説の機能の色・原稿の書体・アプリのキーボードの変数を持ち込んでいない', () => {
    for (const source of [css, menuCss]) {
      expect(stripComments(source)).not.toMatch(/--area-|--memo|--special|--diff-|--editor-font|--kb-native/)
    }
  })

  it('等幅の英数字は Roboto Mono（日本語はゴシック）', () => {
    expect(VARS.white.get('--font-mono')).toBe("'Roboto Mono', var(--font-ui)")
  })
})

describe('字の色が地の上で読める（docs/SPEC.md の 4.5 の WCAG の比）', () => {
  const TEXTS = [
    '--text',
    '--text-muted',
    '--text-faint',
    '--sat',
    '--sun',
    '--accent',
    '--work-text',
    '--private-text',
    '--off-text',
  ]
  const GROUNDS = [
    '--bg',
    '--surface',
    '--surface-2',
    '--surface-3',
    '--off-fill',
    '--work-soft',
    '--private-soft',
    '--work-area',
    '--private-area',
    '--work-sheet',
    '--private-sheet',
    '--accent-soft',
  ]

  it.each(THEMES)('%s: 字の色は、どの地の上でも 4.5:1 以上', (theme) => {
    for (const text of TEXTS) {
      for (const ground of GROUNDS) {
        // 例外: ディープダークの休みの地の上では --text-faint を使わず --text-muted で出す（4.5）
        if (theme === 'deep-dark' && text === '--text-faint' && ground === '--off-fill') continue
        const ratio = contrast(color(theme, text), color(theme, ground))
        expect(ratio, `${theme}: ${text} / ${ground}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it.each(['white', 'dark'] as const)('%s: 件名のハイライトの上の --text・--text-muted は 4.5:1 以上', (theme) => {
    for (const marker of ['--work-marker', '--private-marker']) {
      for (const text of ['--text', '--text-muted']) {
        expect(contrast(color(theme, text), color(theme, marker)), `${theme}: ${text} / ${marker}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('ディープダークは区分の色分けを無くす（領域・詳細の地は --surface、ハイライトは無し）', () => {
    const own = ownVars('deep-dark')
    for (const name of ['--work-area', '--private-area', '--work-sheet', '--private-sheet'])
      expect(own.get(name)).toBe('var(--surface)')
    expect(own.get('--work-marker')).toBe('transparent')
    expect(own.get('--private-marker')).toBe('transparent')
    expect(own.get('--work-soft')).toBe(own.get('--private-soft'))
  })

  it.each(THEMES)('%s: 主なボタン・今日の印・表紙・お知らせ・注意の字も 4.5:1 以上', (theme) => {
    const pairs: [string, string][] = [
      ['--on-primary', '--primary'],
      ['--on-primary', '--primary-hover'],
      ['--on-primary', '--today-bg'],
      ['--on-accent', '--accent'],
      ['--accent-strong', '--accent-soft'],
      ['--on-cover', '--cover'],
      ['--toast-text', '--toast-bg'],
      ['--overdue', '--surface'],
      ['--danger', '--surface'],
      ['--danger', '--danger-soft'],
    ]
    for (const [fg, bg] of pairs) {
      expect(contrast(color(theme, fg), color(theme, bg)), `${theme}: ${fg} / ${bg}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it.each(THEMES)('%s: 大きく淡い数字と済んだ物の字は 3:1 以上', (theme) => {
    for (const ground of ['--bg', '--surface']) {
      expect(contrast(color(theme, '--numeral'), color(theme, ground)), `${theme}: --numeral / ${ground}`).toBeGreaterThanOrEqual(
        3,
      )
    }
    for (const ground of ['--surface', '--done-bg', '--work-area', '--private-area', '--work-sheet', '--private-sheet']) {
      expect(
        contrast(color(theme, '--done-text'), color(theme, ground)),
        `${theme}: --done-text / ${ground}`,
      ).toBeGreaterThanOrEqual(3)
    }
  })
})

describe('区分の色とラベルの色の見分け（docs/SPEC.md の 4.3・4.5）', () => {
  // ディープダークの線・●（--work-line・--private-line）はラベルのグレーと近い（4.6 の値のまま。段階2の見本で決める）ので、
  // 確かめるのはホワイトとダークだけ
  it.each(['white', 'dark'] as const)('%s: ラベルが無い時の線・●の色は、24色のどれとも OKLab で 0.06 以上離れている', (theme) => {
    for (const line of ['--work-line', '--private-line']) {
      for (const [key] of SPEC_LABELS) {
        const d = deltaE(color(theme, line), color(theme, `--label-${key}`))
        expect(d, `${theme}: ${line} / ${key}`).toBeGreaterThanOrEqual(0.06)
      }
    }
  })

  it.each(THEMES)('%s: カードの地は、ラベルの色と明るさが 0.1 以上違う', (theme) => {
    for (const soft of ['--work-soft', '--private-soft']) {
      for (const [key] of SPEC_LABELS) {
        const dl = Math.abs(oklab(color(theme, soft))[0] - oklab(color(theme, `--label-${key}`))[0])
        expect(dl, `${theme}: ${soft} / ${key}`).toBeGreaterThanOrEqual(0.1)
      }
    }
  })

  it('ダーク: 土日の色は区分の数字の色と OKLab で 0.10 ほど離れている（取り違えないように）', () => {
    expect(deltaE(color('dark', '--sat'), color('dark', '--work-text'))).toBeGreaterThanOrEqual(0.1)
    expect(deltaE(color('dark', '--sun'), color('dark', '--private-text'))).toBeGreaterThanOrEqual(0.1)
  })
})

describe('部品の書き方', () => {
  /** 色のトークンの規則（3つの外観）を除いた残り */
  function componentCss(source: string): string {
    const tokenSelectors = new Set(Object.values(SELECTORS))
    let out = stripComments(source)
    for (const r of topLevelRules(source)) if (tokenSelectors.has(r.selector)) out = out.replace(r.body, '')
    return out
  }

  it('src/ の下の CSS をすべて確かめる（共通・メニュー・画面ごとの CSS）', () => {
    const names = ALL_CSS.map(([name]) => name)
    for (const name of [
      'styles.css',
      'ui/menu.css',
      'ui/layout.css',
      'ui/sync.css',
      'features/top/top.css',
      'features/login/login.css',
    ])
      expect(names).toContain(name)
  })

  it.each(ALL_CSS)('%s: 部品は色を直接書かず、変数だけを使う', (_name, source) => {
    const rest = componentCss(source)
    expect(rest).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(rest).not.toMatch(/\b(?:rgba?|hsla?|oklch|oklab)\(/)
    expect(rest).not.toMatch(/:\s*[^;{}]*\b(?:white|black)\b/)
  })

  it('幅の区分の値は src/ui/hooks.ts の WIDTH_M・WIDTH_L とそろっている（docs/SPEC.md の 4.11）', () => {
    const widths = new Set([...css.matchAll(/\((?:max|min)-width:\s*(\d+)px\)/g)].map((m) => Number(m[1])))
    expect([...widths].sort((a, b) => a - b)).toEqual([WIDTH_M - 1, WIDTH_M, WIDTH_L - 1, WIDTH_L])
    expect(css).toContain(`@media (max-width: ${WIDTH_M - 1}px)`)
    expect(css).toContain(`@media (max-width: ${WIDTH_L - 1}px)`)
    expect(css).toContain(`@media (max-width: ${WIDTH_L - 1}px), (pointer: coarse)`)
  })

  // ヘッダーの名前を出さない 380px 未満（docs/SPEC.md の 3.3）だけは、幅の区分とは別の値
  const HEADER_NAME_MAX = 379
  it.each(ALL_CSS)('%s: 幅の値は幅の区分（WIDTH_M・WIDTH_L）か、ヘッダーの名前を隠す 380px 未満だけ', (_name, source) => {
    const allowed = new Set([WIDTH_M - 1, WIDTH_M, WIDTH_L - 1, WIDTH_L, HEADER_NAME_MAX])
    const widths = [...stripComments(source).matchAll(/\((?:max|min)-width:\s*(\d+)px\)/g)].map((m) => Number(m[1]))
    for (const w of widths) expect(allowed.has(w), `${w}px`).toBe(true)
  })

  it('視差効果を減らす設定では、CSS の動きを全部止める（docs/SPEC.md の 4.9）', () => {
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\*,\s*\*::before,\s*\*::after \{\s*animation: none !important;\s*transition: none !important;/,
    )
  })
})
