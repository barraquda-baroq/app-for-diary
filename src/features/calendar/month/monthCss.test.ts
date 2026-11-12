// マンスリーの CSS（month.css）の見た目の値（docs/SPEC.md の 9.2・4.7。FRAME-206）。
// 件数の色・字の色の比は src/styles.test.ts と src/calendarCss.test.ts、余白の 4px の単位は src/calendarCss.test.ts が確かめる。
// jsdom は CSS を当てないので、クラス（mono・is-compact）は MonthView.test.tsx、計算した大きさは E2E（e2e/month.spec.ts）
import { describe, expect, it } from 'vitest'

// CSS は import すると（?raw でも）テストでは中身が空になるので、ファイルを読む（src/styles.test.ts と同じ読み方）
const NODE_FS = 'node:fs'
const { readFileSync } = (await import(/* @vite-ignore */ NODE_FS)) as {
  readFileSync: (path: string, encoding: 'utf8') => string
}
// （new URL('./month.css', import.meta.url) は Vite が開発サーバーの URL に書き換えるので、import.meta.url のファイルの場所から作る）
const HERE = decodeURIComponent(new URL(import.meta.url).pathname).replace(/[^/]*$/, '')
const MONTH_CSS = readFileSync(`${HERE}month.css`, 'utf8')
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

const RULES = topRules(MONTH_CSS)

describe('マンスリーの日付（9.2・4.7）', () => {
  it('mono 13px・400・行の高さ 1。S（is-compact）は 12px（FRAME-206）', () => {
    const date = RULES.get('.mo-date')
    expect([date?.get('font-size'), date?.get('font-weight'), date?.get('line-height')]).toEqual(['13px', '400', '1'])
    expect(RULES.get('.mo-month.is-compact .mo-date')?.get('font-size')).toBe('12px')
    // 等幅の書体は共通の .mono（MonthCell が日付に付ける）
    expect(topRules(COMMON_CSS).get('.mono')?.get('font-family')).toBe('var(--font-mono)')
    // 日付の大きさを書き換える規則は、S の 12px のほかに無い（今日の丸・土日祝・隣の月は色と太さだけ）
    const sizes = [...RULES].filter(([s, d]) => /\.mo-date\b/.test(s) && d.has('font-size')).map(([s]) => s)
    expect(sizes).toEqual(['.mo-date', '.mo-month.is-compact .mo-date'])
  })
})
