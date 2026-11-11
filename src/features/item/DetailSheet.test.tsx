// 予定の詳細の画面（docs/SPEC.md の 12.3・3.8・4.3・6.12・12.5。D11・D47・D48）: 題・上の列・欄の並び、その予定の区分の地と
// ラベルの帯（知らない区分・ラベルは仕事・ラベルなし）、区分とラベルを選び替えるとその場で替わる、「詳しく」を開いて出す決まり、
// 件名が空の記録、完了の切り替え（お知らせを出さない）、下の行（作った・完了・Claude が追加）、予定が無い時に閉じる
import { act, fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DATE_REFUSED } from '../../domain/itemInput'
import { mkItem, mkTask, T0, DAY } from '../../domain/testData'
import { trashNotice } from '../../domain/trash'
import type { Item } from '../../domain/types'
import { actions } from '../../store/actions'
import { getRaw, useApp } from '../../store/appStore'
import { flushAllDrafts } from '../../store/draftRegistry'
import { usePrefs, useToasts, type Prefs } from '../../store/uiStore'
import { renderView, setupCalendarTests } from '../../test/renderCalendar'
import { testIds } from '../calendar/common/testIds'
import { DetailSheet, MORE_MENU_TEST_ID } from './DetailSheet'
import { DUP_TEST_IDS } from './DuplicateDialog'
import { DATE_PICKER_TEST_ID } from './fields/MiniMonth'
import { MEMO_VIEW_TEST_ID } from './fields/MemoField'
import { timeListTestId } from './fields/TimeFields'

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
      MEMO_VIEW_TEST_ID,
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
    // メモは入力欄から離れている間は文章で出す（押すと入力欄になる。ITEMS-216）
    expect(byId(MEMO_VIEW_TEST_ID).textContent).toBe('表紙を先に決める')
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

  it.each([
    ['null', { title: null }],
    ['項目が無い', { title: undefined }],
  ])(
    '端末の記録の件名が文字でない（%s）時も空の件名として、欄は空・プレースホルダ（「（件名なし）」を値にしない）',
    async (_name, patch) => {
      const odd = { ...mkItem({ id: 'z' }), ...patch } as unknown as Item
      if (patch.title === undefined) delete (odd as Partial<Item>).title
      await open([odd])
      const title = byId(testIds.itemTitle) as HTMLTextAreaElement
      expect(title.value).toBe('')
      expect(title.placeholder).toBe('（件名なし）')
    },
  )

  it('記録が「（件名なし）」という本当の件名なら、その字を出す', async () => {
    await open([mkItem({ id: 'r', title: '（件名なし）' })])
    expect((byId(testIds.itemTitle) as HTMLTextAreaElement).value).toBe('（件名なし）')
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

// ---------- 後半（動き）: 自動の保存・日付と時刻の決まり・list 生まれ・複製・削除・重なった小さな画面 ----------

/** 保存した記録（表示用） */
const stored = (id: string) => useApp.getState().data.items[id]

/** 小さな月のカレンダーで日を選ぶ（L は日付の欄の下の小窓） */
async function pickDate(user: ReturnType<typeof userEvent.setup>, field: string, date: string) {
  await user.click(byId(field))
  const picker = byId(DATE_PICKER_TEST_ID)
  await user.click(picker.querySelector(`[data-date="${date}"]`) as HTMLElement)
}

describe('直したそばから自動で保存する（12.3・ITEMS-207・208・FRAME-054）', () => {
  it('件名は打つのが 0.6秒止まった時に保存する（打っている間は保存しない）', async () => {
    await open([materials])
    vi.useFakeTimers({ now: T0 })
    const title = byId(testIds.itemTitle) as HTMLTextAreaElement
    fireEvent.change(title, { target: { value: '資料づくり（表紙）' } })
    act(() => vi.advanceTimersByTime(599))
    expect(stored('a').title).toBe('資料づくり')
    act(() => vi.advanceTimersByTime(1))
    expect(stored('a').title).toBe('資料づくり（表紙）')
  })

  it('打ち続けていても 1.5秒ごとには保存する', async () => {
    await open([materials])
    vi.useFakeTimers({ now: T0 })
    const title = byId(testIds.itemTitle) as HTMLTextAreaElement
    for (let i = 1; i <= 4; i++) {
      fireEvent.change(title, { target: { value: `資料づくり${'。'.repeat(i)}` } })
      act(() => vi.advanceTimersByTime(500))
    }
    expect(stored('a').title).toBe('資料づくり。。。')
  })

  it('フォーカスを外すとすぐ保存し、閉じる（部品が消える）時も 0.6秒待ちの字を保存する', async () => {
    const { unmount } = await open([materials])
    const title = byId(testIds.itemTitle) as HTMLTextAreaElement
    title.focus()
    fireEvent.change(title, { target: { value: '資料づくり2' } })
    act(() => title.blur())
    expect(stored('a').title).toBe('資料づくり2')
    const requester = byId(testIds.itemRequester) as HTMLInputElement
    fireEvent.change(requester, { target: { value: '営業部' } })
    expect(stored('a').requester).toBe('総務')
    unmount()
    expect(stored('a').requester).toBe('営業部')
  })

  it('件名を空（空白だけ）にしても保存せず、離れると元の件名に戻す（ITEMS-004・D48）', async () => {
    await open([materials])
    vi.useFakeTimers({ now: T0 })
    const title = byId(testIds.itemTitle) as HTMLTextAreaElement
    title.focus()
    fireEvent.change(title, { target: { value: '  ' } })
    act(() => vi.advanceTimersByTime(1000))
    expect(stored('a').title).toBe('資料づくり')
    // 打っている間は空のまま（戻すのは離れた時）
    expect(title.value).toBe('  ')
    act(() => title.blur())
    expect(title.value).toBe('資料づくり')
    expect(stored('a').title).toBe('資料づくり')
  })

  it('前後の空白だけ違う時は保存せず、打っている途中の最後の空白も消さない', async () => {
    await open([materials])
    vi.useFakeTimers({ now: T0 })
    const updated = stored('a').updatedAt
    const title = byId(testIds.itemTitle) as HTMLTextAreaElement
    fireEvent.change(title, { target: { value: '資料づくり ' } })
    act(() => vi.advanceTimersByTime(1000))
    expect(stored('a').updatedAt).toBe(updated)
    expect(title.value).toBe('資料づくり ')
  })

  it('日本語の変換の途中では保存せず、変換を決めてから 0.6秒で保存する', async () => {
    await open([materials])
    vi.useFakeTimers({ now: T0 })
    const title = byId(testIds.itemTitle) as HTMLTextAreaElement
    fireEvent.compositionStart(title)
    fireEvent.change(title, { target: { value: '資料づくりひょうし' } })
    act(() => vi.advanceTimersByTime(2000))
    expect(stored('a').title).toBe('資料づくり')
    fireEvent.change(title, { target: { value: '資料づくり表紙' } })
    fireEvent.compositionEnd(title)
    act(() => vi.advanceTimersByTime(600))
    expect(stored('a').title).toBe('資料づくり表紙')
  })

  it('ほかの端末で件名が変わった時は、未保存の字が無ければ欄も替わる', async () => {
    await open([materials])
    act(() => {
      const st = useApp.getState()
      useApp.setState({ data: { ...st.data, items: { ...st.data.items, a: { ...materials, title: '資料（直した）' } } } })
    })
    expect((byId(testIds.itemTitle) as HTMLTextAreaElement).value).toBe('資料（直した）')
  })

  it('区分・ラベル・ロック・Task List にも出すは、押すとすぐ保存する', async () => {
    const { user } = await open([materials])
    await user.click(byId(testIds.itemKind('private')))
    expect(stored('a').kind).toBe('private')
    await user.click(byId(testIds.itemLabel('peony-d')))
    expect(stored('a').label).toBe('peony-d')
    await user.click(byId(testIds.itemLock))
    expect(stored('a').locked).toBe(true)
    await user.click(byId(testIds.itemListed))
    expect(stored('a').listed).toBe(true)
    await user.click(byId(testIds.itemLabel('none')))
    expect(stored('a').label).toBeNull()
  })

  it('ロック中の予定も、どの欄も直せる（ITEMS-224・CALENDAR-148）', async () => {
    const { user } = await open([mkItem({ id: 'L', locked: true, start: '2026-11-10' })])
    await pickDate(user, testIds.itemStart, '2026-11-12')
    expect(stored('L').start).toBe('2026-11-12')
  })

  it('知らない区分の記録は、仕事と出ている所で［仕事］を押しても書かず、［プライベート］を選んだ時だけ書く（ITEMS-039）', async () => {
    const odd = { ...mkItem({ id: 'x', title: '古い形' }), kind: 'family' } as unknown as Item
    const { user } = await open([odd])
    const updated = stored('x').updatedAt
    await user.click(byId(testIds.itemKind('work')))
    expect(stored('x').updatedAt).toBe(updated)
    expect((getRaw().items.x as unknown as { kind: string }).kind).toBe('family')
    await user.click(byId(testIds.itemKind('private')))
    expect(stored('x').kind).toBe('private')
  })

  it('メモは 0.6秒止まった時に保存し、離れると文章に戻る。URL は新しいタブのリンク（rel="noopener noreferrer"）', async () => {
    const { user } = await open([mkItem({ id: 'm', memo: '案内は https://example.com/guide. を見る' })])
    const view = byId(MEMO_VIEW_TEST_ID)
    const link = within(view).getByRole('link')
    expect(link.getAttribute('href')).toBe('https://example.com/guide')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
    expect(view.textContent).toBe('案内は https://example.com/guide. を見る')
    // リンク以外を押すと入力欄になり、フォーカスする
    await user.click(view.querySelector('.it-memo-text span') as HTMLElement)
    const memo = byId(testIds.itemMemo) as HTMLTextAreaElement
    expect(document.activeElement).toBe(memo)
    await user.type(memo, '（地図あり）')
    act(() => memo.blur())
    expect(stored('m').memo).toBe('案内は https://example.com/guide. を見る（地図あり）')
    expect(screen.queryByTestId(testIds.itemMemo)).toBeNull()
    expect(byId(MEMO_VIEW_TEST_ID).textContent).toContain('（地図あり）')
  })

  it('メモの［書き換える］（キーボードで届く所）でも入力欄になる。空のメモは初めから入力欄', async () => {
    const { user } = await open([mkItem({ id: 'm', memo: '持ち物' })])
    await user.click(screen.getByRole('button', { name: 'メモを書き換える' }))
    expect(document.activeElement).toBe(byId(testIds.itemMemo))
    await open([mkItem({ id: 'e', memo: '' })], {}, 'e')
    expect(screen.getAllByTestId(testIds.itemMemo).length).toBeGreaterThan(0)
  })

  it('依頼者の欄は、直近 365日に使った名前を回数の多い順に候補に出し、打った字で絞る。選ぶとすぐ保存する（D49）', async () => {
    const old = T0 - 400 * DAY
    const { user } = await open(
      [
        mkItem({ id: 'r', requester: '' }),
        mkItem({ id: 'r1', requester: '総務', createdAt: T0 - DAY }),
        mkItem({ id: 'r2', requester: '営業部', createdAt: T0 - 2 * DAY }),
        mkItem({ id: 'r3', requester: '営業部', createdAt: T0 - 3 * DAY }),
        mkItem({ id: 'r4', requester: '経理', createdAt: old }),
      ],
      { prefs: { detailsOpen: true } },
    )
    const input = byId(testIds.itemRequester)
    await user.click(input)
    const list = () => screen.queryByRole('listbox', { name: '依頼者の候補' })
    expect([...list()!.querySelectorAll('[role="option"]')].map((o) => o.textContent)).toEqual(['営業部', '総務'])
    await user.type(input, '総')
    expect([...list()!.querySelectorAll('[role="option"]')].map((o) => o.textContent)).toEqual(['総務'])
    await user.click(within(list()!).getByRole('option', { name: '総務' }))
    expect(stored('r').requester).toBe('総務')
    expect(list()).toBeNull()
  })
})

describe('日付と時刻の決まり（12.4・6.3・6.4）', () => {
  it('日付の欄を押すと小さな月のカレンダー（L は欄の下の小窓）。締め切り日に開始日より前の日を選ぶと、開始日もそろえる（CALENDAR-021）', async () => {
    const { user } = await open([materials])
    await user.click(byId(testIds.itemDue))
    const picker = byId(DATE_PICKER_TEST_ID)
    expect(picker.getAttribute('role')).toBe('dialog')
    expect(picker.textContent).toContain('2026年11月')
    // 日曜始まり・今日の印・土日祝の色
    expect([...picker.querySelectorAll('.it-mm-wd')].map((w) => w.textContent).join('')).toBe('日月火水木金土')
    expect(picker.querySelector('[data-date="2026-11-10"]')?.classList.contains('today-mark')).toBe(true)
    expect(picker.querySelector('[data-date="2026-11-03"]')?.getAttribute('data-tone')).toBe('sun')
    expect(picker.querySelector('[data-date="2026-11-14"]')?.getAttribute('data-tone')).toBe('sat')
    expect(picker.querySelector('[data-date="2026-11-12"]')?.getAttribute('aria-pressed')).toBe('true')
    await user.click(picker.querySelector('[data-date="2026-11-05"]') as HTMLElement)
    expect(screen.queryByTestId(DATE_PICKER_TEST_ID)).toBeNull()
    expect(stored('a')).toMatchObject({ start: '2026-11-05', due: '2026-11-05' })
  })

  it('開始日に締め切り日より後の日を選ぶと、締め切り日もそろえる', async () => {
    const { user } = await open([materials])
    await pickDate(user, testIds.itemStart, '2026-11-20')
    expect(stored('a')).toMatchObject({ start: '2026-11-20', due: '2026-11-20' })
  })

  it('‹ › で月を替え、キー（←→↑↓・Enter）でも選べる', async () => {
    const { user } = await open([materials])
    await user.click(byId(testIds.itemStart))
    const picker = byId(DATE_PICKER_TEST_ID)
    await user.click(within(picker).getByRole('button', { name: '次の月' }))
    expect(picker.textContent).toContain('2026年12月')
    await user.click(within(picker).getByRole('button', { name: '前の月' }))
    const day = picker.querySelector<HTMLElement>('[data-date="2026-11-09"]')!
    day.focus()
    await user.keyboard('{ArrowRight}{ArrowDown}{Enter}')
    expect(stored('a').start).toBe('2026-11-17')
  })

  it('そろえると 1日の予定で終了 < 開始になる日付にはできない: 日付の欄の下に理由を出し、元の値のまま（ITEMS-222・CALENDAR-043）', async () => {
    const night = mkItem({ id: 'n', start: '2026-11-10', due: '2026-11-11', startTime: '23:00', endTime: '01:00' })
    const { user } = await open([night])
    await user.click(byId(testIds.itemDueClear))
    expect(byId(testIds.itemDateError).textContent).toBe(DATE_REFUSED)
    expect(stored('n')).toMatchObject({ start: '2026-11-10', due: '2026-11-11', endTime: '01:00' })
    expect(byId(testIds.itemDue).textContent).toBe('11月11日（水）')
    // 次に日付を決めると消える
    await pickDate(user, testIds.itemDue, '2026-11-12')
    expect(screen.queryByTestId(testIds.itemDateError)).toBeNull()
    expect(stored('n').due).toBe('2026-11-12')
  })

  it('1日の予定で終了 < 開始の時刻を入れると、翌日までの2日の予定にして保存し、「翌日 02:00 まで」を出す（日付を直すまで。AMB-ITEMS-05）', async () => {
    const { user } = await open([mkItem({ id: 'b', start: '2026-11-11', startTime: '22:00' })])
    const end = byId(testIds.itemEndTime) as HTMLInputElement
    await user.type(end, '2:00{Enter}')
    expect(stored('b')).toMatchObject({ start: '2026-11-11', due: '2026-11-12', startTime: '22:00', endTime: '02:00' })
    expect(byId(testIds.itemTimeHint).textContent).toBe('翌日 02:00 まで')
    expect(byId(testIds.itemDue).textContent).toBe('11月12日（木）')
    await pickDate(user, testIds.itemDue, '2026-11-13')
    expect(screen.queryByTestId(testIds.itemTimeHint)).toBeNull()
  })

  it('list 生まれの翌日: 開始日を元の締め切り日、締め切り日をその翌日にする（ITEMS-230）', async () => {
    const { user } = await open([mkTask({ id: 't', start: null, due: '2026-11-20', startTime: '23:00' })])
    await user.type(byId(testIds.itemEndTime), '0130{Enter}')
    expect(stored('t')).toMatchObject({ start: '2026-11-20', due: '2026-11-21', endTime: '01:30' })
  })

  it('終了に 0:00 を打つと 24:00（翌日にしない）。終了 = 開始なら終了を空に（ITEMS-233・234）', async () => {
    const { user } = await open([mkItem({ id: 'z', startTime: '22:00' })])
    const end = byId(testIds.itemEndTime) as HTMLInputElement
    await user.type(end, '0:00{Enter}')
    expect(stored('z')).toMatchObject({ due: null, endTime: '24:00' })
    expect(end.value).toBe('24:00')
    await user.clear(end)
    await user.type(end, '22:00{Enter}')
    expect(stored('z').endTime).toBeNull()
  })

  it('開始時刻を空にすると終了時刻も消え、終了の欄は押せない（ITEMS-229）', async () => {
    const { user } = await open([mkItem({ id: 'c', startTime: '10:00', endTime: '11:00' })])
    const start = byId(testIds.itemStartTime) as HTMLInputElement
    await user.clear(start)
    act(() => start.blur())
    expect(stored('c')).toMatchObject({ startTime: null, endTime: null })
    const end = byId(testIds.itemEndTime) as HTMLInputElement
    expect(end.value).toBe('')
    expect(end.disabled).toBe(true)
  })

  it('時刻の欄を押すと 5分刻みの一覧。開始は 0:00〜23:55、終了は 0:05〜24:00（0:00 なし）。選ぶとすぐ保存する', async () => {
    const { user } = await open([mkItem({ id: 'l', startTime: '09:00' })])
    await user.click(byId(testIds.itemStartTime))
    const startList = byId(timeListTestId('start'))
    const startOptions = [...startList.querySelectorAll('[role="option"]')].map((o) => o.textContent)
    expect(startOptions).toHaveLength(288)
    expect([startOptions[0], startOptions[287]]).toEqual(['0:00', '23:55'])
    // 今の値に印
    expect(startList.querySelector('.is-current')?.textContent).toBe('9:00')
    await user.click(within(startList).getByRole('option', { name: '10:30' }))
    expect(stored('l').startTime).toBe('10:30')
    expect(screen.queryByTestId(timeListTestId('start'))).toBeNull()
    await user.click(byId(testIds.itemEndTime))
    const endOptions = [...byId(timeListTestId('end')).querySelectorAll('[role="option"]')].map((o) => o.textContent)
    expect([endOptions[0], endOptions.at(-1)]).toEqual(['0:05', '24:00'])
    expect(endOptions).not.toContain('0:00')
  })

  it('時刻の一覧は ↑↓ で移り Enter で選ぶ。読めない字は元に戻して理由を出す（AMB-ITEMS-07）', async () => {
    const { user } = await open([mkItem({ id: 'k', startTime: '09:00' })])
    const start = byId(testIds.itemStartTime) as HTMLInputElement
    start.focus()
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')
    expect(stored('k').startTime).toBe('09:05')
    await user.clear(start)
    await user.type(start, '25:00{Enter}')
    expect(start.value).toBe('9:05')
    expect(screen.getByRole('alert').textContent).toContain('読めない時刻')
    await user.clear(start)
    await user.type(start, '９：３０{Enter}')
    expect(stored('k').startTime).toBe('09:30')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('打ちかけの時刻（まだ欄を離れていない）も、Esc・「戻る」で閉じる時（部品が消える時）に保存する（ITEMS-208）', async () => {
    const { unmount } = await open([mkItem({ id: 'u', startTime: '09:00' })])
    const end = byId(testIds.itemEndTime) as HTMLInputElement
    end.focus()
    fireEvent.change(end, { target: { value: '1030' } })
    expect(stored('u').endTime).toBeNull()
    unmount()
    expect(stored('u')).toMatchObject({ startTime: '09:00', endTime: '10:30' })
  })

  it('打ちかけの時刻は、画面を閉じる・裏に回る時（pagehide。下書きをまとめて保存する時）にも保存する。読めない字は保存しない', async () => {
    await open([mkItem({ id: 'w', startTime: '09:00' })])
    const start = byId(testIds.itemStartTime) as HTMLInputElement
    start.focus()
    fireEvent.change(start, { target: { value: '25:00' } })
    act(() => flushAllDrafts())
    expect(stored('w').startTime).toBe('09:00')
    // 読めない字はそのまま欄に残す（打ち直せる）
    expect(start.value).toBe('25:00')
    fireEvent.change(start, { target: { value: '8' } })
    expect(useApp.getState().draftsDirty).toBe(true)
    act(() => flushAllDrafts())
    expect(stored('w').startTime).toBe('08:00')
    expect(start.value).toBe('8:00')
    expect(useApp.getState().draftsDirty).toBe(false)
  })
})

describe('list 生まれのタスク（12.3・6.3）', () => {
  it.each([
    [{ start: null, due: null }, 'カレンダーには出ません（Task List だけ）'],
    [{ start: '2026-11-10', due: null }, '開始日だけではカレンダーに出ません。締め切り日を入れるとカレンダーに出ます'],
    [{ start: null, due: '2026-11-20' }, '11/20（金）の1日の予定としてカレンダーに出ます'],
    [{ start: '2026-11-10', due: '2026-11-20' }, '11/10（火）〜11/20（金）の予定としてカレンダーに出ます'],
  ])('日付の欄の下に今どう出るかの1行: %o → %s（ITEMS-211）', async (dates, line) => {
    await open([mkTask({ id: 't', ...dates })])
    expect(byId(testIds.itemStatusLine).textContent).toBe(line)
  })

  it('calendar 生まれには出さない', async () => {
    await open([materials])
    expect(screen.queryByTestId(testIds.itemStatusLine)).toBeNull()
  })

  it('カレンダーに出ていない時（①④）は時刻の欄と「Task List にも出す」を押せず、「締め切り日を入れると時刻を入れられます」（ITEMS-212・214）', async () => {
    await open([mkTask({ id: 't', start: '2026-11-10', due: null, startTime: '10:00' })], { prefs: { detailsOpen: true } })
    expect((byId(testIds.itemStartTime) as HTMLInputElement).disabled).toBe(true)
    expect((byId(testIds.itemStartTime) as HTMLInputElement).value).toBe('10:00')
    expect((byId(testIds.itemEndTime) as HTMLInputElement).disabled).toBe(true)
    expect(screen.getByText('締め切り日を入れると時刻を入れられます')).toBeTruthy()
    expect((byId(testIds.itemListed) as HTMLInputElement).disabled).toBe(true)
  })

  it('カレンダーに出ている時は「Task List にも出す」を外せる（Task List から外す）', async () => {
    const { user } = await open([mkTask({ id: 't', due: '2026-11-20' })])
    const listed = byId(testIds.itemListed) as HTMLInputElement
    expect(listed.disabled).toBe(false)
    await user.click(listed)
    expect(stored('t').listed).toBe(false)
  })

  it('締め切り日を消すとカレンダーから外れ（時刻は残す）、Task List から外していたら戻して知らせる。詳細は開いたまま（ITEMS-213・215・271）', async () => {
    const { user, onClose } = await open([
      mkTask({ id: 't', due: '2026-11-20', listed: false, startTime: '10:00', endTime: '11:00' }),
    ])
    await user.click(byId(testIds.itemDueClear))
    expect(stored('t')).toMatchObject({ due: null, listed: true, startTime: '10:00', endTime: '11:00' })
    expect(useToasts.getState().toasts.map((t) => t.message)).toEqual(['カレンダーから外れたので Task List に戻しました'])
    expect(useToasts.getState().toasts[0].action).toBeUndefined()
    expect(byId(testIds.itemStatusLine).textContent).toBe('カレンダーには出ません（Task List だけ）')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('Task List に出したままなら、締め切り日を消しても知らせない', async () => {
    const { user } = await open([mkTask({ id: 't', due: '2026-11-20' })])
    await user.click(byId(testIds.itemDueClear))
    expect(stored('t').due).toBeNull()
    expect(useToasts.getState().toasts).toEqual([])
  })
})

describe('複製・削除の入口と、重なった小さな画面（12.7・12.8・AMB-ITEMS-32）', () => {
  it('［複製］で「複製する日を選ぶ」を詳細の上に開き、Esc はその画面だけを閉じる（詳細はそのまま）', async () => {
    const { user, onClose } = await open([materials])
    await user.click(byId(testIds.itemDuplicate))
    const dialog = byId(DUP_TEST_IDS.dialog)
    expect(within(dialog).getByRole('heading').textContent).toBe('複製する日を選ぶ')
    await user.keyboard('{Escape}')
    expect(screen.queryByTestId(DUP_TEST_IDS.dialog)).toBeNull()
    expect(screen.getByTestId(testIds.itemSheet)).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('日付の小窓・時刻の一覧の Esc も、その小窓だけを閉じる', async () => {
    const { user, onClose } = await open([materials])
    await user.click(byId(testIds.itemStart))
    await user.keyboard('{Escape}')
    expect(screen.queryByTestId(DATE_PICKER_TEST_ID)).toBeNull()
    await user.click(byId(testIds.itemStartTime))
    expect(byId(timeListTestId('start'))).toBeTruthy()
    await user.keyboard('{Escape}')
    expect(screen.queryByTestId(timeListTestId('start'))).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('カレンダーに出ている予定は確かめてから消す（Task List にも出ていれば「Task List からも消えます。」）。［やめる］なら詳細はそのまま（ITEMS-263・268）', async () => {
    const trash = vi.spyOn(actions, 'trashItem').mockResolvedValue('entry-1')
    const { user, onClose } = await open([{ ...materials, listed: true }])
    await user.click(byId(testIds.itemMore))
    const menu = byId(MORE_MENU_TEST_ID)
    await user.click(within(menu).getByTestId(testIds.itemDelete))
    const dialog = screen.getByRole('dialog', { name: '『資料づくり』を削除しますか？' })
    expect(within(dialog).getByText(`${trashNotice()}Task List からも消えます。`)).toBeTruthy()
    await user.click(within(dialog).getByRole('button', { name: 'やめる' }))
    expect(trash).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    await user.click(byId(testIds.itemMore))
    await user.click(byId(testIds.itemDelete))
    await user.click(
      within(screen.getByRole('dialog', { name: '『資料づくり』を削除しますか？' })).getByRole('button', { name: '削除' }),
    )
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(trash).toHaveBeenCalledWith('a')
    // 確かめて消した物はお知らせを出さない（ゴミ箱の画面は段階5。AMB-ITEMS-24）
    expect(useToasts.getState().toasts).toEqual([])
  })

  it.each([
    ['Task List に出ていない', { listed: false }],
    ['済んで 7日を過ぎて Task List に見えない', { listed: true, done: true, doneAt: T0 - 8 * DAY, doneOn: '2026-11-02' }],
  ])('%s時は、確かめの文の最後の1文を出さない（ITEMS-264・AMB-ITEMS-23）', async (_name, patch) => {
    vi.spyOn(actions, 'trashItem').mockResolvedValue('entry-1')
    const { user } = await open([{ ...materials, ...patch }])
    await user.click(byId(testIds.itemMore))
    await user.click(byId(testIds.itemDelete))
    const dialog = screen.getByRole('dialog', { name: '『資料づくり』を削除しますか？' })
    expect(within(dialog).getByText(trashNotice())).toBeTruthy()
    expect(dialog.textContent).not.toContain('Task List からも消えます。')
  })

  it('カレンダーに出ていないタスク（Task List だけ）は確かめずに消し、「『件名』を削除しました［元に戻す］」。［元に戻す］でゴミ箱から戻す（ITEMS-266）', async () => {
    const trash = vi.spyOn(actions, 'trashItem').mockResolvedValue('entry-9')
    const restore = vi.spyOn(actions, 'restoreTrashEntry').mockResolvedValue({ restored: 1 } as never)
    const { user, onClose } = await open([mkTask({ id: 't', title: '見積書を出す' })])
    await user.click(byId(testIds.itemMore))
    await user.click(byId(testIds.itemDelete))
    expect(screen.queryByRole('dialog', { name: /削除しますか/ })).toBeNull()
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(trash).toHaveBeenCalledWith('t')
    const [toast] = useToasts.getState().toasts
    expect(toast.message).toBe('『見積書を出す』を削除しました')
    expect(toast.action?.label).toBe('元に戻す')
    act(() => toast.action?.run())
    await vi.waitFor(() => expect(restore).toHaveBeenCalledWith('entry-9'))
  })
})
