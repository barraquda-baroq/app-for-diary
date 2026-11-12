// ウィークリーの CSS（week.css）の見た目の値（docs/SPEC.md の 10.2。ITEMS-062・065・070・071）。
// 色の値・字の色の比は src/styles.test.ts、影・等幅の太さ・色の直書き・余白の 4px の単位は src/calendarCss.test.ts が確かめる。
// jsdom は CSS を当てないので、クラス・data-* は WeekView.test.tsx、計算した幅・高さは E2E（e2e/week.spec.ts。カードの幅は列の幅 − 8px）
import { describe, expect, it } from 'vitest'
import { WEEK_PX } from './weekModel'

// CSS は import すると（?raw でも）テストでは中身が空になるので、ファイルを読む（src/styles.test.ts と同じ読み方）
const NODE_FS = 'node:fs'
const { readFileSync } = (await import(/* @vite-ignore */ NODE_FS)) as {
  readFileSync: (path: string, encoding: 'utf8') => string
}
// （new URL('./week.css', import.meta.url) は Vite が開発サーバーの URL に書き換えるので、import.meta.url のファイルの場所から作る）
const HERE = decodeURIComponent(new URL(import.meta.url).pathname).replace(/[^/]*$/, '')
const WEEK_CSS = readFileSync(`${HERE}week.css`, 'utf8')
const COMMON_CSS = readFileSync(`${HERE}../../../styles.css`, 'utf8')

/** @media の外の規則（セレクタ → 宣言。「,」で並べたセレクタは1つずつ。同じセレクタが2つあれば後の物で上書き） */
function topRules(source: string): Map<string, Map<string, string>> {
  const src = source.replace(/\/\*[\s\S]*?\*\//g, '')
  const out = new Map<string, Map<string, string>>()
  const stack: { prelude: string; start: number }[] = []
  let last = 0
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '{') {
      stack.push({ prelude: src.slice(last, i).trim(), start: i + 1 })
      last = i + 1
    } else if (src[i] === '}') {
      const top = stack.pop()
      if (top && stack.length === 0 && !top.prelude.startsWith('@')) {
        for (const selector of top.prelude.split(',').map((s) => s.trim().replace(/\s+/g, ' '))) {
          const decls = out.get(selector) ?? new Map<string, string>()
          for (const part of src.slice(top.start, i).split(';')) {
            const m = /^\s*([\w-]+)\s*:\s*([\s\S]+?)\s*$/.exec(part)
            if (m) decls.set(m[1], m[2].replace(/\s+/g, ' '))
          }
          out.set(selector, decls)
        }
      }
      last = i + 1
    }
  }
  return out
}

const RULES = topRules(WEEK_CSS)
const decl = (selector: string, prop: string) => RULES.get(selector)?.get(prop)
const px = (v: string | undefined) => Number(/^(-?\d+(?:\.\d+)?)px$/.exec(v ?? '')?.[1] ?? NaN)

describe('7日を横の段と列（10.2）', () => {
  it('段の間は 8px あけて 1px の --rule（見出し・仕事の段・段の間 9px・プライベートの段。ITEMS-062）', () => {
    expect(decl('.wk-h-inner', 'grid-template-rows')).toBe('auto minmax(0, 1fr) 9px minmax(0, 1fr)')
    expect(decl('.wk-divider', 'border-bottom')).toBe('1px solid var(--rule)')
    // 段の間の 9px は、8px のあきと 1px の線
    const rows = decl('.wk-h-inner', 'grid-template-rows')!.split(' ')
    expect(px(rows[3]) - px(decl('.wk-divider', 'border-bottom')!.split(' ')[0])).toBe(8)
  })

  it('7列を同じ幅にし、列の間に 1px の --rule（見出し・段の中の列も、線の分を同じだけあけて帯と同じ幅に。ITEMS-065）', () => {
    for (const s of ['.wk-strips', '.wk-heads', '.wk-cells']) {
      expect(decl(s, 'display'), s).toBe('grid')
      expect(decl(s, 'grid-template-columns'), s).toBe('repeat(7, minmax(0, 1fr))')
    }
    expect(decl('.wk-strip + .wk-strip', 'border-left')).toBe('1px solid var(--rule)')
    expect(decl('.wk-heads > .wk-head + .wk-head', 'border-left')).toBe('1px solid transparent')
    expect(decl('.wk-cells > .wk-cell + .wk-cell', 'border-left')).toBe('1px solid transparent')
    // 7列の最小は weekModel.ts の WEEK_PX.colMin と同じ（72px × 7。10.1）
    expect(decl('.wk-h-inner', 'min-width')).toBe(`calc(7 * ${WEEK_PX.colMin}px)`)
  })
})

describe('カード（10.2）', () => {
  it('高さ 44px 以上・角丸 6px（--radius-sm。ITEMS-070）', () => {
    expect(decl('.wk-card', 'min-height')).toBe('44px')
    expect(decl('.wk-card', 'border-radius')).toBe('var(--radius-sm)')
    expect(topRules(COMMON_CSS).get(':root')?.get('--radius-sm')).toBe('6px')
  })

  it('余白は上下 6px・左 12px・右 8px。左は点線の丸 16px と丸と件名の間 6px を足した 34px（ITEMS-071）', () => {
    const [top, right, bottom, left] = decl('.wk-card', 'padding')!.split(' ').map(px)
    expect([top, right, bottom]).toEqual([6, 8, 6])
    expect(left).toBe(12 + 16 + 6)
    // 点線の丸の押せる所（32px）は左 4px から: 丸（16px）はその真ん中で、カードの左から 12px〜28px
    const ring = px(decl('.wk-card .wk-done', 'left')) + px(decl('.wk-card .wk-done', 'width')) / 2 - 16 / 2
    expect(ring).toBe(12)
  })
})

describe('落とした後に収まる（4.9。FRAME-230）', () => {
  const DND_CSS = readFileSync(`${HERE}dnd/dnd.css`, 'utf8')

  it('160ms・ease-out: 元の場所へ戻る物は dnd.css の --dur-settle、移った先の新しいカードは drop.ts の SETTLE_MS で同じ長さ', async () => {
    const { SETTLE_BACK, SETTLE_MS } = await import('./dnd/drop')
    expect(topRules(COMMON_CSS).get(':root')?.get('--dur-settle')).toBe(`${SETTLE_MS}ms`)
    expect(SETTLE_MS).toBe(160)
    expect(SETTLE_BACK).toEqual({ duration: 160, easing: 'ease-out' })
    expect(topRules(DND_CSS).get(':root [data-dnd-dragging][data-dnd-dropping]')?.get('animation')).toBe(
      'dnd-settle var(--dur-settle) ease-out forwards',
    )
  })
})
