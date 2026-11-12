// 段階2の見本の画面を撮る（docs/SPEC.md の 21.・22.。作者に色と見た目を決めてもらう）。ふつうの E2E・CI では流さない:
//   E2E_SAMPLES=1 npx playwright test --project=samples   （npm run samples。開発サーバーとテスト用のログインと作り物のデータだけを使う）
// 撮る物は e2e/samples/shots.ts、色の案は e2e/samples/variants.json（node scripts/sample-variants.mjs が作る）。
// 絵は e2e/artifacts/samples/（リポジトリに入れない）に JPEG（品質 85）で書き、見本のページを作るための控え（parts/*.json。order は
// SHOTS・CROPS の中の順で、見本のページはこの順に並べる）も残す。
// 画面の中身（マンスリー・ウィークリー・デイリー・登録と詳細）ができる前は、開けない行き先・仮の画面のままの撮る物を飛ばす
// （できた後は、探す所が1つでも見つからなければ落ちる）。見本のデータを置けることと、案の CSS が効くことは、中身が無くても確かめる
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { openCalendar } from '../helpers'
import { demoData } from '../fixtures/demoData'
import { testIds } from '../../src/features/calendar/common/testIds'
import {
  APPEARANCE_NAMES,
  APPEARANCES,
  CROPS,
  SHOTS,
  VIEWPORTS,
  cropName,
  editableTitle,
  shotName,
  shotOf,
  type Appearance,
  type Box,
  type Crop,
  type Shot,
  type Size,
} from './shots'

const OUT = 'e2e/artifacts/samples'
const PARTS = `${OUT}/parts`

/** e2e/samples/variants.json の中身（使う所だけ） */
interface Variants {
  questions: Record<
    string,
    {
      title: string
      appearances: Appearance[]
      reference?: Appearance[]
      options: { letter: string; id: string; label: string }[]
    }
  >
  options: Record<string, { css: string; appearances: Appearance[]; tokens: Partial<Record<Appearance, Record<string, string>>> }>
}
const variants = JSON.parse(readFileSync('e2e/samples/variants.json', 'utf8')) as Variants

/** 見本のページ（scripts/sample-sheet.mjs）が読む控え（1枚に1つ） */
function record(name: string, entry: Record<string, unknown>): void {
  mkdirSync(PARTS, { recursive: true })
  writeFileSync(`${PARTS}/${name}.json`, `${JSON.stringify({ file: `${name}.jpg`, ...entry }, null, 2)}\n`)
}

/** まだ撮れない（行き先が無い・中身が仮の画面のまま）か */
async function notBuiltYet(page: Page): Promise<boolean> {
  if (await page.getByText('ページが見つかりません').count()) return true
  if (await page.getByTestId('calendar-placeholder').count()) return true
  // 仮の詳細の画面（件名を字で出すだけで、欄が無い。中身は WP9）
  if ((await page.getByTestId(testIds.itemTitle).count()) > (await editableTitle(page).count())) return true
  return (await page.getByText(/段階2で(作ります|出します)/).count()) > 0
}

/** 見本の状態で開く（作り物のデータ・決めた時刻・外観・「詳しく」を開いた設定）。まだ撮れない物は飛ばす */
async function openShot(page: Page, shot: Shot, appearance: Appearance): Promise<void> {
  try {
    await openCalendar(page, shot.hash, { appearance, prefs: { detailsOpen: true }, data: demoData() })
  } catch (e) {
    test.skip(await notBuiltYet(page), `${shot.hash} はまだ開けません（画面の枠ができてから撮る）`)
    throw e
  }
  const ready = shot.ready(page)
  if (!(await ready.isVisible().catch(() => false))) {
    await ready.waitFor({ timeout: 5_000 }).catch(() => undefined)
    if (!(await ready.isVisible())) test.skip(await notBuiltYet(page), `${shot.title} はまだ仮の画面です`)
  }
  await expect(ready).toBeVisible()
  if (shot.prepare) {
    try {
      await shot.prepare(page)
    } catch (e) {
      // 登録・詳細の画面がまだ仮の物（押す所が無い）
      test.skip(await notBuiltYet(page), `${shot.title} の操作がまだできません（中身が仮の画面）`)
      throw e
    }
  }
  test.skip(await notBuiltYet(page), `${shot.title} はまだ仮の画面です`)
  await settle(page)
}

/** 書体を読み終え、描き終わるまで待つ */
async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  })
}

async function snap(page: Page, name: string, clip?: Box): Promise<void> {
  await page.screenshot({ path: `${OUT}/${name}.jpg`, type: 'jpeg', quality: 85, animations: 'disabled', caret: 'hide', clip })
}

/** 撮る物を幅ごとに分ける（S は指の端末として開く） */
function bySize(size: Size): void {
  test.use({
    viewport: VIEWPORTS[size],
    deviceScaleFactor: 2,
    reducedMotion: 'reduce',
    ...(size === 'S' ? { isMobile: true, hasTouch: true } : {}),
  })
}

// 画面の中身が無くても確かめられる所: 見本のデータを置けること。案の CSS を差し込むと、その外観の変数（と件名のハイライトの形）が
// その値になり、外すと戻ること
test('見本のデータを置くと、直す所無くそのまま画面のデータになる', async ({ page }) => {
  const data = demoData()
  await openCalendar(page, '/', { data })
  const [shown, raw] = await page.evaluate(() => [window.__ds.getData(), window.__ds.getRaw()])
  expect(shown.items).toEqual(data.items)
  expect(shown.offDays).toEqual(data.offDays)
  expect(shown.labelNames).toEqual(data.labelNames)
  expect(raw.items).toEqual(data.items)
})

test('仮の詳細の画面（件名を字で出すだけ）は、まだ撮れない物として飛ばし、欄のある画面は撮る', async ({ page }) => {
  // 見分け方だけを確かめるので、アプリを開かずに、その形の要素だけのページで
  const sheet = (inner: string) => `<div data-testid="${testIds.itemSheet}">${inner}</div>`
  await page.setContent(sheet(`<p data-testid="${testIds.itemTitle}">資料づくり</p>`))
  expect(await notBuiltYet(page)).toBe(true)
  await page.setContent(sheet(`<input data-testid="${testIds.itemTitle}" value="資料づくり">`))
  expect(await notBuiltYet(page)).toBe(false)
  await expect(editableTitle(page)).toHaveCount(1)
  await page.setContent(sheet(`<textarea data-testid="${testIds.itemTitle}">資料づくり</textarea>`))
  expect(await notBuiltYet(page)).toBe(false)
})

test.describe('案の CSS が効く', () => {
  for (const appearance of APPEARANCES) {
    test(`${APPEARANCE_NAMES[appearance]}: 案の値がその外観の変数に入り、外すと今の値に戻る`, async ({ page }) => {
      await openCalendar(page, '/', { appearance })
      const read = (names: string[]) =>
        page.evaluate((ns) => {
          const cs = getComputedStyle(document.documentElement)
          return ns.map((n) => cs.getPropertyValue(n).trim())
        }, names)
      for (const [id, option] of Object.entries(variants.options)) {
        const tokens = option.tokens[appearance] ?? {}
        const names = Object.keys(tokens)
        const before = await read(names)
        const tag = await page.addStyleTag({ content: option.css })
        expect(await read(names), id).toEqual(Object.values(tokens))
        await tag.evaluate((e) => (e as Element).remove())
        expect(await read(names), id).toEqual(before)
      }
      // 件名のハイライトの形（Q4 B）: 字の高さいっぱい（下 6割の 40% の境が無い）。作者の答え（2026-11-12）で B に決まり、今の値も
      // この形になったので、案の CSS を差し込んでも形は変わらない
      const marker = () =>
        page.evaluate(() => {
          const host = document.createElement('div')
          host.setAttribute('data-kind', 'work')
          const span = document.createElement('span')
          span.className = 'kind-marker'
          span.textContent = '見本'
          host.appendChild(span)
          document.body.appendChild(host)
          const bg = getComputedStyle(span).backgroundImage
          host.remove()
          return bg
        })
      expect(await marker()).not.toContain('40%')
      const tag = await page.addStyleTag({ content: variants.options['highlight-full'].css })
      expect(await marker()).not.toContain('40%')
      await tag.evaluate((e) => (e as Element).remove())
    })
  }
})

for (const size of ['L', 'S'] as const) {
  test.describe(`見本の画面 ${size}`, () => {
    bySize(size)

    // 操作（押す・待つ）は 10秒で諦める（まだ仮の画面の時に、押す所を待ち続けないように）
    test.beforeEach(({ page }) => page.setDefaultTimeout(10_000))

    for (const shot of SHOTS.filter((s) => s.size === size)) {
      for (const appearance of APPEARANCES) {
        const name = shotName(shot, appearance)
        test(`${name}（${shot.title}・${APPEARANCE_NAMES[appearance]}）`, async ({ page }) => {
          await openShot(page, shot, appearance)
          await snap(page, name)
          record(name, {
            kind: 'shot',
            order: SHOTS.indexOf(shot),
            id: shot.id,
            size,
            part: shot.part ?? null,
            title: shot.title,
            appearance,
          })
        })
      }
    }

    // 問いごとの切り抜き: 同じ状態のまま、案の CSS を差し替えて A・B・C を撮る（今の値の案は差し込まない）
    for (const crop of CROPS.filter((c) => c.shot.size === size)) {
      const q = variants.questions[String(crop.question)]
      for (const appearance of [...q.appearances, ...(q.reference ?? [])]) {
        const reference = !q.appearances.includes(appearance)
        test(`q${crop.question}-${crop.id}-${appearance}（${q.title}・${crop.title}・${APPEARANCE_NAMES[appearance]}）`, async ({
          page,
        }) => {
          await openShot(page, shotOf(crop), appearance)
          // 見比べの外観（Q5 のダーク）は今の値だけ
          const letters = reference ? q.options.filter((o) => o.id === 'now') : q.options
          for (const option of letters) await shootOption(page, crop, option, appearance, reference)
        })
      }
    }
  })
}

async function shootOption(
  page: Page,
  crop: Crop,
  option: { letter: string; id: string; label: string },
  appearance: Appearance,
  reference: boolean,
): Promise<void> {
  const css = option.id === 'now' ? null : variants.options[option.id]?.css
  if (option.id !== 'now' && !css) throw new Error(`案 ${option.id} が e2e/samples/variants.json にありません`)
  const tag = css ? await page.addStyleTag({ content: css }) : null
  await settle(page)
  const name = cropName(crop, option.letter, appearance)
  await snap(page, name, await crop.area(page))
  record(name, {
    kind: 'crop',
    order: CROPS.indexOf(crop),
    question: crop.question,
    id: crop.id,
    title: crop.title,
    letter: option.letter,
    option: option.id,
    label: option.label,
    appearance,
    reference,
  })
  await tag?.evaluate((e) => (e as Element).remove())
}
