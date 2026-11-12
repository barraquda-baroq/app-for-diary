// 登録・詳細の画面の E2E（docs/SPEC.md の 3.8・4.3・4.7・12.2・12.3）: L は真ん中の小さな画面（幅 520px・角丸 14px）、S は下からの
// シート（最大 92dvh・上の角丸 16px）。画面の地は区分の色（--work-sheet／--private-sheet。ディープダークは --surface と題の左の
// 区分のアイコン）、上の辺はラベルの色の帯で、選び替えるとその場で替わる。入力欄の字はスマホで 16px。「戻る」で閉じる。
// 後半（動き）: 登録（［＋ 登録］・Ctrl+Enter・新しいカードを目立たせる）、詳細の自動の保存（読み込み直しても残る）、翌日にする時刻、
// できない日付、ロック中の日付、複製と［開く］、削除（確かめ・ゴミ箱・Task List だけの物の［元に戻す］）、知らない値を消さない、
// 書きかけの「戻る」、読み込み直した後の詳細、iPhone のキーボードの高さ（--kb）。
// 今は 2026年11月10日（火）9:00（e2e/helpers.ts の E2E_NOW）。データは作り物（e2e/fixtures/demoData.ts と、ここで作る小さな物）
import { expect, test, type Locator, type Page } from '@playwright/test'
import type { Item } from '../src/domain/types'
import { DEMO_IDS, demoData } from './fixtures/demoData'
import { collectDiagnosticsOnFailure, noHorizontalScroll, openCalendar, rawItem } from './helpers'

collectDiagnosticsOnFailure()

const sheetOf = (page: Page) => page.getByTestId('item-sheet')

/** CSS の変数の色を、背景の色として読んだ値（'rgb(…)'。計算済みの色と比べる） */
function tokenColor(page: Page, name: string): Promise<string> {
  return page.evaluate((n) => {
    const probe = document.createElement('div')
    probe.style.background = `var(${n})`
    document.body.appendChild(probe)
    const c = getComputedStyle(probe).backgroundColor
    probe.remove()
    return c
  }, name)
}

/** 小さな画面が出る動き（pop-in 140ms。少し小さく下から）が終わるまで待つ（終わる前の箱は小さく測れる） */
async function settled(sheet: Locator): Promise<void> {
  await sheet.evaluate((e) => Promise.all(e.getAnimations({ subtree: true }).map((a) => a.finished)))
}

const background = (el: Locator) => el.evaluate((e) => getComputedStyle(e).backgroundColor)
const height = (el: Locator) => el.evaluate((e) => e.getBoundingClientRect().height)
const shadow = (el: Locator) => el.evaluate((e) => getComputedStyle(e).boxShadow)

/** 詳細を開いた時と同じ履歴（同じ行き先に state.sheet を積む）を作って読み込み直す（読み込み直すと、予定があれば開き直す。D03） */
async function openDetailByHistory(page: Page, id: string): Promise<void> {
  await page.evaluate((itemId) => {
    const cur = (window.history.state ?? {}) as { idx?: number }
    window.history.pushState(
      { usr: { sheet: { kind: 'detail', id: itemId } }, key: 'e2e-item', idx: (cur.idx ?? 0) + 1 },
      '',
      window.location.href,
    )
  }, id)
  await page.reload()
  await expect(sheetOf(page)).toBeVisible()
}

test.describe('登録の画面（PC）', { tag: ['@pc'] }, () => {
  test('［＋ 登録］で真ん中の小さな画面（幅 520px・角丸 14px）を開き、件名にフォーカス。プライベート・ラベルを選ぶとその場で地と上の辺の帯が替わる', async ({
    page,
  }) => {
    await openCalendar(page, '/month/2026-11')
    await page.getByTestId('cal-add').click()
    const sheet = sheetOf(page)
    await expect(sheet).toBeVisible()
    await expect(sheet.getByRole('heading')).toHaveText('予定を登録')
    await settled(sheet)
    const box = await sheet.boundingBox()
    expect(box?.width).toBe(520)
    expect(await sheet.evaluate((e) => getComputedStyle(e).borderTopLeftRadius)).toBe('14px')
    const title = page.getByTestId('item-title')
    await expect(title).toBeFocused()
    // 件名の欄（1行の textarea）もほかの入力欄と同じ高さ 36px（4.11・FRAME-252）
    expect(await height(title)).toBe(36)
    expect(await height(page.getByTestId('item-start-time'))).toBe(36)
    // 仕事の地・帯なし。題の左の区分のアイコンはディープダークだけ（ほかの外観では出さない）
    expect(await background(sheet)).toBe(await tokenColor(page, '--work-sheet'))
    await expect(sheet).not.toHaveAttribute('data-label')
    await expect(sheet.locator('.modal-title-icon')).toBeHidden()
    // プライベートを選ぶと地がプライベートの色に
    await page.getByTestId('item-kind-private').click()
    await expect(sheet).toHaveAttribute('data-kind', 'private')
    expect(await background(sheet)).toBe(await tokenColor(page, '--private-sheet'))
    // ラベルを選ぶと上の辺にその色の 6px の帯
    await page.getByTestId('item-label-rose-l').click()
    await expect(sheet).toHaveAttribute('data-label', 'rose-l')
    const rose = await tokenColor(page, '--label-rose-l')
    expect(await shadow(sheet)).toContain(`${rose} 0px 6px 0px 0px inset`)
    // 件名を打てる。打つと［登録］を押せる
    await expect(page.getByTestId('item-register')).toBeDisabled()
    await title.fill('友だちと映画を見に行く')
    await expect(title).toHaveValue('友だちと映画を見に行く')
    await expect(page.getByTestId('item-register')).toBeEnabled()
    await noHorizontalScroll(page)
  })

  test('ディープダーク: 地は区分で変えず --surface、題の左に区分のアイコン（14px）を出す（FRAME-143・144）', async ({ page }) => {
    await openCalendar(page, '/week/2026-11-08', { appearance: 'deep-dark' })
    await page.getByTestId('cal-add').click()
    const sheet = sheetOf(page)
    const surface = await tokenColor(page, '--surface')
    expect(await background(sheet)).toBe(surface)
    const icon = sheet.locator('.modal-title-icon svg')
    await expect(icon).toBeVisible()
    await settled(sheet)
    expect((await icon.boundingBox())?.width).toBe(14)
    const work = await icon.innerHTML()
    await page.getByTestId('item-kind-private').click()
    expect(await background(sheet)).toBe(surface)
    expect(await icon.innerHTML()).not.toBe(work)
  })
})

test.describe('詳細の画面（PC）', { tag: ['@pc'] }, () => {
  test('予定の中身（件名は書き換えられる欄・区分の地・ラベルの帯と呼び名・どの欄も・下の行）を出し、［×］で閉じる', async ({
    page,
  }) => {
    await openCalendar(page, '/week/2026-11-08', { data: demoData() })
    await openDetailByHistory(page, DEMO_IDS.materials)
    const sheet = sheetOf(page)
    await expect(sheet.getByRole('heading')).toHaveText('予定')
    await expect(page.getByTestId('item-title')).toHaveValue('資料づくり')
    await expect(sheet).toHaveAttribute('data-kind', 'work')
    await expect(sheet).toHaveAttribute('data-label', 'sky-l')
    expect(await background(sheet)).toBe(await tokenColor(page, '--work-sheet'))
    // 畳む所は無く、どの欄も出ている。付けた呼び名は色の並びの下の1行に出す（22. の 7.・8.・10.・ITEMS-021）
    await expect(page.getByTestId('item-details')).toHaveCount(0)
    for (const id of ['item-requester', 'item-memo-view', 'item-lock', 'item-listed', 'item-label-none'])
      await expect(page.getByTestId(id)).toBeVisible()
    await expect(page.getByTestId('item-label-name')).toHaveText('社内')
    await expect(page.getByTestId('item-requester')).toHaveValue('総務')
    await expect(page.getByTestId('item-start')).toHaveText('11月9日（月）')
    await expect(page.getByTestId('item-start-time')).toHaveValue('10:00')
    await expect(page.getByTestId('item-footer')).toContainText('作った 2026/10/01')
    // 区分を選び替えると、その場で地が替わる
    await page.getByTestId('item-kind-private').click()
    expect(await background(sheet)).toBe(await tokenColor(page, '--private-sheet'))
    await page.getByTestId('modal-close').click()
    await expect(sheet).toHaveCount(0)
  })

  test('詳細の Tab の順は画面の並び（件名 → 区分 → 依頼者 → 日付 → 時刻 → メモ → ロック・Task List → ラベル）で、最後の色の次は［×］へ', async ({
    page,
  }) => {
    await openCalendar(page, '/week/2026-11-08', { data: demoData() })
    // メールの返信: 依頼者・メモ・ラベルが空で、時刻も無く、Claude の行も無い（下の行に押せる物が無い）
    await openDetailByHistory(page, DEMO_IDS.mail)
    await page.getByTestId('item-title').focus()
    expect(await tabOrder(page, 12)).toEqual([
      'item-kind-work',
      'item-kind-private',
      'item-requester',
      'item-start',
      'item-due',
      'item-start-time',
      // 終了の欄は開始時刻が空の間は押せない（飛ばす）
      'item-memo',
      'item-lock',
      'item-listed',
      'item-label-none',
      'item-label-rose-l',
      'item-label-coral-l',
    ])
    await page.getByTestId('item-label-peony-d').focus()
    await page.keyboard.press('Tab')
    await expect(page.getByTestId('modal-close')).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await expect(page.getByTestId('item-label-peony-d')).toBeFocused()
  })

  test('ラベルの呼び名は色の並びの下の1行。呼び名の無い色・ある色に乗せても選んでも、画面の高さは変わらない（4.6・22. の 7.）', async ({
    page,
  }) => {
    await openCalendar(page, '/week/2026-11-08', { data: demoData() })
    await page.getByTestId('cal-add').click()
    const sheet = sheetOf(page)
    await settled(sheet)
    const name = page.getByTestId('item-label-name')
    const caption = sheet.getByText('ラベルの色', { exact: true })
    const lastRow = (await page.getByTestId('item-label-peony-d').boundingBox())!
    const firstSwatch = (await page.getByTestId('item-label-rose-l').boundingBox())!
    const line = (await name.boundingBox())!
    // 色の並び（下の行）の下で、左の端は色の並びにそろう。欄の名前「ラベルの色」は色の並びの上
    expect(line.y).toBeGreaterThanOrEqual(lastRow.y + lastRow.height)
    expect(Math.abs(line.x - firstSwatch.x)).toBeLessThanOrEqual(1)
    expect((await caption.boundingBox())!.y).toBeLessThan(firstSwatch.y)
    // 呼び名が無くても1行の高さ（12px の字の 1.5 倍）を空けておく
    expect(line.height).toBeGreaterThanOrEqual(17.5)
    await expect(name).toHaveText('')
    const height = async () => (await sheet.boundingBox())!.height
    const h0 = await height()
    // 呼び名を付けた色（sky-l「社内」）に乗せると出て、外すと消える。呼び名の無い色（rose-l）は出さない
    await page.getByTestId('item-label-sky-l').hover()
    await expect(name).toHaveText('社内')
    expect(await height()).toBe(h0)
    await page.getByTestId('item-label-rose-l').hover()
    await expect(name).toHaveText('')
    await page.getByTestId('item-label-blue-d').click()
    await page.mouse.move(0, 0)
    await expect(name).toHaveText('お客さま')
    expect(await height()).toBe(h0)
  })
})

test.describe('詳細のメモを打った後に押した物（どの端末も）', { tag: ['@pc', '@m', '@s'] }, () => {
  // メモが空の予定の詳細は、メモを4行の入力欄で出す。打った後にほかの物を押すと、入力欄は1行の文章に戻って下の物が上へ（L は
  // 真ん中に置いた画面ごと縮んで上の物も下へ。M は下から出したシートの上の端が下がって［×］も）ずれる。押し終わるまで戻さないので、
  // 押した物は押した時の並びのまま押される（12.3。12.1 のすばやく足すと同じ）
  for (const target of ['item-lock', 'item-listed', 'item-label-sky-l', 'modal-close'] as const) {
    test(`メモを打ってから ${target} を押すと、押した物がそのまま効く（メモも保存する）`, async ({ page, hasTouch }) => {
      if ((page.viewportSize()?.width ?? 0) < 600) await page.setViewportSize({ width: 390, height: 844 })
      await openCalendar(page, '/week/2026-11-08', { data: demoData() })
      await openDetailByHistory(page, DEMO_IDS.mail)
      const sheet = sheetOf(page)
      await settled(sheet)
      await page.getByTestId('item-memo').fill('あとで')
      // ロック・Task List は切り替えの行（字と丸）を押す
      const press =
        target === 'item-lock' || target === 'item-listed'
          ? page.locator('label', { has: page.getByTestId(target) })
          : page.getByTestId(target)
      await press.scrollIntoViewIfNeeded()
      if (hasTouch) await press.tap()
      else await press.click()
      if (target === 'modal-close') await expect(sheet).toHaveCount(0)
      else if (target === 'item-label-sky-l') await expect(sheet).toHaveAttribute('data-label', 'sky-l')
      else await expect(page.getByTestId(target)).toBeChecked()
      // 押し終わった後は、メモを文章に戻す（閉じた時は出ていない）
      if (target !== 'modal-close') await expect(page.getByTestId('item-memo-view')).toBeVisible()
      await expect.poll(async () => (await rawItem(page, DEMO_IDS.mail))?.memo).toBe('あとで')
      const raw = await rawItem(page, DEMO_IDS.mail)
      if (target === 'item-lock') expect(raw?.locked).toBe(true)
      if (target === 'item-listed') expect(raw?.listed).toBe(true)
      if (target === 'item-label-sky-l') expect(raw?.label).toBe('sky-l')
    })
  }
})

test.describe('開始の時刻を打って Tab（どの端末も）', { tag: ['@pc', '@m', '@s'] }, () => {
  // 終了の欄は開始時刻が空の間は押せない（12.2）。開始を打って Tab を押した時は、離れる前に開始を決めて終了を押せるようにし、
  // Tab は画面の並びどおり終了へ移る（文書の順・画面の順・Tab の順は同じ。12.2）。決める前に移すと、ブラウザは押せないままの
  // 終了を飛ばしてメモへ移していた
  for (const where of ['登録', '詳細'] as const) {
    test(`${where}の画面で開始を打って Tab を押すと、終了の欄へ移る（Shift+Tab で開始へ戻る）`, async ({ page }) => {
      await openCalendar(page, '/week/2026-11-08', { data: demoData() })
      // 詳細はメールの返信（時刻が無い）
      if (where === '登録') await page.getByTestId('cal-add').click()
      else await openDetailByHistory(page, DEMO_IDS.mail)
      await settled(sheetOf(page))
      const start = page.getByTestId('item-start-time')
      const end = page.getByTestId('item-end-time')
      await expect(end).toBeDisabled()
      await start.focus()
      await page.keyboard.type('1000')
      await page.keyboard.press('Tab')
      await expect(end).toBeFocused()
      await expect(start).toHaveValue('10:00')
      await page.keyboard.press('Shift+Tab')
      await expect(start).toBeFocused()
      if (where === '詳細') await expect.poll(async () => (await rawItem(page, DEMO_IDS.mail))?.startTime).toBe('10:00')
    })
  }
})

/** 今フォーカスのある所から Tab を n 回押し、移った先の data-testid を順に返す */
async function tabOrder(page: Page, n: number): Promise<(string | null)[]> {
  const out: (string | null)[] = []
  for (let i = 0; i < n; i++) {
    await page.keyboard.press('Tab')
    out.push(await page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? null))
  }
  return out
}

test.describe('登録の画面（スマホ）', { tag: ['@s'] }, () => {
  test('下からのシート（最大 92dvh・上の角丸 16px）。件名の欄は 16px、横にはみ出さず、「戻る」で閉じる', async ({ page }) => {
    await openCalendar(page, '/month/2026-11')
    await page.getByTestId('cal-add').click()
    const sheet = sheetOf(page)
    await expect(sheet).toBeVisible()
    await settled(sheet)
    const [vw, vh] = await page.evaluate(() => [window.innerWidth, window.innerHeight])
    const box = await sheet.boundingBox()
    expect(box?.width).toBe(vw)
    expect(Math.round((box?.y ?? 0) + (box?.height ?? 0))).toBe(vh)
    expect(box?.height ?? 0).toBeLessThanOrEqual(vh * 0.92 + 1)
    const radius = await sheet.evaluate((e) => {
      const s = getComputedStyle(e)
      return [s.borderTopLeftRadius, s.borderTopRightRadius, s.borderBottomLeftRadius]
    })
    expect(radius).toEqual(['16px', '16px', '0px'])
    expect(await page.getByTestId('item-title').evaluate((e) => getComputedStyle(e).fontSize)).toBe('16px')
    // 入力欄の高さはスマホで 40px（件名の欄も。4.11・FRAME-252）
    expect(await height(page.getByTestId('item-title'))).toBe(40)
    // ラベルの丸は 24px で12個が1行に入る（「なし」は別の行。D35）
    const first = await page.getByTestId('item-label-rose-l').boundingBox()
    const last = await page.getByTestId('item-label-peony-l').boundingBox()
    expect(first?.width).toBe(24)
    expect(last?.y).toBe(first?.y)
    const none = (await page.getByTestId('item-label-none').boundingBox())!
    expect(none.y + none.height, '「なし」は色の並びの上の行').toBeLessThanOrEqual(first!.y)
    expect(none.width).toBeGreaterThanOrEqual(34)
    await noHorizontalScroll(page)
    await page.goBack()
    await expect(sheet).toHaveCount(0)
  })
})

test.describe('登録の画面の長さ（スマホ）', { tag: ['@s'] }, () => {
  test('どの欄もいつも出すので S の登録の画面は縦に長く、シートの中だけがスクロールして、いちばん下のラベルの色まで届く（12.2・22. の 10.）', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openCalendar(page, '/month/2026-11', { data: demoData() })
    await page.getByTestId('cal-add').click()
    const sheet = sheetOf(page)
    await settled(sheet)
    const body = sheet.locator('.modal-body')
    // 件名にフォーカスし、シートの中はいちばん上から
    await expect(page.getByTestId('item-title')).toBeFocused()
    const m = await body.evaluate((e) => ({ scroll: e.scrollHeight, client: e.clientHeight, top: e.scrollTop }))
    expect(m.scroll, '中身はシートの見えている所より高い').toBeGreaterThan(m.client)
    expect(m.top).toBe(0)
    // いちばん下まで送ると、最後の色の丸と呼び名の1行が、下のボタンの列の上に全部見える
    await body.evaluate((e) => (e.scrollTop = e.scrollHeight))
    const area = (await body.boundingBox())!
    for (const id of ['item-label-none', 'item-label-peony-d', 'item-label-name']) {
      const b = (await page.getByTestId(id).boundingBox())!
      expect(b.y, id).toBeGreaterThanOrEqual(area.y - 0.5)
      expect(b.y + b.height, id).toBeLessThanOrEqual(area.y + area.height + 0.5)
    }
    await page.getByTestId('item-label-peony-d').click()
    await expect(sheet).toHaveAttribute('data-label', 'peony-d')
    // ページそのものは動かない（シートの中だけ）
    expect(await page.evaluate(() => [window.scrollY, document.documentElement.scrollHeight - window.innerHeight])).toEqual([
      0, 0,
    ])
    await noHorizontalScroll(page)
  })

  for (const where of ['登録', '詳細'] as const) {
    test(`${where}の画面: Tab で「なし」から色の丸へ移ると、フォーカスの枠（丸から 4px）と色の並びの下の呼び名の1行まで見える所へ送る（12.2・4.6）`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 390, height: 844 })
      await openCalendar(page, '/week/2026-11-08', { data: demoData() })
      if (where === '登録') await page.getByTestId('cal-add').click()
      else await openDetailByHistory(page, DEMO_IDS.mail)
      const sheet = sheetOf(page)
      await settled(sheet)
      const body = sheet.locator('.modal-body')
      const name = page.getByTestId('item-label-name')
      // 「なし」は色の並びの上の別の行（S。D35）
      const none = (await page.getByTestId('item-label-none').boundingBox())!
      expect(none.y + none.height).toBeLessThanOrEqual((await page.getByTestId('item-label-rose-l').boundingBox())!.y)
      await page.getByTestId('item-label-none').focus()
      // 上の行（淡い12色）を順に。呼び名の1行は2つの行の下にある
      for (const key of ['rose-l', 'coral-l', 'apricot-l', 'lemon-l', 'lime-l', 'mint-l', 'teal-l', 'sky-l']) {
        await page.keyboard.press('Tab')
        const swatch = page.getByTestId(`item-label-${key}`)
        await expect(swatch).toBeFocused()
        const area = (await body.boundingBox())!
        const b = (await swatch.boundingBox())!
        expect(b.y + b.height + 4, `${key} の枠の下`).toBeLessThanOrEqual(area.y + area.height + 0.5)
        const line = (await name.boundingBox())!
        expect(line.y + line.height, `${key} の時の呼び名の1行`).toBeLessThanOrEqual(area.y + area.height + 0.5)
      }
      // フォーカスした色の付けた呼び名（sky-l「社内」）が見えている
      await expect(name).toHaveText('社内')
    })
  }

  test('指・マウスで上の行の色を押した時は、呼び名の1行が隠れていてもシートの中を送らない（押した物がそのまま効く。12.2）', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openCalendar(page, '/week/2026-11-08', { data: demoData() })
    await page.getByTestId('cal-add').click()
    const sheet = sheetOf(page)
    await settled(sheet)
    const body = sheet.locator('.modal-body')
    for (const [key, how] of [
      ['coral-l', 'tap'],
      ['rose-l', 'click'],
    ] as const) {
      // 上の行の丸は全部見え、その下（下の行・呼び名の1行）は見える所の下に隠れるように送っておく
      const top = await body.evaluate((e, k) => {
        const s = e.querySelector(`[data-testid="item-label-${k}"]`)!.getBoundingClientRect()
        e.scrollTop += s.bottom + 6 - e.getBoundingClientRect().bottom
        return e.scrollTop
      }, key)
      const swatch = page.getByTestId(`item-label-${key}`)
      const area = (await body.boundingBox())!
      const b = (await swatch.boundingBox())!
      expect(b.y + b.height).toBeLessThanOrEqual(area.y + area.height)
      expect((await page.getByTestId('item-label-name').boundingBox())!.y).toBeGreaterThan(area.y + area.height)
      if (how === 'tap') await swatch.tap()
      else await swatch.click()
      await expect(sheet).toHaveAttribute('data-label', key)
      expect(await body.evaluate((e) => e.scrollTop), how).toBe(top)
    }
  })

  for (const c of [
    // 欄をシートの見えている所のいちばん下に置く。390×844 では下の欄が短く、時刻の欄は下の 3分の1 までしか下がらないので、
    // 画面が低い時（Android のキーボードが出た時など）で見る。依頼者は上から3つ目の欄なので、もっと低い時に下の方に来る
    { name: '時刻', field: 'item-start-time', list: 'item-time-list-start', height: 640 },
    { name: '依頼者', field: 'item-requester', list: 'item-requester-list', height: 380 },
  ]) {
    test(`下の方の${c.name}の欄を押しても、シートの中の並びは動かず欄は隠れない。一覧は欄に重ならず画面の中に開く（12.2）`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 390, height: c.height })
      await openCalendar(page, '/month/2026-11', { data: demoData() })
      await page.getByTestId('cal-add').click()
      const sheet = sheetOf(page)
      await settled(sheet)
      const body = sheet.locator('.modal-body')
      const field = page.getByTestId(c.field)
      // 欄の下の端を、シートの見えている所の下の端の 4px 上へ（届かなければ、いちばん上のまま）
      await body.evaluate((e, id) => {
        const f = document.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect()
        e.scrollTop = Math.max(0, e.scrollTop + f.bottom - e.getBoundingClientRect().bottom + 4)
      }, c.field)
      const top = await body.evaluate((e) => e.scrollTop)
      const area = (await body.boundingBox())!
      const before = (await field.boundingBox())!
      expect(before.y + before.height, '欄はシートの下の方').toBeGreaterThan(area.y + area.height * 0.6)
      await field.click()
      const list = page.getByTestId(c.list)
      await expect(list).toBeVisible()
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
      // シートの中は動かず、欄は見えている所の中のまま、フォーカスも欄に
      expect(await body.evaluate((e) => e.scrollTop)).toBe(top)
      expect(await field.boundingBox()).toEqual(before)
      await expect(field).toBeFocused()
      // 一覧は画面の中で、欄に重ならない（下に入らなければ欄の上に開く）
      const pop = (await list.boundingBox())!
      const vh = await page.evaluate(() => window.innerHeight)
      expect(pop.y).toBeGreaterThanOrEqual(0)
      expect(pop.y + pop.height).toBeLessThanOrEqual(vh)
      const overlaps = pop.y < before.y + before.height && before.y < pop.y + pop.height
      expect(overlaps, '一覧が欄に重なる').toBe(false)
      await page.keyboard.press('Escape')
      await expect(list).toHaveCount(0)
      await expect(sheet).toBeVisible()
    })
  }
})

test.describe('登録の画面（iPhone）', { tag: ['@ios'] }, () => {
  test('件名の欄の字は 16px 以上（iOS のズームを防ぐ）、キーボードの高さ（--kb）でシートを持ち上げ、「戻る」で閉じる（FRAME-086・199・ITEMS-190・191・192）', async ({
    page,
  }) => {
    await openCalendar(page, '/month/2026-11')
    await page.getByTestId('cal-add').click()
    const title = page.getByTestId('item-title')
    await expect(title).toBeVisible()
    const size = await title.evaluate((e) => parseFloat(getComputedStyle(e).fontSize))
    expect(size).toBeGreaterThanOrEqual(16)
    // キーボードが出て見えている範囲が縮むと、シートを --kb で持ち上げる（作り物の visualViewport。FRAME-086・ITEMS-191）
    await settled(sheetOf(page))
    await expect.poll(() => shrinkViewport(page, 300)).toBe('300px')
    const box = await page.locator('.modal-backdrop').boundingBox()
    const vh = await page.evaluate(() => window.innerHeight)
    expect(Math.round((box?.y ?? 0) + (box?.height ?? 0))).toBe(vh - 300)
    await page.goBack()
    await expect(sheetOf(page)).toHaveCount(0)
  })
})

// ---------- 後半（動き） ----------

/** 作り物の予定（データの形 6.2 のすべての項目。作った時刻は 2026/10/01） */
function mk(p: Partial<Item> & { id: string; title: string }): Item {
  const at = Date.parse('2026-10-01T09:00:00+09:00')
  return {
    v: 1,
    kind: 'work',
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

const itemsOf = (...list: Item[]) => ({ items: Object.fromEntries(list.map((i) => [i.id, i])) })

/** 表示用のデータの予定（件名で探す） */
function itemByTitle(page: Page, title: string): Promise<Item | null> {
  return page.evaluate((t) => Object.values(window.__ds.getData().items).find((i) => i.title === t) ?? null, title)
}

/** 小さな月のカレンダー（L は日付の欄の下の小窓）で日を選ぶ */
async function pickDate(page: Page, field: string, date: string): Promise<void> {
  await page.getByTestId(field).click()
  await page.getByTestId('item-date-picker').locator(`[data-date="${date}"]`).click()
  await expect(page.getByTestId('item-date-picker')).toHaveCount(0)
}

/** 保存が終わるまで待つ（読み込み直す前に） */
const flush = (page: Page) => page.evaluate(() => window.__ds.flushNow())

/** 保存してから読んだ端末の raw の予定 */
async function savedItem(page: Page, id: string): Promise<Item | null> {
  await flush(page)
  return rawItem(page, id)
}

const DATE_REFUSED = '終わりの時刻が始まりより早いので、この日付にはできません（先に時刻を直してください）'

test.describe('登録と詳細の動き（PC）', { tag: ['@pc'] }, () => {
  test('［＋ 登録］で件名を打ち Ctrl+Enter で登録すると、閉じて新しいカードを 1.2秒目立たせる（お知らせなし。ITEMS-185・187）', async ({
    page,
  }) => {
    await openCalendar(page, '/week/2026-11-08')
    await page.getByTestId('cal-add').click()
    await page.getByTestId('item-title').fill('打ち合わせの準備')
    await page.getByTestId('item-start-time').click()
    await page.keyboard.type('1030')
    // 打ちかけの時刻も、登録の前に決める
    await page.keyboard.press('Control+Enter')
    await expect(sheetOf(page)).toHaveCount(0)
    const item = await itemByTitle(page, '打ち合わせの準備')
    expect(item).toMatchObject({ origin: 'calendar', start: '2026-11-10', startTime: '10:30', kind: 'work' })
    const card = page.getByTestId(`week-card-${item!.id}`)
    await expect(card).toHaveClass(/\bflash\b/)
    await expect(card).not.toHaveClass(/\bflash\b/, { timeout: 3000 })
    await expect(page.locator('.toast')).toHaveCount(0)
  })

  test('詳細で件名を直すと自動で保存し、読み込み直しても残る（打っている途中で読み込み直しても。FRAME-054・265）', async ({
    page,
  }) => {
    await openCalendar(page, '/week/2026-11-08', { data: itemsOf(mk({ id: 'e1', title: '定例会議' })) })
    await page.getByTestId('week-card-e1').locator('.wk-open').click()
    const title = page.getByTestId('item-title')
    await title.fill('定例会議（資料あり）')
    // 0.6秒待たずに読み込み直す（画面を閉じる前に下書きを保存する）
    await page.reload()
    await expect(sheetOf(page)).toBeVisible()
    await expect(title).toHaveValue('定例会議（資料あり）')
    await title.fill('定例会議（第2回）')
    await title.press('Enter')
    await flush(page)
    await page.reload()
    await expect(title).toHaveValue('定例会議（第2回）')
    // 件名を空にして離れると元に戻し、書かない（ITEMS-004）
    await title.fill('')
    await page.getByTestId('item-done').focus()
    await expect(title).toHaveValue('定例会議（第2回）')
    expect((await savedItem(page, 'e1'))?.title).toBe('定例会議（第2回）')
    // 打ちかけの時刻（Enter も押さず欄も離れない）も、読み込み直す前に保存する
    await page.getByTestId('item-start-time').click()
    await page.keyboard.type('1030')
    await page.reload()
    await expect(page.getByTestId('item-start-time')).toHaveValue('10:30')
    expect((await savedItem(page, 'e1'))?.startTime).toBe('10:30')
  })

  test('時刻を入れて 1日の予定で終了 < 開始になると、翌日までにして「翌日 02:00 まで」。そろえると終了 < 開始になる日付は断る（6.4）', async ({
    page,
  }) => {
    await openCalendar(page, '/week/2026-11-08', {
      data: itemsOf(mk({ id: 'n1', title: '夜の作業', start: '2026-11-11', startTime: '22:00' })),
    })
    await page.getByTestId('week-card-n1').locator('.wk-open').click()
    await page.getByTestId('item-end-time').click()
    // 終了の一覧は開始の1時間後（23:00）の所を見せて開く
    await expect(page.getByTestId('item-time-list-end').getByRole('option', { name: '23:00' })).toBeInViewport()
    await page.keyboard.type('2:00')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('item-time-hint')).toHaveText('翌日 02:00 まで')
    await expect(page.getByTestId('item-due')).toHaveText('11月12日（木）')
    expect(await savedItem(page, 'n1')).toMatchObject({ start: '2026-11-11', due: '2026-11-12', endTime: '02:00' })
    // 締め切り日を消すと 1日の 22:00〜02:00 になるので断り、元のまま
    await page.getByTestId('item-due-clear').click()
    await expect(page.getByTestId('item-date-error')).toHaveText(DATE_REFUSED)
    await expect(page.getByTestId('item-due')).toHaveText('11月12日（木）')
    expect((await savedItem(page, 'n1'))?.due).toBe('2026-11-12')
  })

  test('ロック中の予定も、詳細で日付を直せる（ITEMS-224・250・CALENDAR-148・183）', async ({ page }) => {
    await openCalendar(page, '/week/2026-11-08', {
      data: itemsOf(mk({ id: 'k1', title: '面談', start: '2026-11-12' })),
    })
    await page.getByTestId('week-card-k1').locator('.wk-open').click()
    await page.locator('label', { has: page.getByTestId('item-lock') }).click()
    await expect(page.getByTestId('item-lock')).toBeChecked()
    await pickDate(page, 'item-start', '2026-11-13')
    expect(await savedItem(page, 'k1')).toMatchObject({ locked: true, start: '2026-11-13' })
    await page.keyboard.press('Escape')
    await expect(sheetOf(page)).toHaveCount(0)
    await expect(page.getByTestId('week-card-k1')).toBeVisible()
  })

  test('［複製］→ 日を選んで［複製する］→「11/17（火）に複製しました［開く］」は小さな画面の上に出て、［開く］で新しい予定の詳細（FRAME-090・096）', async ({
    page,
  }) => {
    await openCalendar(page, '/week/2026-11-08', {
      data: itemsOf(mk({ id: 'd1', title: '研修', start: '2026-11-10', due: '2026-11-12', label: 'sky-l' })),
    })
    await page.getByTestId('week-start-d1').locator('.wk-open').click()
    await page.getByTestId('item-duplicate').click()
    await expect(page.getByTestId('dup-submit')).toBeDisabled()
    await pickDate(page, 'dup-start', '2026-11-17')
    await expect(page.getByTestId('dup-due')).toHaveText('11月19日（木）')
    await page.getByTestId('dup-submit').click()
    await expect(page.getByTestId('dup-dialog')).toHaveCount(0)
    const toast = page.locator('.toast', { hasText: '11/17（火）に複製しました' })
    await expect(toast).toBeVisible()
    // 詳細は開いたまま。お知らせは小さな画面の上（押せる）
    await expect(page.getByTestId('item-title')).toHaveValue('研修')
    await toast.getByRole('button', { name: '開く' }).click()
    await expect(page.getByTestId('item-start')).toHaveText('11月17日（火）')
    await expect(page.getByTestId('item-due')).toHaveText('11月19日（木）')
    await expect(sheetOf(page)).toHaveAttribute('data-label', 'sky-l')
  })

  test('カレンダーに出ている予定は確かめてから消し、ゴミ箱へ移して詳細を閉じる（ITEMS-262・263・267・268）', async ({ page }) => {
    await openCalendar(page, '/week/2026-11-08', { data: itemsOf(mk({ id: 'x1', title: '古い会議', listed: true })) })
    await page.getByTestId('week-card-x1').locator('.wk-open').click()
    await page.getByTestId('item-more').click()
    await page.getByTestId('item-delete').click()
    const confirm = page.getByRole('dialog', { name: '『古い会議』を削除しますか？' })
    await expect(confirm).toContainText(
      'ゴミ箱に移します。30日後に完全に削除されます（それまではゴミ箱から元に戻せます）。Task List からも消えます。',
    )
    await confirm.getByRole('button', { name: '削除' }).click()
    await expect(sheetOf(page)).toHaveCount(0)
    await expect(page.getByTestId('week-card-x1')).toHaveCount(0)
    expect(await savedItem(page, 'x1')).toBeNull()
    const trashed = await page.evaluate(() =>
      Object.values(window.__ds.getRaw().trashRecords).map((r) => (r.record as { id: string }).id),
    )
    expect(trashed).toContain('x1')
    await expect(page.locator('.toast')).toHaveCount(0)
  })

  test('Task List だけのタスクは確かめずに消し、「『件名』を削除しました［元に戻す］」で戻せる（ITEMS-266・FRAME-097）', async ({
    page,
  }) => {
    await openCalendar(page, '/week/2026-11-08', {
      data: itemsOf(mk({ id: 't1', title: '見積書を出す', origin: 'list', start: null, due: '2026-11-12', listed: true })),
    })
    await page.getByTestId('week-card-t1').locator('.wk-open').click()
    // 締め切り日を消すと Task List だけになる（詳細は開いたまま）
    await page.getByTestId('item-due-clear').click()
    await expect(page.getByTestId('item-status-line')).toHaveText('カレンダーには出ません（Task List だけ）')
    await expect(page.getByTestId('item-start-time')).toBeDisabled()
    await page.getByTestId('item-more').click()
    await page.getByTestId('item-delete').click()
    await expect(sheetOf(page)).toHaveCount(0)
    const toast = page.locator('.toast', { hasText: '『見積書を出す』を削除しました' })
    await expect(toast).toBeVisible()
    await expect.poll(() => rawItem(page, 't1')).toBeNull()
    await toast.getByRole('button', { name: '元に戻す' }).click()
    await expect.poll(() => rawItem(page, 't1').then((i) => i?.title)).toBe('見積書を出す')
  })

  test('知らない値（新しい版の区分・ラベル・項目）の予定を詳細で直しても、知らない値は消えない（6.12・形3・ITEMS-037・039）', async ({
    page,
  }) => {
    const odd = { ...mk({ id: 'u1', title: '新しい版の予定' }), kind: 'family', label: 'gold-x', future: { keep: true } }
    await openCalendar(page, '/week/2026-11-08', { data: itemsOf(odd as unknown as Item) })
    await page.getByTestId('week-card-u1').locator('.wk-open').click()
    await expect(page.getByTestId('item-kind-work')).toHaveAttribute('aria-pressed', 'true')
    await page.getByTestId('item-kind-work').click()
    const title = page.getByTestId('item-title')
    await title.fill('新しい版の予定（直した）')
    await title.press('Enter')
    await pickDate(page, 'item-start', '2026-11-12')
    const raw = (await savedItem(page, 'u1')) as unknown as Record<string, unknown>
    expect(raw).toMatchObject({ title: '新しい版の予定（直した）', start: '2026-11-12', kind: 'family', label: 'gold-x' })
    expect(raw.future).toEqual({ keep: true })
  })
})

test.describe('登録と詳細の動き（スマホ）', { tag: ['@s'] }, () => {
  test('書きかけの登録の画面で「戻る」を押すと「書きかけを捨てますか？」。［戻る］なら開いたまま、［捨てる］で閉じる（AMB-ITEMS-10）', async ({
    page,
  }) => {
    await openCalendar(page, '/month/2026-11')
    await expect(page.getByTestId('view-month')).toBeVisible()
    await page.getByTestId('cal-add').click()
    await page.getByTestId('item-title').fill('買い物')
    await page.goBack()
    const dialog = page.getByRole('dialog', { name: '書きかけを捨てますか？' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: '戻る' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByTestId('item-title')).toHaveValue('買い物')
    await page.goBack()
    await page.getByRole('dialog', { name: '書きかけを捨てますか？' }).getByRole('button', { name: '捨てる' }).click()
    await expect(sheetOf(page)).toHaveCount(0)
    await expect(page).toHaveURL(/#\/month\/2026-11$/)
    expect(await itemByTitle(page, '買い物')).toBeNull()
  })

  test('詳細は読み込み直しても開き直し、「戻る」で閉じる。日付は下からのシートで選ぶ（D03・D38）', async ({ page }) => {
    await openCalendar(page, '/week/2026-11-08', { data: itemsOf(mk({ id: 's1', title: '歯医者', kind: 'private' })) })
    await page.getByTestId('week-card-s1').locator('.wk-open').click()
    await expect(sheetOf(page)).toBeVisible()
    await page.reload()
    await expect(page.getByTestId('item-title')).toHaveValue('歯医者')
    await page.getByTestId('item-due').click()
    const picker = page.getByTestId('item-date-picker')
    await expect(picker.getByRole('heading')).toHaveText('締め切り日を選ぶ')
    await picker.locator('[data-date="2026-11-11"]').click()
    await expect(picker).toHaveCount(0)
    await expect(page.getByTestId('item-due')).toHaveText('11月11日（水）')
    await page.goBack()
    await expect(sheetOf(page)).toHaveCount(0)
    await noHorizontalScroll(page)
  })

  test('キーボードが出て見えている範囲が縮むと、シートを --kb で持ち上げ、打っている欄をキーボードの上 16px まで送る（FRAME-086・ITEMS-191）', async ({
    page,
  }) => {
    await openCalendar(page, '/month/2026-11')
    await page.getByTestId('cal-add').click()
    await settled(sheetOf(page))
    await page.getByTestId('item-memo').focus()
    await expect.poll(() => shrinkViewport(page, 320)).toBe('320px')
    const box = await page.locator('.modal-backdrop').boundingBox()
    const vh = await page.evaluate(() => window.innerHeight)
    expect(Math.round((box?.y ?? 0) + (box?.height ?? 0))).toBe(vh - 320)
    await expect
      .poll(() => page.getByTestId('item-memo').evaluate((e) => e.getBoundingClientRect().bottom))
      .toBeLessThanOrEqual(vh - 320 - 16 + 1)
  })
})

/** 画面キーボードが出た時と同じく、見えている範囲（visualViewport）の高さだけを縮めて知らせる。--kb の値を返す */
function shrinkViewport(page: Page, px: number): Promise<string> {
  return page.evaluate(async (by) => {
    const vv = window.visualViewport!
    const full = window.innerHeight
    Object.defineProperty(vv, 'height', { configurable: true, get: () => full - by })
    vv.dispatchEvent(new Event('resize'))
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    return getComputedStyle(document.documentElement).getPropertyValue('--kb').trim()
  }, px)
}
