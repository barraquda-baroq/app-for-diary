// カレンダーの枠の E2E（docs/SPEC.md の 3.1・3.3〜3.5・3.7・3.8・6.4・7.3・7.12）: 行き先と履歴（カレンダーの中は置き換える・戻る）、
// 正しくない行き先・日曜でない週、前回のモード、左のアイコン、高さ（L はページがスクロールしない・S・M の週と日は固定）、
// 0時を過ぎた時の今日の印、裏から戻って6時間、登録・詳細の小さな画面と「戻る」・Esc、スワイプ、期間を移った時にページをめくる動き。
// 今は 2026年11月10日（火）9:00（e2e/helpers.ts の E2E_NOW）。モードの画面の中身は各モードの担当の E2E で確かめる
import { expect, test, type Page } from '@playwright/test'
import { DEMO_IDS, demoData } from './fixtures/demoData'
import {
  collectDiagnosticsOnFailure,
  goBack,
  holdTurns,
  iosCancelledTouch,
  longPressDrag,
  noHorizontalScroll,
  openCalendar,
  pauseTurn,
  recordTurns,
  seed,
  thumbArc,
  touchPath,
  touchSwipe,
  turnDone,
  turnsOf,
} from './helpers'

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

/** 4つのモードの、見ている期間と、次・前の期間の行き先（2026年11月10日（火）を見ている時） */
const PERIODS = [
  ['/year/2026', '/year/2027', '/year/2026'],
  ['/month/2026-11', '/month/2026-12', '/month/2026-11'],
  ['/week/2026-11-08', '/week/2026-11-15', '/week/2026-11-08'],
  ['/day/2026-11-10', '/day/2026-11-11', '/day/2026-11-10'],
] as const

/** なぞる高さ: モードの画面の見えている所の真ん中あたり（イヤー・マンスリーはページより高いので、画面の下の端の手前まで） */
async function flickY(page: Page): Promise<number> {
  const box = await page.getByTestId('calendar-body').boundingBox()
  if (!box) throw new Error('カレンダーが見えていません')
  const vh = page.viewportSize()?.height ?? 800
  return Math.round(Math.min(box.y + box.height / 2, vh - 160))
}

/** 「Diary Studio を閉じますか？」が出て（OS の「戻る」をカレンダーで押した。3.1）、［キャンセル］で閉じる */
async function cancelClose(page: Page) {
  await expect(page.getByTestId('app-close')).toBeVisible()
  await page.getByTestId('app-close-cancel').click()
  await expect(page.getByTestId('app-close')).toHaveCount(0)
}

/** ページ全体がスクロールしない（L。3.4） */
async function pageDoesNotScroll(page: Page, label: string) {
  const [scrollH, innerH] = await page.evaluate(() => [document.documentElement.scrollHeight, window.innerHeight])
  expect(scrollH, label).toBeLessThanOrEqual(innerH)
}

test.describe('行き先と履歴（PC）', { tag: ['@pc'] }, () => {
  test('トップ #/ は前回のモードの今日を含む期間へ置き換え、モードを替えても見ている日を保って置き換え（履歴に積まない）、‹ ›・［今日］も置き換える。「戻る」は前のモードへ戻らず、閉じるかを聞く（3.1）', async ({
    page,
  }) => {
    await openCalendar(page, '/')
    await at(page, '/month/2026-11')
    await expect(page.getByTestId('view-month')).toBeVisible()
    const length = await page.evaluate(() => history.length)
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
    await page.getByTestId('cal-today').click()
    await at(page, '/week/2026-11-08')
    expect(await page.evaluate(() => history.length)).toBe(length)
    await goBack(page)
    await cancelClose(page)
    await at(page, '/week/2026-11-08')
    expect(await page.evaluate(() => history.length)).toBe(length)
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
      // 正しくない行き先へは戻らない（カレンダーの「戻る」は閉じるかを聞く。3.1）
      await goBack(page)
      await cancelClose(page)
      await at(page, good)
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

  test('左のアイコンと名前: カレンダーからは前回のモードの今日を含む期間へ置き換え、設定からはカレンダーの履歴の所へ戻って置き換える（FRAME-029。3.1）', async ({
    page,
  }) => {
    await openCalendar(page, '/month/2026-11')
    const length = await page.evaluate(() => history.length)
    await page.getByTestId('cal-mode-week').click()
    await page.getByTestId('cal-next').click()
    await at(page, '/week/2026-11-15')
    await page.getByTestId('brand').click()
    await at(page, '/week/2026-11-08')
    // 設定から。［‹ 戻る］・「戻る」で開く前の期間へ（FRAME-268）
    await page.getByTestId('cal-mode-day').click()
    await page.getByTestId('cal-next').click()
    await at(page, '/day/2026-11-11')
    await page.getByTestId('open-settings').click()
    await expect(page.getByTestId('app-settings')).toBeVisible()
    await page.getByTestId('settings-back').click()
    await at(page, '/day/2026-11-11')
    await page.getByTestId('open-settings').click()
    await expect(page.getByTestId('app-settings')).toBeVisible()
    await goBack(page)
    await at(page, '/day/2026-11-11')
    await page.getByTestId('open-settings').click()
    await expect(page.getByTestId('app-settings')).toBeVisible()
    await page.getByTestId('brand').click()
    await at(page, '/day/2026-11-10')
    // 設定へは戻らない（カレンダーの「戻る」は閉じるかを聞く）。履歴は増えない
    await goBack(page)
    await cancelClose(page)
    await at(page, '/day/2026-11-10')
    expect(await page.evaluate(() => history.length)).toBe(length)
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

  test('［›］［‹］・［今日］・前後の月の日で期間を移るとページをめくり（次へ・前へ）、モードを替えた時はめくらない。めくる間も本物の画面は1つで、めくり終えると押せる（3.7・4.9。22. の段階2の終わりの確かめ）', async ({
    page,
  }) => {
    await openCalendar(page, '/month/2026-11', { data: demoData() })
    await recordTurns(page)
    // 止めて見る間、めくり終えても箱を外さない（押すとすぐ終える）
    await holdTurns(page)
    await page.getByTestId('cal-next').click()
    await at(page, '/month/2026-12')
    // めくる箱は読み上げに出さず押せない。写した前の期間には、テストの印が残らない
    const turn = page.locator('.cal-turn')
    await expect.poll(() => turnsOf(page)).toEqual(['next'])
    await pauseTurn(page, 0.3)
    await expect(turn).toHaveAttribute('aria-hidden', 'true')
    await expect(turn).toHaveAttribute('inert', '')
    await expect(turn).toHaveCSS('pointer-events', 'none')
    expect(await turn.locator('[data-testid]').count()).toBe(0)
    await expect(page.getByTestId('view-month')).toHaveCount(1)
    // 押すとすぐめくり終える（押した物はそのまま押せる）
    await page.getByTestId('cal-prev').click()
    await at(page, '/month/2026-11')
    await expect.poll(() => turnsOf(page)).toEqual(['next', 'prev'])
    await expect(turn).toHaveCount(1)
    await holdTurns(page, false)
    await page.keyboard.press('Shift')
    await turnDone(page)
    // ［今日］: 期間が替わらない時はめくらない、替わる時はめくる
    await page.getByTestId('cal-today').click()
    await page.getByTestId('cal-mode-week').click()
    await at(page, '/week/2026-11-08')
    await page.getByTestId('cal-mode-day').click()
    await page.getByTestId('cal-mode-year').click()
    await at(page, '/year/2026')
    await page.waitForTimeout(500)
    expect(await turnsOf(page)).toEqual(['next', 'prev'])
    await page.getByTestId('cal-mode-month').click()
    await page.getByTestId('cal-prev').click()
    await at(page, '/month/2026-10')
    await turnDone(page)
    await page.getByTestId('cal-today').click()
    await at(page, '/month/2026-11')
    // マンスリーの前後の月の日（同じモードの中の行き来）もめくる
    await turnDone(page)
    await page.getByTestId('month-cell-2026-12-05').locator('.mo-hit').click()
    await at(page, '/month/2026-12')
    await expect.poll(() => turnsOf(page)).toEqual(['next', 'prev', 'prev', 'next', 'next'])
    // めくり終えると、新しい期間のマスを押せる（デイリーへ）
    await turnDone(page)
    await page.getByTestId('month-cell-2026-12-01').locator('.mo-hit').click()
    await at(page, '/day/2026-12-01')
  })

  test('視差効果を減らす設定ではページをめくらず、すぐ替わる（4.9）', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await openCalendar(page, '/week/2026-11-08', { data: demoData() })
    await recordTurns(page)
    await page.getByTestId('cal-next').click()
    await at(page, '/week/2026-11-15')
    await page.getByTestId('cal-prev').click()
    await at(page, '/week/2026-11-08')
    await page.waitForTimeout(300)
    expect(await turnsOf(page)).toEqual([])
    await expect(page.locator('.cal-turn')).toHaveCount(0)
  })

  test('CPU が遅く（4倍）、めくり始めるのが遅れても、イヤーのめくる動きは最後まで動いてから片付く（途中で切らない。3.7）', async ({
    page,
  }) => {
    await openCalendar(page, '/year/2026', { data: demoData() })
    const cdp = await page.context().newCDPSession(page)
    // めくる箱ごとに、ページのめくる動きが終わった（animationend）か・箱を外した時にもう終わっていたかを控える
    await page.evaluate(() => {
      const w = window as unknown as { __e2eTurnEnds: { ended: boolean; endedBeforeRemoved: boolean | null }[] }
      w.__e2eTurnEnds = []
      let cur: { ended: boolean; endedBeforeRemoved: boolean | null } | null = null
      document.addEventListener(
        'animationend',
        (e) => {
          if (cur && (e.animationName === 'cal-turn-out' || e.animationName === 'cal-turn-in')) cur.ended = true
        },
        true,
      )
      new MutationObserver((list) => {
        for (const m of list) {
          for (const n of m.addedNodes)
            if (n instanceof HTMLElement && n.classList.contains('cal-turn')) {
              cur = { ended: false, endedBeforeRemoved: null }
              w.__e2eTurnEnds.push(cur)
            }
          for (const n of m.removedNodes)
            if (n instanceof HTMLElement && n.classList.contains('cal-turn') && cur) cur.endedBeforeRemoved = cur.ended
        }
      }).observe(document.querySelector('[data-testid="calendar"]')!, { childList: true })
    })
    await recordTurns(page)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
    try {
      // 行き先は描き直す前に替わるので、めくる箱が置かれるのを待ってから、めくり終えるのを待つ
      await page.getByTestId('cal-next').click()
      await at(page, '/year/2027')
      await expect.poll(() => turnsOf(page)).toEqual(['next'])
      await turnDone(page)
      await page.getByTestId('cal-prev').click()
      await at(page, '/year/2026')
      await expect.poll(() => turnsOf(page)).toEqual(['next', 'prev'])
      await turnDone(page)
    } finally {
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
    }
    const ends = await page.evaluate(() => (window as unknown as { __e2eTurnEnds: unknown[] }).__e2eTurnEnds)
    expect(ends).toEqual([
      { ended: true, endedBeforeRemoved: true },
      { ended: true, endedBeforeRemoved: true },
    ])
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
    // 置き換えたので、「戻る」は前の日へ戻らず、閉じるかを聞く
    await goBack(page)
    await cancelClose(page)
    await at(page, '/day/2026-11-11')
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
    // ［×］でも閉じる。閉じた後の「戻る」はカレンダーの「戻る」（小さな画面を開き直さない。閉じるかを聞く）
    await page.getByTestId('cal-add').click()
    await expect(sheet).toBeVisible()
    await page.getByTestId('modal-close').click()
    await expect(sheet).toHaveCount(0)
    await goBack(page)
    await cancelClose(page)
    await at(page, '/week/2026-11-15')
    await expect(sheet).toHaveCount(0)
  })

  test('読み込み直すと、登録の画面は開き直さない（「戻る」の数は変わらない: 次の「戻る」はカレンダーの「戻る」）', async ({
    page,
  }) => {
    await openCalendar(page, '/month/2026-11')
    await page.getByTestId('cal-mode-day').click()
    const length = await page.evaluate(() => history.length)
    await page.getByTestId('cal-add').click()
    await expect(page.getByTestId('item-sheet')).toBeVisible()
    await page.reload()
    await expect(page.getByTestId('view-day')).toBeVisible()
    await expect(page.getByTestId('item-sheet')).toHaveCount(0)
    await at(page, '/day/2026-11-10')
    await goBack(page)
    await cancelClose(page)
    await at(page, '/day/2026-11-10')
    expect(await page.evaluate(() => history.length)).toBe(length)
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
    await goBack(page)
    await cancelClose(page)
    await at(page, '/day/2026-11-10')
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

  test('マンスリーで左へなぞると次の月、右へなぞると前の月（置き換える）。週もなぞると前後の週へ（22. の段階2の終わりの確かめ）。縦にスクロールしても移らない', async ({
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
    // 置き換えたので、Android の「戻る」は前の月・前のモードへ戻らず、閉じるかを聞く
    await goBack(page)
    await cancelClose(page)
    await at(page, '/month/2026-10')
    await page.getByTestId('cal-mode-week').click()
    await at(page, '/week/2026-10-04')
    await page.getByTestId('cal-today').click()
    await at(page, '/week/2026-11-08')
    await touchSwipe(page, page.getByTestId('calendar-body'), -150, 0)
    await at(page, '/week/2026-11-15')
    await touchSwipe(page, page.getByTestId('calendar-body'), 150, 4)
    await at(page, '/week/2026-11-08')
  })

  test('画面の端（カレンダーの区切りの外の余白）から外へ大きく払っても、親指の弧で終わりが上へ逸れても、どのモードでも次・前の期間へ（置き換える。22. の段階2の終わりの確かめ）', async ({
    page,
  }) => {
    for (const [from, next, back] of PERIODS) {
      await openCalendar(page, from, { data: demoData() })
      const vw = page.viewportSize()?.width ?? 412
      const y = await flickY(page)
      const length = await page.evaluate(() => history.length)
      // 右の画面の端（3px。区切りの外の余白）から左の画面の端まで、少し上へ逸れながら 150ms ほどで払う
      await touchPath(page, thumbArc({ x: vw - 3, y }, { x: 3, y: y - 40 }, 12))
      await at(page, next)
      // 左の画面の端から右の画面の端まで払うと前へ
      await touchPath(page, thumbArc({ x: 3, y }, { x: vw - 3, y: y - 30 }, 12))
      await at(page, back)
      // 右の端の 30px 内側から 300px 左へ 120ms。親指の弧で終わりが 200px 上へ逸れる（押した所と離した所では 34°）
      await touchPath(page, thumbArc({ x: vw - 30, y }, { x: vw - 330, y: y - 200 }, 10))
      await at(page, next)
      // 履歴は積まない（置き換える）。「戻る」の印も増えない
      expect(await page.evaluate(() => history.length), from).toBe(length)
    }
  })

  test('iPhone の払い（少しでも縦に揺れると 12px ほどの所でブラウザに取られ、その後は touch の出来事だけが来る）でも、30px 内側からの親指の弧（34°）と画面の端から端への払いで、どのモードでも次・前の期間へ（22. の段階2の終わりの確かめ）', async ({
    page,
  }) => {
    for (const [from, next, back] of PERIODS) {
      await openCalendar(page, from, { data: demoData() })
      const vw = page.viewportSize()?.width ?? 412
      const y = await flickY(page)
      const length = await page.evaluate(() => history.length)
      // 右の端の 30px 内側から 300px 左へ、終わりが 200px 上（12px ずつ 25回）。12px 動いた所で取られる（払い始めが決まる 24px の前）
      await iosCancelledTouch(page, thumbArc({ x: vw - 30, y }, { x: vw - 330, y: y - 200 }, 25))
      await at(page, next)
      await turnDone(page)
      // 左から右へ払っても同じ（前へ）
      await iosCancelledTouch(page, thumbArc({ x: 30, y }, { x: 330, y: y - 200 }, 25))
      await at(page, back)
      await turnDone(page)
      // 右の画面の端（区切りの外の余白）から左の画面の端まで
      await iosCancelledTouch(page, thumbArc({ x: vw - 3, y }, { x: 3, y: y - 40 }, 34))
      await at(page, next)
      await turnDone(page)
      expect(await page.evaluate(() => history.length), from).toBe(length)
    }
  })

  test('大きく払えるようにしても、縦のスクロールはそのまま（画面の端の余白からでも。期間は移らない）', async ({ page }) => {
    // イヤー（ページがスクロールする）: 左の端の余白から上へ・斜めに上へ（水平から 78°）送る
    await openCalendar(page, '/year/2026', { data: demoData() })
    const vh = page.viewportSize()?.height ?? 800
    await touchSwipe(page, { x: 6, y: vh - 120 }, 20, -300, { steps: 10, durationMs: 160 })
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100)
    const scrolled = await page.evaluate(() => window.scrollY)
    await touchSwipe(page, { x: 200, y: vh - 120 }, -60, -280, { steps: 10, durationMs: 160 })
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(scrolled)
    await at(page, '/year/2026')
    // ウィークリー（週の中だけスクロールする）: 初めに少し横へ動いてから縦に送る・斜めに（水平から 73°）送る
    await openCalendar(page, '/week/2026-11-08', { data: demoData() })
    const week = page.getByTestId('view-week')
    const y = await flickY(page)
    await touchPath(
      page,
      [
        { x: 300, y: y + 120 },
        { x: 290, y: y + 116 },
        { x: 284, y: y + 90 },
        { x: 280, y: y + 20 },
        { x: 276, y: y - 60 },
        { x: 272, y: y - 140 },
      ],
      { stepMs: 16 },
    )
    await expect.poll(() => week.evaluate((e) => e.scrollTop)).toBeGreaterThan(0)
    const top = await week.evaluate((e) => e.scrollTop)
    await touchSwipe(page, { x: 320, y: y + 120 }, -80, -260, { steps: 10, durationMs: 160 })
    await expect.poll(() => week.evaluate((e) => e.scrollTop)).toBeGreaterThan(top)
    await page.waitForTimeout(300)
    await at(page, '/week/2026-11-08')
  })

  test('幅 360px でページをめくっている途中も、ページ・カレンダーの区切りは横にスクロールしない（めくれた端は切る）', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 780 })
    for (const path of ['/month/2026-11', '/week/2026-11-08', '/year/2026', '/day/2026-11-10']) {
      await openCalendar(page, path, { data: demoData() })
      await holdTurns(page)
      for (const [dir, frac] of [
        ['next', 0.2],
        ['prev', 0.5],
      ] as const) {
        await page.getByTestId(`cal-${dir}`).click()
        await pauseTurn(page, frac)
        await noHorizontalScroll(page)
        const body = await page.getByTestId('calendar-body').evaluate((e) => ({ scroll: e.scrollWidth, client: e.clientWidth }))
        expect(body.scroll, `${path} ${dir}`).toBeLessThanOrEqual(body.client)
        // めくる箱は .cal-body と同じ所・大きさ
        const turn = page.locator('.cal-turn')
        const [a, b] = await Promise.all([turn.boundingBox(), page.getByTestId('calendar-body').boundingBox()])
        expect(a && b && Math.abs(a.x - b.x) + Math.abs(a.width - b.width), `${path} ${dir}`).toBeLessThanOrEqual(1)
        // めくれた端は箱で切る（箱の外の操作の列・ヘッダーの上に描かない。横のはみ出しは外の箱でも隠れるので、切り方そのものを見る）
        const clip = await turn.evaluate((e) => ({ x: getComputedStyle(e).overflowX, contain: getComputedStyle(e).contain }))
        expect(['clip', 'hidden'], `${path} ${dir}`).toContain(clip.x)
        expect(clip.contain, `${path} ${dir}`).toContain('paint')
        await page.keyboard.press('Shift')
        await turnDone(page)
      }
    }
  })

  test('マンスリーで行の数が替わる時も、めくるページは写した時の大きさのまま（新しい月の高さに伸ばし縮めしない。3.7）', async ({
    page,
  }) => {
    // 2026年12月は5行、2027年1月は6行
    await openCalendar(page, '/month/2026-12', { data: demoData() })
    await holdTurns(page)
    const heightOf = (sel: string) =>
      page.locator(sel).evaluate((e) => ({ h: (e as HTMLElement).offsetHeight, scroll: e.scrollHeight, client: e.clientHeight }))
    const dec = (await heightOf('[data-testid="calendar-body"]')).h
    await page.getByTestId('cal-next').click()
    await at(page, '/month/2027-01')
    await pauseTurn(page, 0.3)
    const jan = (await heightOf('[data-testid="calendar-body"]')).h
    expect(jan).toBeGreaterThan(dec)
    // 次へ: めくれていく 12月は 12月の高さのまま（下の 1月の6行目は、めくる間もそのまま見える）。箱は 1月の高さ
    const out = await heightOf('.cal-turn-page.is-out .cal-turn-body')
    expect(out.h).toBe(dec)
    expect(out.scroll).toBeLessThanOrEqual(out.client)
    expect((await heightOf('.cal-turn-page.is-out')).h).toBe(dec)
    expect((await heightOf('.cal-turn')).h).toBe(jan)
    await page.keyboard.press('Shift')
    await turnDone(page)
    // 前へ: 下に敷く 1月は 1月の高さのまま（縮めて中だけでスクロールする箱にしない）。めくれて来る 12月は 12月の高さ
    await page.getByTestId('cal-prev').click()
    await at(page, '/month/2026-12')
    await pauseTurn(page, 0.5)
    const under = await heightOf('.cal-turn-page.is-under .cal-turn-body')
    expect(under.h).toBe(jan)
    expect(under.scroll).toBeLessThanOrEqual(under.client)
    expect((await heightOf('.cal-turn-page.is-in .cal-turn-body')).h).toBe(dec)
    expect((await heightOf('.cal-turn')).h).toBe(dec)
    await page.keyboard.press('Shift')
    await turnDone(page)
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

  test('‹ › ではページのスクロールの位置を変えず、モードを替える（積まずに置き換えるが、モードが替わる）と先頭へ戻る（D54）', async ({
    page,
  }) => {
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
  test('ウィークリー（7日を横。段の中だけ縦にスクロールする）でも、カードの上から左へなぞると次の週、右へなぞると前の週（ページをめくる。3.7・10.5。22. の段階2の終わりの確かめ）', async ({
    page,
  }) => {
    await openCalendar(page, '/week/2026-11-08', { data: demoData() })
    await recordTurns(page)
    await touchSwipe(page, page.getByTestId(`week-card-${DEMO_IDS.dinner}`), -200, 4)
    await at(page, '/week/2026-11-15')
    await expect.poll(() => turnsOf(page)).toEqual(['next'])
    await turnDone(page)
    await touchSwipe(page, page.getByTestId('calendar-body'), 200, 0)
    await at(page, '/week/2026-11-08')
    await expect.poll(() => turnsOf(page)).toEqual(['next', 'prev'])
  })

  test('画面の端（カレンダーの区切りの外の余白）から外へ大きく払っても次・前の期間へ（置き換える。22. の段階2の終わりの確かめ）', async ({
    page,
  }) => {
    await openCalendar(page, '/month/2026-11', { data: demoData() })
    const vw = page.viewportSize()?.width ?? 768
    const y = await flickY(page)
    const length = await page.evaluate(() => history.length)
    await touchPath(page, thumbArc({ x: vw - 3, y }, { x: 3, y: y - 40 }, 16))
    await at(page, '/month/2026-12')
    await turnDone(page)
    await touchPath(page, thumbArc({ x: 3, y }, { x: vw - 3, y: y - 40 }, 16))
    await at(page, '/month/2026-11')
    expect(await page.evaluate(() => history.length)).toBe(length)
  })

  test('ウィークリー・デイリーは高さを固定し、マンスリーは中身の高さ。下のリストはページのスクロールで届く（FRAME-043・044）', async ({
    page,
  }) => {
    await openCalendar(page, '/day/2026-11-10')
    await checkFixedHeights(page)
  })
})

test.describe('iPhone の枠', { tag: ['@ios'] }, () => {
  test('ウィークリーで左へなぞると次の週へ（ページをめくる）、右へなぞると前の週へ（22. の段階2の終わりの確かめ）', async ({
    page,
  }) => {
    await openCalendar(page, '/week/2026-11-08', { data: demoData() })
    await recordTurns(page)
    const card = page.getByTestId(`week-card-${DEMO_IDS.dinner}`)
    await card.scrollIntoViewIfNeeded()
    await touchSwipe(page, card, -140, 4)
    await at(page, '/week/2026-11-15')
    await expect.poll(() => turnsOf(page)).toEqual(['next'])
    await turnDone(page)
    await touchSwipe(page, page.getByTestId('calendar-body'), 140, 0)
    await at(page, '/week/2026-11-08')
    await expect.poll(() => turnsOf(page)).toEqual(['next', 'prev'])
  })

  test('ウィークリーで画面の端（20px の中）から払うと、端からのフリックと同じくモードを回す（ブラウザが身振りを始めなかった時。3.1）。端の 30px 内側から左の端まで大きく払うと次の週へ。途中で pointercancel が来て touch の出来事だけになった親指の弧でも次の週へ（22. の段階2の終わりの確かめ）', async ({
    page,
  }) => {
    await openCalendar(page, '/week/2026-11-08', { data: demoData() })
    const vw = page.viewportSize()?.width ?? 390
    const box = await page.getByTestId('calendar-body').boundingBox()
    if (!box) throw new Error('カレンダーが見えていません')
    const y = Math.round(box.y + Math.min(box.height / 2, 200))
    // 右の画面の端（3px。区切りの外の余白）から左へ: 週 → 日（期間へは移らない）。左の端から右へ: 日 → 週
    await touchPath(page, thumbArc({ x: vw - 3, y }, { x: 3, y: y - 120 }, 12))
    await at(page, '/day/2026-11-10')
    await touchPath(page, thumbArc({ x: 3, y }, { x: vw - 3, y: y - 120 }, 12))
    await at(page, '/week/2026-11-08')
    // 端の 30px 内側から左の端まで大きく払うと、今までどおり次の週へ
    await touchPath(page, thumbArc({ x: vw - 30, y }, { x: 3, y: y - 120 }, 12))
    await at(page, '/week/2026-11-15')
    await turnDone(page)
    // iPhone の本物の指のように、12px 動いた所で pointercancel が来て、その後は touch の出来事だけが来る払い（親指の弧。34°）
    await iosCancelledTouch(page, thumbArc({ x: vw - 30, y }, { x: vw - 330, y: y - 200 }, 25))
    await at(page, '/week/2026-11-22')
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
