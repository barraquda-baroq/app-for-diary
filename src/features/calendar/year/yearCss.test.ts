// イヤーの CSS（year.css）の見た目の値（docs/SPEC.md の 8.2・8.3・7.3・7.9・4.4・4.7。D07。CALENDAR-073・140・208・209・210・211・
// 213・215・216・219・221・FRAME-134・152・163・209・217・280・281）。
// 色の値・字の色の比は src/styles.test.ts、影・等幅の太さ・色の直書きは src/calendarCss.test.ts が確かめる。jsdom は CSS を当てないので、
// クラス・data-* は YearView.test.tsx、計算した値は E2E（e2e/year.spec.ts）
import { describe, expect, it } from 'vitest'

// CSS は import すると（?raw でも）テストでは中身が空になるので、ファイルを読む（src/styles.test.ts と同じ読み方）
const NODE_FS = 'node:fs'
const { readFileSync } = (await import(/* @vite-ignore */ NODE_FS)) as {
  readFileSync: (path: string, encoding: 'utf8') => string
}
// （new URL('./year.css', import.meta.url) は Vite が開発サーバーの URL に書き換えるので、import.meta.url のファイルの場所から作る）
const HERE = decodeURIComponent(new URL(import.meta.url).pathname).replace(/[^/]*$/, '')
const YEAR_CSS = readFileSync(`${HERE}year.css`, 'utf8')

/** @media の外の規則（セレクタ → 宣言。同じセレクタが2つあれば後の物で上書き） */
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

const RULES = topRules(YEAR_CSS)
const rule = (selector: string) => Object.fromEntries(RULES.get(selector) ?? new Map<string, string>())

describe('イヤーの見た目の値（year.css）', () => {
  it('●: 仕事 --work-line・プライベート --private-line、直径 5px（小さな月は 4px）・間 2px。予定の無い場所は見えないまま残し、全部完了は 0.35', () => {
    expect(rule('.yr-dot.is-work')).toEqual({ background: 'var(--work-line)' })
    expect(rule('.yr-dot.is-private')).toEqual({ background: 'var(--private-line)' })
    expect(rule('.yr-dot')).toMatchObject({ width: '5px', height: '5px' })
    expect(rule('.yr-dots')).toMatchObject({ gap: '2px' })
    expect(rule('.yr-cell.is-mini .yr-dot')).toEqual({ width: '4px', height: '4px' })
    expect(rule(".yr-dot[data-state='none']")).toEqual({ visibility: 'hidden' })
    expect(rule(".yr-dot[data-state='allDone']")).toEqual({ opacity: '0.35' })
  })

  it('今日: マスの内側に 2px の --accent の枠（ぼかしの無い線）と日付の太さ 600。地と色は替えない（D07）', () => {
    expect(rule('.yr-cell.is-today')).toEqual({ 'box-shadow': 'inset 0 0 0 2px var(--accent)' })
    expect(rule('.yr-cell.is-today .yr-date')).toEqual({ 'font-weight': '600' })
  })

  it('月の見出しの帯: 幅 64px・高さ 52px・地 --surface-3、「NOV」13px・500 と「2026」10px。今月は今日の印（--today-bg・--on-primary）', () => {
    expect(YEAR_CSS).toMatch(/grid-template-columns: 64px repeat\(31, minmax\(0, 1fr\)\);\s*column-gap: 2px;/)
    expect(rule('.yr-band')).toMatchObject({ height: '52px', background: 'var(--surface-3)' })
    expect(rule('.yr-band-month')).toMatchObject({ 'font-size': '13px', 'font-weight': '500' })
    expect(rule('.yr-band-year')).toMatchObject({ 'font-size': '10px' })
    expect(rule('.yr-band.today-mark')).toEqual({ background: 'var(--today-bg)', color: 'var(--on-primary)' })
  })

  it('日のマス: 高さ 52px・上の線 2px の --rule-strong、日付 12px・400、曜日 9px・500（行の高さ 1）。色は 7.1、休みは --off-fill', () => {
    expect(rule('.yr-cell:not(.is-mini)')).toMatchObject({ height: '52px', 'border-top': '2px solid var(--rule-strong)' })
    expect(rule('.yr-date')).toEqual({ 'font-size': '12px', 'font-weight': '400', 'line-height': '1' })
    expect(rule('.yr-wd')).toMatchObject({ 'font-size': '9px', 'font-weight': '500', 'line-height': '1' })
    expect(rule(".yr-cell[data-tone='sun'] .yr-date")).toEqual({ color: 'var(--sun)' })
    expect(rule(".yr-cell[data-tone='sun'] .yr-wd")).toEqual({ color: 'var(--sun)' })
    expect(rule(".yr-cell[data-tone='sat'] .yr-date")).toEqual({ color: 'var(--sat)' })
    expect(rule('.yr-cell.cp-offday')).toEqual({ background: 'var(--off-fill)' })
  })

  it('小さな月: 名前 13px・500（今月は --accent）、曜日の頭文字 9px、マスは正方形で日付は真ん中に 11px', () => {
    expect(rule('.yr-mini-name')).toMatchObject({ 'font-size': '13px', 'font-weight': '500' })
    expect(rule('.yr-mini-name.is-this-month')).toEqual({ color: 'var(--accent)' })
    expect(rule('.yr-mini-wd')).toMatchObject({ 'font-size': '9px' })
    expect(rule('.yr-cell.is-mini')).toMatchObject({ 'align-items': 'center', 'justify-content': 'center' })
    expect(rule('.yr-slot')).toEqual({ 'aspect-ratio': '1' })
    expect(rule('.yr-cell.is-mini .yr-date')).toEqual({ 'font-size': '11px' })
  })

  it('L はこの画面の中だけで縦にスクロールする（CALENDAR-217。測る箱 .cal-body はスクロールさせない）', () => {
    expect(rule('.yr.is-scroll')).toMatchObject({ height: 'calc(100% + 16px)', 'overflow-y': 'auto' })
  })

  it('乗せた時の地は --surface-3（8.4。休みの日の地は替えない）', () => {
    expect(YEAR_CSS).toMatch(
      /@media \(hover: hover\) \{\s*\.yr-cell:not\(\.cp-offday\):hover \{\s*background: var\(--surface-3\);/,
    )
  })
})
