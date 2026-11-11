// 予定の詳細の画面（docs/SPEC.md の 12.3・3.8・4.3・6.12・12.5。D11・D47・D48）: 題・上の列・欄の並び、その予定の区分の地と
// ラベルの帯（知らない区分・ラベルは仕事・ラベルなし）、区分とラベルを選び替えるとその場で替わる、「詳しく」を開いて出す決まり、
// 件名が空の記録、完了の切り替え（お知らせを出さない）、下の行（作った・完了・Claude が追加）、予定が無い時に閉じる
import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { mkItem, mkTask } from '../../domain/testData'
import type { Item } from '../../domain/types'
import { useApp } from '../../store/appStore'
import { usePrefs, useToasts, type Prefs } from '../../store/uiStore'
import { renderView, setupCalendarTests } from '../../test/renderCalendar'
import { testIds } from '../calendar/common/testIds'
import { DetailSheet } from './DetailSheet'

setupCalendarTests()

const sheet = () => screen.getByTestId(testIds.itemSheet)
const byId = (id: string) => screen.getByTestId(id)
const before = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
const detailsOpen = () => byId(testIds.itemDetails).getAttribute('aria-expanded') === 'true'

/** 端末の記録 */
const materials = mkItem({
  id: 'a',
  title: '資料づくり',
  kind: 'work',
  label: 'sky-l',
  start: '2026-11-09',
  due: '2026-11-12',
  startTime: '10:00',
  endTime: '18:00',
  requester: '総務',
  memo: '表紙を先に決める',
  createdAt: new Date(2026, 9, 1, 9, 2).getTime(),
})

async function open(items: Item[], opts: { prefs?: Partial<Prefs> } = {}, id = items[0].id) {
  const onClose = vi.fn()
  const data = { items: Object.fromEntries(items.map((i) => [i.id, i])) }
  const r = await renderView(DetailSheet, { id, onClose }, { data, ...opts })
  return { ...r, onClose, user: userEvent.setup() }
}

describe('題・上の列・欄（12.3）', () => {
  it('題は「予定」。上の列に「完了にする」・［複製］・「…」、欄は登録の画面と同じ並び、下の行は最後', async () => {
    await open([materials])
    expect(within(sheet()).getByRole('heading').textContent).toBe('予定')
    const order = [
      testIds.itemDone,
      testIds.itemDuplicate,
      testIds.itemMore,
      testIds.itemTitle,
      testIds.itemKind('work'),
      testIds.itemStart,
      testIds.itemDue,
      testIds.itemStartTime,
      testIds.itemEndTime,
      testIds.itemDetails,
      testIds.itemLabel('none'),
      testIds.itemRequester,
      testIds.itemLock,
      testIds.itemListed,
      testIds.itemMemo,
      testIds.itemFooter,
    ].map(byId)
    for (let i = 1; i < order.length; i++) expect(before(order[i - 1], order[i]), order[i].dataset.testid).toBe(true)
    expect(byId(testIds.itemDone).textContent).toBe('完了にする')
    expect(byId(testIds.itemDuplicate).textContent).toBe('複製')
    expect(byId(testIds.itemMore).getAttribute('aria-label')).toBe('ほかの操作')
    // 登録の画面のボタンの列は無い（直したそばから保存する）
    expect(screen.queryByTestId(testIds.itemRegister)).toBeNull()
  })

  it('件名は書き換えられる欄（textarea）で、その予定の値を出す。開いた時は件名にフォーカスしない（スマホでキーボードを開かない）', async () => {
    await open([materials])
    const title = byId(testIds.itemTitle) as HTMLTextAreaElement
    expect(title.tagName).toBe('TEXTAREA')
    expect(title.value).toBe('資料づくり')
    expect(document.activeElement).not.toBe(title)
    expect(sheet().contains(document.activeElement)).toBe(true)
  })

  it('欄はその予定の値: 日付（「11月9日（月）」〜「11月12日（木）」、締め切り日は［×］で消せる）・時刻・詳しく', async () => {
    await open([materials])
    expect(byId(testIds.itemStart).textContent).toBe('11月9日（月）')
    expect(byId(testIds.itemDue).textContent).toBe('11月12日（木）')
    expect(byId(testIds.itemDueClear).getAttribute('aria-label')).toBe('締め切り日を消す')
    expect((byId(testIds.itemStartTime) as HTMLInputElement).value).toBe('10:00')
    expect((byId(testIds.itemEndTime) as HTMLInputElement).value).toBe('18:00')
    expect(byId(testIds.itemLabel('sky-l')).getAttribute('aria-pressed')).toBe('true')
    expect((byId(testIds.itemRequester) as HTMLInputElement).value).toBe('総務')
    expect((byId(testIds.itemMemo) as HTMLTextAreaElement).value).toBe('表紙を先に決める')
  })

  it('calendar 生まれの開始日は消せず、list 生まれは開始日も［×］で消せる（ITEMS-210）。list 生まれに「空なら1日だけ」は出さない', async () => {
    await open([materials])
    expect(screen.queryByRole('button', { name: '開始日を消す' })).toBeNull()
    expect(screen.getByText('空なら1日だけ')).toBeTruthy()
  })

  it('list 生まれの開始日の［×］', async () => {
    const { user } = await open([mkTask({ id: 't', start: '2026-11-10', due: '2026-11-20' })])
    const clear = screen.getByRole('button', { name: '開始日を消す' })
    expect(screen.queryByText('空なら1日だけ')).toBeNull()
    await user.click(clear)
    expect(byId(testIds.itemStart).textContent).toBe('なし')
  })
})

describe('画面の地と上の辺の帯（4.3・X2・ITEMS-199〜203）', () => {
  it('その予定の区分（data-kind）とラベル（data-label・.label-band）。選び替えるとその場で替わる', async () => {
    const { user } = await open([materials])
    expect(sheet().getAttribute('data-kind')).toBe('work')
    expect(sheet().getAttribute('data-label')).toBe('sky-l')
    expect(sheet().classList.contains('label-band')).toBe(true)
    expect(sheet().classList.contains('it-sheet')).toBe(true)
    await user.click(byId(testIds.itemKind('private')))
    expect(sheet().getAttribute('data-kind')).toBe('private')
    await user.click(byId(testIds.itemLabel('peony-l')))
    expect(sheet().getAttribute('data-label')).toBe('peony-l')
    await user.click(byId(testIds.itemLabel('none')))
    expect(sheet().hasAttribute('data-label')).toBe(false)
    expect(sheet().classList.contains('label-band')).toBe(false)
  })

  it('知らない区分は仕事、知らないラベルはラベルなし（帯なし・「なし」を選んだ状態）として出す（6.12・ITEMS-025・036）', async () => {
    const odd = { ...mkItem({ id: 'x', title: '古い形' }), kind: 'family', label: 'gold-x' } as unknown as Item
    await open([odd])
    expect(sheet().getAttribute('data-kind')).toBe('work')
    expect(byId(testIds.itemKind('work')).getAttribute('aria-pressed')).toBe('true')
    expect(sheet().hasAttribute('data-label')).toBe(false)
    expect(sheet().classList.contains('label-band')).toBe(false)
    expect(byId(testIds.itemLabel('none')).getAttribute('aria-pressed')).toBe('true')
  })

  it('題の左に区分のアイコン（ディープダークで出す。読み上げない）', async () => {
    await open([mkItem({ id: 'p', kind: 'private' })])
    const icon = sheet().querySelector('.modal-head h2 .modal-title-icon')
    expect(icon?.getAttribute('aria-hidden')).toBe('true')
    expect(icon?.querySelector('svg')).not.toBeNull()
  })
})

describe('「詳しく」を開いて出す決まり（D11・AMB-ITEMS-02）', () => {
  it.each([
    ['ラベル', { label: 'sky-l' }],
    ['依頼者', { requester: '営業部' }],
    ['ロック', { locked: true }],
    ['Task List にも出す', { listed: true }],
    ['メモ', { memo: '持ち物' }],
  ])('%s が入っていれば、detailsOpen が閉じていても開いて出す', async (_name, patch) => {
    await open([mkItem({ id: 'd', ...patch })], { prefs: { detailsOpen: false } })
    expect(detailsOpen()).toBe(true)
  })

  it('どれも空なら detailsOpen に従う。ここで開け閉めしても detailsOpen に書く', async () => {
    const { user, unmount } = await open([mkItem({ id: 'e' })], { prefs: { detailsOpen: false } })
    expect(detailsOpen()).toBe(false)
    await user.click(byId(testIds.itemDetails))
    expect(detailsOpen()).toBe(true)
    expect(usePrefs.getState().detailsOpen).toBe(true)
    unmount()
    await open([mkItem({ id: 'e' })])
    expect(detailsOpen()).toBe(true)
  })

  it('入っていて開いた詳細で閉じると、detailsOpen も閉じる', async () => {
    const { user } = await open([materials], { prefs: { detailsOpen: true } })
    await user.click(byId(testIds.itemDetails))
    expect(detailsOpen()).toBe(false)
    expect(usePrefs.getState().detailsOpen).toBe(false)
  })

  it('付けたラベルの呼び名を、ラベルの欄に出す（ITEMS-021）', async () => {
    const onClose = vi.fn()
    await renderView(
      DetailSheet,
      { id: 'a', onClose },
      {
        data: {
          items: { a: materials },
          labelNames: { 'sky-l': { id: 'sky-l', name: '社内', updatedAt: 1, by: 'user', ai: null, via: null } },
        },
      },
    )
    expect(sheet().querySelector('.it-label-name')?.textContent).toBe('社内')
  })
})

describe('件名が空の記録（D48・AMB-ITEMS-26）', () => {
  it('欄は空にして、プレースホルダを「（件名なし）」にする', async () => {
    await open([mkItem({ id: 'n', title: '' })])
    const title = byId(testIds.itemTitle) as HTMLTextAreaElement
    expect(title.value).toBe('')
    expect(title.placeholder).toBe('（件名なし）')
  })
})

describe('完了（12.5）', () => {
  it('「完了にする」で予定全体を完了にし、「完了」になる。もう一度押すと戻す。お知らせは出さない', async () => {
    const { user } = await open([materials])
    const done = byId(testIds.itemDone)
    expect(done.getAttribute('aria-pressed')).toBe('false')
    await user.click(done)
    expect(useApp.getState().data.items.a.done).toBe(true)
    expect(done.textContent).toBe('完了')
    expect(done.getAttribute('aria-pressed')).toBe('true')
    expect(useToasts.getState().toasts).toEqual([])
    // 下の行に完了の日時が出る
    expect(byId(testIds.itemFooter).textContent).toContain('完了 2026/11/10 09:00')
    await user.click(done)
    expect(useApp.getState().data.items.a.done).toBe(false)
    expect(done.textContent).toBe('完了にする')
  })
})

describe('下の行（12.3・D47。12px・--text-faint）', () => {
  it('「作った 2026/10/01 09:02」（端末の暦と時刻）。手で作った物には Claude の行を出さない', async () => {
    await open([materials])
    const foot = byId(testIds.itemFooter)
    expect([...foot.querySelectorAll('p')].map((p) => p.textContent)).toEqual(['作った 2026/10/01 09:02'])
  })

  it('完了した物は「完了 …」、Claude が足した物は「Claude が追加（via）」（長い時は1行で切り、押すと全部）', async () => {
    const doneAt = new Date(2026, 10, 12, 18, 3).getTime()
    const item = mkItem({
      id: 'c',
      by: 'connector',
      ai: 'claude',
      via: 'メール: 12/3 打ち合わせのご案内',
      done: true,
      doneAt,
      doneOn: '2026-11-12',
    })
    const { user } = await open([item])
    const foot = byId(testIds.itemFooter)
    expect([...foot.querySelectorAll('p')].map((p) => p.textContent)).toEqual([
      '作った 2026/11/10 09:00',
      '完了 2026/11/12 18:03',
      'Claude が追加（メール: 12/3 打ち合わせのご案内）',
    ])
    const via = within(foot).getByRole('button')
    expect(via.getAttribute('aria-expanded')).toBe('false')
    await user.click(via)
    expect(via.getAttribute('aria-expanded')).toBe('true')
  })

  it('知らない AI は「AI が追加」、via が無ければ「Claude が追加」だけ', async () => {
    await open([mkItem({ id: 'u', by: 'connector', ai: 'other', via: null })])
    expect(byId(testIds.itemFooter).textContent).toContain('AI が追加')
    expect(byId(testIds.itemFooter).textContent).not.toContain('（')
  })
})

describe('予定が無い時（ほかの端末で消した・消した後に「進む」で戻った）', () => {
  it('初めから無い時は閉じる（onClose）', async () => {
    const { onClose } = await open([materials], {}, 'gone')
    expect(onClose).toHaveBeenCalled()
  })

  it('開いている間に無くなった時は、何も出さずに閉じる', async () => {
    const { onClose } = await open([materials])
    expect(onClose).not.toHaveBeenCalled()
    // ほかの端末でゴミ箱へ移した（届いた変更で、表示用の記録から無くなる）
    act(() => {
      const s = useApp.getState()
      const items = { ...s.data.items }
      delete items.a
      useApp.setState({ data: { ...s.data, items } })
    })
    expect(screen.queryByTestId(testIds.itemSheet)).toBeNull()
    expect(onClose).toHaveBeenCalled()
  })
})
