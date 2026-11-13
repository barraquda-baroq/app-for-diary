// カレンダーの画面での OS の「戻る」で、アプリを閉じる（docs/SPEC.md の 3.1。22. の段階2の終わりの確かめの ■22・■25）:
// Android のブラウザのタブ・PC は「Diary Studio を閉じますか？」［キャンセル］［閉じる］。データの保存の注意は出さず、同期していない
// 変更がある時だけ1行。［閉じる］で書きかけを保存してからアプリの履歴の前へ。閉じられなかった時はお知らせ。聞いている間の「戻る」は
// 聞くのをやめる。ホーム画面から開いた Android のアプリは聞かずに、書きかけを保存してから、もう一度［戻る］で閉じる所にし、
// 「もう一度［戻る］を押すと閉じます」を、その所にしている長さだけ出す
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCalendarUi, useToasts } from '../../store/uiStore'
import { useSync } from '../../sync/controller'
import type { SyncStatus } from '../../sync/engine'
import { confirmDialog, DialogHost, hasOpenDialog } from '../../ui/dialogs'

const leaveApp = vi.fn<(onArmEnd?: () => void) => Promise<'left' | 'armed' | 'stayed'>>()
const armExitApp = vi.fn<(ms: number, onEnd: () => void) => Promise<boolean>>()
const saveBeforeLeave = vi.fn<() => Promise<boolean>>()

vi.mock('../../history/appHistory', () => ({
  leaveApp: (onArmEnd?: () => void) => leaveApp(onArmEnd),
  armExitApp: (ms: number, onEnd: () => void) => armExitApp(ms, onEnd),
}))
vi.mock('../../store/lifecycle', () => ({ saveBeforeLeave: () => saveBeforeLeave() }))

const {
  ARMED_NOTICE,
  armExitOnBack,
  askToCloseApp,
  CLOSE_TEST_IDS,
  CLOSE_TITLE,
  consumeBackPress,
  EXIT_ARMED_MS,
  leaveNotice,
  unsyncedLine,
} = await import('./closeApp')

function syncStatus(pending: number): SyncStatus {
  return { phase: pending > 0 ? 'offline' : 'synced', pending, lastSyncedAt: null, error: null }
}

beforeEach(() => {
  leaveApp.mockReset().mockResolvedValue('left')
  armExitApp.mockReset().mockResolvedValue(true)
  saveBeforeLeave.mockReset().mockResolvedValue(true)
  useToasts.setState({ toasts: [] })
  useSync.setState({ status: syncStatus(0) })
  render(<DialogHost />)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
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

  it('開いた時のフォーカスは［キャンセル］。題の列の［×］は「キャンセル」と読み、「閉じる」のボタンは［閉じる］だけ', async () => {
    const { done } = await ask()
    expect(document.activeElement).toBe(screen.getByTestId(CLOSE_TEST_IDS.cancel))
    expect(screen.getByTestId('modal-close').getAttribute('aria-label')).toBe('キャンセル')
    expect(screen.getAllByRole('button', { name: '閉じる' })).toEqual([screen.getByTestId(CLOSE_TEST_IDS.close)])
    // Enter はキャンセル（閉じない）
    await userEvent.setup().keyboard('{Enter}')
    await done
    expect(leaveApp).not.toHaveBeenCalled()
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

  it('前が無いタブで閉じられず「もう一度［戻る］を押すと閉じます」にした時は、その所が終わった時（押した・長押しした・時間ではない）にお知らせも消す。出す前に終わっていたら出さない', async () => {
    let end: (() => void) | undefined
    leaveApp.mockImplementation(async (onArmEnd) => {
      end = onArmEnd
      return 'armed'
    })
    const first = await ask()
    await userEvent.setup().click(screen.getByTestId(CLOSE_TEST_IDS.close))
    await first.done
    expect(useToasts.getState().toasts.map((t) => t.message)).toEqual(['もう一度［戻る］を押すと閉じます'])
    act(() => end?.())
    expect(useToasts.getState().toasts).toEqual([])
    // 出す前に終わっていた
    leaveApp.mockImplementation(async (onArmEnd) => {
      onArmEnd?.()
      return 'armed'
    })
    const second = await ask()
    await userEvent.setup().click(screen.getByTestId(CLOSE_TEST_IDS.close))
    await second.done
    expect(useToasts.getState().toasts).toEqual([])
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

describe('「戻る」「進む」の前に片付ける（consumeBackPress）', () => {
  it('確かめのダイアログ（詳細の画面の削除の確かめなど）が開いていれば、それだけを閉じて true（キャンセル）', async () => {
    let answer: boolean | undefined
    act(() => {
      void confirmDialog({ title: '『打ち合わせ』を削除しますか？', danger: true }).then((v) => (answer = v))
    })
    await screen.findByRole('dialog')
    let consumed = false
    await act(async () => {
      consumed = consumeBackPress()
    })
    expect(consumed).toBe(true)
    expect(answer).toBe(false)
    expect(hasOpenDialog()).toBe(false)
  })

  it('何も開いていなければ false。掴んでいる間（掴んでから離すまで）は true（何もしない）', () => {
    expect(consumeBackPress()).toBe(false)
    useCalendarUi.getState().setDragging(true)
    try {
      expect(consumeBackPress()).toBe(true)
    } finally {
      useCalendarUi.getState().setDragging(false)
    }
  })

  it('離した後の、浮いたカードが元の所へ戻る動きの間（dnd-kit の掴んだ印は残る）は、もう掴んでいない（false）', () => {
    const settling = document.createElement('div')
    settling.setAttribute('data-dnd-dragging', '')
    settling.setAttribute('data-dnd-dropping', '')
    document.body.append(settling)
    try {
      expect(consumeBackPress()).toBe(false)
    } finally {
      settling.remove()
    }
  })
})

describe('ホーム画面から開いた Android のアプリの「戻る」（■25）', () => {
  const messages = () => useToasts.getState().toasts.map((t) => t.message)

  it('聞かずに、書きかけを端末に保存してから、もう一度［戻る］で閉じる所にし、「もう一度［戻る］を押すと閉じます」を出す', async () => {
    await act(() => armExitOnBack())
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(hasOpenDialog()).toBe(false)
    expect(saveBeforeLeave).toHaveBeenCalledTimes(1)
    expect(armExitApp).toHaveBeenCalledTimes(1)
    expect(saveBeforeLeave.mock.invocationCallOrder[0]).toBeLessThan(armExitApp.mock.invocationCallOrder[0])
    expect(armExitApp.mock.calls[0][0]).toBe(EXIT_ARMED_MS)
    expect(leaveApp).not.toHaveBeenCalled()
    expect(messages()).toEqual([ARMED_NOTICE])
    expect(ARMED_NOTICE).toBe('もう一度［戻る］を押すと閉じます')
  })

  it('その所にしている長さは 3秒で、お知らせもちょうどその間だけ出す（その所が先に終わったら、お知らせも消す）', async () => {
    expect(EXIT_ARMED_MS).toBe(3000)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await act(() => armExitOnBack())
    await act(() => vi.advanceTimersByTimeAsync(EXIT_ARMED_MS - 1))
    expect(messages()).toEqual([ARMED_NOTICE])
    await act(() => vi.advanceTimersByTimeAsync(1))
    expect(messages()).toEqual([])
    // 押した・時間が過ぎた（アプリの履歴が onEnd で知らせる）時は、すぐ消す
    await act(() => armExitOnBack())
    expect(messages()).toEqual([ARMED_NOTICE])
    const onEnd = armExitApp.mock.calls[1][1]
    act(() => onEnd())
    expect(messages()).toEqual([])
  })

  it('同期していない変更がある時だけ、端末に保存してあって次に開いた時に送ることを、次の行に添える', async () => {
    useSync.setState({ status: syncStatus(2) })
    await act(() => armExitOnBack())
    expect(messages()).toEqual([`${ARMED_NOTICE}\n同期していない変更（2件）は、この端末に保存してあり、次に開いた時に送ります。`])
    useToasts.setState({ toasts: [] })
    useSync.setState({ status: syncStatus(0) })
    await act(() => armExitOnBack())
    expect(messages()).toEqual([ARMED_NOTICE])
  })

  it('端末に保存できなかった時は、その所にせず、閉じるのをやめたことを言う', async () => {
    saveBeforeLeave.mockResolvedValue(false)
    await act(() => armExitOnBack())
    expect(armExitApp).not.toHaveBeenCalled()
    expect(messages()).toHaveLength(1)
    expect(messages()[0]).toContain('保存できなかったため、閉じるのをやめました')
    expect(messages()[0]).not.toContain(ARMED_NOTICE)
  })

  it('その所にできなかった時（カレンダーを出していないなど）・できる前に終わった時は、お知らせを出さない', async () => {
    armExitApp.mockResolvedValue(false)
    await act(() => armExitOnBack())
    expect(messages()).toEqual([])
    armExitApp.mockImplementation(async (_ms, onEnd) => {
      onEnd()
      return true
    })
    await act(() => armExitOnBack())
    expect(messages()).toEqual([])
  })

  it('保存している間に来たもう一度の「戻る」では、もう一度頼まない（1回だけ）', async () => {
    let finish!: (ok: boolean) => void
    saveBeforeLeave.mockImplementation(() => new Promise<boolean>((resolve) => (finish = resolve)))
    let first!: Promise<void>
    act(() => {
      first = armExitOnBack()
    })
    await act(() => armExitOnBack())
    await act(async () => {
      finish(true)
      await first
    })
    expect(saveBeforeLeave).toHaveBeenCalledTimes(1)
    expect(armExitApp).toHaveBeenCalledTimes(1)
    expect(messages()).toEqual([ARMED_NOTICE])
  })
})
