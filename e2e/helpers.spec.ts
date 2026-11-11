// E2E の道具（e2e/helpers.ts）が思ったとおりに動くことの確かめ（段階2のカレンダーの E2E の土台。docs/SPEC.md の 2.10）:
// 時刻・外観・表示の設定を決めてログインして開く、画面を通さずにデータを置いて読む、マウス・指の操作を送る、タブレットの端末の形
import { expect, test, type Page } from '@playwright/test'
import type { Item } from '../src/domain/types'
import {
  collectDiagnosticsOnFailure,
  E2E_NOW,
  longPressDrag,
  mouseDrag,
  openCalendar,
  rawItem,
  seed,
  touchSwipe,
} from './helpers'

collectDiagnosticsOnFailure()

/** 作り物の予定 */
function item(p: Partial<Item>): Item {
  const at = Date.parse(E2E_NOW)
  return {
    id: 'e2e-1',
    v: 1,
    kind: 'work',
    title: '資料の確認',
    origin: 'calendar',
    start: '2026-11-10',
    due: null,
    startTime: null,
    endTime: null,
    listed: false,
    done: false,
    doneAt: null,
    doneOn: null,
    locked: false,
    label: null,
    requester: '',
    memo: '',
    order: at,
    by: 'user',
    ai: null,
    via: null,
    createdAt: at,
    updatedAt: at,
    ...p,
  }
}

interface Recorded {
  type: string
  pointerType: string
  x: number
  y: number
  t: number
}

/** ページの中の pointer の出来事を控える（捕まえる段階で。押した要素が何でも残る） */
async function recordPointers(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __pointers: unknown[] }
    w.__pointers = []
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
      document.addEventListener(
        type,
        (e) => {
          const p = e as PointerEvent
          w.__pointers.push({
            type,
            pointerType: p.pointerType,
            x: Math.round(p.clientX),
            y: Math.round(p.clientY),
            t: performance.now(),
          })
        },
        true,
      )
    }
  })
}
const recorded = (page: Page) => page.evaluate(() => (window as unknown as { __pointers: Recorded[] }).__pointers)

/** 指で動かしてもページがスクロールしない（ブラウザが pointercancel を出さない）ようにする */
const noTouchScroll = (page: Page) => page.addStyleTag({ content: '* { touch-action: none !important; }' })

test.describe('開く・データを置く（e2e/helpers.ts）', { tag: ['@pc'] }, () => {
  test('openCalendar: 決めた時刻・外観・表示の設定で、ログインした状態で開き、データを置く', async ({ page }) => {
    await openCalendar(page, '/', {
      appearance: 'deep-dark',
      prefs: { lastMode: 'week' },
      data: { items: { 'e2e-1': item({}) } },
    })
    expect(await page.evaluate(() => new Date().toISOString())).toBe('2026-11-10T00:00:00.000Z')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'deep-dark')
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('diary-studio:prefs') ?? '{}').lastMode)).toBe('week')
    expect(await page.evaluate(() => window.__ds.getData().items['e2e-1']?.title)).toBe('資料の確認')
    expect((await rawItem(page, 'e2e-1'))?.start).toBe('2026-11-10')
    expect(await rawItem(page, 'none')).toBeNull()

    // 操作でも置ける（保存まで待つ）
    const id = await seed(
      page,
      ({ actions }, title) => actions.addItem({ origin: 'calendar', title, start: '2026-11-11' }),
      'メールの返信',
    )
    expect(typeof id).toBe('string')
    expect((await rawItem(page, id))?.title).toBe('メールの返信')

    // 読み込み直しても、置いたデータと、アプリで変えた表示の設定が残る（表示の設定を置くのは最初に開いた時だけ）
    await page.evaluate(() => {
      const prefs = JSON.parse(localStorage.getItem('diary-studio:prefs') ?? '{}')
      localStorage.setItem('diary-studio:prefs', JSON.stringify({ ...prefs, appearance: 'white' }))
    })
    await page.reload()
    await expect(page.getByTestId('top-page')).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'white')
    expect((await rawItem(page, 'e2e-1'))?.title).toBe('資料の確認')
    expect((await rawItem(page, id))?.title).toBe('メールの返信')
  })

  test('seedData は端末の中のデータを丸ごと置き換える（前に置いた物は残らない）', async ({ page }) => {
    await openCalendar(page, '/', { data: { items: { a: item({ id: 'a' }) } } })
    await openCalendar(page, '/', { data: { items: { b: item({ id: 'b', title: '見積もりの提出' }) } } })
    expect(await rawItem(page, 'a')).toBeNull()
    expect((await rawItem(page, 'b'))?.title).toBe('見積もりの提出')
  })

  test('mouseDrag: 押して、5px 以上動かして掴み、落とす所の真ん中で離す', async ({ page }) => {
    await openCalendar(page, '/')
    const cells = page.locator('.cal-cell')
    const from = cells.nth(9)
    const to = cells.nth(12)
    await recordPointers(page)
    await mouseDrag(page, from, to)
    const all = await recorded(page)
    // 押す前に、押す所へ動かした分の pointermove がある
    const events = all.slice(all.findIndex((e) => e.type === 'pointerdown'))
    const [down] = events
    const up = events[events.length - 1]
    const fromBox = (await from.boundingBox())!
    const toBox = (await to.boundingBox())!
    expect(down).toMatchObject({ type: 'pointerdown', pointerType: 'mouse' })
    expect(Math.abs(down.x - (fromBox.x + fromBox.width / 2))).toBeLessThanOrEqual(1)
    expect(events.some((e) => e.type === 'pointermove' && Math.abs(e.x - down.x) >= 5)).toBe(true)
    expect(up).toMatchObject({ type: 'pointerup', pointerType: 'mouse' })
    expect(Math.abs(up.x - (toBox.x + toBox.width / 2))).toBeLessThanOrEqual(1)
    expect(Math.abs(up.y - (toBox.y + toBox.height / 2))).toBeLessThanOrEqual(1)
  })
})

test.describe('指の操作（e2e/helpers.ts）', { tag: ['@s'] }, () => {
  for (const via of ['cdp', 'synthetic'] as const) {
    test(`longPressDrag（${via}）: 押したまま 450ms 待ってから動かし、落とす所で離す`, async ({ page }) => {
      // 待つ時間を測るので、時刻は決めない
      await openCalendar(page, '/', { now: false })
      await noTouchScroll(page)
      const cells = page.locator('.cal-cell')
      const from = cells.nth(8)
      const to = cells.nth(10)
      await recordPointers(page)
      await longPressDrag(page, from, to, { via })
      const events = (await recorded(page)).filter((e) => e.pointerType === 'touch')
      const down = events.find((e) => e.type === 'pointerdown')!
      const firstMove = events.find((e) => e.type === 'pointermove')!
      const up = events[events.length - 1]
      expect(down).toBeTruthy()
      expect(firstMove.t - down.t).toBeGreaterThanOrEqual(400)
      expect(events.some((e) => e.type === 'pointercancel')).toBe(false)
      const toBox = (await to.boundingBox())!
      expect(up.type).toBe('pointerup')
      expect(Math.abs(up.x - (toBox.x + toBox.width / 2))).toBeLessThanOrEqual(1)
    })

    test(`touchSwipe（${via}）: 指ですばやく横に払う`, async ({ page }) => {
      await openCalendar(page, '/', { now: false })
      await noTouchScroll(page)
      const from = page.locator('.cal-cell').nth(10)
      await recordPointers(page)
      await touchSwipe(page, from, -80, 4, { via })
      const events = (await recorded(page)).filter((e) => e.pointerType === 'touch')
      const down = events.find((e) => e.type === 'pointerdown')!
      const up = events[events.length - 1]
      expect(up.type).toBe('pointerup')
      expect(up.x - down.x).toBe(-80)
      expect(up.y - down.y).toBe(4)
      expect(up.t - down.t).toBeLessThan(400)
    })
  }
})

test.describe('タブレット（M）の端末の形（playwright.config.ts の tablet）', { tag: ['@m'] }, () => {
  test('幅 768px・指で操作する（上に載せられない）。トップは縦に積む並べ方', async ({ page }) => {
    await openCalendar(page, '/')
    const media = await page.evaluate(() => ({
      width: window.innerWidth,
      m: matchMedia('(min-width: 600px) and (max-width: 899px)').matches,
      coarse: matchMedia('(pointer: coarse)').matches,
      hover: matchMedia('(hover: hover) and (pointer: fine)').matches,
    }))
    expect(media).toEqual({ width: 768, m: true, coarse: true, hover: false })
    await expect(page.getByTestId('top-switcher')).toBeVisible()
  })
})
