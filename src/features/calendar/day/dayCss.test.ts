// デイリーの CSS（day.css と、デイリーが使う src/styles.css の共通の物）の決まり（docs/SPEC.md の 11.1〜11.3・4.3〜4.8・7.3・7.8・7.9）。
// 色の値・字の色の比は src/styles.test.ts、影・等幅の太さ・色の直書きは src/calendarCss.test.ts が確かめる。ここはデイリーの見た目の値
// （チェックリストで「CSS」で確かめるとした物）。jsdom は CSS を当てないので、クラス・data-* は DayView.test.tsx、計算した色は E2E
import { describe, expect, it } from 'vitest'
import { mkItem } from '../../../domain/testData'
import { boxMarksPx, boxPx, boxTextPx, COLUMN_GAP_PX, EVENTS_RIGHT_PX, MORE_ROOM_PX } from './dayModel'

// CSS は import すると（?raw でも）テストでは中身が空になるので、ファイルを読む（src/styles.test.ts と同じ読み方）
const NODE_FS = 'node:fs'
const { readFileSync } = (await import(/* @vite-ignore */ NODE_FS)) as {
  readFileSync: (path: string, encoding: 'utf8') => string
}
const read = (relative: string) => readFileSync(decodeURIComponent(new URL(relative, import.meta.url).pathname), 'utf8')
const DAY = read('./day.css')
const COMMON = read('../../../styles.css')

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

const DAY_RULES = rulesOf(DAY)

/** そのセレクタ（「,」で並べた中の1つでもよい）の宣言を合わせた物 */
function day(selector: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const r of DAY_RULES) {
    if (r.at !== '') continue
    if (r.selector.split(',').some((s) => s.trim() === selector)) for (const [k, v] of r.decls) out.set(k, v)
  }
  return out
}

/** 外観ごとのトークンの値（:root の中。外観は data-theme の値。ホワイトは :root だけの所） */
function tokenOf(theme: 'white' | 'deep-dark', name: string): string | undefined {
  const re = theme === 'white' ? /^:root$/ : /^:root\[data-theme='deep-dark'\]$/
  let value: string | undefined
  for (const r of rulesOf(COMMON)) if (r.at === '' && re.test(r.selector) && r.decls.has(name)) value = r.decls.get(name)
  return value
}

describe('並べ方（11.1・D15・AMB-ITEMS-20）', () => {
  it('日の見出しは高さ 40px（ITEMS-107）', () => {
    expect(day('.dy-head').get('height')).toBe('40px')
  })

  it('L・M は左のリスト：右のタイムスケジュール = 4:6、間 16px（ITEMS-103）', () => {
    const main = day('.dy-main')
    expect(main.get('grid-template-columns')).toBe('minmax(0, 4fr) minmax(0, 6fr)')
    expect(main.get('gap')).toBe('16px')
  })

  it('L・M の左のリストは仕事・プライベートを半分ずつにし、それぞれの中だけでスクロールする（ITEMS-104）', () => {
    expect(day('.dy-area').get('flex')).toBe('1 1 0')
    expect(day('.dy-area-body').get('overflow-y')).toBe('auto')
    expect(day('.dy-tl-scroll').get('overflow-y')).toBe('auto')
  })

  it('S は上下に積み、リストは日の見出しより下の高さの 45% まで（超えたら中でスクロール）、残りがタイムスケジュール（ITEMS-106）', () => {
    expect(day('.dy.is-stacked .dy-main').get('flex-direction')).toBe('column')
    const list = day('.dy.is-stacked .dy-list')
    expect(list.get('max-height')).toBe('45%')
    expect(list.get('overflow-y')).toBe('auto')
    expect(day('.dy.is-stacked .dy-timeline').get('flex')).toBe('1 1 0')
  })
})

describe('時間指定なしのリスト（11.2・4.3・4.7・7.9）', () => {
  it('区切りの地そのものに --kind-area（data-kind の --work-area／--private-area）。行・足す行・中の箱には地を付けない（FRAME-126・127・ITEMS-109・118）', () => {
    expect(day('.dy-area').get('background')).toBe('var(--kind-area)')
    for (const sel of ['.dy-area-body', '.dy-rows', '.dy-row', '.dy-add', '.dy-open']) {
      const bg = day(sel).get('background') ?? day(sel).get('background-color')
      expect(bg === undefined || bg === 'transparent', sel).toBe(true)
    }
  })

  it('ディープダークは区切りの地が --surface で、2つの区切りの間に 1px の --rule-strong（ITEMS-110・FRAME-143）', () => {
    expect(tokenOf('deep-dark', '--work-area')).toBe('var(--surface)')
    expect(tokenOf('deep-dark', '--private-area')).toBe('var(--surface)')
    const between = DAY_RULES.find((r) => r.selector === ":root[data-theme='deep-dark'] .dy-area + .dy-area")
    expect(between?.decls.get('border-top')).toBe('1px solid var(--rule-strong)')
  })

  it('見出しは高さ 28px（ITEMS-111）', () => {
    expect(day('.dy-area-head').get('height')).toBe('28px')
  })

  it('行は高さ 40px 以上・下に 1px の --rule、件名は ui 14px・400・行の高さ 1.45（ITEMS-114・117・FRAME-203）', () => {
    const row = day('.dy-row')
    expect(row.get('min-height')).toBe('40px')
    expect(row.get('border-bottom')).toBe('1px solid var(--rule)')
    const title = day('.dy-row-title')
    expect([title.get('font-size'), title.get('font-weight'), title.get('line-height')]).toEqual(['14px', '400', '1.45'])
  })

  it('複数日の右の端: 「━＞」「━●」は線の色（ラベル・無ければ土台・完了は --done-text）、「〜11/11」は --text-muted（ITEMS-121）', () => {
    expect(day('.dy-tail-mark').get('color')).toBe('var(--kind-line)')
    expect(day('.dy-row[data-label] .dy-tail-mark').get('color')).toBe('var(--label)')
    expect(day('.dy-row.is-done .dy-tail-mark').get('color')).toBe('var(--done-text)')
    expect(day('.dy-tail-range').get('color')).toBe('var(--text-muted)')
  })

  it('完了した行は字を --done-text に（件名は部品。右の端の期間・印も同じにする。7.9・ITEMS-126・CALENDAR-136）', () => {
    expect(day('.dy-row.is-done .dy-tail-range').get('color')).toBe('var(--done-text)')
    expect(day('.dy-row.is-done .cp-marks').get('color')).toBe('var(--done-text)')
  })
})

describe('タイムスケジュール（11.3・4.4-6・4.8）', () => {
  it('左に幅 48px の時刻の欄（11px・--text-faint）（ITEMS-128）', () => {
    expect(day('.dy-axis').get('width')).toBe('48px')
    const label = day('.dy-axis-label')
    expect([label.get('font-size'), label.get('color')]).toEqual(['11px', 'var(--text-faint)'])
  })

  it('時間の縞: 偶数の時 --surface、奇数の時 --stripe（ITEMS-129・FRAME-159）', () => {
    expect(day('.dy-hour').get('background')).toBe('var(--surface)')
    expect(day('.dy-hour.is-odd').get('background')).toBe('var(--stripe)')
    expect(day('.dy-hour').get('height')).toBe('var(--hour-px)')
  })

  it('各時間の上に 1px の --rule、12:00 は 1px の点線（--rule-strong）、0:00 は 2px（--rule-strong）（ITEMS-130・FRAME-222）', () => {
    expect(day('.dy-hour').get('border-top')).toBe('1px solid var(--rule)')
    expect(day('.dy-hour.is-noon').get('border-top')).toBe('1px dashed var(--rule-strong)')
    expect(day('.dy-hour.is-day-start').get('border-top')).toBe('2px solid var(--rule-strong)')
  })

  it('今の時刻の線: 2px の --accent と、時刻の欄の端に直径 8px の丸（ITEMS-131・FRAME-280）', () => {
    const line = day('.dy-now')
    expect([line.get('height'), line.get('background'), line.get('left')]).toEqual(['2px', 'var(--accent)', '0'])
    const dot = day('.dy-now::before')
    expect([dot.get('width'), dot.get('height'), dot.get('border-radius'), dot.get('background')]).toEqual([
      '8px',
      '8px',
      '50%',
      'var(--accent)',
    ])
    // 丸の真ん中を時刻の欄の端（.dy-events の左の端）に
    expect(dot.get('left')).toBe('-4px')
  })

  it('予定の枠: 地 --surface・1px の --border・角丸 6px（--radius-sm）・余白 上下 4px・左 10px・右 6px（ITEMS-134・138・FRAME-183・216）', () => {
    const box = day('.dy-box')
    expect(box.get('background')).toBe('var(--surface)')
    expect(box.get('border')).toBe('1px solid var(--border)')
    expect(box.get('border-radius')).toBe('var(--radius-sm)')
    expect(tokenOf('white', '--radius-sm')).toBe('6px')
    // 点線の丸のある枠は、左の余白に丸の分（押せる所 24px）を足す
    expect(box.get('padding')).toMatch(/^4px 6px 4px \d+px$/)
    expect(day('.dy-box.no-ring').get('padding-left')).toBe('10px')
  })

  it('件名は 12px・500（FRAME-204 の 11.3 が優先）', () => {
    const title = day('.dy-ev-title')
    expect([title.get('font-size'), title.get('font-weight')]).toEqual(['12px', '500'])
  })

  it('完了した予定は地 --done-bg。時刻・印の字も --done-text（件名と同じ。7.9・ITEMS-151・CALENDAR-137）', () => {
    expect(day('.dy-box.is-done').get('background')).toBe('var(--done-bg)')
    expect(day('.dy-box.is-done .cp-time').get('color')).toBe('var(--done-text)')
    expect(day('.dy-box.is-done .cp-marks').get('color')).toBe('var(--done-text)')
  })

  it('日をまたぐ予定: 開始のカードは貼り付く（sticky）。線は 2px（--span-w）で線の色、完了は --done-text（ITEMS-144・145・CALENDAR-138）', () => {
    expect(day('.dy-start').get('position')).toBe('sticky')
    expect(day('.dy-start').get('top')).toBe('0')
    expect(day('.dy-span-line').get('width')).toBe('var(--span-w)')
    expect(tokenOf('white', '--span-w')).toBe('2px')
    expect(day('.dy-span-line').get('background')).toBe('var(--kind-line)')
    expect(day('.dy-piece[data-label] .dy-span-line').get('background')).toBe('var(--label)')
    expect(day('.dy-piece.is-done .dy-span-line').get('background')).toBe('var(--done-text)')
  })

  it('予定の枠の位置: 予定を置ける幅（右に 8px の空き）の割合 --x・--w から、札の所 --more-room を --x-room・--w-room 個引く。列の間 2px', () => {
    const box = day('.dy-event')
    expect(box.get('left')).toBe('calc((100% - 8px) * var(--x) - var(--more-room) * var(--x-room) + 2px)')
    expect(box.get('width')).toBe('calc((100% - 8px) * var(--w) - var(--more-room) * var(--w-room) - 2px)')
    expect(day('.dy-piece').get('left')).toBe(box.get('left'))
    expect(day('.dy-piece').get('width')).toBe(box.get('width'))
  })

  it('「+n」の札は 11px（等幅のクラスは部品）で、まとまりの右の端に空けた札の所に、最後の列と 2px 離して置く（予定に重ねない。ITEMS-147・AMB-ITEMS-13）', () => {
    const more = day('.dy-more')
    expect(more.get('font-size')).toBe('11px')
    expect(more.get('position')).toBe('absolute')
    // 札の左の端 = 置ける幅の右の端 + 右の空き 8px − right − 札の幅 が、最後の列の右の端（置ける幅 − 札の所）より 2px 右
    const px = (v: string | undefined) => Number(/^(\d+)px$/.exec(v ?? '')?.[1] ?? NaN)
    const room = px(day('.dy-events').get('--more-room'))
    const chip = px(more.get('min-width'))
    expect(room).toBe(24)
    expect(8 - px(more.get('right')) - chip + room).toBe(2)
    // 2桁（「+10」）まで札の幅に入る（等幅 11px の3文字 ≒ 20px ＋ 余白 2px ×2 ＋ 線 1px ×2）
    expect(more.get('padding')).toBe('0 2px')
    expect(chip).toBeGreaterThanOrEqual(26)
  })
})

describe('指の端末の押せる所（D08・4.11）', () => {
  /** @media の中の規則の宣言 */
  const inMedia = (selector: string) => {
    const r = DAY_RULES.find(
      (x) => x.at.includes('(pointer: coarse)') && x.selector.split(',').some((s) => s.trim() === selector),
    )
    return r?.decls ?? new Map<string, string>()
  }

  it('点線の丸の押せる所は、枠の左上の角から高さ 34px・幅は件名の始まりまで広げる（枠の外は枠の overflow で切れる。件名には掛けない）', () => {
    const hit = inMedia('.dy-ring::before')
    expect([hit.get('height'), hit.get('top'), hit.get('left')]).toEqual(['var(--tap)', '0', '-5px'])
    expect(tokenOf('white', '--tap')).toBe('34px')
    // 丸は枠の上の端・左から 5px（押せる所 24px）。広げた所の左の端が枠の左の端（5 − 5 = 0）
    expect(day('.dy-ring').get('left')).toBe('5px')
    expect(day('.dy-box').get('overflow')).toBe('hidden')
    // 右の端は件名・時刻の始まり（枠の左の余白）と同じ。そこより右は「押すと詳細」（隣と重ならない所だけ広げる。D08・AMB-CAL-14）
    const padLeft = day('.dy-box').get('padding')?.split(/\s+/)[3]
    expect(padLeft).toBe('30px')
    const n = (v: string | undefined) => Number.parseFloat(v ?? '')
    expect(n(day('.dy-ring').get('left')) + n(hit.get('left')) + n(hit.get('width'))).toBe(n(padLeft))
  })

  it('AI の札の押せる所は高さ 34px まで（予定の枠では上の端から下へ、リストの行では 40px の行の中で上下に）', () => {
    expect(inMedia('.dy-ev-marks .cp-ai::after').get('inset')).toBe('-5px -6px -15px')
    expect(inMedia('.dy-row-marks .cp-ai::after').get('inset')).toBe('-10px -6px')
  })
})

describe('すばやく足す（12.1・D44）', () => {
  it('入力欄は「＋ 予定を足す」の行と同じ 40px の高さちょうど（S・M の入力欄 40px に上下の余白を足さない。開いた・閉じた時に下の物が動かない）', () => {
    expect(day('.dy-quick').get('height')).toBe('40px')
    const [top, , bottom] = (day('.dy-quick').get('padding') ?? '').split(/\s+/)
    expect([top, bottom]).toEqual(['0', '0'])
    expect(day('.dy-add').get('min-height')).toBe('40px')
    // S・M・指の端末の入力欄は 40px（src/styles.css）
    const input = rulesOf(COMMON).find((r) => r.at.includes('(pointer: coarse)') && r.selector.includes('.input'))
    expect(input?.decls.get('min-height')).toBe('40px')
  })
})

describe('枠の幅の計算（dayModel.ts の fitBox）は day.css と同じ値を使う（CSS だけを変えて、狭い枠の決め方がずれないように）', () => {
  const px = (v: string | undefined) => Number(/^(-?[\d.]+)px$/.exec(v ?? '')?.[1] ?? NaN)

  it('予定を置ける幅の右の空き・列の間・「+n」の札の所', () => {
    expect(day('.dy-event').get('width')).toBe(
      `calc((100% - ${EVENTS_RIGHT_PX}px) * var(--w) - var(--more-room) * var(--w-room) - ${COLUMN_GAP_PX}px)`,
    )
    expect(day('.dy-events').get('--more-room')).toBe(`${MORE_ROOM_PX}px`)
  })

  it('字の所の幅 = 枠の幅 − 左右の線 − 左右の余白（点線の丸のある枠・無い枠）', () => {
    const [, right, , left] = (day('.dy-box').get('padding') ?? '').split(/\s+/).map(px)
    const border = px(day('.dy-box').get('border')?.split(' ')[0])
    const noRing = px(day('.dy-box.no-ring').get('padding-left'))
    const b = { w: 1 / 3, wRoom: 0 }
    expect(boxPx(b, 300) - boxTextPx({ ...b, ring: true }, 300)).toBeCloseTo(2 * border + left + right)
    expect(boxPx(b, 300) - boxTextPx({ ...b, ring: false }, 300)).toBeCloseTo(2 * border + noRing + right)
  })

  it('印どうし・件名と印の間（.dy-ev-marks の gap・.dy-box の column-gap）', () => {
    // ロックの印（12px）を足した分 − 12px が間
    const gap = boxMarksPx(mkItem({ locked: true }), null) - boxMarksPx(mkItem({}), null) - 12
    expect(day('.dy-ev-marks').get('gap')).toBe(`${gap}px`)
    expect(day('.dy-box').get('column-gap')).toBe(`${gap}px`)
  })
})

describe('予定の枠の中の並び（11.3。狭い枠は dayModel.ts の fitBox）', () => {
  it('ふつうの枠: 1行目に件名（残りの幅）と右上の印、2行目に時刻（幅いっぱい）。時刻は途中で切らない（入る表記を fitBox が選ぶ）', () => {
    expect(day('.dy-box').get('flex-wrap')).toBe('wrap')
    expect(day('.dy-ev-open').get('flex')).toBe('1 1 0')
    expect(day('.dy-ev-marks').get('flex')).toBe('none')
    expect(day('.dy-ev-time').get('flex')).toBe('0 0 100%')
    expect(day('.dy-ev-time').get('overflow')).toBe('hidden')
  })

  it('狭い枠（is-narrow）: 件名は1行目の幅いっぱい、印は2行目の時刻の右へ下ろす', () => {
    expect(day('.dy-box.is-narrow .dy-ev-open').get('flex-basis')).toBe('100%')
    expect(day('.dy-box.is-narrow .dy-ev-time').get('flex')).toBe('1 1 0')
    const marks = day('.dy-box.is-narrow .dy-ev-marks')
    expect([marks.get('order'), marks.get('margin-left')]).toEqual(['1', 'auto'])
  })

  it('低い枠（is-compact）: 件名・時刻・印を1行に（時刻から縮める）。とても狭い枠（is-marks-thin）は〆・ロック・AI の札を出さない', () => {
    expect(day('.dy-box.is-compact').get('flex-wrap')).toBe('nowrap')
    expect(day('.dy-box.is-compact .dy-ev-time').get('flex')).toBe('0 100 auto')
    expect(day('.dy-box.is-compact .dy-ev-marks').get('order')).toBe('1')
    const thin = DAY_RULES.find((r) => r.selector.startsWith('.dy-box.is-marks-thin'))
    expect(thin?.selector).toBe(".dy-box.is-marks-thin .dy-ev-marks :is([data-mark='due'], [data-mark='lock'], .cp-ai)")
    expect(thin?.decls.get('display')).toBe('none')
  })

  it('狭い枠の AI の札の押せる所は、上の件名へは広げない（指の端末。D08）', () => {
    const r = DAY_RULES.find(
      (x) => x.at.includes('(pointer: coarse)') && x.selector === '.dy-box.is-narrow .dy-ev-marks .cp-ai::after',
    )
    expect(r?.decls.get('inset')?.split(/\s+/)[0]).toBe('0')
  })
})

describe('目立たせる所（4.9・useFlashTarget）', () => {
  it('区切り・行・予定の枠・開始のカードには outline・animation を付けない（.flash の枠が隠れる）', () => {
    const targets = ['.dy-area', '.dy-row', '.dy-event', '.dy-start', '.dy-box', '.dy-piece']
    for (const r of DAY_RULES) {
      if (/:focus|::after|::before/.test(r.selector)) continue
      const hits = r.selector.split(',').some((s) => targets.some((t) => s.trim().split(/\s+/).at(-1)?.startsWith(t)))
      if (!hits) continue
      for (const k of r.decls.keys()) expect(/^(outline|animation)/.test(k), `${r.selector} { ${k} }`).toBe(false)
    }
  })
})
