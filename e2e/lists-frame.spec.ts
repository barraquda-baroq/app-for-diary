// 段階3の3つのリストの枠の E2E（docs/SPEC.md の 3.5・3.6・6.13・21. の段階3の終わりの決まり 3.）: S・M では3つのリストがアプリを開く
// たびに畳んで始まり（読み込み直しても）、開いた状態は端末に覚えない。L の右の列の畳んだ状態は端末に覚える。幅を替えて行き来しても、
// それぞれの状態を使う。見出しと切り替えの列の数は同じ（まだ済んでいない数。畳んでいても数える）。入力欄はいつも出ていて、Enter・
// ［足す］ではまだ足さず（足すのは各リストの中身）、打った字は書きかけに残る。データは作り物（e2e/fixtures/listData.ts）
import { expect, test, type Page } from '@playwright/test'
import { favoriteListView } from '../src/domain/favoriteList'
import { routineListView } from '../src/domain/routineList'
import { taskListView } from '../src/domain/taskList'
import { LIST_IDS, listData } from './fixtures/listData'
import { E2E_NOW, noHorizontalScroll } from './helpers'
import {
  expectCollapsed,
  headCount,
  LIST_NAMES,
  LIST_TODAY,
  type ListName,
  listAdd,
  listFold,
  listInput,
  openLists,
  openStackedList,
  storedDraft,
  switchCount,
} from './listHelpers'

/** 作り物のデータのまだ済んでいない数（各リストの決まりで数えた物） */
function expectedCounts() {
  const d = listData()
  const nowMs = Date.parse(E2E_NOW)
  return {
    routine: routineListView(d, LIST_TODAY).undone,
    task: taskListView(Object.values(d.items), LIST_TODAY, nowMs).undone,
    favorite: favoriteListView(Object.values(d.favorites), LIST_TODAY).undone,
  }
}

test.describe(
  'S3 S・M の3つのリスト（3.5・3.6。S3-FRAME-043・044・050〜053・S3-TASK-243・S3-ROUTINE-153・155）',
  { tag: ['@s', '@m'] },
  () => {
    test('アプリを開くたびに3つとも畳んで始まる。開いても読み込み直すと、また3つとも畳んで始まる（端末に覚えない）', async ({
      page,
    }) => {
      await openLists(page)
      for (const list of LIST_NAMES) await expectCollapsed(page, list, true)
      await openStackedList(page, 'task')
      await openStackedList(page, 'favorite')
      await expectCollapsed(page, 'routine', true)
      await page.reload()
      await expect(page.getByTestId('top-page')).toBeVisible()
      for (const list of LIST_NAMES) await expectCollapsed(page, list, true)
      expect(await page.evaluate(() => localStorage.getItem('diary-studio:prefs'))).toBeNull()
    })

    test('切り替えの列の数は、見出しの数と同じ（畳んでいても数える。等幅の字）', async ({ page }) => {
      await openLists(page)
      for (const list of LIST_NAMES) {
        expect(await switchCount(page, list), list).toBe(await headCount(page, list))
      }
      const font = await page
        .getByTestId('top-jump-task')
        .locator('.top-switcher-count')
        .evaluate((e) => getComputedStyle(e).fontFamily)
      expect(font).toContain('Roboto Mono')
    })

    test('裏に回って戻っただけ（ページを閉じていない）なら、開いた状態は続く', async ({ page }) => {
      await openLists(page)
      await openStackedList(page, 'routine')
      await page.evaluate(() => {
        for (const state of ['hidden', 'visible']) {
          Object.defineProperty(document, 'visibilityState', { configurable: true, value: state })
          document.dispatchEvent(new Event('visibilitychange'))
        }
      })
      await expectCollapsed(page, 'routine', false)
    })
  },
)

test.describe('S3 S（360px）', { tag: ['@s'] }, () => {
  test('3つとも開いても横にはみ出さない（S3-FRAME-035）', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 })
    await openLists(page)
    for (const list of LIST_NAMES) await openStackedList(page, list)
    await noHorizontalScroll(page)
    // 入力欄と［足す］は 40px・38px（指の端末・S。4.11）
    for (const list of LIST_NAMES) {
      const input = await listInput(page, list).boundingBox()
      const add = await listAdd(page, list).boundingBox()
      expect(input?.height, list).toBeGreaterThanOrEqual(40)
      expect(Math.round(add?.width ?? 0), list).toBe(34)
      expect(Math.round(add?.height ?? 0), list).toBe(38)
    }
  })
})

test.describe('S3 L の右の列（3.6・6.13。S3-FRAME-066・067・S3-TASK-242・244・S3-ROUTINE-154）', { tag: ['@pc'] }, () => {
  test('畳んだ状態は端末に覚え、読み込み直しても同じ。幅を S にすると S・M の状態（畳んで始まる）を使い、L に戻すと L の状態', async ({
    page,
  }) => {
    await openLists(page)
    for (const list of LIST_NAMES) await expectCollapsed(page, list, false)
    await listFold(page, 'favorite').click()
    await expectCollapsed(page, 'favorite', true)
    await page.reload()
    await expect(page.getByTestId('side-column')).toBeVisible()
    await expectCollapsed(page, 'favorite', true)
    await expectCollapsed(page, 'task', false)
    await page.setViewportSize({ width: 500, height: 900 })
    await expect(page.getByTestId('top-page')).toHaveAttribute('data-width', 'S')
    for (const list of LIST_NAMES) await expectCollapsed(page, list, true)
    await openStackedList(page, 'task')
    await page.setViewportSize({ width: 1400, height: 900 })
    await expect(page.getByTestId('top-page')).toHaveAttribute('data-width', 'L')
    await expectCollapsed(page, 'favorite', true)
    await expectCollapsed(page, 'task', false)
    await expectCollapsed(page, 'routine', false)
  })

  test('入力欄と［足す］は 36px・34px（L のマウス。4.11）。字が無い間の［足す］は淡い', async ({ page }) => {
    await openLists(page)
    for (const list of LIST_NAMES) {
      const input = await listInput(page, list).boundingBox()
      const add = await listAdd(page, list).boundingBox()
      expect(Math.round(input?.height ?? 0), list).toBe(36)
      expect(Math.round(add?.width ?? 0), list).toBe(34)
      expect(Math.round(add?.height ?? 0), list).toBe(34)
      await expect(listAdd(page, list)).toHaveAttribute('aria-disabled', 'true')
    }
  })
})

test.describe(
  'S3 入力欄（3.6・12.1・6.13。S3-FRAME-069・081・082・095・S3-TASK-030・042・S3-ROUTINE-092）',
  { tag: ['@pc', '@s'] },
  () => {
    test('いつも出ている入力欄に打った字は、Enter・外を押す・［足す］でまだ足さず（足すのは各リストの中身）、読み込み直しても戻る', async ({
      page,
      isMobile,
    }) => {
      await openLists(page)
      if (isMobile) await openStackedList(page, 'favorite')
      const input = listInput(page, 'favorite')
      await input.click()
      await input.fill('週末に行く店を調べる')
      await expect(listAdd(page, 'favorite')).not.toHaveAttribute('aria-disabled', 'true')
      await input.press('Enter')
      await page.getByTestId('app-header').click({ position: { x: 300, y: 10 } })
      await expect(input).toHaveValue(isMobile ? '週末に行く店を調べる\n' : '週末に行く店を調べる')
      await expect.poll(() => storedDraft(page, 'favorite')).not.toBeNull()
      await page.reload()
      await expect(page.getByTestId('top-page')).toBeVisible()
      if (isMobile) await openStackedList(page, 'favorite')
      await expect(listInput(page, 'favorite')).toHaveValue(isMobile ? '週末に行く店を調べる\n' : '週末に行く店を調べる')
    })

    test('［足す］を押してもフォーカスは入力欄に残る（iPhone のキーボードを閉じない。12.1）', async ({ page, isMobile }) => {
      await openLists(page)
      if (isMobile) await openStackedList(page, 'routine')
      const input = listInput(page, 'routine')
      await input.click()
      await input.fill('ストレッチ')
      await listAdd(page, 'routine').click()
      await expect(input).toBeFocused()
    })
  },
)

test.describe(
  'S3 まだ済んでいない数（作り物のデータから。3.5・3.6。S3-FRAME-044・S3-ROUTINE-081）',
  { tag: ['@pc', '@s'] },
  () => {
    /** 見出し（S・M は切り替えの列も）の数が want になるまで待つ */
    async function expectCounts(page: Page, isMobile: boolean, want: Record<ListName, number>): Promise<void> {
      for (const list of LIST_NAMES) {
        await expect.poll(() => headCount(page, list), { message: list }).toBe(want[list])
        if (isMobile) await expect.poll(() => switchCount(page, list), { message: list }).toBe(want[list])
      }
    }

    test('見出し（と S・M の切り替えの列）に、各リストの決まりで数えた数を出し、記録が替わるとすぐ数え直す（畳んでいても）', async ({
      page,
      isMobile,
    }) => {
      const want = expectedCounts()
      // 作り物のデータ: ルーチン6つのうち今日済んだ1つを除く5つ、Task List に出る8つ（済んで8日たった1つは出ない）のうち済んだ1つを
      // 除く7つ（カレンダー生まれの1つも数える）、やりたいこと5つのうち済んだ1つを除く4つ
      expect(want).toEqual({ routine: 5, task: 7, favorite: 4 })
      await openLists(page)
      await expectCounts(page, isMobile, want)
      // 画面の外（window.__ds の操作）で、ルーチンを1つ済みにし、タスクを1つ済みにし、やりたいことを1つ足す
      await page.evaluate(
        async ({ routine, task, today }) => {
          await window.__ds.actions.checkRoutine(routine, today)
          await window.__ds.actions.setItemDone(task, true)
          await window.__ds.actions.addFavorite('駅前の本屋をのぞく')
        },
        { routine: LIST_IDS.stretch, task: LIST_IDS.printDocs, today: LIST_TODAY },
      )
      await expectCounts(page, isMobile, { routine: 4, task: 6, favorite: 5 })
    })
  },
)
