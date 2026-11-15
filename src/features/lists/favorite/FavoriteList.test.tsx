// Favorite List（src/features/lists/favorite。docs/SPEC.md の 15.・3.6・6.8・6.13・6.15・12.2）をトップの画面の中で確かめる: 行（新しい物が
// 上・2行以上なら1行目を太く・http(s) のリンク・リンクを押しても直さない・3行を超えたら「続き」・足した日・分類の無い行）、入力欄
// （PC の Enter で足す・Shift+Enter で改行・指の端末の Enter は改行で［足す］で足す・変換中は足さない）、その場で直す（PC の Enter で
// 保存・指の端末の Enter は改行・止まって 0.6秒で保存・空は元に戻す・Esc でやめる）、済み・「済み n件」・［済みを片付ける］、「…」の
// ［詳しく］［予定にする］［Task List へ移す］［削除］、［詳しく］のパネル。リンクの新しいタブ・3行の測り・キーボードの上の欄・高さの
// 上限は E2E（e2e/favorite-list.spec.ts）
import { act, fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LIST_IDS, LIST_TODAY, listData } from '../../../../e2e/fixtures/listData'
import { mkFavorite } from '../../../domain/testData'
import type { AppData } from '../../../domain/types'
import { actions } from '../../../store/actions'
import { getData, useApp } from '../../../store/appStore'
import { useCalendarUi, usePrefs, useToasts } from '../../../store/uiStore'
import { renderAt, setupCalendarTests } from '../../../test/renderCalendar'
import { sheetOf } from '../../calendar/common/sheets'
import { discardListDraft } from '../common/listDraft'
import { draftKey } from '../common/listInputModel'
import { listTestIds } from '../common/testIds'
import { favoritePanelTestIds } from './favoriteTestIds'

setupCalendarTests()
afterEach(() => {
  vi.restoreAllMocks()
})

const I = LIST_IDS
const byId = (id: string) => screen.getByTestId(id)
const rowOf = (id: string) => screen.queryByTestId(listTestIds.row('favorite', id))
const titleOf = (id: string) => byId(listTestIds.rowTitle('favorite', id))
const input = () => byId(listTestIds.input('favorite')) as HTMLTextAreaElement
/** 並んだ行の中身（「済み n件」を開いていれば済んだ行も） */
const texts = () =>
  within(byId(listTestIds.body('favorite')))
    .queryAllByTestId(/^list-favorite-title-/)
    .map((el) => el.textContent)
const toasts = () => useToasts.getState().toasts
const openMenu = async (user: ReturnType<typeof userEvent.setup>, id: string) => {
  await user.click(byId(listTestIds.rowMore('favorite', id)))
  return within(byId(listTestIds.rowMenu('favorite')))
}

/**
 * ゴミ箱へ移す・戻す（端末の中の raw の記録に当てる。このテストの偽物の保存先では動かないので、表示用の記録だけを替える物にする。
 * 本当の出し入れ・［元に戻す］の確かめは favoriteActions.test.ts（本物の保存先））
 */
function fakeTrash() {
  const entries = new Map<string, () => void>()
  let n = 0
  const take = (table: 'favorites' | 'items', ids: string[]) => {
    const id = `e${++n}`
    const st = useApp.getState()
    const saved = ids.map((k) => st.data[table][k]).filter(Boolean)
    useApp.setState((s) => {
      const rows = { ...s.data[table] } as Record<string, unknown>
      for (const k of ids) delete rows[k]
      const entry = { id } as AppData['trashEntries'][string]
      return { data: { ...s.data, [table]: rows, trashEntries: { ...s.data.trashEntries, [id]: entry } } }
    })
    entries.set(id, () =>
      useApp.setState((s) => {
        const rows = { ...s.data[table] } as Record<string, unknown>
        for (const r of saved) rows[r.id] = r
        const trashEntries = { ...s.data.trashEntries }
        delete trashEntries[id]
        return { data: { ...s.data, [table]: rows, trashEntries } }
      }),
    )
    return id
  }
  return {
    trashFavorite: vi.spyOn(actions, 'trashFavorite').mockImplementation(async (fid) => take('favorites', [fid])),
    trashDoneFavorites: vi.spyOn(actions, 'trashDoneFavorites').mockImplementation(async () => {
      const done = Object.values(useApp.getState().data.favorites).filter((f) => f.done)
      return {
        entryId: take(
          'favorites',
          done.map((f) => f.id),
        ),
        count: done.length,
      }
    }),
    trashItem: vi.spyOn(actions, 'trashItem').mockImplementation(async (iid) => take('items', [iid])),
    restore: vi.spyOn(actions, 'restoreTrashEntry').mockImplementation(async (eid) => {
      entries.get(eid)?.()
      return undefined as never
    }),
  }
}

async function open(opts: { data?: Partial<AppData>; width?: 'L' | 'S'; pointer?: 'fine' | 'coarse' } = {}) {
  const user = userEvent.setup()
  const r = await renderAt('/week/2026-11-08', {
    data: opts.data ?? listData(LIST_TODAY),
    width: opts.width ?? 'L',
    pointer: opts.pointer,
  })
  if ((opts.width ?? 'L') === 'S') await user.click(byId(listTestIds.fold('favorite')))
  return { ...r, user }
}

describe('S3 行（15.2。S3-FRAME-275〜280・S3-ROUTINE-035・170・179〜183）', () => {
  it('新しい物が上。2行以上の物は1行目を太く（改行で数える）。足した日は「10/11」の形（等幅）。区分・分類の印は無い', async () => {
    await open()
    expect(texts()).toEqual([
      '近所のパン屋に行ってみる',
      '週末に作りたい料理\nカレー\n親子丼\nポトフ',
      '気になる記事\nhttps://example.com/article',
      '旅行で行きたい所\n海の見える公園\n古い町並みの残る通り\n山の上の展望台\n湖のほとりのカフェ\n星のよく見える高原',
    ])
    expect(titleOf(I.bakery).querySelector('.fv-first')).toBeNull()
    expect(titleOf(I.recipes).querySelector('.fv-first')?.textContent).toBe('週末に作りたい料理')
    const added = byId(listTestIds.favoriteAdded(I.bakery))
    expect(added.classList.contains('mono')).toBe(true)
    expect(added.textContent).toMatch(/^足した日 \d{1,2}\/\d{1,2}$/)
    const row = rowOf(I.bakery)!
    expect(row.querySelector('[data-kind], .kind-marker')).toBeNull()
  })

  it('足した日は、年が今日と違う時だけ年も出す（開発）', async () => {
    // 足した日は端末の暦の日付なので、作った時刻も端末の時刻で置く（どの時間帯で流しても同じ日になる）
    await open({
      data: {
        favorites: {
          old: mkFavorite({ id: 'old', text: '去年の物', createdAt: new Date(2025, 10, 10, 9).getTime() }),
          now: mkFavorite({ id: 'now', text: '今年の物', order: -1, createdAt: new Date(2026, 10, 9, 9).getTime() }),
        },
      },
    })
    expect(byId(listTestIds.favoriteAdded('old')).textContent).toBe('足した日 2025/11/10')
    expect(byId(listTestIds.favoriteAdded('now')).textContent).toBe('足した日 11/9')
  })

  it('http・https の URL は押せるリンク（新しいタブ・rel="noopener noreferrer"）。ほかの形はリンクにしない', async () => {
    await open({
      data: {
        favorites: {
          f1: mkFavorite({
            id: 'f1',
            text: '読む http://example.com/a と https://example.com/b。ftp://example.com/c は字のまま',
          }),
        },
      },
    })
    const links = [...titleOf('f1').querySelectorAll('a')]
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['http://example.com/a', 'https://example.com/b'])
    for (const a of links) {
      expect(a.getAttribute('target')).toBe('_blank')
      expect(a.getAttribute('rel')).toBe('noopener noreferrer')
    }
  })

  it('リンクを押しても直し始めない。リンクの外の字を押すと直す（リンクのある物はボタンにしない）', async () => {
    const { user } = await open()
    const box = titleOf(I.article)
    expect(box.tagName).toBe('DIV')
    const link = box.querySelector('a')!
    // jsdom は押したリンクを開かない（新しいタブは E2E）
    link.addEventListener('click', (e) => e.preventDefault())
    await user.click(link)
    expect(screen.queryByTestId(listTestIds.rowEdit('favorite', I.article))).toBeNull()
    await user.click(box.querySelector('.fv-first')!)
    expect(document.activeElement).toBe(byId(listTestIds.rowEdit('favorite', I.article)))
  })

  it('3行を超える物だけ「続き」。押すと全部見せ、「続き」は消える', async () => {
    // 3行に収まらない（測った高さが枠より高い）のは「旅行で行きたい所」だけにする（jsdom は描かないので測る値を決める）
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('fv-text') && this.textContent?.startsWith('旅行') ? 120 : 60
    })
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('fv-text') ? 60 : 0
    })
    const { user } = await open()
    expect(screen.queryByTestId(listTestIds.favoriteMore(I.recipes))).toBeNull()
    const more = byId(listTestIds.favoriteMore(I.trips))
    expect(more.textContent).toBe('続き')
    expect(titleOf(I.trips).querySelector('.fv-text')?.classList.contains('is-clamped')).toBe(true)
    await user.click(more)
    expect(screen.queryByTestId(listTestIds.favoriteMore(I.trips))).toBeNull()
    expect(titleOf(I.trips).querySelector('.fv-text')?.classList.contains('is-clamped')).toBe(false)
    // 「続き」を押しても直し始めない
    expect(screen.queryByTestId(listTestIds.rowEdit('favorite', I.trips))).toBeNull()
  })
})

describe('S3 入力欄（15.1・3.6・12.1。S3-FRAME-272・273・288・S3-ROUTINE-176）', () => {
  it('PC: Enter でいちばん上に足し（前後の空白は落とす）、欄と書きかけを空にしてフォーカスを残し、足した行を目立たせる。お知らせは出さない', async () => {
    const { user } = await open()
    await user.click(input())
    await user.keyboard('  帽子を買う  ')
    await vi.waitFor(() => expect(localStorage.getItem(draftKey('favorite'))).toBe('  帽子を買う  '))
    await user.keyboard('{Enter}')
    expect(texts()[0]).toBe('帽子を買う')
    expect(input().value).toBe('')
    expect(document.activeElement).toBe(input())
    expect(localStorage.getItem(draftKey('favorite'))).toBeNull()
    const id = Object.values(getData().favorites).find((f) => f.text === '帽子を買う')!.id
    expect(useCalendarUi.getState().flash?.keys).toEqual([`list:favorite:${id}`])
    expect(toasts()).toEqual([])
  })

  it('PC: Shift+Enter は改行（足さない）。変換を決める Enter でも足さない', async () => {
    const { user } = await open()
    await user.click(input())
    await user.keyboard('一行目{Shift>}{Enter}{/Shift}二行目')
    expect(input().value).toBe('一行目\n二行目')
    fireEvent.compositionStart(input())
    fireEvent.keyDown(input(), { key: 'Enter', keyCode: 229 })
    fireEvent.compositionEnd(input())
    expect(Object.values(getData().favorites)).toHaveLength(5)
    await user.keyboard('{Enter}')
    expect(texts()[0]).toBe('一行目\n二行目')
  })

  it('指の端末（S）: Enter は改行で足さず、［足す］（✓）で足す。空白だけの時の［足す］は何もしない', async () => {
    const { user } = await open({ width: 'S' })
    await user.click(input())
    await user.keyboard('あ{Enter}い')
    expect(input().value).toBe('あ\nい')
    expect(Object.values(getData().favorites)).toHaveLength(5)
    await user.click(byId(listTestIds.add('favorite')))
    expect(texts()[0]).toBe('あ\nい')
    expect(input().value).toBe('')
    expect(byId(listTestIds.add('favorite')).getAttribute('aria-disabled')).toBe('true')
    await user.click(byId(listTestIds.add('favorite')))
    expect(Object.values(getData().favorites)).toHaveLength(6)
  })

  it('■34: 打ちかけを捨てると欄も書きかけも空になる（足さない）', async () => {
    const { user } = await open()
    await user.click(input())
    await user.keyboard('捨てる字')
    act(() => discardListDraft('favorite'))
    expect(input().value).toBe('')
    expect(localStorage.getItem(draftKey('favorite'))).toBeNull()
    expect(Object.values(getData().favorites)).toHaveLength(5)
  })
})

describe('S3 その場で直す（15.2・開発。S3-FRAME-280・S3-ROUTINE-183・202）', () => {
  it('押した出来事の中で欄にフォーカスし（iPhone でもキーボードが出る）、PC の Enter で保存（前後の空白は落とす）', async () => {
    const { user } = await open()
    await user.click(titleOf(I.bakery))
    const edit = byId(listTestIds.rowEdit('favorite', I.bakery)) as HTMLTextAreaElement
    expect(document.activeElement).toBe(edit)
    expect(edit.value).toBe('近所のパン屋に行ってみる')
    await user.keyboard('{Shift>}{Enter}{/Shift}クロワッサン  {Enter}')
    expect(screen.queryByTestId(listTestIds.rowEdit('favorite', I.bakery))).toBeNull()
    expect(getData().favorites[I.bakery].text).toBe('近所のパン屋に行ってみる\nクロワッサン')
  })

  it('空にして欄から出ると、保存せずに元に戻す。Esc は保存せずにやめる', async () => {
    const { user } = await open()
    await user.click(titleOf(I.bakery))
    await user.clear(byId(listTestIds.rowEdit('favorite', I.bakery)))
    await user.click(input())
    expect(getData().favorites[I.bakery].text).toBe('近所のパン屋に行ってみる')
    expect(titleOf(I.bakery).textContent).toBe('近所のパン屋に行ってみる')
    await user.click(titleOf(I.bakery))
    await user.keyboard('を書き換え{Escape}')
    expect(getData().favorites[I.bakery].text).toBe('近所のパン屋に行ってみる')
  })

  it('止まってから 0.6秒で保存し（打っている欄はそのまま）、欄から出ても保存する（外を押すと保存）', async () => {
    const { user } = await open()
    await user.click(titleOf(I.bakery))
    await user.keyboard('と')
    expect(getData().favorites[I.bakery].text).toBe('近所のパン屋に行ってみる')
    await vi.waitFor(() => expect(getData().favorites[I.bakery].text).toBe('近所のパン屋に行ってみると'), { timeout: 2000 })
    expect(screen.getByTestId(listTestIds.rowEdit('favorite', I.bakery))).toBeTruthy()
    await user.keyboard('ても')
    await user.click(input())
    expect(getData().favorites[I.bakery].text).toBe('近所のパン屋に行ってみるとても')
  })

  it('指の端末: Enter は改行（保存して閉じない）', async () => {
    const { user } = await open({ width: 'S' })
    await user.click(titleOf(I.bakery))
    await user.keyboard('{Enter}二行目')
    const edit = byId(listTestIds.rowEdit('favorite', I.bakery)) as HTMLTextAreaElement
    expect(edit.value).toBe('近所のパン屋に行ってみる\n二行目')
  })
})

describe('S3 済み（15.3・3.9。S3-FRAME-282・283・S3-ROUTINE-185〜187・195）', () => {
  it('チェックすると「済み n件」（畳んだまま）へ沈み、その区切りを目立たせる。外すと元の所へ戻る。お知らせは出さない', async () => {
    const { user } = await open()
    expect(usePrefs.getState().collapsed.favoriteDone).toBe(true)
    await user.click(byId(listTestIds.rowCheck('favorite', I.recipes)))
    expect(rowOf(I.recipes)).toBeNull()
    expect(byId(listTestIds.done('favorite')).textContent).toContain('済み 2件')
    expect(useCalendarUi.getState().flash?.keys).toEqual(['list:favorite:done'])
    expect(getData().favorites[I.recipes].done).toBe(true)
    // 開いて外す
    await user.click(within(byId(listTestIds.done('favorite'))).getByRole('button', { name: /済み 2件/ }))
    await user.click(byId(listTestIds.rowCheck('favorite', I.recipes)))
    expect(texts().slice(0, 2)).toEqual(['近所のパン屋に行ってみる', '週末に作りたい料理\nカレー\n親子丼\nポトフ'])
    expect(useCalendarUi.getState().flash?.keys).toEqual([`list:favorite:${I.recipes}`])
    expect(toasts()).toEqual([])
  })

  it('フォーカスのあった行が畳んだ「済み n件」へ隠れる時は、区切りへフォーカスを移す。開いている時は行が残りフォーカスもそのまま', async () => {
    const { user } = await open()
    byId(listTestIds.rowCheck('favorite', I.bakery)).focus()
    await user.keyboard('{Enter}')
    expect(document.activeElement).toBe(within(byId(listTestIds.done('favorite'))).getByRole('button', { name: /済み/ }))
    await user.keyboard('{Enter}')
    const check = byId(listTestIds.rowCheck('favorite', I.recipes))
    check.focus()
    await user.keyboard('{Enter}')
    expect(document.activeElement).toBe(byId(listTestIds.rowCheck('favorite', I.recipes)))
    expect(byId(listTestIds.rowCheck('favorite', I.recipes))).toBe(check)
  })

  it('「済み n件」を開くと［済みを片付ける］。押すとまとめてゴミ箱へ・お知らせに［元に戻す］・フォーカスは見出しの畳む・開くへ', async () => {
    const trash = fakeTrash()
    const { user } = await open()
    expect(screen.queryByTestId(listTestIds.favoriteClearDone)).toBeNull()
    await user.click(within(byId(listTestIds.done('favorite'))).getByRole('button', { name: /済み 1件/ }))
    await user.click(byId(listTestIds.favoriteClearDone))
    await vi.waitFor(() => expect(getData().favorites[I.notebook]).toBeUndefined())
    expect(screen.queryByTestId(listTestIds.done('favorite'))).toBeNull()
    expect(toasts().at(-1)).toMatchObject({ message: '済みの 1件をゴミ箱へ移しました', action: { label: '元に戻す' } })
    await vi.waitFor(() => expect(document.activeElement).toBe(byId(listTestIds.fold('favorite'))))
    expect(trash.trashDoneFavorites).toHaveBeenCalledTimes(1)
  })
})

describe('S3 行の操作（15.4・12.2。S3-FRAME-111・284〜287・S3-ROUTINE-189〜192）', () => {
  it('「…」は［詳しく］［予定にする］［Task List へ移す］［削除］', async () => {
    const { user } = await open()
    const menu = await openMenu(user, I.bakery)
    expect(menu.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['詳しく', '予定にする', 'Task List へ移す', '削除'])
  })

  it('［予定にする］: 登録の画面を、件名に1行目・メモに残り・今日・仕事で開く（Favorite List から開いた印。元の項目は残す）', async () => {
    const { user, router } = await open()
    const menu = await openMenu(user, I.recipes)
    await user.click(menu.getByRole('menuitem', { name: '予定にする' }))
    expect(sheetOf(router.state.location.state)).toEqual({
      kind: 'register',
      init: { start: LIST_TODAY, kind: 'work', title: '週末に作りたい料理', memo: 'カレー\n親子丼\nポトフ' },
      from: 'favorite',
    })
    const dialog = await screen.findByRole('dialog')
    expect((within(dialog).getByDisplayValue('週末に作りたい料理') as HTMLElement).tagName).toBeTruthy()
    expect(getData().favorites[I.recipes]).toBeDefined()
  })

  it('［Task List へ移す］: タスクを足して元の項目をゴミ箱へ、「Task List へ移しました［元に戻す］」', async () => {
    const trash = fakeTrash()
    const { user } = await open()
    const menu = await openMenu(user, I.recipes)
    await user.click(menu.getByRole('menuitem', { name: 'Task List へ移す' }))
    await vi.waitFor(() => expect(rowOf(I.recipes)).toBeNull())
    const task = Object.values(getData().items).find((t) => t.title === '週末に作りたい料理')
    expect(task).toMatchObject({ origin: 'list', kind: 'work', listed: true, memo: 'カレー\n親子丼\nポトフ' })
    expect(toasts().at(-1)).toMatchObject({ message: 'Task List へ移しました', action: { label: '元に戻す' } })
    act(() => toasts().at(-1)!.action!.run())
    await vi.waitFor(() => expect(rowOf(I.recipes)).not.toBeNull())
    expect(getData().items[task!.id]).toBeUndefined()
    expect(trash.trashFavorite).toHaveBeenCalledWith(I.recipes)
    expect(trash.trashItem).toHaveBeenCalledWith(task!.id)
  })

  it('［削除］: 確かめずに消し、「『1行目』を削除しました［元に戻す］」', async () => {
    const trash = fakeTrash()
    const { user } = await open()
    const menu = await openMenu(user, I.trips)
    await user.click(menu.getByRole('menuitem', { name: '削除' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    await vi.waitFor(() => expect(rowOf(I.trips)).toBeNull())
    expect(toasts().at(-1)).toMatchObject({ message: '『旅行で行きたい所』を削除しました', action: { label: '元に戻す' } })
    act(() => toasts().at(-1)!.action!.run())
    await vi.waitFor(() => expect(rowOf(I.trips)).not.toBeNull())
    expect(trash.trashFavorite).toHaveBeenCalledWith(I.trips)
    expect(trash.restore).toHaveBeenCalledTimes(1)
  })
})

describe('S3 ［詳しく］のパネル（3.6・15.4・4.10。S3-FRAME-075〜078）', () => {
  it('題は「やりたいこと」・中身・足した日・［削除］。開いた時は中身の欄にフォーカスしない', async () => {
    const { user } = await open()
    const menu = await openMenu(user, I.recipes)
    await user.click(menu.getByRole('menuitem', { name: '詳しく' }))
    const panel = await screen.findByTestId(listTestIds.favoritePanel)
    expect(within(panel).getByRole('heading').textContent).toContain('やりたいこと')
    const text = byId(favoritePanelTestIds.text) as HTMLTextAreaElement
    expect(text.value).toBe('週末に作りたい料理\nカレー\n親子丼\nポトフ')
    expect(document.activeElement).not.toBe(text)
    expect(byId(favoritePanelTestIds.added).textContent).toMatch(/^\d{1,2}\/\d{1,2} に足しました$/)
  })

  it('中身を直すとそのまま保存（前後の空白を落とす）。空にして欄から出ると保存してある中身に戻す', async () => {
    const { user } = await open()
    await user.click((await openMenu(user, I.bakery)).getByRole('menuitem', { name: '詳しく' }))
    const text = (await screen.findByTestId(favoritePanelTestIds.text)) as HTMLTextAreaElement
    await user.click(text)
    await user.keyboard('！ ')
    // 欄から出る（jsdom は Tab でパネルの中を回る所を測れないので、blur で）
    act(() => text.blur())
    expect(getData().favorites[I.bakery].text).toBe('近所のパン屋に行ってみる！')
    await user.clear(byId(favoritePanelTestIds.text))
    act(() => (byId(favoritePanelTestIds.text) as HTMLTextAreaElement).blur())
    expect(getData().favorites[I.bakery].text).toBe('近所のパン屋に行ってみる！')
    expect((byId(favoritePanelTestIds.text) as HTMLTextAreaElement).value).toBe('近所のパン屋に行ってみる！')
  })

  it('［削除］で消してパネルを閉じる（［元に戻す］付きのお知らせ）', async () => {
    const trash = fakeTrash()
    const { user } = await open()
    await user.click((await openMenu(user, I.bakery)).getByRole('menuitem', { name: '詳しく' }))
    await user.click(await screen.findByTestId(favoritePanelTestIds.remove))
    await vi.waitFor(() => expect(screen.queryByTestId(listTestIds.favoritePanel)).toBeNull())
    expect(getData().favorites[I.bakery]).toBeUndefined()
    expect(toasts().at(-1)).toMatchObject({ message: '『近所のパン屋に行ってみる』を削除しました' })
    expect(trash.trashFavorite).toHaveBeenCalledWith(I.bakery)
  })
})
