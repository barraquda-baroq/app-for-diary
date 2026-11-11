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
    await openCalendar(page, '/month/2026-11', { prefs: { detailsOpen: true } })
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
  test('予定の中身（件名は書き換えられる欄・区分の地・ラベルの帯と呼び名・詳しく・下の行）を出し、［×］で閉じる', async ({
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
    // ラベルが入っているので「詳しく」は開いて出し、付けた呼び名を出す（D11・ITEMS-021）
    await expect(page.getByTestId('item-details')).toHaveAttribute('aria-expanded', 'true')
    await expect(sheet.locator('.it-label-name')).toHaveText('社内')
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

  test('「詳しく」を閉じた詳細でも、Tab は画面の中を回る（畳んだ欄を飛ばし、最後の「詳しく」の次は［×］へ）', async ({
    page,
  }) => {
    await openCalendar(page, '/week/2026-11-08', { data: demoData() })
    // メールの返信: 詳しくの中が空で Claude の行も無い（下の行に押せる物が無い）
    await openDetailByHistory(page, DEMO_IDS.mail)
    const details = page.getByTestId('item-details')
    await expect(details).toHaveAttribute('aria-expanded', 'false')
    await details.focus()
    await page.keyboard.press('Tab')
    await expect(page.getByTestId('modal-close')).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await expect(details).toBeFocused()
    // 開いて閉じた後も同じ（畳む動きが終わってから畳んだ欄を外す）
    await details.click()
    await details.click()
    const memo = page.getByTestId('item-memo')
    await expect.poll(() => memo.evaluate((e) => (e as HTMLElement).offsetParent === null)).toBe(true)
    await details.focus()
    await page.keyboard.press('Tab')
    await expect(page.getByTestId('modal-close')).toBeFocused()
  })
})

test.describe('登録の画面（スマホ）', { tag: ['@s'] }, () => {
  test('下からのシート（最大 92dvh・上の角丸 16px）。件名の欄は 16px、横にはみ出さず、「戻る」で閉じる', async ({ page }) => {
    await openCalendar(page, '/month/2026-11', { prefs: { detailsOpen: true } })
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
    await noHorizontalScroll(page)
    await page.goBack()
    await expect(sheet).toHaveCount(0)
  })
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
      prefs: { detailsOpen: true },
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
    await openCalendar(page, '/month/2026-11', { prefs: { detailsOpen: true } })
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
