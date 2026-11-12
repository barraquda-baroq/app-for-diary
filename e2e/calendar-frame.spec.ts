// カレンダーの枠の E2E（docs/SPEC.md の 3.1・3.3〜3.5・3.7・3.8・6.4・7.3・7.12）: 行き先と履歴（積む・置き換える・戻る）、
// 正しくない行き先・日曜でない週、前回のモード、左のアイコン、高さ（L はページがスクロールしない・S・M の週と日は固定）、
// 0時を過ぎた時の今日の印、裏から戻って6時間、登録・詳細の小さな画面と「戻る」・Esc、スワイプ。
// 今は 2026年11月10日（火）9:00（e2e/helpers.ts の E2E_NOW）。モードの画面の中身は各モードの担当の E2E で確かめる
import { expect, test, type Page } from '@playwright/test'
import { DEMO_IDS, demoData } from './fixtures/demoData'
import { collectDiagnosticsOnFailure, longPressDrag, noHorizontalScroll, openCalendar, seed, touchSwipe } from './helpers'

collectDiagnosticsOnFailure()

/** 今の行き先（# の後ろ） */
const hashOf = (page: Page) => page.evaluate(() => window.location.hash.slice(1))

/** 行き先が path になるまで待つ */
async function at(page: Page, path: string) {
  await expect.poll(() => hashOf(page)).toBe(path)
}

/** 画面が見えている・隠れているを切り替える（アプリが裏へ回った・戻った） */
async function setVisibility(page: Page, state: 'visible' | 'hidden') {
  await page.evaluate((s) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => s })
    document.dispatchEvent(new Event('visibilitychange'))
  }, state)
}

/** ページ全体がスクロールしない（L。3.4） */
async function pageDoesNotScroll(page: Page, label: string) {
  const [scrollH, innerH] = await page.evaluate(() => [document.documentElement.scrollHeight, window.innerHeight])
  expect(scrollH, label).toBeLessThanOrEqual(innerH)
}

test.describe('行き先と履歴（PC）', { tag: ['@pc'] }, () => {
  test('トップ #/ は前回のモードの今日を含む期間へ置き換え、モードを替えると見ている日を保って積み、› を3回押しても「戻る」1回で前のモードへ', async ({
    page,
  }) => {
    await openCalendar(page, '/')
    await at(page, '/month/2026-11')
    await expect(page.getByTestId('view-month')).toBeVisible()
    await page.getByTestId('cal-mode-week').click()
    await at(page, '/week/2026-11-08')
    await page.getByTestId('cal-mode-year').click()
    await at(page, '/year/2026')
    await page.getByTestId('cal-mode-day').click()
    await at(page, '/day/2026-11-10')
    await page.getByTestId('cal-mode-week').click()
    await at(page, '/week/2026-11-08')
    for (let i = 0; i < 3; i++) await page.getByTestId('cal-next').click()
    await at(page, '/week/2026-11-29')
    await expect(page.getByTestId('cal-period')).toContainText('11.29–12.05')
    await page.goBack()
    await at(page, '/day/2026-11-10')
    await page.goBack()
    await at(page, '/year/2026')
    // ［今日］も置き換える
    await page.getByTestId('cal-next').click()
    await page.getByTestId('cal-today').click()
    await at(page, '/year/2026')
    await page.goBack()
    await at(page, '/week/2026-11-08')
    await page.goBack()
    await at(page, '/month/2026-11')
  })

  test('日付の形が正しくない行き先は今日を含む期間へ置き換え（「戻る」で戻らない）、日曜でない週はその週の日曜へ置き換える', async ({
    page,
  }) => {
    await openCalendar(page, '/week/2026-11-15')
    for (const [bad, good] of [
      ['/month/2026-13', '/month/2026-11'],
      ['/day/2026-02-30', '/day/2026-11-10'],
      ['/year/abc', '/year/2026'],
    ]) {
      await page.evaluate((h) => (window.location.hash = h), bad)
      await at(page, good)
      await page.goBack()
      await at(page, '/week/2026-11-15')
    }
    // 日曜でない日はその日を見ている日にする（「日」でその日）
    await page.evaluate(() => (window.location.hash = '/week/2026-11-12'))
    await at(page, '/week/2026-11-08')
    await page.getByTestId('cal-mode-day').click()
    await at(page, '/day/2026-11-12')
    // 知らない行き先は「見つかりません」
    await page.evaluate(() => (window.location.hash = '/month/2026-11/x'))
    await expect(page.getByTestId('top-page')).toHaveCount(0)
  })

  test('前回のモードを覚え、読み込み直す・#/ を開くとそのモードの今日を含む期間（FRAME-261・282）', async ({ page }) => {
    // 12月の行き先を直接開くと、見ている日は 12月1日（今日が無いので月の初めの日。D02）
    await openCalendar(page, '/month/2026-12')
    await page.getByTestId('cal-mode-week').click()
    await at(page, '/week/2026-11-29')
    // 週を描き終える（前回のモードを書く）まで待ってから #/ へ（描いている途中で移ると、その描画ごと捨てられる）
    await expect(page.getByTestId('view-week')).toBeVisible()
    await page.goto('/#/')
    await at(page, '/week/2026-11-08')
    await page.reload()
    await at(page, '/week/2026-11-08')
    await expect(page.getByTestId('cal-mode-week')).toHaveAttribute('aria-pressed', 'true')
  })

  test('左のアイコンと名前: カレンダーからは前回のモードの今日を含む期間へ置き換え、設定からは積む（FRAME-029）', async ({
    page,
  }) => {
    await openCalendar(page, '/month/2026-11')
    await page.getByTestId('cal-mode-week').click()
    await page.getByTestId('cal-next').click()
    await at(page, '/week/2026-11-15')
    await page.getByTestId('brand').click()
    await at(page, '/week/2026-11-08')
    await page.goBack()
    await at(page, '/month/2026-11')
    // 設定から（積む）。［‹ 戻る］・「戻る」で前のモード・期間へ（FRAME-268）
    await page.getByTestId('cal-mode-day').click()
    await page.getByTestId('cal-next').click()
    await at(page, '/day/2026-11-11')
    await page.getByTestId('open-settings').click()
    await expect(page.getByTestId('app-settings')).toBeVisible()
    await page.getByTestId('settings-back').click()
    await at(page, '/day/2026-11-11')
    await page.getByTestId('open-settings').click()
    await expect(page.getByTestId('app-settings')).toBeVisible()
    await page.getByTestId('brand').click()
    await at(page, '/day/2026-11-10')
    await page.goBack()
    await at(page, '/settings')
  })

  test('L はどのモードでもページ全体がスクロールしない。幅を替えると並べ直してもモード・期間はそのまま（FRAME-021・036）', async ({
    page,
  }) => {
    await openCalendar(page, '/year/2026')
    for (const mode of ['year', 'month', 'week', 'day'] as const) {
      await page.getByTestId(`cal-mode-${mode}`).click()
      await expect(page.getByTestId(`view-${mode}`)).toBeVisible()
      // 右の列は4つのモードのどれでも出したまま（FRAME-011）
      await expect(page.getByTestId('side-column')).toBeVisible()
      await pageDoesNotScroll(page, mode)
    }
    await at(page, '/day/2026-11-10')
    for (const [width, cls] of [
      [700, 'M'],
      [390, 'S'],
      [1400, 'L'],
    ] as const) {
      await page.setViewportSize({ width, height: 900 })
      await expect(page.getByTestId('top-page')).toHaveAttribute('data-width', cls)
      await expect(page.getByTestId('view-day')).toBeVisible()
      await at(page, '/day/2026-11-10')
      await noHorizontalScroll(page)
    }
    await pageDoesNotScroll(page, 'day after resize')
  })
})

test.describe('操作の列（PC。3.7・9.5）', { tag: ['@pc'] }, () => {
  test('［休み］は押すと押した状態（今日の印と同じ地と輪）になり、もう一度押すと戻る。マンスリーを離れると終わる（FRAME-254・D30）', async ({
    page,
  }) => {
    await openCalendar(page, '/month/2026-11')
    const off = page.getByTestId('cal-off')
    await off.click()
    await expect(off).toHaveAttribute('aria-pressed', 'true')
    const look = () => off.evaluate((e) => [getComputedStyle(e).backgroundColor, getComputedStyle(e).boxShadow])
    const token = await page.evaluate(() => {
      const probe = document.createElement('div')
      probe.style.color = 'var(--today-bg)'
      document.body.appendChild(probe)
      const c = getComputedStyle(probe).color
      probe.remove()
      return c
    })
    await expect.poll(async () => (await look())[0]).toBe(token)
    expect((await look())[1]).toContain('1.5px')
    // ‹ › では続き、モードを替えると終わる
    await page.getByTestId('cal-next').click()
    await expect(off).toHaveAttribute('aria-pressed', 'true')
    await off.click()
    await expect(off).toHaveAttribute('aria-pressed', 'false')
    await off.click()
    await page.getByTestId('cal-mode-week').click()
    await page.getByTestId('cal-mode-month').click()
    await expect(off).toHaveAttribute('aria-pressed', 'false')
  })

  test('マウスで左右になぞっても期間は移らない（スワイプは指だけ。FRAME-075）', async ({ page }) => {
    await openCalendar(page, '/month/2026-11')
    const box = await page.getByTestId('calendar-body').boundingBox()
    if (!box) throw new Error('カレンダーが見えていません')
    const y = box.y + box.height / 2
    await page.mouse.move(box.x + box.width - 40, y)
    await page.mouse.down()
    await page.mouse.move(box.x + 40, y, { steps: 8 })
    await page.mouse.up()
    await page.waitForTimeout(200)
    await at(page, '/month/2026-11')
  })
})

test.describe('今日（PC。6.4・7.3）', { tag: ['@pc'] }, () => {
  test('0時を過ぎると今日の印だけが移り、見ている期間は動かさない（FRAME-277・CALENDAR-029・076）', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-11-10T23:59:30+09:00') })
    await openCalendar(page, '/month/2026-11', { now: false })
    const marks = page.getByTestId('calendar-month').locator('.today-mark')
    await expect(marks).toHaveText(['10'])
    await page.clock.runFor(60_000)
    await expect(marks).toHaveText(['11'])
    await at(page, '/month/2026-11')
    await expect(page.getByTestId('cal-numeral')).toHaveText('11')
  })

  test('裏から戻って 6時間たっていて、見ている期間が前の今日を含めば、新しい今日の期間へ置き換える（5時間59分では動かさない）', async ({
    page,
  }) => {
    await page.clock.install({ time: new Date('2026-11-10T22:00:00+09:00') })
    await openCalendar(page, '/month/2026-11', { now: false })
    await page.getByTestId('cal-mode-day').click()
    await at(page, '/day/2026-11-10')
    // 最後の操作から 5時間59分
    await page.getByTestId('cal-period').click()
    await setVisibility(page, 'hidden')
    await page.clock.fastForward('05:59:00')
    await setVisibility(page, 'visible')
    await at(page, '/day/2026-11-10')
    // 操作しないままもう一度裏へ回り、最後の操作から 6時間を過ぎて戻る
    await setVisibility(page, 'hidden')
    await page.clock.fastForward('00:01:30')
    await setVisibility(page, 'visible')
    await at(page, '/day/2026-11-11')
    // 置き換えたので、「戻る」は前のモード（マンスリー）へ
    await page.goBack()
    await at(page, '/month/2026-11')
  })
})

test.describe('登録・詳細の小さな画面（PC。3.1・3.8）', { tag: ['@pc'] }, () => {
  test('［＋ 登録］で開き（行き先はそのまま）、Esc で閉じる。閉じるとモード・期間はそのまま（FRAME-083）', async ({ page }) => {
    await openCalendar(page, '/month/2026-11')
    await page.getByTestId('cal-mode-week').click()
    await page.getByTestId('cal-next').click()
    await at(page, '/week/2026-11-15')
    await page.getByTestId('cal-add').click()
    const sheet = page.getByTestId('item-sheet')
    await expect(sheet).toBeVisible()
    await expect(sheet).toHaveAttribute('data-kind', 'work')
    await at(page, '/week/2026-11-15')
    await page.keyboard.press('Escape')
    await expect(sheet).toHaveCount(0)
    await at(page, '/week/2026-11-15')
    await expect(page.getByTestId('view-week')).toBeVisible()
    // ［×］でも閉じる。閉じた後の「戻る」は前の画面（小さな画面を開き直さない）
    await page.getByTestId('cal-add').click()
    await expect(sheet).toBeVisible()
    await page.getByTestId('modal-close').click()
    await expect(sheet).toHaveCount(0)
    await page.goBack()
    await at(page, '/month/2026-11')
    await expect(sheet).toHaveCount(0)
  })

  test('読み込み直すと、登録の画面は開き直さない（「戻る」の数は変わらない: 1回で前のモードへ）', async ({ page }) => {
    await openCalendar(page, '/month/2026-11')
    await page.getByTestId('cal-mode-day').click()
    await page.getByTestId('cal-add').click()
    await expect(page.getByTestId('item-sheet')).toBeVisible()
    await page.reload()
    await expect(page.getByTestId('view-day')).toBeVisible()
    await expect(page.getByTestId('item-sheet')).toHaveCount(0)
    await at(page, '/day/2026-11-10')
    await page.goBack()
    await at(page, '/month/2026-11')
  })

  test('読み込み直すと、詳細の画面は予定があれば開き直し（履歴の state が残る）、［×］で1つ前へ閉じる（D03）', async ({
    page,
  }) => {
    await openCalendar(page, '/month/2026-11')
    await page.getByTestId('cal-mode-day').click()
    await at(page, '/day/2026-11-10')
    const id = await seed(page, ({ actions }) =>
      actions.addItem({ origin: 'calendar', title: '定例の打ち合わせ', start: '2026-11-10' }),
    )
    // 詳細を開いた時と同じ履歴（同じ行き先に state.sheet を積む。中身の画面が詳細を開くのは WP9）を作ってから読み込み直す
    await page.evaluate((itemId) => {
      const cur = (window.history.state ?? {}) as { idx?: number }
      window.history.pushState(
        { usr: { sheet: { kind: 'detail', id: itemId } }, key: 'e2e-detail', idx: (cur.idx ?? 0) + 1 },
        '',
        window.location.href,
      )
    }, id)
    await page.reload()
    const sheet = page.getByTestId('item-sheet')
    await expect(sheet).toBeVisible()
    await expect(page.getByTestId('item-title')).toHaveText('定例の打ち合わせ')
    await page.getByTestId('modal-close').click()
    await expect(sheet).toHaveCount(0)
    await at(page, '/day/2026-11-10')
    await page.goBack()
    await at(page, '/month/2026-11')
  })
})

test.describe('スマホ（S）の枠', { tag: ['@s'] }, () => {
  test('登録のシートは「戻る」で閉じ、カレンダーのモード・期間・ページのスクロールの位置はそのまま（FRAME-015・083）', async ({
    page,
  }) => {
    await openCalendar(page, '/month/2026-11')
    await page.getByTestId('cal-next').click()
    await at(page, '/month/2026-12')
    // ページを伸ばして少し下へ送る（操作の列はまだ見えている）
    await page.evaluate(() => {
      const filler = document.createElement('div')
      filler.style.height = `${window.innerHeight * 2}px`
      document.querySelector('.top-stack')?.appendChild(filler)
      window.scrollTo(0, 30)
    })
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(30)
    await page.getByTestId('cal-add').click()
    await expect(page.getByTestId('item-sheet')).toBeVisible()
    await page.goBack()
    await expect(page.getByTestId('item-sheet')).toHaveCount(0)
    await at(page, '/month/2026-12')
    await expect(page.getByTestId('cal-numeral')).toHaveText('12')
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(30)
  })

  test('ウィークリー・デイリーは 100dvh − ヘッダー − 切り替えの列 の高さで中だけスクロールし、ページを下へ送ると Routine に届く（FRAME-043・044）', async ({
    page,
  }) => {
    await openCalendar(page, '/week/2026-11-08')
    await checkFixedHeights(page)
  })

  test('マンスリーで左へなぞると次の月、右へなぞると前の月（置き換える）。週はなぞっても移らない。縦にスクロールしても移らない', async ({
    page,
  }) => {
    await openCalendar(page, '/week/2026-11-08')
    await page.getByTestId('cal-mode-month').click()
    await at(page, '/month/2026-11')
    const body = page.getByTestId('calendar-body')
    await touchSwipe(page, body, -120, 8)
    await at(page, '/month/2026-12')
    await touchSwipe(page, body, 120, -6)
    await touchSwipe(page, body, 120, 0)
    await at(page, '/month/2026-10')
    // 短い・斜め・長押ししてから動かす（ドラッグの掴み方）は、なぞったとみなさない
    await touchSwipe(page, body, -50, 0)
    await touchSwipe(page, body, -80, 80)
    const box = await body.boundingBox()
    if (!box) throw new Error('カレンダーが見えていません')
    const y = box.y + Math.min(120, box.height / 2)
    await longPressDrag(page, { x: box.x + box.width - 40, y }, { x: box.x + 40, y })
    await page.waitForTimeout(200)
    await at(page, '/month/2026-10')
    // 置き換えたので「戻る」は前のモードへ
    await page.goBack()
    await at(page, '/week/2026-11-08')
    await touchSwipe(page, page.getByTestId('calendar-body'), -150, 0)
    await page.waitForTimeout(200)
    await at(page, '/week/2026-11-08')
  })

  test('モードの画面の中だけでスクロールする所（デイリーの区切りなど）の上でも、なぞると前後の日へ。その所の縦のスクロールはそのまま', async ({
    page,
  }) => {
    await openCalendar(page, '/day/2026-11-10')
    // デイリーの中身（WP8）の、中だけでスクロールする区切りの代わり
    await page.evaluate(() => {
      const box = document.createElement('div')
      box.dataset.testid = 'inner-scroller'
      box.style.height = '240px'
      box.style.overflowY = 'auto'
      const tall = document.createElement('div')
      tall.style.height = '2000px'
      box.appendChild(tall)
      document.querySelector('[data-testid="view-day"]')?.appendChild(box)
    })
    const inner = page.getByTestId('inner-scroller')
    await touchSwipe(page, inner, -140, 6)
    await at(page, '/day/2026-11-11')
    await touchSwipe(page, inner, 140, 0)
    await at(page, '/day/2026-11-10')
    // 縦になぞると、その所の中がスクロールする（期間は移らない）
    await touchSwipe(page, inner, 0, -160)
    await expect.poll(() => inner.evaluate((e) => e.scrollTop)).toBeGreaterThan(0)
    await at(page, '/day/2026-11-10')
  })

  test('‹ › ではページのスクロールの位置を変えず、モードを替える（積む）と先頭へ戻る（D54）', async ({ page }) => {
    await openCalendar(page, '/month/2026-11')
    // ページを伸ばして少し下へ送る（操作の列はまだ見えている）
    await page.evaluate(() => {
      const filler = document.createElement('div')
      filler.style.height = `${window.innerHeight * 2}px`
      document.querySelector('.top-stack')?.appendChild(filler)
      window.scrollTo(0, 40)
    })
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(40)
    await page.getByTestId('cal-next').click()
    await at(page, '/month/2026-12')
    expect(await page.evaluate(() => window.scrollY)).toBe(40)
    await page.getByTestId('cal-mode-year').click()
    await at(page, '/year/2026')
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
  })
})

test.describe('タブレット（M）の枠', { tag: ['@m'] }, () => {
  test('ウィークリー・デイリーは高さを固定し、マンスリーは中身の高さ。下のリストはページのスクロールで届く（FRAME-043・044）', async ({
    page,
  }) => {
    await openCalendar(page, '/day/2026-11-10')
    await checkFixedHeights(page)
  })
})

test.describe('iPhone の枠', { tag: ['@ios'] }, () => {
  test('登録・詳細のシートは「戻る」で閉じ、モード・期間はそのまま（FRAME-015）', async ({ page }) => {
    await openCalendar(page, '/day/2026-11-10', { data: demoData() })
    await page.getByTestId('cal-add').click()
    await expect(page.getByTestId('item-sheet')).toBeVisible()
    await page.goBack()
    await expect(page.getByTestId('item-sheet')).toHaveCount(0)
    await at(page, '/day/2026-11-10')
    // 詳細（予定を指で押して開く）
    await page.getByTestId(`day-event-${DEMO_IDS.weekly}`).locator('.dy-ev-open').tap()
    await expect(page.getByTestId('item-sheet')).toBeVisible()
    await expect(page.getByTestId('item-title')).toHaveValue('定例ミーティング')
    await page.goBack()
    await expect(page.getByTestId('item-sheet')).toHaveCount(0)
    await at(page, '/day/2026-11-10')
  })
})

/**
 * S・M の高さ（3.5・確かめ A17）: ウィークリー・デイリーのカレンダーの区切り（操作の列を含む）は 100dvh − ヘッダー − 切り替えの列 で、
 * 中身が増えても伸びずに中だけスクロールする。マンスリーは中身の高さ（伸びる）。ページを下へ送ると Routine List に届く
 */
async function checkFixedHeights(page: Page) {
  const expected = await page.evaluate(() => {
    const header = document.querySelector('.app-header')?.getBoundingClientRect().height ?? 0
    const switcher = document.querySelector('.top-switcher')?.getBoundingClientRect().height ?? 0
    return window.innerHeight - header - switcher
  })
  const filler = (h: number) =>
    page.evaluate((px) => {
      document.querySelector('[data-test-filler]')?.remove()
      const el = document.createElement('div')
      el.style.height = `${px}px`
      el.dataset.testFiller = '1'
      document.querySelector('[data-testid="calendar-body"]')?.appendChild(el)
    }, h)
  const calHeight = () => page.getByTestId('calendar').evaluate((e) => e.getBoundingClientRect().height)
  for (const mode of ['week', 'day'] as const) {
    await page.getByTestId(`cal-mode-${mode}`).click()
    await expect(page.getByTestId(`view-${mode}`)).toBeVisible()
    await expect(page.getByTestId('calendar')).toHaveClass(/is-fixed/)
    expect(Math.abs((await calHeight()) - expected), mode).toBeLessThanOrEqual(1)
    // 中身が長くても伸びずに、中だけスクロールする
    await filler(3000)
    expect(Math.abs((await calHeight()) - expected), `${mode} 長い中身`).toBeLessThanOrEqual(1)
    const inner = await page
      .getByTestId('calendar-body')
      .evaluate((e) => ({ scroll: e.scrollHeight, client: e.clientHeight, overflow: getComputedStyle(e).overflowY }))
    expect(inner.scroll).toBeGreaterThan(inner.client)
    expect(inner.overflow).toBe('auto')
  }
  // ページを下へ送ると Routine List に届く
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await expect(page.getByTestId('list-routine')).toBeInViewport()
  // マンスリーは中身の高さ（伸びる）
  await page.getByTestId('cal-mode-month').click()
  await expect(page.getByTestId('view-month')).toBeVisible()
  await expect(page.getByTestId('calendar')).not.toHaveClass(/is-fixed/)
  await filler(3000)
  expect(await calHeight()).toBeGreaterThan(3000)
  await noHorizontalScroll(page)
}
