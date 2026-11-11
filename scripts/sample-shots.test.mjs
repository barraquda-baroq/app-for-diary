// @vitest-environment node
// 段階2の見本で撮る物の一覧（e2e/samples/shots.ts）が、作る計画（PLAN §6.3）の撮る画面と問いごとの切り抜きをすべて持ち、
// 切り抜きの四角が見せたい所を囲むかを、ブラウザを使わずに確かめる（docs/SPEC.md の 21.・22.）。
// 切り抜きの四角は、data-testid ごとに箱を決めた作り物のページで計算する
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CROPS, SHOTS, cropName, shotName, shotOf, unionBox } from '../e2e/samples/shots.ts'
import { DEMO_IDS, DEMO_PAIR_KEYS, pairId } from '../e2e/fixtures/demoData.ts'
import { testIds } from '../src/features/calendar/common/testIds.ts'

const variants = JSON.parse(readFileSync(new URL('../e2e/samples/variants.json', import.meta.url), 'utf8'))

/** data-testid ごとの箱（{ x, y, width, height } の並び）を持つ作り物のページ。探した data-testid を asked に残す */
function fakePage(boxes, viewport = { width: 1400, height: 900 }) {
  const asked = []
  return {
    asked,
    viewportSize: () => viewport,
    getByTestId: (id) => {
      asked.push(id)
      return { all: async () => (boxes[id] ?? []).map((b) => ({ boundingBox: async () => b })) }
    },
  }
}

describe('撮る画面（PLAN §6.3 の表）', () => {
  it('16 の画面を、表の行き先と幅で撮る', () => {
    const rows = SHOTS.map((s) => [s.id, s.size, s.part ?? null, s.hash])
    expect(rows).toEqual([
      ['month', 'L', null, '/month/2026-11'],
      ['month', 'S', null, '/month/2026-11'],
      ['month-off', 'L', null, '/month/2026-11'],
      ['week', 'L', null, '/week/2026-11-08'],
      ['week', 'S', 'top', '/week/2026-11-08'],
      ['week', 'S', 'thu-sat', '/week/2026-11-08'],
      ['week-dense', 'S', null, '/week/2026-11-22'],
      ['palette', 'L', null, '/week/2026-11-15'],
      ['day', 'L', null, '/day/2026-11-10'],
      ['day', 'S', null, '/day/2026-11-10'],
      ['day-busy', 'L', null, '/day/2026-11-13'],
      ['detail-work', 'L', null, '/week/2026-11-08'],
      ['detail-work', 'S', null, '/week/2026-11-08'],
      ['detail-private', 'S', null, '/week/2026-11-08'],
      ['register', 'L', null, '/week/2026-11-08'],
      ['register', 'S', null, '/week/2026-11-08'],
    ])
    // 3つの外観で 48 枚。ファイルの名前は重ならない
    const names = SHOTS.flatMap((s) => ['white', 'dark', 'deep-dark'].map((a) => shotName(s, a)))
    expect(new Set(names).size).toBe(48)
  })

  it('問いごとの切り抜き: 計画の所と外観（Q4 はハイライトのあるホワイトとダーク、Q5 はダークを見比べ用に）', () => {
    const byQuestion = {}
    for (const c of CROPS) {
      expect(() => shotOf(c), c.id).not.toThrow()
      byQuestion[c.question] = [...(byQuestion[c.question] ?? []), c.id]
    }
    expect(byQuestion).toEqual({
      2: ['palette-work', 'picker'],
      3: ['week-top', 'day-areas', 'detail'],
      4: ['timeline'],
      5: ['month-top'],
      6: ['toolbar', 'today-month', 'today-week', 'register'],
    })
    expect(variants.questions['4'].appearances).toEqual(['white', 'dark'])
    expect(variants.questions['5'].appearances).toEqual(['white', 'deep-dark'])
    expect(variants.questions['5'].reference).toEqual(['dark'])
    // 撮る切り抜きの数（案 × 外観。見比べ用の外観は今の値だけ）と、名前が重ならないこと
    const names = CROPS.flatMap((c) => {
      const q = variants.questions[String(c.question)]
      return [
        ...q.appearances.flatMap((a) => q.options.map((o) => cropName(c, o.letter, a))),
        ...(q.reference ?? []).map((a) => cropName(c, q.options.find((o) => o.id === 'now').letter, a)),
      ]
    })
    expect(names).toHaveLength(84)
    expect(new Set(names).size).toBe(84)
  })
})

describe('切り抜きの四角', () => {
  const crop = (id) => CROPS.find((c) => c.id === id)

  it('unionBox: 見えている箱を合わせ、pad だけ広げて画面の中に収める（見えない箱は飛ばし、無ければ止める）', async () => {
    const page = fakePage({
      a: [{ x: 10, y: 20, width: 100, height: 50 }],
      b: [
        { x: 300, y: 5, width: 0, height: 0 },
        { x: 1350, y: 800, width: 100, height: 200 },
      ],
    })
    const box = await unionBox(page, [page.getByTestId('a'), page.getByTestId('b')], 8)
    expect(box).toEqual({ x: 2, y: 12, width: 1398, height: 888 })
    await expect(unionBox(page, [page.getByTestId('none')])).rejects.toThrow()
  })

  it('Q4: タイムスケジュールの 9:00（今の時刻の線）から 17:00（面談の終わり）まで、タイムスケジュールの幅いっぱいに', async () => {
    // 48px/時、8:00 が y=100
    const at = (hm) => 100 + (Number(hm.slice(0, 2)) - 8) * 48 + (Number(hm.slice(3)) / 60) * 48
    const ev = (from, to) => [{ x: 700, y: at(from), width: 200, height: at(to) - at(from) }]
    const page = fakePage({
      [testIds.dayTimeline]: [{ x: 600, y: 90, width: 760, height: 800 }],
      [testIds.dayNow]: [{ x: 600, y: at('09:00') - 1, width: 760, height: 2 }],
      [testIds.dayEvent(DEMO_IDS.weekly)]: ev('10:00', '11:30'),
      [testIds.dayEvent(DEMO_IDS.meeting)]: ev('13:00', '13:30'),
      [testIds.dayEvent(DEMO_IDS.review)]: ev('15:00', '16:00'),
      [testIds.dayEvent(DEMO_IDS.interview)]: ev('15:30', '17:00'),
    })
    const box = await crop('timeline').area(page)
    expect(box.y).toBeLessThanOrEqual(at('09:00') - 1)
    expect(box.y + box.height).toBeGreaterThanOrEqual(at('17:00'))
    expect([box.x, box.width]).toEqual([600, 760])
  })

  it('Q5: マンスリーの曜日の行（マス目の上。data-testid が無い）を切らずに入れる', async () => {
    // 中身の箱の上の端が y=120、曜日の行が 40px、マス目が y=160 から 1行 100px
    const cells = {}
    for (let d = 1; d <= 14; d++) {
      const i = d - 1
      cells[testIds.monthCell(`2026-11-${String(d).padStart(2, '0')}`)] = [
        { x: 20 + (i % 7) * 120, y: 160 + Math.floor(i / 7) * 100, width: 120, height: 100 },
      ]
    }
    const page = fakePage({ ...cells, [testIds.calendarBody]: [{ x: 20, y: 120, width: 840, height: 700 }] })
    const box = await crop('month-top').area(page)
    expect(box.y).toBeLessThanOrEqual(120)
    expect(box.y + box.height).toBe(360)
    // 中身の箱の上に別の物（操作の列など）があっても、マス目の上 64px までにとどめる
    const tall = fakePage({ ...cells, [testIds.calendarBody]: [{ x: 20, y: 0, width: 840, height: 900 }] })
    expect((await crop('month-top').area(tall)).y).toBe(96)
  })

  it('Q6: 登録の画面の切り抜きは、主なボタン（［登録］。--primary）も囲む', async () => {
    const page = fakePage({
      [testIds.itemTitle]: [{ x: 450, y: 120, width: 500, height: 36 }],
      [testIds.itemKind('work')]: [{ x: 450, y: 170, width: 100, height: 30 }],
      [testIds.itemKind('private')]: [{ x: 550, y: 170, width: 100, height: 30 }],
      [testIds.itemRegister]: [{ x: 850, y: 760, width: 100, height: 36 }],
    })
    const box = await crop('register').area(page)
    expect(box.y + box.height).toBeGreaterThanOrEqual(796)
    expect(box.x + box.width).toBeGreaterThanOrEqual(950)
  })

  it('Q2: 色の見本の週の仕事の段は、24色・ラベルなしと、土曜の桜と牡丹の組を囲む', async () => {
    const page = fakePage({ [testIds.weekHead('2026-11-15')]: [{ x: 0, y: 0, width: 10, height: 10 }] })
    await crop('palette-work').area(page)
    for (const key of DEMO_PAIR_KEYS) expect(page.asked).toContain(testIds.weekCard(pairId('work', key)))
  })
})
