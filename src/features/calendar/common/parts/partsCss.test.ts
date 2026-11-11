// カレンダーの共通の部品の CSS（parts.css と、部品が使う src/styles.css の共通の物）の決まり（docs/SPEC.md の 4.3〜4.8・4.11・7.1〜7.4・7.7・7.9）。
// 色の値・字の色の比は src/styles.test.ts、影・等幅の太さ・色の直書きは src/calendarCss.test.ts が確かめる。ここは部品の見た目の値
import { describe, expect, it } from 'vitest'

// CSS は import すると（?raw でも）テストでは中身が空になるので、ファイルを読む（src/styles.test.ts と同じ読み方）
const NODE_FS = 'node:fs'
const { readFileSync } = (await import(/* @vite-ignore */ NODE_FS)) as {
  readFileSync: (path: string, encoding: 'utf8') => string
}
const read = (relative: string) => readFileSync(decodeURIComponent(new URL(relative, import.meta.url).pathname), 'utf8')
const PARTS = read('./parts.css')
const COMMON = read('../../../../styles.css')

/** すべての規則（@media の中も。@keyframes の中は除く）: [@media などの前置き, セレクタ, 宣言] */
function rulesOf(source: string): { at: string; selector: string; decls: Map<string, string> }[] {
  const src = source.replace(/\/\*[\s\S]*?\*\//g, '')
  const out: { at: string; selector: string; decls: Map<string, string> }[] = []
  const stack: { prelude: string; start: number }[] = []
  let last = 0
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '{') {
      stack.push({ prelude: src.slice(last, i).trim(), start: i + 1 })
      last = i + 1
    } else if (src[i] === '}') {
      const top = stack.pop()
      if (top && !top.prelude.startsWith('@') && !stack.some((s) => s.prelude.startsWith('@keyframes'))) {
        const decls = new Map<string, string>()
        for (const part of src.slice(top.start, i).split(';')) {
          const m = /^\s*([\w-]+)\s*:\s*([\s\S]+?)\s*$/.exec(part)
          if (m) decls.set(m[1], m[2].replace(/\s+/g, ' '))
        }
        out.push({ at: stack.map((s) => s.prelude).join(' '), selector: top.prelude.replace(/\s+/g, ' '), decls })
      }
      last = i + 1
    }
  }
  return out
}

const PARTS_RULES = rulesOf(PARTS)
const COMMON_RULES = rulesOf(COMMON)

/** そのセレクタ（「,」で並べた中の1つでもよい）の宣言を合わせた物 */
function decl(rules: ReturnType<typeof rulesOf>, selector: string, at = ''): Map<string, string> {
  const out = new Map<string, string>()
  for (const r of rules) {
    if (r.at !== at) continue
    if (r.selector.split(',').some((s) => s.trim() === selector)) for (const [k, v] of r.decls) out.set(k, v)
  }
  return out
}
const parts = (selector: string, at = '') => decl(PARTS_RULES, selector, at)
const common = (selector: string) => decl(COMMON_RULES, selector)

describe('曜日の丸いラベル（DayPill。4.4-5・7.3・7.4）', () => {
  it('丸いラベルは角丸 999px・地 --surface-3・左右 8px・上下 2px（FRAME-155・CALENDAR-059）', () => {
    const pill = common('.pill')
    expect(pill.get('border-radius')).toBe('var(--radius-pill)')
    expect(pill.get('background')).toBe('var(--surface-3)')
    expect(pill.get('padding')).toBe('2px 8px')
    expect(COMMON).toMatch(/--radius-pill:\s*999px/)
  })

  it('中の英字（.caps）は等幅 11px・500・字間 0.08em・大文字・行の高さ 1（FRAME-208・CALENDAR-060）', () => {
    const caps = common('.caps')
    expect([caps.get('font-size'), caps.get('font-weight'), caps.get('letter-spacing')]).toEqual(['11px', '500', '0.08em'])
    expect([caps.get('text-transform'), caps.get('line-height')]).toEqual(['uppercase', '1'])
    expect(common('.caps').get('font-family') ?? common('.mono').get('font-family')).toBe('var(--font-mono)')
  })

  it('今日は地 --today-bg・字 --on-primary・1.5px の --today-ring の輪、字の太さ 600（FRAME-156・279・CALENDAR-070）', () => {
    const today = common('.pill.is-today')
    expect(today.get('background')).toBe('var(--today-bg)')
    expect(today.get('color')).toBe('var(--on-primary)')
    expect(today.get('box-shadow')).toBe('0 0 0 1.5px var(--today-ring)')
    expect(parts('.cp-pill.is-today .caps').get('font-weight')).toBe('600')
  })

  it('休みの日は地を --surface に（FRAME-157・CALENDAR-083）', () => {
    expect(parts('.cp-pill.is-off').get('background')).toBe('var(--surface)')
  })

  it('土曜は --sat、日曜・祝日は --sun（CALENDAR-053）', () => {
    expect(parts('.cp-pill.cp-sun').get('color')).toBe('var(--sun)')
    expect(parts('.cp-pill.cp-sat').get('color')).toBe('var(--sat)')
    expect(parts('.cp-sun').get('color')).toBe('var(--sun)')
    expect(parts('.cp-sat').get('color')).toBe('var(--sat)')
  })
})

describe('休み・祝日名（7.2・7.4・4.7）', () => {
  it('祝日名・「休」は ui 10px・400・行の高さ 1.2（FRAME-210・CALENDAR-068）', () => {
    for (const sel of ['.cp-holiday', '.cp-off']) {
      const d = parts(sel)
      expect([d.get('font-family'), d.get('font-size'), d.get('font-weight'), d.get('line-height')], sel).toEqual([
        'var(--font-ui)',
        '10px',
        '400',
        '1.2',
      ])
    }
  })

  it('祝日名は --sun の1行、「休」は --off-text（CALENDAR-081）', () => {
    expect(parts('.cp-holiday').get('color')).toBe('var(--sun)')
    expect(parts('.cp-holiday').get('white-space')).toBe('nowrap')
    expect(parts('.cp-holiday').get('text-overflow')).toBe('ellipsis')
    expect(parts('.cp-off').get('color')).toBe('var(--off-text)')
  })

  it('祝日名の「…」は、画面がどこに置いても効く（inline の span のままでは overflow・text-overflow が効かない）', () => {
    const d = parts('.cp-holiday')
    expect(d.get('display')).toBe('inline-block')
    expect(d.get('max-width')).toBe('100%')
    expect(d.get('overflow')).toBe('hidden')
  })

  it('休みの日の地は --off-fill。ディープダークでは、その上の淡い字（--text-faint）を --text-muted で出す（FRAME-173・CALENDAR-084）', () => {
    expect(parts('.cp-offday').get('background')).toBe('var(--off-fill)')
    expect(parts(":root[data-theme='deep-dark'] .cp-offday").get('--text-faint')).toBe('var(--text-muted)')
  })
})

describe('件名・時刻・印（4.3・4.5・7.7・7.9）', () => {
  it('件名のハイライトは inline の要素の下 6割の帯で、折り返したら各行に（FRAME-135）', () => {
    const m = common('.kind-marker')
    expect(m.get('display')).toBe('inline')
    expect(m.get('background')).toBe('linear-gradient(transparent 40%, var(--kind-marker, transparent) 40%)')
    expect(m.get('box-decoration-break')).toBe('clone')
    expect(m.get('-webkit-box-decoration-break')).toBe('clone')
  })

  it('件名の部品が使う字の色は --text・--text-muted（帯の上に置ける字）と、完了の --done-text だけ（FRAME-137・174）', () => {
    const colours = PARTS_RULES.filter((r) => /\.cp-title/.test(r.selector)).flatMap((r) =>
      [...r.decls].filter(([k]) => k === 'color').map(([, v]) => v),
    )
    expect(new Set(colours)).toEqual(new Set(['var(--text)', 'var(--text-muted)', 'var(--done-text)']))
    expect(parts('.cp-title').get('color')).toBe('var(--text)')
    expect(parts('.cp-title-received').get('color')).toBe('var(--text-muted)')
  })

  it('完了は --done-text、斜線は strike の所だけ（7.9）', () => {
    expect(parts('.cp-title.is-done').get('color')).toBe('var(--done-text)')
    expect(parts('.cp-title.is-strike').get('text-decoration')).toBe('line-through')
  })

  it('時刻・期間は等幅 11px（.mono-time）の --text-muted（CALENDAR-101・FRAME-172）', () => {
    expect(common('.mono-time').get('font-size')).toBe('11px')
    expect(common('.mono-time').get('font-family')).toBe('var(--font-mono)')
    expect(common('.mono-time').get('font-variant-numeric')).toBe('tabular-nums')
    expect(parts('.cp-time').get('color')).toBe('var(--text-muted)')
  })

  it('印は --text-muted、〆 は 11px（FRAME-172・CALENDAR-010・149）', () => {
    expect(parts('.cp-marks').get('color')).toBe('var(--text-muted)')
    expect(parts('.cp-due').get('font-size')).toBe('11px')
  })

  it('AI の札は枠だけの小さな札（地なし・枠は字の色・10px）で、押せる所を札の周りに広げる（CALENDAR-108・AMB-CAL-15）', () => {
    const ai = parts('.cp-ai')
    expect(ai.get('background')).toBe('transparent')
    expect(ai.get('border')).toBe('1px solid currentColor')
    expect(ai.get('font-size')).toBe('10px')
    expect(ai.get('color')).toBe('var(--text-muted)')
    expect(parts('.cp-ai::after').get('inset')).toBe('-4px')
  })

  it('ラベルの左の一辺は box-shadow: inset 4px 0 0 色（ラベルがある時だけ。FRAME-219）', () => {
    expect(common('.label-edge[data-label]').get('box-shadow')).toBe('inset var(--edge-w) 0 0 var(--label)')
    expect(COMMON).toMatch(/--edge-w:\s*4px/)
  })
})

describe('完了の丸・●（4.11・7.9）', () => {
  it('点線の丸は --text-faint、押せる所は --dot-hit（既定 40px）、完了の✓は --surface（FRAME-248・249・D09）', () => {
    const dot = common('.dot-check')
    expect(dot.get('color')).toBe('var(--text-faint)')
    expect([dot.get('width'), dot.get('height')]).toEqual(['var(--dot-hit, 40px)', 'var(--dot-hit, 40px)'])
    expect(common('.dot-check-mark').get('stroke')).toBe('var(--surface)')
    expect(decl(COMMON_RULES, '.dot-check:hover .dot-check-ring', '@media (hover: hover)').get('stroke-dasharray')).toBe('none')
  })

  it('●は直径 10px。ラベルの色、無ければ土台の色。✓は --on-label、終点の●の完了は --done-text（4.3・7.8・7.9）', () => {
    const d = parts('.cp-dot')
    expect([d.get('width'), d.get('height'), d.get('border-radius')]).toEqual(['var(--dot-d)', 'var(--dot-d)', '50%'])
    expect(d.get('background')).toBe('var(--kind-line)')
    expect(d.get('color')).toBe('var(--on-label)')
    expect(parts('.cp-dot[data-label]').get('background')).toBe('var(--label)')
    expect(parts('.cp-dot.is-faded').get('background')).toBe('var(--done-text)')
    expect(COMMON).toMatch(/--dot-d:\s*10px/)
  })
})

describe('等幅の字（4.4-1・FRAME-147）', () => {
  it('parts.css は等幅の書体を自分で付けない（等幅は曜日の .caps と時刻の .mono-time だけ。AI の札「Claude」・〆・祝日名は ui）', () => {
    const mono = PARTS_RULES.filter((r) =>
      [...r.decls].some(([k, v]) => (k === 'font-family' || k === 'font') && v.includes('--font-mono')),
    ).map((r) => r.selector)
    expect(mono).toEqual([])
    expect(parts('.cp-ai').get('font-family')).toBe('var(--font-ui)')
  })
})

describe('目立たせる枠を隠さない（4.9。WP0 の注意）', () => {
  it('parts.css は outline・animation を書かない（.flash の outline と animation が要素の CSS に負けないように）', () => {
    const found = PARTS_RULES.flatMap((r) =>
      [...r.decls.keys()].filter((k) => /^(?:outline|animation)/.test(k)).map((k) => `${r.selector} { ${k} }`),
    )
    expect(found).toEqual([])
  })
})
