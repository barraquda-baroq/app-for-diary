// カレンダーの画面での OS の「戻る」で、アプリを閉じるかを聞く（docs/SPEC.md の 3.1。22. の段階2の終わりの確かめの ■22）:
// 「Diary Studio を閉じますか？」［キャンセル］［閉じる］。データの保存の注意は出さず、同期していない変更がある時だけ1行。
// ［閉じる］で書きかけを保存してからアプリの履歴の前へ。閉じられなかった時はお知らせ。聞いている間の「戻る」は聞くのをやめる
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useToasts } from '../../store/uiStore'
import { useSync } from '../../sync/controller'
import type { SyncStatus } from '../../sync/engine'
import { DialogHost, hasOpenDialog } from '../../ui/dialogs'

const leaveApp = vi.fn<() => Promise<'left' | 'armed' | 'stayed'>>()
const saveBeforeLeave = vi.fn<() => Promise<boolean>>()

vi.mock('../../history/appHistory', () => ({ leaveApp: () => leaveApp() }))
vi.mock('../../store/lifecycle', () => ({ saveBeforeLeave: () => saveBeforeLeave() }))

const { askToCloseApp, CLOSE_TEST_IDS, CLOSE_TITLE, leaveNotice, unsyncedLine } = await import('./closeApp')

function syncStatus(pending: number): SyncStatus {
  return { phase: pending > 0 ? 'offline' : 'synced', pending, lastSyncedAt: null, error: null }
}

beforeEach(() => {
  leaveApp.mockReset().mockResolvedValue('left')
  saveBeforeLeave.mockReset().mockResolvedValue(true)
  useToasts.setState({ toasts: [] })
  useSync.setState({ status: syncStatus(0) })
  render(<DialogHost />)
})

afterEach(() => {
  cleanup()
})

/** 聞き始めて、確かめが出るまで（done は聞き終えた時。async の戻り値にすると、聞き終えるまで待ってしまうので包む） */
async function ask(): Promise<{ done: Promise<void> }> {
  let done!: Promise<void>
  act(() => {
    done = askToCloseApp()
  })
  await screen.findByRole('dialog')
  return { done }
}

describe('閉じるかの確かめ', () => {
  it('題は「Diary Studio を閉じますか？」、ボタンは［キャンセル］［閉じる］。同期していない変更が無ければ、保存の注意は出さない', async () => {
    const { done } = await ask()
    expect(screen.getByRole('dialog').textContent).toContain(CLOSE_TITLE)
    expect(screen.getByTestId(CLOSE_TEST_IDS.cancel).textContent).toBe('キャンセル')
    expect(screen.getByTestId(CLOSE_TEST_IDS.close).textContent).toBe('閉じる')
    expect(screen.getByRole('dialog').textContent).not.toContain('保存')
    expect(screen.getByRole('dialog').textContent).not.toContain('同期')
    await userEvent.setup().click(screen.getByTestId(CLOSE_TEST_IDS.cancel))
    await done
  })

  it('同期していない変更がある時だけ、端末に保存してあって次に開いた時に送ることを1行で添える', async () => {
    useSync.setState({ status: syncStatus(3) })
    const { done } = await ask()
    expect(screen.getByRole('dialog').textContent).toContain(
      '同期していない変更（3件）は、この端末に保存してあり、次に開いた時に送ります。',
    )
    await userEvent.setup().click(screen.getByTestId(CLOSE_TEST_IDS.cancel))
    await done
    expect(unsyncedLine(0)).toBeUndefined()
    expect(unsyncedLine(1)).toContain('1件')
  })

  it('［キャンセル］では閉じない（保存もしない）', async () => {
    const { done } = await ask()
    await userEvent.setup().click(screen.getByTestId(CLOSE_TEST_IDS.cancel))
    await done
    expect(saveBeforeLeave).not.toHaveBeenCalled()
    expect(leaveApp).not.toHaveBeenCalled()
    expect(hasOpenDialog()).toBe(false)
  })

  it('［閉じる］で書きかけを端末に保存してからアプリの前へ戻る（離れた時はお知らせを出さない）', async () => {
    const { done } = await ask()
    await userEvent.setup().click(screen.getByTestId(CLOSE_TEST_IDS.close))
    await done
    expect(saveBeforeLeave).toHaveBeenCalledTimes(1)
    expect(leaveApp).toHaveBeenCalledTimes(1)
    expect(saveBeforeLeave.mock.invocationCallOrder[0]).toBeLessThan(leaveApp.mock.invocationCallOrder[0])
    expect(useToasts.getState().toasts).toEqual([])
  })

  it('閉じられなかった時は、お知らせで言う（Android: もう一度［戻る］で閉じる、PC: タブ・ウインドウを閉じてもらう）', async () => {
    leaveApp.mockResolvedValue('armed')
    const { done } = await ask()
    await userEvent.setup().click(screen.getByTestId(CLOSE_TEST_IDS.close))
    await done
    expect(useToasts.getState().toasts.map((t) => t.message)).toEqual(['もう一度［戻る］を押すと閉じます'])
    expect(leaveNotice('stayed')).toContain('タブ・ウインドウを閉じてください')
    expect(leaveNotice('left')).toBeNull()
  })

  it('端末に保存できなかった時は閉じない', async () => {
    saveBeforeLeave.mockResolvedValue(false)
    const { done } = await ask()
    await userEvent.setup().click(screen.getByTestId(CLOSE_TEST_IDS.close))
    await done
    expect(leaveApp).not.toHaveBeenCalled()
    expect(useToasts.getState().toasts[0]?.message).toContain('保存できなかったため')
  })

  it('聞いている間にもう一度「戻る」が来たら、聞くのをやめる（閉じない）', async () => {
    const { done } = await ask()
    await act(() => askToCloseApp())
    await done
    expect(hasOpenDialog()).toBe(false)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(leaveApp).not.toHaveBeenCalled()
  })
})
