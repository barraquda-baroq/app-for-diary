// 3つのリストの入力欄（src/features/lists/common/ListInput.tsx・useListInput.ts・listDraft.ts。docs/SPEC.md の 3.6・12.1・13.2・14.2・15.1・
// 6.13・■34）: ［足す］（✓）の見た目と押し方、Enter、外れても・Esc・Tab でも足さず閉じない、変換中の［足す］は1回だけ足す、書きかけを
// 控えて戻す（pagehide でまとめて控える）、■34 で打ちかけを捨てる
import { act, fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushAllDrafts, hasDirtyDrafts } from '../../../store/draftRegistry'
import { useToasts, type ListKey } from '../../../store/uiStore'
import { renderView, setupCalendarTests } from '../../../test/renderCalendar'
import { DRAFT_WRITE_MS, discardListDraft, registerDraftClear, resetListDraftsForTests } from './listDraft'
import { ListInput } from './ListInput'
import { COMMIT_WAIT_MS, draftKey, type ListDraft } from './listInputModel'
import { listTestIds } from './testIds'
import { useListInput } from './useListInput'

setupCalendarTests()
afterEach(() => {
  vi.restoreAllMocks()
})

interface HarnessProps {
  list: ListKey
  onAdd: (d: ListDraft) => boolean
}

/** 入力欄と、その前に押せるボタン（外を押す所） */
function Harness({ list, onAdd }: HarnessProps) {
  const input = useListInput({ list, onAdd })
  return (
    <div>
      <button type="button" data-testid="outside">
        ほかの所
      </button>
      <ListInput
        input={input}
        below={
          list === 'task' ? (
            <button type="button" data-testid="chip" onClick={() => input.setDraft({ due: '2026-11-20' })}>
              〆
            </button>
          ) : null
        }
      />
    </div>
  )
}

async function open(list: ListKey = 'task', opts: { pointer?: 'fine' | 'coarse'; added?: string[]; accept?: boolean } = {}) {
  const added = opts.added ?? []
  const onAdd = vi.fn((d: ListDraft) => {
    if (opts.accept === false) return false
    added.push(d.text.trim())
    return true
  })
  const r = await renderView(Harness, { list, onAdd }, { pointer: opts.pointer })
  return {
    ...r,
    onAdd,
    added,
    input: screen.getByTestId(listTestIds.input(list)) as HTMLTextAreaElement,
    add: screen.getByTestId(listTestIds.add(list)) as HTMLButtonElement,
  }
}

const fakeTimers = () => vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms)
  })
const typeText = (el: HTMLElement, text: string) => fireEvent.change(el, { target: { value: text } })

/** ［足す］を押す（マウスの順: pointerdown → mousedown → pointerup → click）。between は押してから離すまで */
function pressAdd(add: HTMLElement, between?: () => void) {
  fireEvent.pointerDown(add, { button: 0, pointerId: 1 })
  between?.()
  fireEvent.mouseDown(add)
  fireEvent.pointerUp(add, { button: 0, pointerId: 1 })
  fireEvent.mouseUp(add)
  fireEvent.click(add)
}

describe('S3 ［足す］（✓。12.1・S3-FRAME-081〜089・S3-TASK-031〜033・S3-ROUTINE-088）', () => {
  it('欄の右の端の中にある（読み上げ「足す」）。字が無い・空白だけの間は淡く（aria-disabled）、押しても足さない', async () => {
    const user = userEvent.setup()
    const { add, input, onAdd } = await open()
    expect(add.getAttribute('aria-label')).toBe('足す')
    expect(add.getAttribute('aria-disabled')).toBe('true')
    expect(input.parentElement?.contains(add)).toBe(true)
    await user.click(add)
    await user.type(input, '   ')
    expect(add.getAttribute('aria-disabled')).toBe('true')
    await user.click(add)
    expect(onAdd).not.toHaveBeenCalled()
    await user.type(input, '見積もり')
    expect(add.hasAttribute('aria-disabled')).toBe(false)
  })

  it('押すと足し、欄（とチップ）を空に戻す。フォーカスは欄に残る（mousedown を止める。iPhone のキーボードを閉じない）', async () => {
    const user = userEvent.setup()
    const { add, input, added } = await open('task')
    await user.click(input)
    await user.type(input, '見積もりの返事')
    await user.click(screen.getByTestId('chip'))
    input.focus()
    expect(fireEvent.mouseDown(add)).toBe(false)
    expect(document.activeElement).toBe(input)
    await user.click(add)
    expect(added).toEqual(['見積もりの返事'])
    expect(input.value).toBe('')
    expect(document.activeElement).toBe(input)
    expect(localStorage.getItem(draftKey('task'))).toBeNull()
  })

  it('Tab で［足す］へ移り、Enter・Space で足す（足したら欄へ戻る。空の時は何もしない）', async () => {
    const user = userEvent.setup()
    const { input, add, added } = await open('routine')
    await user.click(input)
    await user.tab()
    expect(document.activeElement).toBe(add)
    await user.keyboard('{Enter}')
    expect(added).toEqual([])
    expect(document.activeElement).toBe(add)
    typeText(input, 'ストレッチ')
    add.focus()
    await user.keyboard(' ')
    expect(added).toEqual(['ストレッチ'])
    expect(document.activeElement).toBe(input)
  })

  it('決まりに合わずに足せなかった時（onAdd が false）は、字を残す', async () => {
    const user = userEvent.setup()
    const { input, add } = await open('task', { accept: false })
    await user.type(input, 'あ'.repeat(201))
    await user.click(add)
    expect(input.value).toBe('あ'.repeat(201))
  })
})

describe('S3 Enter（13.2・14.2・15.1・D6・S3-TASK-034・035・S3-ROUTINE-172・173）', () => {
  it('Task List: Enter で足す。PC の Shift+Enter は改行', async () => {
    const user = userEvent.setup()
    const { input, added } = await open('task')
    await user.type(input, '1行目{Shift>}{Enter}{/Shift}2行目')
    expect(input.value).toBe('1行目\n2行目')
    expect(added).toEqual([])
    await user.keyboard('{Enter}')
    expect(added).toEqual(['1行目\n2行目'])
  })

  it('Favorite List: PC は Enter で足す。指の端末は Enter で改行し、［足す］で足す', async () => {
    const user = userEvent.setup()
    const pc = await open('favorite', { pointer: 'fine' })
    await user.type(pc.input, 'パン屋{Enter}')
    expect(pc.added).toEqual(['パン屋'])
    pc.unmount()
    const touch = await open('favorite', { pointer: 'coarse' })
    await user.type(touch.input, 'パン屋{Enter}駅の北口')
    expect(touch.input.value).toBe('パン屋\n駅の北口')
    expect(touch.added).toEqual([])
    await user.click(touch.add)
    expect(touch.added).toEqual(['パン屋\n駅の北口'])
  })

  it('変換中の Enter（isComposing・keyCode 229）では足さない（S3-FRAME-090）', async () => {
    const { input, onAdd } = await open('routine')
    typeText(input, 'すとれっち')
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 })
    expect(onAdd).not.toHaveBeenCalled()
  })
})

describe('S3 いつも出ている欄なので、外れても足さず閉じない（3.6・S3-FRAME-082・100・S3-TASK-037・S3-ROUTINE-089・177）', () => {
  it('キーボードを閉じた（iPhone のキーボードの上の✓。押さずに外れた）・外を押した・Esc・Tab のどれでも足さず、字は欄と書きかけに残る', async () => {
    const user = userEvent.setup()
    const { input, onAdd } = await open('favorite')
    await user.type(input, 'あとで調べる')
    act(() => input.blur())
    await user.click(screen.getByTestId('outside'))
    await user.click(input)
    await user.keyboard('{Escape}')
    await user.tab()
    expect(onAdd).not.toHaveBeenCalled()
    expect(screen.getByTestId(listTestIds.input('favorite'))).toBe(input)
    expect(input.value).toBe('あとで調べる')
    await vi.waitFor(() => expect(localStorage.getItem(draftKey('favorite'))).toBe('あとで調べる'))
  })
})

describe('S3 変換を決める前に［足す］を押した時（12.1・■15・P1・S3-FRAME-087・S3-TASK-038・S3-ROUTINE-091）', () => {
  it('押した時に欄から外して変換を決めてもらい、変換の終わりの後、離した時に決まった字を1回だけ足して空に戻す。フォーカスは欄', async () => {
    const { input, add, added } = await open('task')
    fakeTimers()
    input.focus()
    fireEvent.compositionStart(input)
    typeText(input, 'みつもり')
    pressAdd(add, () => {
      expect(document.activeElement).not.toBe(input)
      expect(added).toEqual([])
      typeText(input, '見積もり')
      fireEvent.compositionEnd(input, { data: '見積もり' })
    })
    expect(added).toEqual(['見積もり'])
    expect(input.value).toBe('')
    expect(document.activeElement).toBe(input)
    advance(COMMIT_WAIT_MS * 3)
    fireEvent.compositionEnd(input)
    expect(added).toEqual(['見積もり'])
  })

  it('変換の終わりが来ないまま（iPhone）でも、待ち終えた時に見えている字を1回だけ足す。ブラウザが変換中の字を捨てても、押した時に見えていた字を足す', async () => {
    const { input, add, added } = await open('favorite', { pointer: 'fine' })
    fakeTimers()
    input.focus()
    fireEvent.compositionStart(input)
    typeText(input, 'ぱんや')
    pressAdd(add, () => typeText(input, ''))
    expect(added).toEqual([])
    advance(COMMIT_WAIT_MS)
    expect(added).toEqual(['ぱんや'])
    expect(input.value).toBe('')
    advance(COMMIT_WAIT_MS * 2)
    expect(added).toEqual(['ぱんや'])
  })

  it('押した指でスクロールした（pointercancel）・［足す］の外で離した時は足さず、字は欄に残る', async () => {
    const { input, add, onAdd } = await open('routine')
    fakeTimers()
    input.focus()
    fireEvent.compositionStart(input)
    typeText(input, 'すとれっち')
    fireEvent.pointerDown(add, { button: 0, pointerId: 3, pointerType: 'touch' })
    fireEvent.pointerCancel(add, { pointerId: 3 })
    advance(COMMIT_WAIT_MS * 2)
    expect(onAdd).not.toHaveBeenCalled()
    expect(input.value).toBe('すとれっち')
    // マウスを［足す］の外（欄の上）で離した
    input.focus()
    fireEvent.compositionStart(input)
    fireEvent.pointerDown(add, { button: 0, pointerId: 1 })
    fireEvent.pointerUp(input, { button: 0, pointerId: 1 })
    advance(COMMIT_WAIT_MS * 2)
    expect(onAdd).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(input)
    expect(input.value).toBe('すとれっち')
  })
})

describe('S3 書きかけ（6.13・D16・D23・S3-FRAME-095・096・S3-TASK-042・S3-ROUTINE-092）', () => {
  it('打った字とチップを diary-studio:draft:task に控え（少し待ってまとめる）、作り直しても戻す', async () => {
    const user = userEvent.setup()
    const first = await open('task')
    await user.type(first.input, '会議室の予約')
    await user.click(screen.getByTestId('chip'))
    await vi.waitFor(() =>
      expect(JSON.parse(localStorage.getItem(draftKey('task')) ?? 'null')).toEqual({
        text: '会議室の予約',
        start: null,
        due: '2026-11-20',
        requester: '',
      }),
    )
    first.unmount()
    resetListDraftsForTests()
    const again = await open('task')
    expect(again.input.value).toBe('会議室の予約')
  })

  it('待っている間に画面を閉じる・裏に回る時（pagehide で下書きをまとめて控える）は、すぐに控える', async () => {
    const { input } = await open('routine')
    fakeTimers()
    typeText(input, 'ゴミ出し')
    expect(localStorage.getItem(draftKey('routine'))).toBeNull()
    expect(hasDirtyDrafts()).toBe(true)
    flushAllDrafts()
    expect(localStorage.getItem(draftKey('routine'))).toBe('ゴミ出し')
    expect(hasDirtyDrafts()).toBe(false)
    advance(DRAFT_WRITE_MS * 2)
    expect(localStorage.getItem(draftKey('routine'))).toBe('ゴミ出し')
  })

  it('端末に控えられない（localStorage が使えない）時も、打つ・足すは動く', async () => {
    const user = userEvent.setup()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    const { input, add, added } = await open('favorite', { pointer: 'fine' })
    await user.type(input, '本を返す')
    await user.click(add)
    expect(added).toEqual(['本を返す'])
    expect(useToasts.getState().toasts).toEqual([])
  })
})

describe('S3 ■34 打ちかけを捨てる（discardListDraft。作者「打ちかけの文字は残さなくて良いです」）', () => {
  it('そのリストの欄の字とチップを空にし、端末の書きかけも、まだ控えていない分も消す（後で pagehide に書き戻さない）。ほかのリストは残す', async () => {
    const user = userEvent.setup()
    localStorage.setItem(draftKey('favorite'), '残す')
    const { input } = await open('task')
    await user.type(input, '見積もり')
    await user.click(screen.getByTestId('chip'))
    expect(hasDirtyDrafts()).toBe(true)
    act(() => discardListDraft('task'))
    expect(input.value).toBe('')
    expect(localStorage.getItem(draftKey('task'))).toBeNull()
    flushAllDrafts()
    expect(localStorage.getItem(draftKey('task'))).toBeNull()
    expect(localStorage.getItem(draftKey('favorite'))).toBe('残す')
    // チップも空（次に打った字だけを控える）
    await user.type(input, 'a')
    await vi.waitFor(() =>
      expect(JSON.parse(localStorage.getItem(draftKey('task')) ?? 'null')).toEqual({
        text: 'a',
        start: null,
        due: null,
        requester: '',
      }),
    )
  })

  it('変換の途中なら決めずに捨てる（続いて決まった字を入れない）。押し終えた［足す］の分も足さない', async () => {
    const { input, add, onAdd } = await open('routine')
    fakeTimers()
    input.focus()
    fireEvent.compositionStart(input)
    typeText(input, 'すとれっち')
    pressAdd(add)
    act(() => discardListDraft('routine'))
    // 畳む時にフォーカスが外れて、ブラウザが変換を決めて書いた字
    typeText(input, 'ストレッチ')
    fireEvent.compositionEnd(input, { data: 'ストレッチ' })
    advance(COMMIT_WAIT_MS * 3)
    expect(onAdd).not.toHaveBeenCalled()
    expect(input.value).toBe('')
  })

  it('出している欄が届けた関数（Routine List の［指定］など）も呼ぶ。外した関数は呼ばない', async () => {
    const spec = vi.fn()
    const gone = vi.fn()
    const off = registerDraftClear('routine', gone)
    registerDraftClear('routine', spec)
    off()
    discardListDraft('routine')
    expect(spec).toHaveBeenCalledTimes(1)
    expect(gone).not.toHaveBeenCalled()
  })
})
