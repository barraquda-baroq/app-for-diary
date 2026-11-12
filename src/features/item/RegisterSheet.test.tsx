// 予定の登録の画面（docs/SPEC.md の 12.2・3.8・4.3・4.6）: 題・欄の並び（畳む所は無く、どの欄もいつも出す）・件名にフォーカス・
// 初めの値、区分とラベルを選び替えると地と帯の印（data-kind・data-label）がその場で替わる、件名が空の間は［登録］を押せない、
// ラベルの呼び名の出し方（色の並びの下の1行）、ディープダークの題の左のアイコン
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DATE_REFUSED } from '../../domain/itemInput'
import { LABEL_DEFAULT_NAMES, LABEL_KEYS } from '../../domain/labels'
import { mkItem, T0, DAY } from '../../domain/testData'
import type { LabelName } from '../../domain/types'
import { useApp } from '../../store/appStore'
import { useCalendarUi, useToasts } from '../../store/uiStore'
import { renderView, setupCalendarTests } from '../../test/renderCalendar'
import { testIds } from '../calendar/common/testIds'
import type { RegisterInit } from '../calendar/common/types'
import { DATE_PICKER_TEST_ID } from './fields/MiniMonth'
import { timeListTestId } from './fields/TimeFields'
import { DISCARD_MESSAGE, DISCARD_TEST_IDS, RegisterSheet } from './RegisterSheet'

setupCalendarTests()

const sheet = () => screen.getByTestId(testIds.itemSheet)
const byId = (id: string) => screen.getByTestId(id)

async function open(init: RegisterInit = { start: '2026-11-10' }, opts: Parameters<typeof renderView>[2] = {}) {
  const onClose = vi.fn()
  const r = await renderView(RegisterSheet, { init, onClose }, opts)
  return { ...r, onClose, user: userEvent.setup() }
}

/** a が b より前にある（文書の順） */
const before = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

const labelName = (id: string, name: string): LabelName => ({ id, name, updatedAt: 1, by: 'user', ai: null, via: null })

describe('題・欄の並び・初めの値（12.2）', () => {
  it('題は「予定を登録」。欄は 件名 → 区分 → 依頼者 → 開始日・締め切り日 → 開始・終了 → メモ → ロック・Task List → ラベルの色 の順（22. の 10.）', async () => {
    await open()
    expect(within(sheet()).getByRole('heading').textContent).toBe('予定を登録')
    const order = [
      testIds.itemTitle,
      testIds.itemKind('work'),
      testIds.itemKind('private'),
      testIds.itemRequester,
      testIds.itemStart,
      testIds.itemDue,
      testIds.itemStartTime,
      testIds.itemEndTime,
      testIds.itemMemo,
      testIds.itemLock,
      testIds.itemListed,
      testIds.itemLabel('none'),
      testIds.itemLabel('rose-l'),
      testIds.itemLabel('peony-d'),
      testIds.itemLabelName,
      testIds.itemCancel,
      testIds.itemRegister,
    ].map(byId)
    for (let i = 1; i < order.length; i++) expect(before(order[i - 1], order[i]), order[i].dataset.testid).toBe(true)
    // 欄の名前も同じ順（文書の順 = 画面の順 = Tab の順）
    expect([...sheet().querySelectorAll('.it-field-label, .it-cap')].map((e) => e.textContent)).toEqual([
      '件名',
      '区分',
      '依頼者',
      '開始日',
      '締め切り日',
      '開始',
      '終了',
      'メモ',
      'ラベルの色',
    ])
    // ロックと Task List にも出すは同じ1行（.it-switches）
    expect(byId(testIds.itemLock).closest('.it-switches')).toBe(byId(testIds.itemListed).closest('.it-switches'))
  })

  it('「詳しく」の畳む所は無く、開いた時からどの欄も出ている（22. の段階2の見本の確かめの 10.）', async () => {
    await open()
    expect(screen.queryByTestId('item-details')).toBeNull()
    expect(screen.queryByRole('button', { name: /詳しく/ })).toBeNull()
    expect(sheet().querySelector('.fold, [aria-expanded][aria-controls]')).toBeNull()
    for (const id of [testIds.itemRequester, testIds.itemMemo, testIds.itemLock, testIds.itemListed, testIds.itemLabel('none')])
      expect(byId(id).closest('[hidden]'), id).toBeNull()
  })

  it('件名は1行の入力欄（textarea。改行しない）で、開くとここにフォーカスする。初めは空', async () => {
    const { user } = await open()
    const title = byId(testIds.itemTitle) as HTMLTextAreaElement
    expect(title.tagName).toBe('TEXTAREA')
    expect(title.rows).toBe(1)
    expect(document.activeElement).toBe(title)
    expect(title.value).toBe('')
    await user.type(title, '打ち合わせ{Enter}の準備')
    expect(title.value).toBe('打ち合わせの準備')
  })

  it('件名は 200字まで（コードポイントで数える。絵文字 200字は入り、201字目は入らない）・貼った改行は空白に', async () => {
    const { user } = await open()
    const title = byId(testIds.itemTitle) as HTMLTextAreaElement
    title.focus()
    await user.paste('😀'.repeat(201))
    expect(Array.from(title.value)).toHaveLength(200)
    await user.clear(title)
    await user.paste('1行目\n2行目')
    expect(title.value).toBe('1行目 2行目')
  })

  it('初めの値: 区分は仕事、開始日は渡した日（「11月10日（火）」）で消せない、締め切り日は空（「空なら1日だけ」）、時刻は空、詳しくは全部空', async () => {
    await open()
    expect(sheet().getAttribute('data-kind')).toBe('work')
    expect(sheet().hasAttribute('data-label')).toBe(false)
    expect(sheet().classList.contains('label-band')).toBe(false)
    expect(byId(testIds.itemKind('work')).getAttribute('aria-pressed')).toBe('true')
    expect(byId(testIds.itemStart).textContent).toBe('11月10日（火）')
    expect(screen.queryByRole('button', { name: '開始日を消す' })).toBeNull()
    expect(byId(testIds.itemDue).textContent).toBe('なし')
    expect(screen.queryByTestId(testIds.itemDueClear)).toBeNull()
    expect(screen.getByText('空なら1日だけ')).toBeTruthy()
    expect((byId(testIds.itemStartTime) as HTMLInputElement).value).toBe('')
    expect((byId(testIds.itemEndTime) as HTMLInputElement).disabled).toBe(true)
    expect(byId(testIds.itemLabel('none')).getAttribute('aria-pressed')).toBe('true')
    expect((byId(testIds.itemRequester) as HTMLInputElement).value).toBe('')
    expect((byId(testIds.itemLock) as HTMLInputElement).checked).toBe(false)
    expect((byId(testIds.itemListed) as HTMLInputElement).checked).toBe(false)
    expect((byId(testIds.itemMemo) as HTMLTextAreaElement).value).toBe('')
    expect((byId(testIds.itemMemo) as HTMLTextAreaElement).rows).toBe(4)
  })

  it('開いた場所の区分と、タイムスケジュールの押した時刻（時の頭の 0 を落として出す。D24）を初めの値にする', async () => {
    await open({ start: '2026-11-12', kind: 'private', startTime: '09:00', endTime: '10:00' })
    expect(sheet().getAttribute('data-kind')).toBe('private')
    expect(byId(testIds.itemKind('private')).getAttribute('aria-pressed')).toBe('true')
    expect(byId(testIds.itemStart).textContent).toBe('11月12日（木）')
    expect((byId(testIds.itemStartTime) as HTMLInputElement).value).toBe('9:00')
    expect((byId(testIds.itemEndTime) as HTMLInputElement).value).toBe('10:00')
  })

  it('時刻は打てば1分単位も入り（907 → 9:07）、読めない字は元に戻す', async () => {
    const { user } = await open()
    const start = byId(testIds.itemStartTime) as HTMLInputElement
    await user.type(start, '907{Enter}')
    expect(start.value).toBe('9:07')
    expect((byId(testIds.itemEndTime) as HTMLInputElement).disabled).toBe(false)
    await user.clear(start)
    await user.type(start, 'あ')
    // 欄を離れる（jsdom は配置を持たないので、Modal の Tab の囲いが同じ欄へ戻す。blur で離れたことにする）
    act(() => start.blur())
    expect(start.value).toBe('9:07')
  })
})

describe('区分・ラベルを選び替えると、その場で地と帯の印が替わる（12.2・X2・ITEMS-188・189）', () => {
  it('区分', async () => {
    const { user } = await open()
    await user.click(byId(testIds.itemKind('private')))
    expect(sheet().getAttribute('data-kind')).toBe('private')
    expect(byId(testIds.itemKind('private')).getAttribute('aria-pressed')).toBe('true')
    expect(byId(testIds.itemKind('work')).getAttribute('aria-pressed')).toBe('false')
    await user.click(byId(testIds.itemKind('work')))
    expect(sheet().getAttribute('data-kind')).toBe('work')
  })

  it('ラベル（上の辺の帯 .label-band と data-label）。「なし」で帯を外す', async () => {
    const { user } = await open()
    await user.click(byId(testIds.itemLabel('rose-l')))
    expect(sheet().getAttribute('data-label')).toBe('rose-l')
    expect(sheet().classList.contains('label-band')).toBe(true)
    expect(byId(testIds.itemLabel('rose-l')).getAttribute('aria-pressed')).toBe('true')
    expect(byId(testIds.itemLabel('none')).getAttribute('aria-pressed')).toBe('false')
    await user.click(byId(testIds.itemLabel('peony-d')))
    expect(sheet().getAttribute('data-label')).toBe('peony-d')
    await user.click(byId(testIds.itemLabel('none')))
    expect(sheet().hasAttribute('data-label')).toBe(false)
    expect(sheet().classList.contains('label-band')).toBe(false)
  })

  it('ディープダークの題の左の区分のアイコン（かばん・家）も、区分を替えると替わる（読み上げない）', async () => {
    const { user } = await open()
    const icon = () => sheet().querySelector('.modal-head h2 .modal-title-icon')
    expect(icon()?.getAttribute('aria-hidden')).toBe('true')
    const work = icon()?.innerHTML
    await user.click(byId(testIds.itemKind('private')))
    expect(icon()?.innerHTML).not.toBe(work)
    expect(within(sheet()).getByRole('heading').textContent).toBe('予定を登録')
  })
})

describe('ラベルの色を選ぶ所（4.6・D35・ITEMS-021〜023）', () => {
  it('左に「なし」、24色を上の行に淡・下の行に濃の順で並べる。色は data-label から引く', async () => {
    await open()
    const swatches = [...sheet().querySelectorAll('.it-swatch')]
    expect(swatches.map((s) => s.getAttribute('data-label'))).toEqual([...LABEL_KEYS])
    expect(before(byId(testIds.itemLabel('none')), swatches[0])).toBe(true)
  })

  it('呼び名を付けていない色は、既定の呼び名を title と読み上げにだけ使い、画面の字には出さない', async () => {
    const { user } = await open()
    const rose = byId(testIds.itemLabel('rose-l'))
    expect(rose.getAttribute('title')).toBe(LABEL_DEFAULT_NAMES['rose-l'])
    expect(rose.getAttribute('aria-label')).toBe('桜・淡')
    await user.click(rose)
    expect(byId(testIds.itemLabelName).textContent).toBe('')
    expect(screen.queryByText('桜・淡')).toBeNull()
  })

  it('呼び名の1行は、欄の名前「ラベルの色」の横ではなく、色の並び（12×2）の下に置き、読み上げない（4.6・22. の 7.）', async () => {
    await open()
    const line = byId(testIds.itemLabelName)
    const group = screen.getByRole('group', { name: 'ラベルの色' })
    const caption = document.getElementById(group.getAttribute('aria-labelledby') ?? '')!
    expect(caption.textContent).toBe('ラベルの色')
    expect(caption.contains(line)).toBe(false)
    // 色の並びのすぐ下（同じ列の中で、色の並びの後）
    const swatches = group.querySelector('.it-swatches')!
    expect(line.parentElement).toBe(swatches.parentElement)
    expect(line.previousElementSibling).toBe(swatches)
    expect(before(byId(testIds.itemLabel('peony-d')), line)).toBe(true)
    expect(line.getAttribute('aria-hidden')).toBe('true')
  })

  it('付けた呼び名は、選んでいる色（乗せた色）の物を色の並びの下に出し、ほかの端末で変わってもすぐ出る（ITEMS-021・026）', async () => {
    const { user } = await open(undefined, {
      data: { labelNames: { 'sky-l': labelName('sky-l', '社内') } },
    })
    const name = () => byId(testIds.itemLabelName).textContent
    const sky = byId(testIds.itemLabel('sky-l'))
    expect(sky.getAttribute('aria-label')).toBe('社内')
    await user.hover(sky)
    expect(name()).toBe('社内')
    await user.unhover(sky)
    expect(name()).toBe('')
    await user.click(sky)
    expect(name()).toBe('社内')
    act(() => {
      const s = useApp.getState()
      useApp.setState({ data: { ...s.data, labelNames: { 'sky-l': labelName('sky-l', '本社') } } })
    })
    expect(name()).toBe('本社')
  })
})

describe('ボタン（12.2・ITEMS-184）', () => {
  it('件名が空・空白だけの間は［登録］を押せない', async () => {
    const { user } = await open()
    const register = byId(testIds.itemRegister) as HTMLButtonElement
    expect(register.textContent).toBe('登録')
    expect(register.classList.contains('btn-primary')).toBe(true)
    expect(register.disabled).toBe(true)
    await user.type(byId(testIds.itemTitle), '  ')
    expect(register.disabled).toBe(true)
    await user.type(byId(testIds.itemTitle), '会議')
    expect(register.disabled).toBe(false)
  })

  it('［やめる］・［×］で閉じる（onClose）', async () => {
    const { user, onClose } = await open()
    await user.click(byId(testIds.itemCancel))
    expect(onClose).toHaveBeenCalledTimes(1)
    await user.click(within(sheet()).getByTestId('modal-close'))
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})

// ---------- 後半（動き）: 登録・Ctrl/⌘+Enter・入力の決まり・書きかけの確かめ ----------

const items = () => Object.values(useApp.getState().data.items)

describe('登録する（12.2・12.4・ITEMS-187・194）', () => {
  it('［登録］で 12.4 の決まりを当ててから足し、閉じて、新しいカードを目立たせる（お知らせは出さない）', async () => {
    const { user, onClose } = await open({ start: '2026-11-12' })
    await user.type(byId(testIds.itemTitle), '  打ち合わせ  ')
    await user.click(byId(testIds.itemKind('private')))
    await user.click(byId(testIds.itemLabel('sky-l')))
    await user.type(byId(testIds.itemRequester), '総務')
    await user.click(byId(testIds.itemLock))
    await user.click(byId(testIds.itemListed))
    await user.type(byId(testIds.itemMemo), '持ち物')
    await user.click(byId(testIds.itemRegister))
    expect(onClose).toHaveBeenCalledTimes(1)
    const [item] = items()
    expect(item).toMatchObject({
      origin: 'calendar',
      title: '打ち合わせ',
      kind: 'private',
      start: '2026-11-12',
      due: null,
      startTime: null,
      endTime: null,
      label: 'sky-l',
      requester: '総務',
      locked: true,
      listed: true,
      memo: '持ち物',
      done: false,
      by: 'user',
    })
    expect(useCalendarUi.getState().flash?.key).toBe(`item:${item.id}`)
    expect(useToasts.getState().toasts).toEqual([])
  })

  it('Ctrl+Enter・⌘+Enter でも登録する（どの欄の中でも。ITEMS-185）', async () => {
    const { user, onClose } = await open()
    await user.type(byId(testIds.itemTitle), '会議')
    await user.keyboard('{Control>}{Enter}{/Control}')
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(items().map((i) => i.title)).toEqual(['会議'])
  })

  it('打ちかけの時刻（まだ欄を離れていない）も、Ctrl/⌘+Enter の前に決めてから登録する', async () => {
    const { user } = await open()
    await user.type(byId(testIds.itemTitle), '会議')
    await user.click(byId(testIds.itemStartTime))
    await user.keyboard('930')
    await user.keyboard('{Meta>}{Enter}{/Meta}')
    expect(items()[0]).toMatchObject({ title: '会議', startTime: '09:30', endTime: null })
  })

  it('件名が空の間は Ctrl+Enter でも登録しない', async () => {
    const { user, onClose } = await open()
    await user.keyboard('{Control>}{Enter}{/Control}')
    expect(onClose).not.toHaveBeenCalled()
    expect(items()).toEqual([])
  })

  it('翌日までの時刻は、入れた時から「翌日 02:00 まで」を出し、［登録］で2日の予定にして足す（D37・AMB-ITEMS-05）', async () => {
    const { user } = await open({ start: '2026-11-10' })
    await user.type(byId(testIds.itemTitle), '夜行バス')
    await user.type(byId(testIds.itemStartTime), '22:00{Enter}')
    await user.type(byId(testIds.itemEndTime), '2:00{Enter}')
    expect(byId(testIds.itemTimeHint).textContent).toBe('翌日 02:00 まで')
    // 登録するまでは日付はそのまま
    expect(byId(testIds.itemDue).textContent).toBe('なし')
    await user.click(byId(testIds.itemRegister))
    expect(items()[0]).toMatchObject({ start: '2026-11-10', due: '2026-11-11', startTime: '22:00', endTime: '02:00' })
  })

  it('翌日までの時刻を入れた後に日付を動かして 1日の予定で終了 < 開始になる時は、その日付にはできない（最後に直した欄。AMB-ITEMS-29）', async () => {
    const { user } = await open({ start: '2026-11-10' })
    await user.type(byId(testIds.itemStartTime), '22:00{Enter}')
    await user.type(byId(testIds.itemEndTime), '2:00{Enter}')
    await user.click(byId(testIds.itemStart))
    await user.click(byId(DATE_PICKER_TEST_ID).querySelector('[data-date="2026-11-12"]') as HTMLElement)
    expect(byId(testIds.itemDateError).textContent).toBe(DATE_REFUSED)
    expect(byId(testIds.itemStart).textContent).toBe('11月10日（火）')
  })

  it('締め切り日を選ぶと「空なら1日だけ」の欄に入り［×］で消せる。開始日より前の日なら開始日もそろえる（6.3）', async () => {
    const { user } = await open({ start: '2026-11-10' })
    await user.click(byId(testIds.itemDue))
    await user.click(byId(DATE_PICKER_TEST_ID).querySelector('[data-date="2026-11-13"]') as HTMLElement)
    expect(byId(testIds.itemDue).textContent).toBe('11月13日（金）')
    await user.click(byId(testIds.itemDueClear))
    expect(byId(testIds.itemDue).textContent).toBe('なし')
    await user.click(byId(testIds.itemDue))
    await user.click(byId(DATE_PICKER_TEST_ID).querySelector('[data-date="2026-11-06"]') as HTMLElement)
    expect(byId(testIds.itemStart).textContent).toBe('11月6日（金）')
    expect(byId(testIds.itemDue).textContent).toBe('11月6日（金）')
  })

  it('S の日付は下からのシートで選ぶ（D38）', async () => {
    const { user } = await open({ start: '2026-11-10' }, { width: 'S' })
    await user.click(byId(testIds.itemDue))
    const picker = byId(DATE_PICKER_TEST_ID)
    expect(picker.classList.contains('modal')).toBe(true)
    expect(within(picker).getByRole('heading').textContent).toBe('締め切り日を選ぶ')
    await user.click(picker.querySelector('[data-date="2026-11-11"]') as HTMLElement)
    expect(screen.queryByTestId(DATE_PICKER_TEST_ID)).toBeNull()
    expect(byId(testIds.itemDue).textContent).toBe('11月11日（水）')
  })

  it('開始時刻を空にすると終了時刻も消える（ITEMS-229）', async () => {
    const { user } = await open({ start: '2026-11-10', startTime: '13:00', endTime: '14:00' })
    const start = byId(testIds.itemStartTime) as HTMLInputElement
    await user.clear(start)
    act(() => start.blur())
    const end = byId(testIds.itemEndTime) as HTMLInputElement
    expect(end.value).toBe('')
    expect(end.disabled).toBe(true)
  })

  it('時刻の一覧の Esc は一覧だけを閉じる（登録の画面は閉じない）', async () => {
    const { user, onClose } = await open()
    await user.click(byId(testIds.itemStartTime))
    expect(byId(timeListTestId('start'))).toBeTruthy()
    await user.keyboard('{Escape}')
    expect(screen.queryByTestId(timeListTestId('start'))).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('依頼者の候補（直近 365日・回数の多い順）から選べる', async () => {
    const { user } = await open(undefined, {
      data: {
        items: {
          a: mkItem({ id: 'a', requester: '総務', createdAt: T0 - DAY }),
          b: mkItem({ id: 'b', requester: '営業部', createdAt: T0 - 2 * DAY }),
          c: mkItem({ id: 'c', requester: '営業部', createdAt: T0 - 3 * DAY }),
        },
      },
    })
    await user.click(byId(testIds.itemRequester))
    const list = screen.getByRole('listbox', { name: '依頼者の候補' })
    expect([...list.querySelectorAll('[role="option"]')].map((o) => o.textContent)).toEqual(['営業部', '総務'])
    await user.keyboard('{ArrowDown}{Enter}')
    expect((byId(testIds.itemRequester) as HTMLInputElement).value).toBe('営業部')
  })
})

describe('書きかけのまま閉じる時の確かめ（12.2・ITEMS-186・AMB-ITEMS-10）', () => {
  const discardDialog = () => screen.queryByRole('dialog', { name: '書きかけを捨てますか？' })

  it.each([
    ['［やめる］', () => fireEvent.click(byId(testIds.itemCancel))],
    ['［×］', () => fireEvent.click(within(sheet()).getByTestId('modal-close'))],
    ['Esc', () => fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })],
    ['背景', () => fireEvent.mouseDown(sheet().parentElement as HTMLElement)],
  ])(
    '%s: 件名に字があれば「書きかけを捨てますか？［捨てる］［戻る］」。［戻る］なら開いたまま、［捨てる］で閉じる',
    async (_name, close) => {
      const { user, onClose } = await open()
      await user.type(byId(testIds.itemTitle), '会議')
      act(() => close())
      const dialog = discardDialog()!
      const buttons = within(dialog)
        .getAllByRole('button')
        .filter((b) => b.dataset.testid?.startsWith('item-discard'))
      expect(buttons.map((b) => b.textContent)).toEqual(['捨てる', '戻る'])
      // 捨てると何が起きるかを1文で添える（空の本文の帯を出さない）
      expect(within(dialog).getByText(DISCARD_MESSAGE)).toBeTruthy()
      // 開いた時は［戻る］にフォーカス
      expect(document.activeElement).toBe(byId(DISCARD_TEST_IDS.keep))
      await user.click(byId(DISCARD_TEST_IDS.keep))
      expect(onClose).not.toHaveBeenCalled()
      expect(discardDialog()).toBeNull()
      act(() => close())
      await user.click(byId(DISCARD_TEST_IDS.discard))
      expect(onClose).toHaveBeenCalledTimes(1)
    },
  )

  it('メモだけに字がある時も確かめる。件名・メモが空なら確かめずに閉じる', async () => {
    const { user, onClose, unmount } = await open()
    await user.type(byId(testIds.itemMemo), 'あとで')
    await user.click(byId(testIds.itemCancel))
    expect(discardDialog()).not.toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    await user.click(byId(DISCARD_TEST_IDS.keep))
    unmount()
    const second = await open()
    await second.user.type(byId(testIds.itemTitle), '   ')
    await second.user.click(byId(testIds.itemCancel))
    expect(discardDialog()).toBeNull()
    expect(second.onClose).toHaveBeenCalledTimes(1)
  })

  it('「戻る」（履歴を戻す）も、書きかけの間は止めて確かめる。［戻る］なら開いたまま、［捨てる］で戻る', async () => {
    const { user, router } = await open()
    await act(() => router.navigate('/month/2026-11'))
    await user.type(byId(testIds.itemTitle), '会議')
    await act(() => router.navigate(-1))
    expect(discardDialog()).not.toBeNull()
    await user.click(byId(DISCARD_TEST_IDS.keep))
    expect(router.state.location.pathname).toBe('/month/2026-11')
    await act(() => router.navigate(-1))
    await user.click(byId(DISCARD_TEST_IDS.discard))
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  })

  it('書きかけでなければ「戻る」は止めない', async () => {
    const { router } = await open()
    await act(() => router.navigate('/month/2026-11'))
    await act(() => router.navigate(-1))
    expect(discardDialog()).toBeNull()
    expect(router.state.location.pathname).toBe('/')
  })

  it('登録した後の閉じ方（履歴を戻す）は止めない', async () => {
    const onClose = vi.fn()
    const r = await renderView(RegisterSheet, { init: { start: '2026-11-10' }, onClose }, {})
    await act(() => r.router.navigate('/month/2026-11'))
    onClose.mockImplementation(() => void r.router.navigate(-1))
    const user = userEvent.setup()
    await user.type(byId(testIds.itemTitle), '会議')
    await user.click(byId(testIds.itemRegister))
    await waitFor(() => expect(r.router.state.location.pathname).toBe('/'))
    expect(discardDialog()).toBeNull()
  })
})
