// @vitest-environment node
// 段階2の見本のページ（scripts/sample-sheet.mjs）: 問いの文を docs/STAGE2-LOOKS.md から読み、撮った絵を1枚も落とさずに並べ、
// 字を HTML として壊さないこと（docs/SPEC.md の 22.）。絵そのものはブラウザで撮るので、ここでは控え（parts）の形だけを使う
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildSheet, escapeHtml, jpegSize, parseLooksDoc } from './sample-sheet.mjs'

const doc = readFileSync(new URL('../docs/STAGE2-LOOKS.md', import.meta.url), 'utf8')
const APPEARANCES = ['white', 'dark', 'deep-dark']

function shot(order, id, size, title, part = null) {
  return APPEARANCES.map((appearance) => ({
    file: `${id}-${size}${part ? `-${part}` : ''}-${appearance}.jpg`,
    kind: 'shot',
    order,
    id,
    size,
    part,
    title,
    appearance,
  }))
}

function crop(order, question, id, title, options, appearances = APPEARANCES, reference = []) {
  const out = []
  for (const appearance of [...appearances, ...reference]) {
    const isRef = reference.includes(appearance)
    for (const [letter, option, label] of options) {
      if (isRef && option !== 'now') continue
      out.push({
        file: `q${question}-${id}-${letter}-${appearance}.jpg`,
        kind: 'crop',
        order,
        question,
        id,
        title,
        letter,
        option,
        label,
        appearance,
        reference: isRef,
      })
    }
  }
  return out
}

const AB = [
  ['A', 'now', '今の色'],
  ['B', 'hue30', '30°おき'],
]
const ABC = [
  ['A', 'depth-lighter', '淡い'],
  ['B', 'now', '今'],
  ['C', 'depth-deeper', '濃い'],
]

const parts = [
  ...shot(0, 'month', 'L', 'マンスリー'),
  ...shot(3, 'week', 'S', 'ウィークリー（上）', 'top'),
  ...shot(7, 'palette', 'L', 'ラベルの24色（ウィークリー）'),
  ...shot(14, 'register', 'L', '登録'),
  ...crop(0, 2, 'palette-work', '仕事の段', AB),
  ...crop(1, 2, 'picker', 'ラベルを選ぶ所', AB),
  ...crop(2, 3, 'week-top', 'ウィークリー（上半分）', ABC),
  ...crop(6, 5, 'month-top', 'マンスリー（曜日の行と初めの2週）', AB, ['white', 'deep-dark'], ['dark']),
]
const sizes = Object.fromEntries(parts.map((p) => [p.file, { width: 1000, height: 400 }]))

describe('問いの文（docs/STAGE2-LOOKS.md）', () => {
  it('■1〜■8 を順に読み、どの問いにも「見る所」と「今の決め方」がある', () => {
    const { questions, notes } = parseLooksDoc(doc)
    expect(questions.map((q) => q.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    for (const q of questions) {
      expect(q.fields['見る所'], `■${q.number}`).toBeTruthy()
      expect(q.fields['今の決め方'], `■${q.number}`).toBeTruthy()
    }
    // 選ぶ物のある問い（2〜6）は、今の決め方がその中の1つ
    for (const q of questions.filter((x) => x.fields['選ぶ物'])) {
      const letter = /^([A-C])（/.exec(q.fields['今の決め方'])?.[1]
      expect(q.fields['選ぶ物'], `■${q.number}`).toContain(`${letter} `)
    }
    expect(notes.fixes.length).toBeGreaterThan(0)
    expect(notes.notices.length).toBeGreaterThan(0)
  })
})

describe('見本のページ', () => {
  const { page, index } = buildSheet({ parts, sizes, doc })

  it('撮った絵をすべて、少なくとも1回は並べる', () => {
    for (const p of parts) expect(page, p.file).toContain(`src="${p.file}"`)
  })

  it('■1〜■8 の節と、直す所・お知らせがあり、今の決め方の案に印が付く', () => {
    for (let n = 1; n <= 8; n++) expect(page).toContain(`id="q${n}"`)
    expect(page).toContain('id="notes"')
    // ■3 は B が今の決め方
    const q3 = page.slice(page.indexOf('id="q3"'), page.indexOf('id="q4"'))
    expect(q3).toMatch(/<span class="letter">B<\/span><span class="opt-name">今<\/span><span class="now">今の決め方<\/span>/)
    expect(q3).not.toMatch(/<span class="letter">A<\/span><span class="opt-name">淡い<\/span><span class="now">/)
  })

  it('見比べ用の外観（■5 のダーク）は、そうと分かる見出しで、今の色だけを出す', () => {
    const q5 = page.slice(page.indexOf('id="q5"'), page.indexOf('id="q6"'))
    expect(q5).toContain('ダーク（見比べ用。今の色だけ）')
    expect(q5).not.toContain('q5-month-top-B-dark.jpg')
  })

  it('送る形は文書の頭を持たず、手元で開く形は持つ。題は「Diary Studio 段階2の見本」', () => {
    expect(page).not.toMatch(/<!doctype|<html|<head>|<body/i)
    expect(page.slice(0, 200)).toContain('<title>Diary Studio 段階2の見本</title>')
    expect(index).toMatch(/^<!doctype html>/)
    expect(index).toContain('<html lang="ja">')
  })

  it('絵の大きさは撮った大きさの半分（倍率 2 で撮っている）', () => {
    expect(page).toContain('src="month-L-white.jpg" alt="マンスリー・PC 1400×900・ホワイト" width="500" height="200"')
  })
})

describe('部品', () => {
  it('escapeHtml は HTML の印になる字を置き換える', () => {
    expect(escapeHtml(`<a href="x">&</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;')
  })

  it('jpegSize は SOF0 の印から幅と高さを読む', () => {
    // SOI, APP0（長さ 4）, SOF0（高さ 0x0102 = 258, 幅 0x0304 = 772）
    const buf = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x02, 0x03, 0x04, 0x03,
    ])
    expect(jpegSize(buf)).toEqual({ width: 772, height: 258 })
  })
})
