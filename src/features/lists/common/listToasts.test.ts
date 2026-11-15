// 3つのリストの［元に戻す］付きのお知らせ（src/features/lists/common/listToasts.ts。docs/SPEC.md の 3.9・6.15・7.13・18.2）: ルーチン・やりたいことを
// 消した時はゴミ箱から戻し（チェックの記録ごと・並びはほかを書き換えない）、もうゴミ箱に無ければ断る。ゴミ箱の1件には 6.15 の種類と
// 場所を書く（「Task List」「Favorite List」「Routine List › 毎週」）
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createPersistence, type Persistence } from '../../../db/persistence'
import { dataWith, mkCheck, mkFavorite, mkItem, mkRoutine } from '../../../domain/testData'
import { emptyData, type AppData } from '../../../domain/types'
import { actions } from '../../../store/actions'
import { getData, initStore, resetStoreForTests } from '../../../store/appStore'
import { useToasts } from '../../../store/uiStore'
import { resetUndoForTests, UNDO_CONFLICT } from '../../../store/undoStore'
import { notifyTrashUndo, restoreFromToast } from './listToasts'

let p: Persistence

async function start(data: AppData): Promise<void> {
  p = createPersistence(`list-toasts-${Math.random().toString(36).slice(2)}`)
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

describe('S3 消したルーチン・やりたいことのお知らせ（S3-FRAME-331〜334・S3-ROUTINE-221・222）', () => {
  it('［元に戻す］でゴミ箱からチェックの記録ごと戻す（ボタンは「元に戻す」・6秒の物）', async () => {
    const r = mkRoutine({ id: 'r1', title: 'ゴミ出し', cycle: 'weekly', weekdays: [1, 4] })
    await start(dataWith({ routines: [r], routineChecks: [mkCheck('r1', '2026-11', ['2026-11-09'])] }))
    const entry = await actions.trashRoutine('r1')
    expect(getData().routines.r1).toBeUndefined()
    notifyTrashUndo('『ゴミ出し』を削除しました', entry)
    expect(toasts().at(-1)).toMatchObject({ message: '『ゴミ出し』を削除しました', action: { label: '元に戻す' } })
    expect(await restoreFromToast(entry)).toBe(true)
    expect(getData().routines.r1?.title).toBe('ゴミ出し')
    expect(Object.values(getData().routineChecks).flatMap((c) => c.dates)).toEqual(['2026-11-09'])
  })

  it('その1件がもうゴミ箱に無い（ほかの端末で戻した・完全に消した）時は戻さず「ほかの所で直されたので戻せません」', async () => {
    await start(dataWith({ favorites: [mkFavorite({ id: 'f1', text: 'パン屋' })] }))
    const entry = await actions.trashFavorite('f1')
    await actions.restoreTrashEntry(entry)
    expect(await restoreFromToast(entry)).toBe(false)
    expect(toasts().at(-1)).toMatchObject({ kind: 'error', message: UNDO_CONFLICT })
  })

  it('ゴミ箱の1件の場所: カレンダーに出ていないタスクは「Task List」、やりたいことは「Favorite List」、ルーチンは「Routine List › 毎週」（6.15）', async () => {
    await start(
      dataWith({
        items: [mkItem({ id: 't', title: '資料を印刷する', origin: 'list', start: null, due: null, listed: true })],
        favorites: [mkFavorite({ id: 'f1', text: 'パン屋' })],
        routines: [mkRoutine({ id: 'r1', title: 'ゴミ出し', cycle: 'weekly', weekdays: [1, 4] })],
      }),
    )
    const places = [await actions.trashItem('t'), await actions.trashFavorite('f1'), await actions.trashRoutine('r1')].map(
      (e) => getData().trashEntries[e].place,
    )
    expect(places).toEqual(['Task List', 'Favorite List', 'Routine List › 毎週'])
  })
})
