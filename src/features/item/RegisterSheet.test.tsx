// 予定の登録の画面（docs/SPEC.md の 12.2・3.8・4.3・4.6）: 題・欄の並び・件名にフォーカス・初めの値、区分とラベルを選び替えると
// 地と帯の印（data-kind・data-label）がその場で替わる、「詳しく」の開閉を端末ごとに覚える、件名が空の間は［登録］を押せない、
// ラベルの呼び名の出し方、ディープダークの題の左のアイコン
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { LABEL_DEFAULT_NAMES, LABEL_KEYS } from '../../domain/labels'
import type { LabelName } from '../../domain/types'
import { useApp } from '../../store/appStore'
import { PREFS_KEY, usePrefs } from '../../store/uiStore'
import { renderView, setupCalendarTests } from '../../test/renderCalendar'
import { testIds } from '../calendar/common/testIds'
import type { RegisterInit } from '../calendar/common/types'
import { RegisterSheet } from './RegisterSheet'

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
  it('題は「予定を登録」。欄は 件名 → 区分 → 日付 → 時刻 → 詳しく（ラベル → 依頼者 → ロック → Task List → メモ）の順', async () => {
    await open()
    expect(within(sheet()).getByRole('heading').textContent).toBe('予定を登録')
    const order = [
      testIds.itemTitle,
      testIds.itemKind('work'),
      testIds.itemKind('private'),
      testIds.itemStart,
      testIds.itemDue,
      testIds.itemStartTime,
      testIds.itemEndTime,
      testIds.itemDetails,
      testIds.itemLabel('none'),
      testIds.itemLabel('rose-l'),
      testIds.itemRequester,
      testIds.itemLock,
      testIds.itemListed,
      testIds.itemMemo,
      testIds.itemCancel,
      testIds.itemRegister,
    ].map(byId)
    for (let i = 1; i < order.length; i++) expect(before(order[i - 1], order[i]), order[i].dataset.testid).toBe(true)
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
    const { user } = await open(undefined, { prefs: { detailsOpen: true } })
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
    await open(undefined, { prefs: { detailsOpen: true } })
    const swatches = [...sheet().querySelectorAll('.it-swatch')]
    expect(swatches.map((s) => s.getAttribute('data-label'))).toEqual([...LABEL_KEYS])
    expect(before(byId(testIds.itemLabel('none')), swatches[0])).toBe(true)
  })

  it('呼び名を付けていない色は、既定の呼び名を title と読み上げにだけ使い、画面の字には出さない', async () => {
    const { user } = await open(undefined, { prefs: { detailsOpen: true } })
    const rose = byId(testIds.itemLabel('rose-l'))
    expect(rose.getAttribute('title')).toBe(LABEL_DEFAULT_NAMES['rose-l'])
    expect(rose.getAttribute('aria-label')).toBe('桜・淡')
    await user.click(rose)
    expect(sheet().querySelector('.it-label-name')?.textContent).toBe('')
    expect(screen.queryByText('桜・淡')).toBeNull()
  })

  it('付けた呼び名は、選んでいる色（乗せた色）の物を欄の名前の横に出し、ほかの端末で変わってもすぐ出る（ITEMS-021・026）', async () => {
    const { user } = await open(undefined, {
      prefs: { detailsOpen: true },
      data: { labelNames: { 'sky-l': labelName('sky-l', '社内') } },
    })
    const name = () => sheet().querySelector('.it-label-name')?.textContent
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

describe('「詳しく」の開閉は端末ごとに覚える（6.13・ITEMS-178・FRAME-262）', () => {
  it('初めは閉じていて、開くと detailsOpen に書き、もう一度開いた登録の画面も開いている', async () => {
    const { user, unmount } = await open()
    const toggle = byId(testIds.itemDetails)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(document.getElementById(toggle.getAttribute('aria-controls') ?? '')?.classList.contains('is-closed')).toBe(true)
    await user.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(usePrefs.getState().detailsOpen).toBe(true)
    expect(JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}').detailsOpen).toBe(true)
    unmount()
    await open()
    expect(byId(testIds.itemDetails).getAttribute('aria-expanded')).toBe('true')
  })

  it('畳んだ中身は、畳む動き（180ms）が終わってから表示なし（hidden）にし、開く時はすぐ出す（Tab が見えない欄へ行かないように）', async () => {
    const { user } = await open()
    const toggle = byId(testIds.itemDetails)
    const content = () => document.getElementById(toggle.getAttribute('aria-controls') ?? '')?.firstElementChild as HTMLElement
    expect(content().hidden).toBe(true)
    await user.click(toggle)
    expect(content().hidden).toBe(false)
    await user.click(toggle)
    // 畳む動きの間は残す（高さが縮む動きを見せる）
    expect(content().hidden).toBe(false)
    await waitFor(() => expect(content().hidden).toBe(true))
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
