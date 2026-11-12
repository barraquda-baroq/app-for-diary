// 段階2のカレンダーの画面の CSS と TSX の書き方の確かめ（docs/SPEC.md の 4.4・4.5・4.7・2.9）:
// 部品は色を直接書かない（TSX の style・文字の値も。FRAME-166）、等幅の字は 600 より太くしない（FRAME-196・CALENDAR-262）、
// カレンダーには影を付けない（ドラッグ中の --shadow-lift だけ。FRAME-153・CALENDAR-260）、数字は桁をそろえる（FRAME-149・CALENDAR-261）。
// CSS の色・幅の区分・視差効果の決まりは src/styles.test.ts で確かめる
import { describe, expect, it } from 'vitest'

// CSS は import すると（?raw でも）テストでは中身が空になるので、ファイルを読む（src/styles.test.ts と同じ読み方）
const NODE_FS = 'node:fs'
const { readFileSync, readdirSync } = (await import(/* @vite-ignore */ NODE_FS)) as {
  readFileSync: (path: string, encoding: 'utf8') => string
  readdirSync: (path: string, options: { recursive: true }) => string[]
}
const SRC_DIR = decodeURIComponent(new URL(import.meta.url).pathname).replace(/[^/]*$/, '')
/** src/ の下のすべての CSS（[src/ からの場所, 中身]） */
const ALL_CSS: readonly (readonly [string, string])[] = readdirSync(SRC_DIR, { recursive: true })
  .filter((f) => f.endsWith('.css'))
  .sort()
  .map((f) => [f, readFileSync(`${SRC_DIR}${f}`, 'utf8')] as const)
/** カレンダーの画面の CSS（src/features/calendar の下。年・月・週・日・共通の部品・ドラッグ） */
const CALENDAR_CSS = ALL_CSS.filter(([name]) => name.startsWith('features/calendar/'))

/** 画面と部品の TS・TSX（テストを除く。src/features と src/ui） */
const CODE = import.meta.glob(['./features/**/*.{ts,tsx}', './ui/**/*.{ts,tsx}', '!./**/*.test.{ts,tsx}'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '')
/** TS のコメントを除く（文字の中の // は残す。// の前が : の物（https://）はコメントにしない） */
const stripTsComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1')

export interface CssRule {
  selector: string
  body: string
}

/** すべての規則（@media・@supports の中も。@keyframes の中は除く）を、セレクタと中身の組にする */
export function flatRules(source: string): CssRule[] {
  const src = stripComments(source)
  const out: CssRule[] = []
  const stack: { prelude: string; start: number }[] = []
  let last = 0
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (ch === '{') {
      stack.push({ prelude: src.slice(last, i).trim(), start: i + 1 })
      last = i + 1
    } else if (ch === '}') {
      const top = stack.pop()
      const inKeyframes = stack.some((s) => s.prelude.startsWith('@keyframes'))
      if (top && !top.prelude.startsWith('@') && !inKeyframes) out.push({ selector: top.prelude, body: src.slice(top.start, i) })
      last = i + 1
    } else if (ch === ';' && (stack.length === 0 || stack[stack.length - 1].prelude.startsWith('@'))) {
      // いちばん外・@media の中の、規則でない文（@import など）
      last = i + 1
    }
  }
  return out
}

/** 規則の中の宣言（[名前, 値]） */
export function declarationsOf(body: string): [string, string][] {
  return body
    .split(';')
    .map((part) => /^\s*([\w-]+)\s*:\s*([\s\S]+?)\s*$/.exec(part))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => [m[1].toLowerCase(), m[2].replace(/\s+/g, ' ')])
}

/** 括弧の外の区切り（, や空白）で分ける */
function splitTop(value: string, sep: RegExp): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of value) {
    if (ch === '(') depth++
    else if (ch === ')') depth--
    if (depth === 0 && sep.test(ch)) {
      if (cur.trim()) out.push(cur.trim())
      cur = ''
    } else cur += ch
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

const ZERO = /^-?0(?:\.0+)?(?:px|rem|em)?$/
const LENGTH = /^-?(?:\d+|\d*\.\d+)(?:px|rem|em)?$|^var\(--(?:edge-w|band-h|span-w)\)$/

/**
 * box-shadow の値が「影」か（ぼかしのある影・--shadow-lift 以外の影のトークン）。影でなければ null、影なら理由。
 * ぼかしの無い物（ラベルの色の一辺 inset var(--edge-w) 0 0 var(--label)・今日の輪 0 0 0 1.5px …）は線なので影にしない
 */
export function shadowProblem(value: string): string | null {
  const v = value.trim()
  if (v === 'none' || v === 'var(--shadow-lift)') return null
  for (const shadow of splitTop(v, /,/)) {
    const tokens = splitTop(shadow, /\s/).filter((t) => t !== 'inset')
    if (tokens.length === 1) {
      return tokens[0] === 'var(--shadow-lift)' ? null : `影のトークン ${tokens[0]}`
    }
    const tokenVar = tokens.find((t) => /^var\(--shadow/.test(t))
    if (tokenVar && tokenVar !== 'var(--shadow-lift)') return `影のトークン ${tokenVar}`
    const lengths = tokens.filter((t) => LENGTH.test(t))
    if (lengths.length >= 3 && !ZERO.test(lengths[2])) return `ぼかし ${lengths[2]}`
  }
  return null
}

/** 等幅の字の規則か（書体が --font-mono・.mono などのクラス） */
function isMonoRule(r: CssRule): boolean {
  if (/\.(?:mono|mono-time|numeral|caps|head-en)(?![\w-])/.test(r.selector)) return true
  return declarationsOf(r.body).some(
    ([name, value]) => (name === 'font-family' || name === 'font') && value.includes('--font-mono'),
  )
}

/** font-weight の値が 600 を超えるか */
function tooBold(value: string): boolean {
  if (value === 'bold' || value === 'bolder') return true
  const n = Number(value)
  return Number.isFinite(n) && n > 600
}

/** 規則の中の太さの指定（font-weight と、まとめて書く font の中の太さ。[名前, 太さ]） */
export function weightsOf(body: string): [string, string][] {
  return declarationsOf(body).flatMap(([name, value]): [string, string][] => {
    if (name === 'font-weight') return [[name, value]]
    if (name !== 'font') return []
    return splitTop(value, /\s/)
      .filter((t) => /^(?:\d{1,4}|bold|bolder|lighter|normal)$/.test(t))
      .map((t): [string, string] => [name, t])
  })
}

describe('確かめる道具', () => {
  it('@media の中の規則も読み、@keyframes の中は読まない', () => {
    const rules = flatRules(`
      .a { color: var(--text); }
      @media (max-width: 599px) { .b { font-weight: 700; } }
      @keyframes k { 0% { opacity: 0; } }
      /* .c { } */
    `)
    expect(rules.map((r) => r.selector)).toEqual(['.a', '.b'])
    expect(declarationsOf(rules[1].body)).toEqual([['font-weight', '700']])
  })

  it('太さは font-weight と、まとめて書く font の中から読む', () => {
    expect(weightsOf('font-weight: 700; color: var(--text);')).toEqual([['font-weight', '700']])
    expect(weightsOf('font: 700 12px/1 var(--font-mono);')).toEqual([['font', '700']])
    expect(weightsOf('font: 12px var(--font-mono);')).toEqual([])
  })

  it.each([
    ['none', null],
    ['var(--shadow-lift)', null],
    ['inset var(--edge-w) 0 0 var(--label)', null],
    ['inset 0 var(--band-h) 0 var(--label), var(--shadow-lift)', null],
    ['0 0 0 1.5px var(--today-ring)', null],
    ['inset 0 -2px 0 var(--accent)', null],
    ['0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent)', null],
    ['var(--shadow-lg)', '影のトークン var(--shadow-lg)'],
    ['0 2px 8px var(--rule)', 'ぼかし 8px'],
    ['inset 0 var(--band-h) 0 var(--label), var(--shadow-lg)', '影のトークン var(--shadow-lg)'],
  ])('box-shadow: %s → %s', (value, problem) => {
    expect(shadowProblem(value)).toBe(problem)
  })
})

describe('部品は色を直接書かない（FRAME-166・ITEMS-282）', () => {
  it('src/features と src/ui の TS・TSX を読めている', () => {
    expect(Object.keys(CODE)).toContain('./ui/Modal.tsx')
    expect(Object.keys(CODE)).toContain('./features/top/TopPage.tsx')
  })

  it('TS・TSX の文字の値に色（#fff・rgb() など）を書かない（style でも、属性・変数でも。色は CSS 変数だけ）', () => {
    const found: string[] = []
    for (const [file, source] of Object.entries(CODE)) {
      const code = stripTsComments(source)
      for (const m of code.matchAll(/(['"`])((?:(?!\1)[^\\\n]|\\.)*)\1/g)) {
        const text = m[2]
        if (/#[0-9a-fA-F]{3,8}\b/.test(text) || /\b(?:rgba?|hsla?|hwb|oklch|oklab|lab|lch)\(/.test(text)) {
          found.push(`${file}: ${m[0]}`)
        }
      }
    }
    expect(found).toEqual([])
  })

  it('TSX の style に色の名前（white・black など）を書かない', () => {
    const found: string[] = []
    for (const [file, source] of Object.entries(CODE)) {
      for (const m of stripTsComments(source).matchAll(/style=\{\{([^}]*)\}\}/g)) {
        if (/:\s*['"`](?:white|black|red|green|blue|yellow|orange|purple|pink|gray|grey|silver|navy)['"`]/i.test(m[1])) {
          found.push(`${file}: ${m[0]}`)
        }
      }
    }
    expect(found).toEqual([])
  })
})

describe('等幅の字は 600 より太くしない（FRAME-196・CALENDAR-262）', () => {
  it.each(ALL_CSS)('%s: 等幅の規則の font-weight は 600 まで', (_name, source) => {
    const bold = flatRules(source)
      .filter(isMonoRule)
      .flatMap((r) =>
        weightsOf(r.body)
          .filter(([, value]) => tooBold(value))
          .map(([name, value]) => `${r.selector} { ${name}: ${value} }`),
      )
    expect(bold).toEqual([])
  })
})

describe('カレンダーには影を付けない（ドラッグ中の --shadow-lift だけ。FRAME-153・CALENDAR-260）', () => {
  it('カレンダーの画面の CSS の影（box-shadow・text-shadow・drop-shadow）', () => {
    const found: string[] = []
    for (const [name, source] of CALENDAR_CSS) {
      for (const r of flatRules(source)) {
        for (const [prop, value] of declarationsOf(r.body)) {
          const problem =
            prop === 'box-shadow'
              ? shadowProblem(value)
              : prop === 'text-shadow' && value !== 'none'
                ? '字の影'
                : /drop-shadow\(/.test(value)
                  ? 'drop-shadow'
                  : null
          if (problem) found.push(`${name}: ${r.selector} { ${prop}: ${value} }（${problem}）`)
        }
      }
    }
    expect(found).toEqual([])
  })
})

/**
 * 差し色（--accent・--primary とその仲間）を使ってよい所（docs/SPEC.md の 4.4-7・FRAME-160）: フォーカスの枠、今日の印、選んでいる所
 * （押した状態・選んだ値・↑↓で移った所・チェックした休み）、落とせる所、目立たせる枠、今の時刻の線。ほかに本文で決めた所: イヤーの
 * 小さな月の今月の名前（8.3）、休みを付ける状態のマスの点線の枠と帯（9.5）
 */
const ACCENT_OK =
  /:focus-visible|\[aria-pressed='true'\]|\[data-drop=|\.(?:is-(?:today|on|current|active|selected|this-month)|today-mark|flash|dy-now|mo-banner)(?![\w-])|\.mo-month\.is-off /

/** 差し色のトークンを使う宣言か（--on-accent・--on-primary は差し色の上の字の色なので除く） */
const usesAccent = (value: string) => /var\(--(?:accent|primary)(?:-[\w-]+)?\)/.test(value)

/** 差し色を決まった所の外で使う規則（[規則のセレクタ, 宣言]） */
export function accentOutside(source: string): string[] {
  return flatRules(source).flatMap((r) => {
    const decls = declarationsOf(r.body).filter(([, value]) => usesAccent(value))
    if (!decls.length) return []
    const bad = r.selector.split(',').filter((s) => !ACCENT_OK.test(s.trim()))
    return bad.length ? decls.map(([name, value]) => `${bad.map((s) => s.trim()).join(', ')} { ${name}: ${value} }`) : []
  })
}

describe('差し色は決まった所だけ（FRAME-160・4.4-7）', () => {
  it('道具: 決まった所の外の差し色を見つける', () => {
    expect(
      accentOutside(`
        .a:focus-visible { outline: 2px solid var(--accent); }
        .wk-cell[data-drop='hover'] { outline: 2px solid var(--accent); }
        .it-option.is-current { background: var(--accent-soft); }
        .wk-off-box { color: var(--on-accent); }
        .wk-card { background: var(--accent-soft); }
        .x.is-today, .y { color: var(--accent); }
      `),
    ).toEqual(['.wk-card { background: var(--accent-soft) }', '.y { color: var(--accent) }'])
  })

  const SCREEN_CSS = ALL_CSS.filter(([name]) => name.startsWith('features/calendar/') || name.startsWith('features/item/'))

  it('カレンダー・登録と詳細の画面の CSS を読めている', () => {
    expect(SCREEN_CSS.map(([name]) => name)).toEqual(
      expect.arrayContaining(['features/calendar/week/week.css', 'features/item/item.css']),
    )
  })

  it.each(SCREEN_CSS)(
    '%s: 差し色はフォーカスの枠・今日・選んでいる所・落とせる所・目立たせる枠・今の時刻の線と、本文で決めた所だけ',
    (_name, source) => {
      expect(accentOutside(source)).toEqual([])
    },
  )
})

describe('視差効果を減らす設定の知らせの印（FRAME-235）', () => {
  it('ロックの印の色 .lock-accent は、カード・行の CSS の色の指定より必ず強い（600ms だけ --accent）', () => {
    const common = ALL_CSS.find(([name]) => name === 'styles.css')?.[1] ?? ''
    const own = flatRules(common).filter((r) => r.selector === '.lock-accent')
    expect(own.flatMap((r) => declarationsOf(r.body))).toEqual([['color', 'var(--accent) !important']])
  })
})

describe('数字は桁をそろえる（FRAME-149・CALENDAR-261）', () => {
  const common = ALL_CSS.find(([name]) => name === 'styles.css')?.[1] ?? ''
  const rules = flatRules(common)

  it('ページ全体（body）と、等幅の字のクラス（.mono・.mono-time・.numeral）は tabular-nums', () => {
    const tabular = (r: CssRule) =>
      declarationsOf(r.body).some(([name, value]) => name === 'font-variant-numeric' && value.includes('tabular-nums'))
    expect(rules.filter((r) => r.selector === 'body').some(tabular)).toBe(true)
    for (const cls of ['.mono', '.mono-time', '.numeral']) {
      const own = rules.filter((r) => r.selector.split(',').some((s) => s.trim() === cls))
      expect(own.some(tabular), cls).toBe(true)
    }
  })

  it.each(ALL_CSS)('%s: 桁をそろえるのをやめる指定（proportional-nums・normal など）を書かない', (_name, source) => {
    const off = flatRules(source).flatMap((r) =>
      declarationsOf(r.body)
        .filter(([name, value]) => name === 'font-variant-numeric' && !value.includes('tabular-nums') && value !== 'inherit')
        .map(([, value]) => `${r.selector} { font-variant-numeric: ${value} }`),
    )
    expect(off).toEqual([])
  })
})
