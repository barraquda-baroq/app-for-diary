// 画面の並べ方の E2E（どのモードにもまたがる所。docs/SPEC.md の 3.2・3.4・4.11・4.12。FRAME-026・036・244・253・256・CALENDAR-226）:
// - 4つのモード（イヤー・マンスリー・ウィークリー・デイリー）と、登録・詳細・確かめの小さな画面が、幅 360・390・412・600・768・960・
//   1400 のどれでも横にスクロールしない（ページも、カレンダーの領域や小さな画面の中のスクロールする所も）
// - L は、予定を 60件入れた週・日でもページ全体がスクロールせず、カレンダーの下が切れない（カレンダーの領域の中だけ）
// - 指で操作する端末では、押せる所が 34px 以上（区切りの中の大きさが勝つ所は D08 の例外。下の SMALL_OK に1つずつ理由を書く）。
//   ::before で広げた所（日付の見出し・受けた表示の中の●・「＞」）と小さな月の名前は、隣の押せる物の押せる所を取らない
// - ディープダーク: 区分は位置とアイコン、休みは「休」の字、完了は斜線と✓、今日は太さ・輪でも分かる
// - Tab で日の見出し・カード・丸・●・数字のボタンへ動け、どれにも見える枠が出る（マンスリーのマス目は Tab で1つだけ止まる）
// 各モードの中身は各モードの担当の E2E（month・week・day・year・item の spec）で確かめる。データは作り物の
// e2e/fixtures/demoData.ts（今日は 2026年11月10日（火）9:00）
import { expect, test, type Locator, type Page } from '@playwright/test'
import { testIds } from '../src/features/calendar/common/testIds'
import type { Item } from '../src/domain/types'
import { DEMO_IDS as I, demoData } from './fixtures/demoData'
import { collectDiagnosticsOnFailure, openCalendar, openItemMore, sheetReady } from './helpers'

collectDiagnosticsOnFailure()

/** 4つのモードと、見本のデータの開く所 */
const MODES = [
  ['year', '/year/2026'],
  ['month', '/month/2026-11'],
  ['week', '/week/2026-11-08'],
  ['day', '/day/2026-11-10'],
] as const

/**
 * 行き先を移る（# だけを替える。同じページのまま積む）。行き先が替わり、そのモードの画面が出るまで待つ（同じモードの中で移る時も、
 * 前の期間の画面を測らないように）
 */
async function go(page: Page, mode: (typeof MODES)[number][0], path: string) {
  await page.evaluate((p) => {
    window.location.hash = p
  }, path)
  await expect.poll(() => page.evaluate(() => window.location.hash.slice(1))).toBe(path)
  await expect(page.getByTestId(testIds.view(mode))).toBeVisible()
}

/**
 * 横にスクロールする所（ページと、overflow-x が auto・scroll の物）のうち、中身が幅を超えている物。モードの中身がはみ出すと、
 * ページではなくカレンダーの領域（.cal-body は縦にスクロールするので横も auto）の中が横にスクロールするので、ページの幅だけでは
 * 見つからない
 */
const sideScrollers = (page: Page) =>
  page.evaluate(() => {
    const out: string[] = []
    const doc = document.documentElement
    if (doc.scrollWidth > window.innerWidth) out.push(`ページ ${doc.scrollWidth} > ${window.innerWidth}`)
    for (const e of document.body.querySelectorAll('*')) {
      const ox = getComputedStyle(e).overflowX
      if ((ox === 'auto' || ox === 'scroll') && e.scrollWidth > e.clientWidth + 1)
        out.push(
          `${e.tagName.toLowerCase()}.${String(e.className).trim().replace(/\s+/g, '.')} ${e.scrollWidth} > ${e.clientWidth}`,
        )
    }
    return out
  })

/** ページも、カレンダーの領域や小さな画面の中のスクロールする所も、横にはみ出していない（FRAME-026） */
async function noSideScroll(page: Page, label: string, sheet?: Locator) {
  expect(await sideScrollers(page), `${label}: 横にスクロールする所`).toEqual([])
  if (!sheet) return
  const m = await sheet.evaluate((e) => ({
    scroll: e.scrollWidth,
    client: e.clientWidth,
    right: e.getBoundingClientRect().right,
    width: window.innerWidth,
  }))
  expect(m.scroll, `${label}: 小さな画面の中の幅`).toBeLessThanOrEqual(m.client + 1)
  expect(m.right, `${label}: 小さな画面の右の端`).toBeLessThanOrEqual(m.width + 0.5)
}

/** 小さな画面を Esc で閉じる（開き終わってから。閉じ終わるまで待つ） */
async function closeSheet(page: Page) {
  await page.keyboard.press('Escape')
  await expect(page.getByTestId(testIds.itemSheet)).toHaveCount(0)
}

/**
 * 4つのモードと、登録・詳細（どの欄もいつも出ている）の小さな画面で、横にはみ出さない。confirm なら詳細の［削除］の確かめの小さな画面も
 * （開いて、［やめる］で戻る）
 */
async function sweep(page: Page, width: number, height: number, { confirm = false } = {}) {
  await page.setViewportSize({ width, height })
  for (const [mode, path] of MODES) {
    await go(page, mode, path)
    await noSideScroll(page, `${width}px ${mode}`)
  }
  // 登録の小さな画面（どの欄もいつも出ている。依頼者・メモ・ロック・ラベルの色の並び）
  await page.getByTestId(testIds.calAdd).click()
  let sheet = await sheetReady(page)
  await noSideScroll(page, `${width}px 登録`, sheet)
  await closeSheet(page)
  // 詳細の小さな画面（日付と時刻のある複数日の予定。いちばん欄の多い物）
  await page.getByTestId(testIds.dayEvent(I.materials)).locator('.dy-open').click()
  sheet = await sheetReady(page)
  await noSideScroll(page, `${width}px 詳細`, sheet)
  if (confirm) {
    await openItemMore(page)
    await page.getByTestId(testIds.itemDelete).click()
    const dialog = page.getByRole('dialog', { name: '『資料づくり』を削除しますか？' })
    await expect(dialog).toBeVisible()
    await noSideScroll(page, `${width}px 削除の確かめ`, dialog)
    await dialog.getByRole('button', { name: 'やめる' }).click()
    await expect(dialog).toHaveCount(0)
    await sheetReady(page)
  }
  await closeSheet(page)
}

test.describe('横にスクロールしない・ページがスクロールしない（PC）', { tag: ['@pc'] }, () => {
  test('960・1400px: 4つのモードと登録・詳細の小さな画面で横にはみ出さない。960px は始点のカードの件名を2行、1400px は印の多い始点のカードの期間を隠す（FRAME-026・開発）', async ({
    page,
  }) => {
    // 印が3つ（〆・ロック・Claude）の複数日の予定（Task List 生まれ。いつもの週の木〜土）
    const base = demoData()
    const marks: Item = {
      ...base.items![I.materials],
      id: 'e2e-layout-marks',
      title: '見積もりの確認と返送',
      origin: 'list',
      start: '2026-11-12',
      due: '2026-11-14',
      startTime: null,
      endTime: null,
      label: null,
      locked: true,
      listed: true,
      by: 'connector',
      ai: 'claude',
      via: 'メール: 見積もりについて',
    }
    await openCalendar(page, '/week/2026-11-08', {
      data: { ...base, items: { ...base.items, [marks.id]: marks } },
    })
    await sweep(page, 960, 900)
    // 960px（列 79px）: 始点のカードの件名は2行（WP7。checkpoint の約束の3）
    await go(page, 'week', '/week/2026-11-08')
    await expect(page.locator('.wk-card.is-start.is-two-lines').first()).toBeVisible()
    await expect(page.getByTestId(testIds.weekStart(I.materials))).toHaveClass(/is-two-lines/)
    await sweep(page, 1400, 900)
    // 1400px（列 142px）: 印が3つの始点のカードは、期間を隠して件名を1行目に（is-period-hidden。WP7 の (u)）
    await go(page, 'week', '/week/2026-11-08')
    await expect(page.getByTestId(testIds.weekStart(marks.id))).toHaveClass(/is-period-hidden/)
    await expect(page.getByTestId(testIds.weekStart(I.materials))).not.toHaveClass(/is-two-lines/)
  })

  test('L は予定を 60件入れた週・日でも、ページ全体はスクロールせず、カレンダーの領域の中だけがスクロールする（FRAME-036・037）', async ({
    page,
  }) => {
    await openCalendar(page, '/month/2026-11', { data: { items: crowdedWeek(), offDays: {}, labelNames: {} } })
    const toolbar = page.getByTestId(testIds.calendarToolbar)
    for (const [mode, path] of MODES) {
      await go(page, mode, path)
      // カレンダーの領域の上でホイールを回しても、ページは動かない。操作の列はいちばん上のまま（FRAME-037）
      const view = page.getByTestId(testIds.view(mode))
      const box = (await view.boundingBox())!
      const bar = (await toolbar.boundingBox())!
      expect(bar.y + bar.height, `${mode}: 操作の列はモードの画面の上`).toBeLessThanOrEqual(box.y + 1)
      await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height / 2, 300))
      await page.mouse.wheel(0, 1200)
      if (mode === 'week' || mode === 'day') {
        // 中の所は送られる（ホイールが届いている）
        await expect.poll(() => view.evaluate((root) => [...root.querySelectorAll('*')].some((e) => e.scrollTop > 0))).toBe(true)
      }
      const m = await page.evaluate(() => ({
        scrollH: document.documentElement.scrollHeight,
        innerH: window.innerHeight,
        y: window.scrollY,
      }))
      expect(m.scrollH, `${mode}: ページの高さ`).toBeLessThanOrEqual(m.innerH)
      expect(m.y, `${mode}: ページのスクロール`).toBe(0)
      expect((await toolbar.boundingBox())!.y, `${mode}: 操作の列は動かない`).toBe(bar.y)
      // カレンダーの領域とトップ画面は中身を隠す（overflow: hidden）ので、ページがスクロールしなくても、モードの画面が高すぎると
      // 下が切れて見えない。どちらも中身が収まっていて、カレンダーは窓の下の端から 16px 以上離れて終わる（3.4・確かめ A16。D15）
      const fit = await page.evaluate(() =>
        ['top-page', 'calendar-area', 'calendar'].map((tid) => {
          const e = document.querySelector(`[data-testid="${tid}"]`)!
          return { tid, over: e.scrollHeight - e.clientHeight, bottom: e.getBoundingClientRect().bottom }
        }),
      )
      for (const f of fit) expect(f.over, `${mode}: ${f.tid} の中身が収まる`).toBeLessThanOrEqual(1)
      expect(m.innerH - fit[2].bottom, `${mode}: カレンダーの下の余白`).toBeGreaterThanOrEqual(16)
    }
    // 中身は領域より高い（週の段・デイリーのリストが、それぞれの中でスクロールする）
    await go(page, 'week', '/week/2026-11-08')
    expect(await innerScrollers(page, 'week'), '週の中でスクロールする所').not.toEqual([])
    await go(page, 'day', '/day/2026-11-10')
    const day = await innerScrollers(page, 'day')
    expect(day, 'デイリーのリストの区切り').toContain('dy-area-body')
    expect(day, 'デイリーのタイムスケジュール').toContain('dy-tl-scroll')
  })
})

/** モードの画面の中で、縦にスクロールしている所（中身が高さを超え、overflow-y が auto・scroll の物）のクラス */
function innerScrollers(page: Page, mode: 'week' | 'day'): Promise<string[]> {
  return page.getByTestId(testIds.view(mode)).evaluate((root) =>
    [root, ...root.querySelectorAll('*')]
      .filter((e) => {
        const oy = getComputedStyle(e).overflowY
        return (oy === 'auto' || oy === 'scroll') && e.scrollHeight > e.clientHeight + 1
      })
      .map((e) => String(e.className)),
  )
}

/** 60件の週: 11/10 に 60件（仕事・プライベート、時刻の無い物とある物）、ほかの6日に 60件 */
function crowdedWeek(): Record<string, Item> {
  const base = demoData().items![I.mail]
  const items: Record<string, Item> = {}
  const add = (id: string, p: Partial<Item>) => {
    items[id] = { ...base, id, label: null, done: false, doneAt: null, doneOn: null, memo: '', ...p }
  }
  for (let i = 0; i < 60; i++) {
    const kind = i % 2 ? 'private' : 'work'
    const timed = i % 3 === 0
    const h = String(7 + (i % 14)).padStart(2, '0')
    add(`l60-day-${i}`, {
      kind,
      title: `${kind === 'work' ? '仕事' : '用事'}の予定 ${i + 1}`,
      start: '2026-11-10',
      startTime: timed ? `${h}:00` : null,
      endTime: timed ? `${h}:45` : null,
      order: 1000 + i,
    })
    const date = ['2026-11-08', '2026-11-09', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14'][i % 6]
    add(`l60-week-${i}`, {
      kind,
      title: `${kind === 'work' ? '作業' : '買い物'} ${i + 1}`,
      start: date,
      startTime: null,
      endTime: null,
      order: 2000 + i,
    })
  }
  return items
}

// ---------- 指で押せる所の大きさ（4.11・FRAME-244・CALENDAR-145・D08） ----------

/** 34px より小さくてよい所: その所の CSS のセレクターと、押せる所の測った最小（幅・高さ px。これより小さくなったら落とす） */
interface SmallOk {
  sel: string
  w: number
  h: number
  /** M（画面の幅 600px から）の最小（S と違う時。無ければ w・h） */
  wide?: { w: number; h: number }
}

/**
 * 指で操作する端末で、押せる所が 34px より小さくてよい所（D08・確かめ A9: 区切りの中の大きさが勝ち、隣と重ならない時だけ 34px に
 * 広げる）。どれも docs/SPEC.md の 4.11 の表の決めた例外（34px に届かないまま表に無い所は無い）。
 * 大きさは押せる所を測った値（ブラウザが押した点の要素を返す範囲。::before・::after で広げた所も入る）。字の高さで決まる所は、
 * iPhone（WebKit）の字の高さの差を見込んで、Chromium で測った値より 1px 低くしてある
 */
const SMALL_OK: readonly SmallOk[] = [
  // ウィークリーの1日のカードの丸: 32×28（カードの高さの中。7日を縦の重ねたカードも同じ）（WP7 第2波。D08）
  { sel: '.wk-card:not(.is-start) .wk-done', w: 30, h: 28 },
  // 始点のカードの丸: 32×36（WP7 第2波。D08）
  { sel: '.wk-card.is-start:not(.is-two-lines) .wk-done', w: 32, h: 34 },
  // 件名を2行にした始点のカードの丸: 28×20（狭い列。M の指の端末でも。WP7 第3波。D08）
  { sel: '.wk-card.is-start.is-two-lines .wk-done', w: 28, h: 20 },
  // 「＋」の行: 高さ 28px（列の幅いっぱい。WP7 第2波。D08）
  { sel: '.wk-add', w: 34, h: 28 },
  // 終点の●: 28×28（D08 の「終点の● 28px」）
  { sel: '.wk-lane > .wk-end', w: 28, h: 28 },
  // 7日を縦のレールの中の締め切り日の●: 18×28（隣の半分・カードに掛からない大きさ。WP7 第2波。D08）。左の端のレールは
  // 隣のレールの●と重なる所を除いて 14px ほど
  { sel: '.wk-end.is-rail', w: 14, h: 28 },
  // 受けた表示の中の、日曜に終わる●: 27×34（受けた表示の高さの中で 34px、右は受けた表示の枠の外の 4px まで。左は件名、右は次の日の
  // 列・隣の半分。week.css の .wk-recv > .wk-end::before。4.11）
  { sel: '.wk-recv > .wk-end', w: 27, h: 34 },
  // 土曜に始まって縮めた始点のカード（7.8）の横の「＞」: 18×34（左はカードの右の端、右は列の右の端。4.11）。線の端の「＞」は 34×34
  { sel: '.wk-lane > .wk-card.is-shrink ~ .wk-edge', w: 18, h: 34 },
  // 7日を縦の下向きの矢印: 18×20（レーンは 10px おきで、隣のレーンの矢印と重なる所は DOM で後ろの矢印が勝ち、左のレーンの矢印は
  // 5.75px ほど。右は「＋」の行、下は週の終わり、上は締め切り日のレールの●。4.11）。高さ 14 は第3波で測った最小（14.75px）
  { sel: '.wk-edge.is-down', w: 5, h: 14 },
  // Claude の印: 高さ 34px の目安（D26。WP7・WP8 の報告。カードの中の行の高さで 32.5px ほど）
  { sel: '.cp-ai', w: 34, h: 31 },
  // 休みのチェック: 34×34 の目安（WP7 第2波。見出しの行の高さで 32.75px ほど）
  { sel: 'label.wk-off', w: 34, h: 31 },
  // デイリーのタイムスケジュールの丸: 30 × 34（予定の枠が低い時は枠の高さ。件名の始まりに掛けない。WP8 第3波。D08・AMB-CAL-14）
  { sel: '.dy-ring', w: 30, h: 22 },
  // デイリーのタイムスケジュールの予定: 予定の高さ（30分の予定は 24px の枠の中。D08 の「24px の予定」）
  { sel: '.dy-ev-open', w: 34, h: 22 },
  // ラベルの「なし」: 高さ 28px（WP9。確かめ Q7）
  { sel: '.it-label-none', w: 34, h: 28 },
  // ラベルの色: S は 24px の丸、M は 28px（WP9。D35・確かめ Q7）
  { sel: '.it-swatch', w: 24, h: 24, wide: { w: 28, h: 28 } },
  // イヤーの小さな月のマス: 22px 四方以上（docs/SPEC.md の 8.3・CALENDAR-221）
  { sel: '.yr-cell.is-mini', w: 22, h: 22 },
]

/**
 * root の中の押せる物（ボタン・リンク・入力欄・チェックを包むラベル）のうち、全部が見えていて真ん中を押せる物の押せる所を測り、
 * 34px に届かない物（SMALL_OK の所は、その最小に届かない物）を返す。押せる所は、真ん中から上下左右へ、押した点の要素がその物
 * （か中の物）である間を 0.25px まで測る。届かなかった物は、スクロールする所の真ん中へ送ってからもう一度測る（貼り付いた見出しが
 * 下の端に掛かっていた、などの見え方のせいで小さく測らないように）
 */
async function smallTargets(page: Page, root: string): Promise<string[]> {
  return page.evaluate(
    ({ root, ok }) => {
      const scope = document.querySelector(root)
      if (!scope) return [`${root} が無い`]
      const sel =
        'button, a[href], input:not([type="hidden"]), select, textarea, label, [role="button"], [role="checkbox"], [role="switch"]'
      /** 要素が画面とスクロールする所の中に全部見えている（切れた所を測らないように） */
      const fullyVisible = (el: Element) => {
        const r = el.getBoundingClientRect()
        if (r.left < 0 || r.top < 0 || r.right > innerWidth || r.bottom > innerHeight) return false
        for (let a = el.parentElement; a; a = a.parentElement) {
          const cs = getComputedStyle(a)
          if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue
          const b = a.getBoundingClientRect()
          if (r.left < b.left - 0.5 || r.top < b.top - 0.5 || r.right > b.right + 0.5 || r.bottom > b.bottom + 0.5) return false
        }
        return true
      }
      /** 押せる所の幅と高さ（測れない時は null: 見えていない・真ん中が別の物の下） */
      const measure = (el: Element) => {
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.height === 0 || !fullyVisible(el)) return null
        const cx = r.left + r.width / 2
        const cy = r.top + r.height / 2
        const owns = (x: number, y: number) => {
          const n = document.elementFromPoint(x, y)
          return !!n && (n === el || el.contains(n))
        }
        if (!owns(cx, cy)) return null
        const reach = (dx: number, dy: number) => {
          let d = 0
          while (d < 40 && owns(cx + dx * (d + 1), cy + dy * (d + 1))) d += 1
          while (d < 41 && owns(cx + dx * (d + 0.25), cy + dy * (d + 0.25))) d += 0.25
          return d
        }
        return { w: reach(-1, 0) + reach(1, 0), h: reach(0, -1) + reach(0, 1) }
      }
      const minOf = (el: Element) => {
        const rule = ok.find((o) => el.matches(o.sel))
        if (!rule) return { w: 34, h: 34, note: '34×34' }
        const { w, h } = (innerWidth >= 600 && rule.wide) || rule
        return { w, h, note: `例外 ${rule.sel} は ${w}×${h}` }
      }
      const small = (el: Element, m: { w: number; h: number }) => {
        const min = minOf(el)
        return m.w < min.w - 0.5 || m.h < min.h - 0.5
      }
      const suspects: Element[] = []
      for (const el of scope.querySelectorAll(sel)) {
        if (el.tagName === 'INPUT' && el.closest('label')) continue
        if (el.tagName === 'LABEL' && !el.querySelector('input')) continue
        const m = measure(el)
        if (m && small(el, m)) suspects.push(el)
      }
      const out: string[] = []
      for (const el of suspects) {
        el.scrollIntoView({ block: 'center', inline: 'center' })
        const m = measure(el)
        if (!m || !small(el, m)) continue
        const name = el.getAttribute('data-testid') ?? el.getAttribute('aria-label') ?? (el.textContent ?? '').trim().slice(0, 16)
        out.push(
          `${m.w}×${m.h}（${minOf(el).note}）: ${el.tagName.toLowerCase()}.${String(el.className).trim().replace(/\s+/g, '.')} 「${name}」`,
        )
      }
      return [...new Set(out)]
    },
    { root, ok: SMALL_OK },
  )
}

/**
 * カレンダーの領域を、モードごと（週とデイリーは中をいちばん下まで送った所も）と、sheets なら登録・詳細の小さな画面でも測る
 */
async function tapSizes(
  page: Page,
  { modes = MODES, sheets = true }: { modes?: readonly (typeof MODES)[number][]; sheets?: boolean } = {},
) {
  const found: string[] = []
  const note = async (label: string, root: string) => {
    for (const s of await smallTargets(page, root)) found.push(`${label}: ${s}`)
  }
  for (const [mode, path] of modes) {
    await go(page, mode, path)
    await note(mode, '[data-testid="calendar"]')
    if (mode === 'week' || mode === 'day') {
      // 中でスクロールする所をいちばん下まで送って、下の方の物も測る
      await page.getByTestId(testIds.view(mode)).evaluate((root) => {
        for (const e of [root, ...root.querySelectorAll('*')]) {
          const oy = getComputedStyle(e).overflowY
          if ((oy === 'auto' || oy === 'scroll') && e.scrollHeight > e.clientHeight) e.scrollTop = e.scrollHeight
        }
      })
      await note(`${mode}（下まで送った所）`, '[data-testid="calendar"]')
    }
  }
  if (!sheets) return found
  /** 小さな画面の中をいちばん上・いちばん下にして測る（S・M のシートは欄が入り切らず、下の欄は中のスクロールで届く。12.2） */
  const noteSheet = async (label: string) => {
    const body = page.getByTestId(testIds.itemSheet).locator('.modal-body')
    await note(label, '[data-testid="item-sheet"]')
    if (await body.evaluate((e) => e.scrollHeight > e.clientHeight + 1)) {
      await body.evaluate((e) => (e.scrollTop = e.scrollHeight))
      await note(`${label}（下まで送った所）`, '[data-testid="item-sheet"]')
    }
  }
  await page.getByTestId(testIds.calAdd).click()
  await sheetReady(page)
  await noteSheet('登録')
  await closeSheet(page)
  await go(page, 'week', '/week/2026-11-08')
  await page.getByTestId(testIds.weekStart(I.materials)).locator('.wk-open').click()
  await sheetReady(page)
  await noteSheet('詳細')
  await closeSheet(page)
  return found
}

/**
 * 見本のデータの1日の予定のうち3つ（11/10 の定例ミーティング・メールの返信、11/11 の打ち合わせの候補日）を、ai が claude でない
 * Claude が足した物（「AI」の札。7.7）にする。見本のデータの札は「Claude」だけなので、細い「AI」の札の押せる所はこれで測る
 */
function withAiTags() {
  const data = demoData()
  for (const id of [I.weekly, I.mail, I.claude]) {
    data.items[id] = { ...data.items[id], by: 'connector', ai: null, via: 'メール: 確かめ' }
  }
  return data
}

/**
 * 「AI」の札の押せる所（ウィークリーのカード・デイリーの行と予定の枠）が D08 の大きさ（SMALL_OK の .cp-ai）。札は「Claude」より
 * 細く、札の左右に 6px 広げるだけでは 32px にしかならなかった（::after は札の枠の内側から測るので、22px の札は 20 + 12px）
 */
async function aiTagSizes(page: Page) {
  await openCalendar(page, '/month/2026-11', { data: withAiTags() })
  expect(await tapSizes(page, { modes: [MODES[2], MODES[3]], sheets: false })).toEqual([])
}

/**
 * ラベルの「なし」の押せる所が、字が細い書体でも SMALL_OK の 34×28 のまま（幅は字の幅で決まるので min-width: var(--tap)。4.11）。
 * 字を 5px にして左右の余白も詰め、字の幅だけでは 34px に届かないようにして、登録・詳細の小さな画面で測る
 */
async function narrowNoneSizes(page: Page) {
  await openCalendar(page, '/month/2026-11', { data: demoData() })
  await page.addStyleTag({ content: '.it-label-none { font-size: 5px; padding: 0 2px; }' })
  expect(await tapSizes(page, { modes: [] })).toEqual([])
}

/** 指の端末で押せる所を広げた所（::before。小さな月の名前は position: relative で下の曜日の頭文字の字の箱より上に重ねた。4.11） */
const GROWN = '.wk-day, .wk-recv > .wk-end, .wk-lane > .wk-edge, .yr-mini-name'
/** 広げる前に戻す（比べるため） */
const UNGROWN =
  '.wk-day::before, .wk-recv > .wk-end::before, .wk-lane > .wk-edge::before { display: none !important; } ' +
  '.wk-day, .yr-mini-name { position: static !important; }'

/**
 * 広げた押せる所が、隣の押せる物の押せる所を取っていないこと（4.11 の「隣の物と重ならない時だけ広げる」）。targets の物（セレクターと
 * 初めの何個か）の箱と ::before の箱を合わせた所（切れて見えない所は除く）を 1px ごとに調べ、広げた物が持ち主の点を、広げる前
 * （UNGROWN）の持ち主と比べる。前の持ち主は、押せる物の無かった点か、広げた物を中に置いた受けた表示の「押すと詳細」（同じ詳細を開く。
 * カードの中の丸と同じ）か、広げた物の箱の境の前後 1px（角丸の角と、ブラウザが押した所を画面の点の境に丸める分）であること。
 * 違う点を「前の持ち主 → 後の持ち主: 点の数」で返す
 */
async function stolenTaps(page: Page, label: string, targets: [string, number][]): Promise<string[]> {
  const out = await page.evaluate(
    ({ grown, ungrown, targets }) => {
      const sel =
        'button, a[href], input:not([type="hidden"]), select, textarea, label, [role="button"], [role="checkbox"], [role="switch"]'
      const owner = (x: number, y: number) => {
        const n = document.elementFromPoint(x, y)
        const c = n?.closest(sel) ?? null
        return c?.tagName === 'INPUT' && c.closest('label') ? c.closest('label') : c
      }
      const name = (c: Element | null) =>
        c
          ? `${c.tagName.toLowerCase()}.${String(c.className).trim().split(/\s+/)[0]}「${c.getAttribute('data-testid') ?? c.getAttribute('aria-label') ?? ''}」`
          : '（なし）'
      /** 箱と ::before の箱を合わせ、overflow で切る所（祖先）の中に収めた所（前後 1px 広く） */
      const region = (el: Element) => {
        const r = el.getBoundingClientRect()
        let [left, top, right, bottom] = [r.left, r.top, r.right, r.bottom]
        const ps = getComputedStyle(el, '::before')
        if (ps.content !== 'none' && ps.position === 'absolute') {
          const cs = getComputedStyle(el)
          const pl = r.left + parseFloat(cs.borderLeftWidth) + parseFloat(ps.left)
          const pt = r.top + parseFloat(cs.borderTopWidth) + parseFloat(ps.top)
          left = Math.min(left, pl)
          top = Math.min(top, pt)
          right = Math.max(right, pl + parseFloat(ps.width))
          bottom = Math.max(bottom, pt + parseFloat(ps.height))
        }
        for (let a = el.parentElement; a; a = a.parentElement) {
          const cs = getComputedStyle(a)
          if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue
          const b = a.getBoundingClientRect()
          left = Math.max(left, b.left)
          top = Math.max(top, b.top)
          right = Math.min(right, b.right)
          bottom = Math.min(bottom, b.bottom)
        }
        return { x0: Math.floor(left) - 1, y0: Math.floor(top) - 1, x1: Math.ceil(right) + 1, y1: Math.ceil(bottom) + 1 }
      }
      const bad = new Map<string, number>()
      const style = document.createElement('style')
      style.textContent = ungrown
      for (const el of targets.flatMap(([t, n]) => [...document.querySelectorAll(t)].slice(0, n))) {
        el.scrollIntoView({ block: 'center', inline: 'center' })
        const { x0, y0, x1, y1 } = region(el)
        const points: [number, number, Element][] = []
        for (let y = y0 + 0.5; y < y1; y++)
          for (let x = x0 + 0.5; x < x1; x++) {
            const b = owner(x, y)
            if (b?.matches(grown)) points.push([x, y, b])
          }
        document.head.append(style)
        const before = points.map(([x, y]) => owner(x, y))
        style.remove()
        points.forEach(([x, y, b], k) => {
          const a = before[k]
          if (!a || a === b) return
          const box = b.getBoundingClientRect()
          const d = Math.min(Math.abs(x - box.left), Math.abs(box.right - x), Math.abs(y - box.top), Math.abs(box.bottom - y))
          const near = x >= box.left - 1 && x <= box.right + 1 && y >= box.top - 1 && y <= box.bottom + 1 && d <= 1
          const card = b.parentElement?.matches('.wk-recv') && a === b.parentElement.querySelector(':scope > .wk-open')
          if (near || card) return
          const key = `${name(a)} → ${name(b)}`
          bad.set(key, (bad.get(key) ?? 0) + 1)
        })
      }
      return [...bad].map(([k, n]) => `${k}: ${n}点`)
    },
    { grown: GROWN, ungrown: UNGROWN, targets },
  )
  return out.map((s) => `${label}: ${s}`)
}

/**
 * いつもの週（受けた表示の中の日曜に終わる●、線の端と縮めた始点のカードの横の「＞」、S はレールの●の上の日付の見出し）とイヤーで、
 * 広げた押せる所が隣の押せる物の押せる所を取っていない。日付の見出しと小さな月の名前はどれも同じ並びなので、初めの3つ（日付の
 * 見出しは日曜・月曜と、字の幅の広い今日の 11/10）
 */
async function grownTapsKeepNeighbours(page: Page) {
  await openCalendar(page, '/week/2026-11-08', { data: demoData() })
  await expect(page.getByTestId(testIds.view('week'))).toBeVisible()
  const found = await stolenTaps(page, 'week', [
    ['.wk-day', 3],
    ['.wk-recv > .wk-end', 9],
    ['.wk-lane > .wk-edge', 9],
  ])
  await go(page, 'year', '/year/2026')
  found.push(...(await stolenTaps(page, 'year', [['.yr-mini-name', 3]])))
  expect(found).toEqual([])
}

test.describe('横にスクロールしない・押せる所の大きさ（S）', { tag: ['@s'] }, () => {
  for (const width of [360, 390, 412] as const) {
    test(`${width}px: 4つのモードと登録・詳細の小さな画面で横にはみ出さない${width === 360 ? '（削除の確かめも）' : ''}（FRAME-026・CALENDAR-226）`, async ({
      page,
    }) => {
      await openCalendar(page, '/month/2026-11', { data: demoData() })
      await sweep(page, width, 844, { confirm: width === 360 })
    })
  }

  test('指で押せる所は 34px 以上（D08 の例外は SMALL_OK の大きさ以上）。4つのモードと登録・詳細の小さな画面（FRAME-244・CALENDAR-145）', async ({
    page,
  }) => {
    await openCalendar(page, '/month/2026-11', { data: demoData() })
    expect(await tapSizes(page)).toEqual([])
  })

  test('「AI」の札（ai が claude でない物）も、指で押せる所は札の幅によらず D08 の大きさ（ウィークリー・デイリー）', async ({
    page,
  }) => {
    await aiTagSizes(page)
  })

  test('字が細い書体でも、ラベルの「なし」（別の行）の押せる所は 34px の幅のまま（登録・詳細の小さな画面。4.11）', async ({
    page,
  }) => {
    await narrowNoneSizes(page)
  })

  test('日付の見出し・受けた表示の●・「＞」・小さな月の名前で広げた押せる所は、隣の押せる物（休みのチェック・レールの●・カード）の押せる所を取らない（4.11）', async ({
    page,
  }) => {
    await grownTapsKeepNeighbours(page)
  })
})

test.describe('横にスクロールしない・押せる所の大きさ（M）', { tag: ['@m'] }, () => {
  test('600・768px: 4つのモードと登録・詳細の小さな画面で横にはみ出さない（600px は S と M の境。FRAME-026・計画の R5）', async ({
    page,
  }) => {
    await openCalendar(page, '/month/2026-11', { data: demoData() })
    await sweep(page, 600, 1024)
    await sweep(page, 768, 1024)
  })

  test('指で押せる所は 34px 以上（D08 の例外は SMALL_OK の大きさ以上）。4つのモードと登録・詳細の小さな画面（FRAME-244）', async ({
    page,
  }) => {
    await openCalendar(page, '/month/2026-11', { data: demoData() })
    expect(await tapSizes(page)).toEqual([])
  })

  test('字の幅が広い書体でも、点線の丸の押せる所は D08 の大きさのまま（AI の札の押せる所が丸に掛かっても丸が勝つ。CI の書体で 29.25px に縮んだ）', async ({
    page,
  }) => {
    await openCalendar(page, '/month/2026-11', { data: demoData() })
    // 端末の書体の違い（CI の Linux の書体では「Claude」の札が手元より 1px ほど広い）より大きく、札の字の幅を 6px 広げる。並べ方は
    // weekModel.ts の marksPx が札の幅のおおよそ（42px）で決めるので、札が見込みより広い書体と同じになる（768px の狭い列のカードでは、
    // 丸の行の右に置いた札の押せる所が丸の押せる所に掛かる）
    await page.addStyleTag({ content: '.cp-ai { letter-spacing: 1px; }' })
    expect(await tapSizes(page, { modes: [MODES[2], MODES[3]], sheets: false })).toEqual([])
  })

  test('「AI」の札（ai が claude でない物）も、指で押せる所は札の幅によらず D08 の大きさ（ウィークリー・デイリー）', async ({
    page,
  }) => {
    await aiTagSizes(page)
  })

  test('字が細い書体でも、ラベルの「なし」（色の並びの左）の押せる所は 34px の幅のまま（登録・詳細の小さな画面。4.11）', async ({
    page,
  }) => {
    await narrowNoneSizes(page)
  })

  test('日付の見出し・受けた表示の●・「＞」・小さな月の名前で広げた押せる所は、隣の押せる物（休みのチェック・レールの●・カード）の押せる所を取らない（4.11）', async ({
    page,
  }) => {
    await grownTapsKeepNeighbours(page)
  })
})

test.describe('押せる所の大きさ（iPhone）', { tag: ['@ios'] }, () => {
  test('指で押せる所は 34px 以上（D08 の例外は SMALL_OK の大きさ以上）。マンスリー・ウィークリー（FRAME-244）', async ({
    page,
  }) => {
    await openCalendar(page, '/month/2026-11', { data: demoData() })
    expect(await tapSizes(page, { modes: [MODES[1], MODES[2]], sheets: false })).toEqual([])
  })
})

// ---------- ディープダーク: 色に頼らない（4.12・FRAME-253） ----------

/** 要素の計算した style の値 */
const styleOf = (target: Locator, prop: string) => target.evaluate((e, p) => getComputedStyle(e).getPropertyValue(p), prop)

/** 画面の上の位置 */
async function boxOf(target: Locator) {
  const b = await target.boundingBox()
  if (!b) throw new Error('要素が見えていません')
  return b
}

/** 今日の印: 字（text）の太さ 600 以上と、輪（ring の box-shadow）がある（色に頼らない。7.3・D07） */
async function todayLook(ring: Locator, text: Locator, label: string) {
  expect(Number(await styleOf(text, 'font-weight')), `${label}: 太さ`).toBeGreaterThanOrEqual(600)
  expect(await styleOf(ring, 'box-shadow'), `${label}: 輪`).not.toBe('none')
}

/** 完了の✓: 丸の中に✓の線（svg の path）があり、完了していない物には無い */
const checkMarks = (target: Locator) => target.locator('svg path').count()

test.describe('ディープダーク（PC）', { tag: ['@pc'] }, () => {
  test('区分は位置（仕事が先）とアイコン、休みは「休」の字、完了は✓と斜線、今日は太さと輪で分かる（FRAME-253・4.12・7.9）', async ({
    page,
  }) => {
    // 見本のデータに、11/10 の済んだ時刻のある予定を1件足す（タイムスケジュールの完了の見え方。見本の 11/10 の済んだ物は時刻が無い）
    const base = demoData()
    const doneTimed: Item = {
      ...base.items![I.weekly],
      id: 'e2e-dd-done-timed',
      title: '済んだ面談',
      startTime: '15:00',
      endTime: '16:00',
      done: true,
      doneAt: Date.parse('2026-11-10T08:00:00+09:00'),
      doneOn: '2026-11-10',
    }
    await openCalendar(page, '/month/2026-11', {
      appearance: 'deep-dark',
      data: { ...base, items: { ...base.items, [doneTimed.id]: doneTimed } },
    })
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'deep-dark')

    // マンスリー: 仕事の数が左、休みの日に「休」、今日の日付は太さと輪
    const cell = page.getByTestId(testIds.monthCell('2026-11-10'))
    await expect(cell).toBeVisible()
    expect((await boxOf(page.getByTestId(testIds.monthCount('2026-11-10', 'work')))).x).toBeLessThan(
      (await boxOf(page.getByTestId(testIds.monthCount('2026-11-10', 'private')))).x,
    )
    await expect(page.getByTestId(testIds.monthCell('2026-11-11')).locator('.mo-off')).toBeVisible()
    await expect(page.getByTestId(testIds.monthCell('2026-11-11')).locator('.mo-off')).toContainText('休')
    await todayLook(cell.locator('.mo-date'), cell.locator('.mo-date'), 'マンスリーの今日')

    // ウィークリー: 仕事の段が上、段の名札に区分のアイコン（仕事と家で形が違う）、休みのチェックの「休」、今日の丸いラベル、完了の✓
    await go(page, 'week', '/week/2026-11-08')
    const work = page.locator('[data-tier="work"]')
    const priv = page.locator('[data-tier="private"]')
    expect((await boxOf(work)).y).toBeLessThan((await boxOf(priv)).y)
    const icons = await Promise.all([work, priv].map((t) => t.locator('.wk-tag svg').first().innerHTML()))
    expect(icons[0]).not.toBe(icons[1])
    await expect(page.getByTestId(testIds.weekHead('2026-11-11')).locator('.wk-off-text')).toHaveText('休')
    await expect(page.getByTestId(testIds.weekOff('2026-11-11'))).toBeChecked()
    const pill = page.getByTestId(testIds.weekHead('2026-11-10')).locator('.pill.is-today')
    await todayLook(pill, pill.locator('.caps'), 'ウィークリーの今日')
    const done = page.getByTestId(testIds.done(I.expenses))
    await expect(done).toHaveAttribute('data-done', 'true')
    expect(await checkMarks(done), '完了したカードの丸に✓').toBeGreaterThan(0)
    expect(await checkMarks(page.getByTestId(testIds.done(I.mail))), '完了していないカードの丸').toBe(0)

    // デイリー: 仕事の区切りが上、区切りのアイコン、タイムスケジュールの予定の区分のアイコン、完了の行は斜線と✓、今日の丸いラベル
    await go(page, 'day', '/day/2026-11-10')
    const areas = [page.getByTestId(testIds.dayArea('work')), page.getByTestId(testIds.dayArea('private'))]
    expect((await boxOf(areas[0])).y).toBeLessThan((await boxOf(areas[1])).y)
    const areaIcons = await Promise.all(areas.map((a) => a.locator('.dy-area-icon').innerHTML()))
    expect(areaIcons[0]).not.toBe(areaIcons[1])
    await expect(page.getByTestId(testIds.dayEvent(I.weekly)).locator('svg title')).toHaveText('仕事')
    await expect(page.getByTestId(testIds.dayEvent(I.dinner)).locator('svg title')).toHaveText('プライベート')
    const row = page.getByTestId(testIds.dayRow(I.expenses))
    expect(await styleOf(row.locator('.cp-title'), 'text-decoration-line')).toContain('line-through')
    expect(await checkMarks(row.getByTestId(testIds.done(I.expenses))), '完了した行の●に✓').toBeGreaterThan(0)
    expect(await styleOf(page.getByTestId(testIds.dayRow(I.mail)).locator('.cp-title'), 'text-decoration-line')).not.toContain(
      'line-through',
    )
    // タイムスケジュールの済んだ予定も斜線と丸の✓（7.9）。済んでいない予定には無い
    const doneEvent = page.getByTestId(testIds.dayEvent(doneTimed.id))
    expect(await styleOf(doneEvent.locator('.cp-title'), 'text-decoration-line')).toContain('line-through')
    expect(await checkMarks(doneEvent.getByTestId(testIds.done(doneTimed.id))), '済んだ予定の丸に✓').toBeGreaterThan(0)
    const openEvent = page.getByTestId(testIds.dayEvent(I.weekly))
    expect(await styleOf(openEvent.locator('.cp-title'), 'text-decoration-line')).not.toContain('line-through')
    expect(await checkMarks(openEvent.getByTestId(testIds.done(I.weekly))), '済んでいない予定の丸').toBe(0)
    const dayPill = page.getByTestId(testIds.dayHead).locator('.pill.is-today')
    await todayLook(dayPill, dayPill.locator('.caps'), 'デイリーの今日')

    // イヤー: 今日のマスは内側の輪と太さ 600（D07）
    await go(page, 'year', '/year/2026')
    const yearToday = page.getByTestId(testIds.yearCell('2026-11-10'))
    await todayLook(yearToday, yearToday.locator('.yr-date'), 'イヤーの今日')
  })
})

// ---------- キーボード: Tab で動ける・見える枠（4.12・FRAME-256） ----------

/** 今フォーカスのある物の種類（クラス）と、見える枠があるか（その物か ::after・::before、隠したチェックの欄はすぐ後ろの四角に 2px 以上の outline） */
const focused = (page: Page) =>
  page.evaluate(() => {
    const e = document.activeElement as HTMLElement | null
    if (!e || e === document.body) return { cls: 'body', ring: false, inView: false, tid: '' }
    const ringOf = (el: Element | null, pseudo?: string) => {
      if (!el) return false
      const cs = getComputedStyle(el, pseudo)
      return cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2
    }
    const ring =
      ringOf(e) ||
      ringOf(e, '::after') ||
      ringOf(e, '::before') ||
      (e instanceof HTMLInputElement && ringOf(e.nextElementSibling))
    return {
      cls: String(e.className),
      ring,
      inView: Boolean(e.closest('[data-testid^="view-"]')),
      tid: e.getAttribute('data-testid') ?? '',
    }
  })

/** start から Tab を n 回押し、モードの画面の中で止まった物の種類（clsOf で決める）を集める。どれにも見える枠がある */
async function tabThrough(page: Page, start: Locator, n: number, kinds: Record<string, string>) {
  await start.focus()
  const seen = new Set<string>()
  for (let i = 0; i < n; i++) {
    await page.keyboard.press('Tab')
    const f = await focused(page)
    if (!f.inView) continue
    expect(f.ring, `枠: ${f.cls} ${f.tid}`).toBe(true)
    for (const [name, cls] of Object.entries(kinds)) if (f.cls.split(/\s+/).includes(cls)) seen.add(name)
  }
  return [...seen].sort()
}

test.describe('キーボード（PC）', { tag: ['@pc'] }, () => {
  test('Tab で日の見出し・休みのチェック・カード・丸・●・「＋」・リストの行・タイムスケジュールの予定へ動け、どれにも見える枠が出る。マンスリーのマス目は1つだけ止まり、矢印で動いてから数字のボタン2つへ（FRAME-256・4.12）', async ({
    page,
  }) => {
    await openCalendar(page, '/week/2026-11-08', { data: demoData() })
    await expect(page.getByTestId(testIds.view('week'))).toBeVisible()
    const weekKinds = { head: 'wk-day', off: 'wk-off-input', card: 'wk-open', ring: 'cp-done', end: 'wk-end', add: 'wk-add' }
    expect(await tabThrough(page, page.getByTestId(testIds.calAdd), 40, weekKinds)).toEqual(Object.keys(weekKinds).sort())

    await go(page, 'day', '/day/2026-11-10')
    const dayKinds = { dot: 'dy-row-dot', row: 'dy-row-open', add: 'dy-add', event: 'dy-ev-open', ring: 'dy-ring' }
    expect(await tabThrough(page, page.getByTestId(testIds.calAdd), 30, dayKinds)).toEqual(Object.keys(dayKinds).sort())

    // マンスリー: Tab で見ている日（今日）のマス → 矢印で隣のマスへ → Tab でそのマスの数字2つ → Tab でマス目を出る
    await go(page, 'month', '/month/2026-11')
    await page.getByTestId(testIds.calTaskView).focus()
    await page.keyboard.press('Tab')
    const hit = (date: string) => page.getByTestId(testIds.monthCell(date)).locator('.mo-hit')
    await expect(hit('2026-11-10')).toBeFocused()
    expect((await focused(page)).ring).toBe(true)
    await page.keyboard.press('ArrowRight')
    await expect(hit('2026-11-11')).toBeFocused()
    for (const kind of ['work', 'private'] as const) {
      await page.keyboard.press('Tab')
      await expect(page.getByTestId(testIds.monthCount('2026-11-11', kind))).toBeFocused()
      expect((await focused(page)).ring, `数字のボタン（${kind}）の枠`).toBe(true)
    }
    await page.keyboard.press('Tab')
    expect((await focused(page)).inView, 'マス目を出る').toBe(false)
    // 戻ると、矢印で動いたマスの数字へ（マス目の中で Tab で止まるのは、いつも1つのマスだけ）
    await page.keyboard.press('Shift+Tab')
    await expect(page.getByTestId(testIds.monthCount('2026-11-11', 'private'))).toBeFocused()

    // イヤー: 月の帯と、見ている日のマス
    await go(page, 'year', '/year/2026')
    const yearKinds = { band: 'yr-band', cell: 'yr-cell' }
    expect(await tabThrough(page, page.getByTestId(testIds.calTaskView), 14, yearKinds)).toEqual(Object.keys(yearKinds).sort())
  })
})
