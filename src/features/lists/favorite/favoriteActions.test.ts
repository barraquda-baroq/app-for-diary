// Favorite List の操作（src/features/lists/favorite/favoriteActions.ts。docs/SPEC.md の 15.・6.8・6.15・7.13・3.9）: 足す・中身を直す
// （前後の空白を落とす・空は書かない）、削除と［済みを片付ける］の［元に戻す］、［Task List へ移す］（先にタスクを足してから
// やりたいことをゴミ箱へ。［元に戻す］はタスクがそのままで、やりたいことがまだゴミ箱にある時だけ両方を戻し、そうでなければ何も
// 戻さずに断る）。どれも元に戻す・やり直すの並びに積まない
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPersistence, type Persistence } from '../../../db/persistence'
import { dataWith, mkFavorite } from '../../../domain/testData'
import { emptyData, type AppData } from '../../../domain/types'
import { actions } from '../../../store/actions'
import { getData, initStore, resetStoreForTests } from '../../../store/appStore'
import { useToasts } from '../../../store/uiStore'
import { enterUndoScope, resetUndoForTests, UNDO_CONFLICT, useUndo } from '../../../store/undoStore'
import { restoreFromToast } from '../common/listToasts'
import {
  addFavoriteFrom,
  clearDoneFavorites,
  deleteFavorite,
  moveFavoriteToTask,
  saveFavoriteText,
  setFavoriteDone,
  undoMoveToTask,
} from './favoriteActions'

let p: Persistence

async function start(data: AppData): Promise<void> {
  p = createPersistence(`favorite-actions-${Math.random().toString(36).slice(2)}`)
  await p.save(emptyData(), data)
  await p.completeUpload((await p.readOutbox(10_000)).map((it) => ({ table: it.table, id: it.id, record: it.local })))
  await initStore(p)
}

beforeEach(() => {
  resetStoreForTests()
  resetUndoForTests()
  useToasts.setState({ toasts: [] })
})

afterEach(() => {
  p?.close()
  resetStoreForTests()
})

const toasts = () => useToasts.getState().toasts
const lastToast = () => toasts().at(-1)
/** お知らせの［元に戻す］を押す（ゴミ箱から戻すのは端末の中のデータへの書き込みの後なので、確かめる側が vi.waitFor で待つ） */
const pressUndo = () => {
  const t = lastToast()
  expect(t?.action?.label).toBe('元に戻す')
  t?.action?.run()
}

const favs = () =>
  Object.values(getData().favorites)
    .sort((a, b) => a.order - b.order)
    .map((f) => f.text)

describe('S3 足す・直す・済み（15.1〜15.3。S3-FRAME-274・S3-ROUTINE-032〜034・S3-ROUTINE-185）', () => {
  it('足す: 前後の空白（空の行も）を落とし、中の改行はそのまま、いちばん上へ。空白だけは足さない', async () => {
    await start(dataWith({ favorites: [mkFavorite({ id: 'f1', text: 'パン屋', order: 0 })] }))
    const id = addFavoriteFrom('\n  週末に作りたい料理\nカレー  \n\n')
    expect(id).toBeDefined()
    expect(favs()).toEqual(['週末に作りたい料理\nカレー', 'パン屋'])
    expect(addFavoriteFrom(' \n ')).toBeUndefined()
    expect(favs()).toHaveLength(2)
    expect(toasts()).toEqual([])
  })

  it('中身を直す: 前後の空白を落とす。同じ中身・空白だけは書かない（空白だけは false で、呼んだ側が元に戻す）', async () => {
    await start(dataWith({ favorites: [mkFavorite({ id: 'f1', text: 'パン屋' })] }))
    const before = getData().favorites.f1
    expect(saveFavoriteText(before, '  パン屋  ')).toBe(true)
    expect(getData().favorites.f1).toBe(before)
    expect(saveFavoriteText(before, ' \n')).toBe(false)
    expect(getData().favorites.f1.text).toBe('パン屋')
    expect(saveFavoriteText(before, ' 近所のパン屋\nクロワッサン \n')).toBe(true)
    expect(getData().favorites.f1.text).toBe('近所のパン屋\nクロワッサン')
  })

  it('済みにする・外す（お知らせは出さない。doneAt を今に・外すと null）', async () => {
    await start(dataWith({ favorites: [mkFavorite({ id: 'f1', text: 'パン屋' })] }))
    expect(setFavoriteDone('f1', true)).toBe(true)
    expect(getData().favorites.f1).toMatchObject({ done: true, doneAt: expect.any(Number) })
    expect(setFavoriteDone('f1', false)).toBe(true)
    expect(getData().favorites.f1).toMatchObject({ done: false, doneAt: null })
    expect(toasts()).toEqual([])
  })
})

describe('S3 削除と［済みを片付ける］（15.3・15.4。S3-FRAME-283・287・S3-ROUTINE-187・192・195）', () => {
  it('削除: 確かめずにゴミ箱へ。「『1行目（20字まで）』を削除しました［元に戻す］」。［元に戻す］で元の所へ', async () => {
    const text = '旅行で行きたい所をもう少し長く書いた一行目\n海の見える公園'
    await start(dataWith({ favorites: [mkFavorite({ id: 'f1', text, order: -3 })] }))
    expect(await deleteFavorite(getData().favorites.f1)).toBe(true)
    expect(getData().favorites.f1).toBeUndefined()
    expect(lastToast()).toMatchObject({ message: '『旅行で行きたい所をもう少し長く書いた一行…』を削除しました' })
    pressUndo()
    await vi.waitFor(() => expect(getData().favorites.f1).toMatchObject({ text, order: -3 }))
  })

  it('［済みを片付ける］: 済みの物をまとめてゴミ箱の1件へ。「済みの n件をゴミ箱へ移しました［元に戻す］」。戻すと全部いっしょに戻る', async () => {
    await start(
      dataWith({
        favorites: [
          mkFavorite({ id: 'f1', text: 'パン屋', done: true, doneAt: 1 }),
          mkFavorite({ id: 'f2', text: 'ノート', done: true, doneAt: 2 }),
          mkFavorite({ id: 'f3', text: '公園' }),
        ],
      }),
    )
    expect(await clearDoneFavorites()).toBe(true)
    expect(Object.keys(getData().favorites)).toEqual(['f3'])
    expect(Object.values(getData().trashEntries)).toHaveLength(1)
    expect(lastToast()).toMatchObject({ message: '済みの 2件をゴミ箱へ移しました', action: { label: '元に戻す' } })
    pressUndo()
    await vi.waitFor(() => expect(Object.keys(getData().favorites).sort()).toEqual(['f1', 'f2', 'f3']))
  })

  it('［済みを片付ける］の［元に戻す］: その1件がもうゴミ箱に無ければ戻さず「ほかの所で直されたので戻せません」', async () => {
    await start(dataWith({ favorites: [mkFavorite({ id: 'f1', text: 'パン屋', done: true, doneAt: 1 })] }))
    await clearDoneFavorites()
    const entry = Object.keys(getData().trashEntries)[0]
    await actions.deleteTrashEntry(entry)
    expect(await restoreFromToast(entry)).toBe(false)
    expect(lastToast()).toMatchObject({ kind: 'error', message: UNDO_CONFLICT })
  })

  it('済みの物が無い時の［済みを片付ける］は何もせず、決まりのお知らせ（ボタンは出さないので、ふつうは押せない）', async () => {
    await start(dataWith({ favorites: [mkFavorite({ id: 'f1', text: 'パン屋' })] }))
    expect(await clearDoneFavorites()).toBe(false)
    expect(getData().favorites.f1).toBeDefined()
    expect(lastToast()).toMatchObject({ kind: 'error' })
  })
})

describe('S3 ［Task List へ移す］と［元に戻す］（15.4・7.13。S3-FRAME-286・S3-ROUTINE-191・S3-TASK-260）', () => {
  it('件名に最初の空でない行・メモに2行目からのタスク（list 生まれ・仕事・Task List に出す・済みでない）を足し、やりたいことはゴミ箱へ', async () => {
    await start(dataWith({ favorites: [mkFavorite({ id: 'f1', text: '\n週末に作りたい料理\nカレー\n親子丼' })] }))
    const moved = await moveFavoriteToTask(getData().favorites.f1)
    expect(moved).not.toBeNull()
    const task = getData().items[moved!.task.id]
    expect(task).toMatchObject({
      title: '週末に作りたい料理',
      memo: 'カレー\n親子丼',
      origin: 'list',
      kind: 'work',
      listed: true,
      done: false,
      start: null,
      due: null,
    })
    expect(getData().favorites.f1).toBeUndefined()
    expect(getData().trashEntries[moved!.entryId]).toBeDefined()
    expect(lastToast()).toMatchObject({ message: 'Task List へ移しました', action: { label: '元に戻す' } })
  })

  it('1行目が 200字を超える時は、件名は 200字まで・あふれた分はメモの頭へ（開発）', async () => {
    const head = 'あ'.repeat(200)
    await start(dataWith({ favorites: [mkFavorite({ id: 'f1', text: `${head}いうえ\n続きの行` })] }))
    const moved = await moveFavoriteToTask(getData().favorites.f1)
    expect(getData().items[moved!.task.id]).toMatchObject({ title: head, memo: 'いうえ\n続きの行' })
  })

  it('［元に戻す］: タスクをゴミ箱へ移し、やりたいことを元の所（並びも）へ戻す', async () => {
    await start(
      dataWith({
        favorites: [mkFavorite({ id: 'f0', text: '上の物', order: -2 }), mkFavorite({ id: 'f1', text: 'パン屋', order: -1 })],
      }),
    )
    await moveFavoriteToTask(getData().favorites.f1)
    pressUndo()
    await vi.waitFor(() => expect(getData().favorites.f1).toMatchObject({ text: 'パン屋', order: -1 }))
    expect(Object.values(getData().items)).toEqual([])
    expect(favs()).toEqual(['上の物', 'パン屋'])
  })

  it('［元に戻す］: タスクがほかの所で直されていたら、どちらも戻さずに「ほかの所で直されたので戻せません」', async () => {
    await start(dataWith({ favorites: [mkFavorite({ id: 'f1', text: 'パン屋' })] }))
    const moved = (await moveFavoriteToTask(getData().favorites.f1))!
    actions.updateItem(moved.task.id, { title: 'パン屋へ行く' })
    expect(await undoMoveToTask(moved)).toBe(false)
    expect(lastToast()).toMatchObject({ kind: 'error', message: UNDO_CONFLICT })
    expect(getData().items[moved.task.id].title).toBe('パン屋へ行く')
    expect(getData().favorites.f1).toBeUndefined()
    expect(getData().trashEntries[moved.entryId]).toBeDefined()
  })

  it('［元に戻す］: やりたいことがもうゴミ箱に無ければ（ほかの所で戻した・消した）、タスクも残して断る', async () => {
    await start(dataWith({ favorites: [mkFavorite({ id: 'f1', text: 'パン屋' })] }))
    const moved = (await moveFavoriteToTask(getData().favorites.f1))!
    await actions.deleteTrashEntry(moved.entryId)
    expect(await undoMoveToTask(moved)).toBe(false)
    expect(lastToast()).toMatchObject({ kind: 'error', message: UNDO_CONFLICT })
    expect(getData().items[moved.task.id]).toBeDefined()
  })

  it('［元に戻す］: タスクが消されていたら（ほかの所で削除した）断る', async () => {
    await start(dataWith({ favorites: [mkFavorite({ id: 'f1', text: 'パン屋' })] }))
    const moved = (await moveFavoriteToTask(getData().favorites.f1))!
    await actions.trashItem(moved.task.id)
    expect(await undoMoveToTask(moved)).toBe(false)
    expect(getData().favorites.f1).toBeUndefined()
  })

  it('ウィークリー・デイリーを出していても、元に戻す・やり直すの並びに積まない（お知らせの［元に戻す］だけ。7.13）', async () => {
    await start(dataWith({ favorites: [mkFavorite({ id: 'f1', text: 'パン屋' }), mkFavorite({ id: 'f2', text: 'ノート' })] }))
    const end = enterUndoScope()
    try {
      await moveFavoriteToTask(getData().favorites.f1)
      await deleteFavorite(getData().favorites.f2)
      expect(useUndo.getState().stack.past).toEqual([])
    } finally {
      end()
    }
  })
})
