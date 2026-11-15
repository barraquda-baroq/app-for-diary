// 段階3の Routine List の E2E（docs/SPEC.md の 14.・3.6・6.4・21. の段階3の終わりの決まり 2.「ルーチンが時計を進めると戻る」）:
// - 時計（page.clock.install）を 2026-11-10（火）23:58 にして、毎日の「ストレッチ」と毎週（月・木）の「ゴミ出し」をチェックする。
//   0時を過ぎると毎日の物は戻り、毎週の物は木曜 11/12 の 0時まで済みのまま。裏にあってタイマーが遅れた時（時計だけを進めて
//   visibilitychange）も戻る。どの 0時でもチェックの記録は書き換えない（端末の raw の routineChecks が同じ）
//   時計を偽物にしている間は押す（タップ・クリック）だけにする（長押しの道具は偽物の時計では待てない）
// - PC: 2段の入力欄の［指定］で毎週の月・木を選んで足す、選んだ種類は読み込み直しても覚えている、済んだ行に乗せると戻る日、
//   ［詳しく］で種類を替える、削除と［元に戻す］（チェックの記録も戻る）
// - スマホ: ［詳しく］は下からのシート、360px で横にはみ出さず、入力欄の上の段の押せる所は 34px 以上
// データは作り物（e2e/fixtures/listData.ts）
import { expect, test, type Locator, type Page } from '@playwright/test'
import { listTestIds } from '../src/features/lists/common/testIds'
import { routinePanelTestIds } from '../src/features/lists/routine/routineTestIds'
import { LIST_IDS } from './fixtures/listData'
import { noHorizontalScroll, tapSize } from './helpers'
import { listInput, openLists, openRowMenu, openStackedList } from './listHelpers'

const I = LIST_IDS

const row = (page: Page, id: string) => page.getByTestId(listTestIds.row('routine', id))
const check = (page: Page, id: string) => page.getByTestId(listTestIds.rowCheck('routine', id))
const group = (page: Page, cycle: string) => page.getByTestId(listTestIds.routineGroup(cycle as never))
const groupCount = (page: Page, cycle: string) => group(page, cycle).locator('.rt-group-count [aria-hidden="true"]')

/** 端末の raw のチェックの記録（保留中の変更を保存してから読む） */
async function rawChecks(page: Page): Promise<unknown> {
  return page.evaluate(async () => {
    await window.__ds.flushNow()
    return window.__ds.getRaw().routineChecks
  })
}

/** 指の端末はタップ、PC はクリック */
async function press(target: Locator, touch: boolean): Promise<void> {
  if (touch) await target.tap()
  else await target.click()
}

test.describe(
  'S3 Routine List は時計を進めると戻る（14.3・6.4・21.。S3-ROUTINE-064〜068・071・072・S3-FRAME-268）',
  { tag: ['@pc', '@s'] },
  () => {
    test('0時を過ぎると毎日の物が戻り、毎週（月・木）の物は木曜の 0時に戻る。タイマーが遅れても画面が見えると戻る。記録は書き換えない', async ({
      page,
      hasTouch,
    }) => {
      await page.clock.install({ time: new Date('2026-11-10T23:58:00+09:00') })
      await openLists(page, '/week/2026-11-08', { now: false })
      if (hasTouch) await openStackedList(page, 'routine')
      await expect(groupCount(page, 'daily')).toHaveText('1/2')

      // 23:58 にチェック（その日の 11/10 を記録する）
      await press(check(page, I.stretch), hasTouch)
      await press(check(page, I.garbage), hasTouch)
      await expect(groupCount(page, 'daily')).toHaveText('2/2')
      await expect(groupCount(page, 'weekly')).toHaveText('1/2')
      const checked = await rawChecks(page)
      expect(JSON.stringify(checked)).toContain(`"routineId":"${I.stretch}"`)

      // 0時を過ぎる（11/11 水曜）: 毎日の2つは戻り、毎週の月・木の物は済みのまま。記録は書き換えない
      await page.clock.runFor('03:00')
      await expect(groupCount(page, 'daily')).toHaveText('0/2')
      await expect(row(page, I.stretch)).not.toHaveAttribute('data-done', 'true')
      await expect(row(page, I.waterPlants)).toBeVisible()
      await expect(groupCount(page, 'weekly')).toHaveText('1/2')
      expect(await rawChecks(page)).toEqual(checked)

      // 木曜 11/12 の 0時を過ぎる: 毎週の月・木の物も戻る
      await page.clock.fastForward('24:00:00')
      await expect(groupCount(page, 'weekly')).toHaveText('0/2')
      await expect(row(page, I.garbage)).toBeVisible()
      expect(await rawChecks(page)).toEqual(checked)

      // 木曜にもう一度チェックし、裏にある間に次の 0時を過ぎた（タイマーは来ていない）。画面が見えるようになると戻る
      await press(check(page, I.stretch), hasTouch)
      await expect(groupCount(page, 'daily')).toHaveText('1/2')
      const thursday = await rawChecks(page)
      await page.clock.setSystemTime(new Date('2026-11-13T00:00:05+09:00'))
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
      await expect(groupCount(page, 'daily')).toHaveText('0/2')
      await expect(row(page, I.stretch)).toBeVisible()
      expect(await rawChecks(page)).toEqual(thursday)
      // 知らせない
      await expect(page.locator('.toast')).toHaveCount(0)
    })
  },
)

test.describe('S3 Routine List（PC。14.2・6.13・6.15）', { tag: ['@pc'] }, () => {
  test('［週］と［指定］で月・木を選んで Enter で足す（毎週のいちばん下・右に「月・木」）。指定は戻り、選んだ種類は読み込み直しても覚えている', async ({
    page,
  }) => {
    await openLists(page, '/week/2026-11-08')
    await page.getByTestId(listTestIds.routineCycle('weekly')).click()
    const spec = page.getByTestId(listTestIds.routineSpecButton)
    await expect(spec).toHaveText('指定')
    await spec.click()
    const picker = page.getByTestId(listTestIds.routineSpecPicker)
    await picker.getByRole('button', { name: '月曜日' }).click()
    await picker.getByRole('button', { name: '木曜日' }).click()
    await picker.getByRole('button', { name: '閉じる' }).click()
    await expect(picker).toHaveCount(0)
    await expect(spec).toHaveText('月・木')
    await listInput(page, 'routine').fill('資源ごみ')
    await listInput(page, 'routine').press('Enter')
    const titles = group(page, 'weekly').locator('[data-testid^="list-routine-title-"]')
    await expect(titles).toHaveText(['ゴミ出し', '週の振り返り', '資源ごみ'])
    const added = group(page, 'weekly').locator('.list-row').last()
    await expect(added.locator('.rt-spec')).toHaveText('月・木')
    await expect(listInput(page, 'routine')).toHaveValue('')
    await expect(listInput(page, 'routine')).toBeFocused()
    await expect(spec).toHaveText('指定')

    await page.reload()
    await expect(page.getByTestId('top-page')).toBeVisible()
    await expect(page.getByTestId(listTestIds.routineCycle('weekly'))).toHaveAttribute('aria-pressed', 'true')
  })

  test('済んだ行に乗せると、指定の所に「11/11（水）に戻ります」（次の戻る日）', async ({ page }) => {
    await openLists(page, '/week/2026-11-08')
    await page.getByTestId(listTestIds.routineDone('daily')).getByRole('button').click()
    const ret = page.getByTestId(listTestIds.routineReturn(I.waterPlants))
    await expect(ret).toBeHidden()
    await row(page, I.waterPlants).hover()
    await expect(ret).toBeVisible()
    await expect(ret).toHaveText('11/11（水）に戻ります')
  })

  test('［詳しく］で種類を替えると新しい種類のいちばん下へ。削除して［元に戻す］でチェックの記録ごと戻る', async ({ page }) => {
    await openLists(page, '/week/2026-11-08')
    await page.getByTestId(listTestIds.routineDone('daily')).getByRole('button').click()
    // 植物に水をやる（毎日・今日チェック済み）を毎月へ
    const menu = await openRowMenu(page, 'routine', I.waterPlants)
    await menu.getByRole('menuitem', { name: '詳しく' }).click()
    const panel = page.getByTestId(listTestIds.routinePanel)
    await expect(panel).toBeVisible()
    await panel.getByTestId(routinePanelTestIds.cycle('monthly')).click()
    await expect(panel.getByTestId(routinePanelTestIds.returnLine)).toHaveText('12/1（火）に戻ります')
    await page.keyboard.press('Escape')
    await expect(panel).toHaveCount(0)
    await expect(groupCount(page, 'monthly')).toHaveText('1/2')
    await expect(groupCount(page, 'daily')).toHaveText('0/1')

    // 削除（確かめない）と［元に戻す］
    await page.getByTestId(listTestIds.routineDone('monthly')).getByRole('button').click()
    const del = await openRowMenu(page, 'routine', I.waterPlants)
    await del.getByRole('menuitem', { name: '削除' }).click()
    await expect(row(page, I.waterPlants)).toHaveCount(0)
    const toast = page.locator('.toast').filter({ hasText: '『植物に水をやる』を削除しました' })
    await expect(toast).toBeVisible()
    await toast.getByRole('button', { name: '元に戻す' }).click()
    await expect(row(page, I.waterPlants)).toBeVisible()
    await expect(row(page, I.waterPlants)).toHaveAttribute('data-done', 'true')
    await expect(groupCount(page, 'monthly')).toHaveText('1/2')
  })

  test('件名を押すとその場で直し、Enter で保存する', async ({ page }) => {
    await openLists(page, '/week/2026-11-08')
    await page.getByTestId(listTestIds.rowTitle('routine', I.stretch)).click()
    const edit = page.getByTestId(listTestIds.rowEdit('routine', I.stretch))
    await expect(edit).toBeFocused()
    await edit.fill('夜のストレッチ')
    await edit.press('Enter')
    await expect(page.getByTestId(listTestIds.rowTitle('routine', I.stretch))).toHaveText('夜のストレッチ')
  })
})

test.describe('S3 Routine List（スマホ。14.2・3.8・4.11）', { tag: ['@s'] }, () => {
  test('［詳しく］は下からのシート（毎週の曜日を選んである）。［×］で閉じる', async ({ page }) => {
    await openLists(page, '/week/2026-11-08')
    await openStackedList(page, 'routine')
    const menu = await openRowMenu(page, 'routine', I.garbage)
    await menu.getByRole('menuitem', { name: '詳しく' }).tap()
    const panel = page.getByTestId(listTestIds.routinePanel)
    await expect(panel).toBeVisible()
    const box = await panel.boundingBox()
    const height = page.viewportSize()?.height ?? 0
    expect(Math.round((box?.y ?? 0) + (box?.height ?? 0))).toBeGreaterThanOrEqual(height - 1)
    await expect(panel.getByRole('button', { name: '月曜日' })).toHaveAttribute('aria-pressed', 'true')
    await panel.getByTestId('modal-close').tap()
    await expect(panel).toHaveCount(0)
  })

  test('360px: Routine List を開いても横にはみ出さない。入力欄の上の段の押せる所は 34px 以上', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 })
    await openLists(page, '/week/2026-11-08')
    await openStackedList(page, 'routine')
    await page.getByTestId(listTestIds.routineCycle('weekly')).tap()
    const spec = page.getByTestId(listTestIds.routineSpecButton)
    await spec.tap()
    for (const d of ['日曜日', '月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日']) {
      await page.getByTestId(listTestIds.routineSpecPicker).getByRole('button', { name: d }).tap()
    }
    await page.getByTestId(listTestIds.routineSpecPicker).getByRole('button', { name: '閉じる' }).tap()
    await expect(spec).toHaveText('日・月・火・水・木・金・土')
    await noHorizontalScroll(page)
    const box = await spec.boundingBox()
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(360)
    for (const c of ['daily', 'weekly', 'monthly', 'quarterly', 'yearly'] as const) {
      await tapSize(page.getByTestId(listTestIds.routineCycle(c)), c)
    }
    await tapSize(spec, '指定')
    await tapSize(page.getByTestId(listTestIds.routineGroupAdd('quarterly')), '＋')
    await tapSize(page.getByTestId(listTestIds.routineGroupFold('daily')), '山形')
  })
})
