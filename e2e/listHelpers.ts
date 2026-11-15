// 段階3の3つのリスト（Routine List・Task List・Favorite List。docs/SPEC.md の 3.5・3.6・13.〜15.）の E2E で使う道具。リストの E2E
// （lists-frame・task-list・routine-list・favorite-list・lists-history・lists-flows など）が同じ物を使う。
//   await openLists(page, '/week/2026-11-08')            作り物のデータ（e2e/fixtures/listData.ts）を置いて開く
//   await openStackedList(page, 'task')                   S・M: 切り替えの列で開いて、その先頭へ
//   await expectCollapsed(page, 'routine', true)
// data-testid は src/features/lists/common/testIds.ts の listTestIds（名前を1か所で決める）
import { expect, type Locator, type Page } from '@playwright/test'
import type { AppData } from '../src/domain/types'
import { draftKey } from '../src/features/lists/common/listInputModel'
import { listTestIds } from '../src/features/lists/common/testIds'
import { listData, LIST_TODAY } from './fixtures/listData'
import { E2E_NOW, openCalendar, type OpenCalendarOptions } from './helpers'

export type ListName = 'routine' | 'task' | 'favorite'

export const LIST_NAMES: readonly ListName[] = ['routine', 'task', 'favorite']

export { listTestIds, LIST_TODAY }

/** E2E_NOW の日が作り物のデータの今日（日付は今日から数えてある） */
if (!E2E_NOW.startsWith(LIST_TODAY)) throw new Error('E2E_NOW と LIST_TODAY が違う日です')

/**
 * 作り物のリストのデータ（listData）を置いてカレンダーを開く。extra は表ごとに混ぜる（items は両方の物を1つの表に）。
 * lists に false を渡すとリストのデータを置かない（extra だけ）
 */
export async function openLists(
  page: Page,
  hash = '/',
  opts: OpenCalendarOptions & { extra?: Partial<AppData>; lists?: boolean } = {},
): Promise<void> {
  const { extra, lists = true, ...rest } = opts
  const base: Partial<AppData> = lists ? listData() : {}
  const data: Partial<AppData> = { ...base, ...extra }
  if (extra?.items) data.items = { ...base.items, ...extra.items }
  await openCalendar(page, hash, { ...rest, data })
}

export const listSection = (page: Page, list: ListName): Locator => page.getByTestId(listTestIds.section(list))
export const listInput = (page: Page, list: ListName): Locator => page.getByTestId(listTestIds.input(list))
export const listAdd = (page: Page, list: ListName): Locator => page.getByTestId(listTestIds.add(list))
export const listFold = (page: Page, list: ListName): Locator => page.getByTestId(listTestIds.fold(list))

/** 見出しのまだ済んでいない数（読み上げの字を除いた数） */
export async function headCount(page: Page, list: ListName): Promise<number> {
  return Number(await page.getByTestId(listTestIds.count(list)).locator('[aria-hidden="true"]').textContent())
}

/** S・M の切り替えの列の数 */
export async function switchCount(page: Page, list: ListName): Promise<number> {
  return Number(await page.getByTestId(`top-jump-${list}`).locator('[aria-hidden="true"]').textContent())
}

/** 畳んでいるか（data-collapsed） */
export async function expectCollapsed(page: Page, list: ListName, collapsed: boolean): Promise<void> {
  await expect(listSection(page, list)).toHaveAttribute('data-collapsed', String(collapsed))
}

/** S・M: 切り替えの列でそのリストを開き、その先頭へ（畳んでいれば開いてから。3.5） */
export async function openStackedList(page: Page, list: ListName): Promise<void> {
  await page.getByTestId(`top-jump-${list}`).click()
  await expectCollapsed(page, list, false)
  await expect(page.getByTestId(`top-jump-${list}`)).toHaveAttribute('aria-current', 'true')
}

/** 端末に控えた書きかけ（diary-studio:draft:{リスト}。無ければ null） */
export function storedDraft(page: Page, list: ListName): Promise<string | null> {
  return page.evaluate((key) => localStorage.getItem(key), draftKey(list))
}
