// その場で直す欄（src/features/lists/common/useInlineEdit.ts。docs/SPEC.md の 3.6・13.3・14.2・15.2。D40・D48・P3・P16）: 押した出来事の中で
// 欄を出してフォーカスする、Enter・離れた時に保存（変換中の Enter は除く）、空は元に戻す、Esc はやめる、複数行の Enter、止まった時の保存、
// 閉じる・裏に回る時の保存
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushAllDrafts } from '../../../store/draftRegistry'
import { setTestMedia } from '../../../test/renderCalendar'
import { useInlineEdit, type InlineEditOptions } from './useInlineEdit'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function Row(props: InlineEditOptions) {
  const edit = useInlineEdit(props)
  return edit.editing ? (
    props.multiline ? (
      <textarea aria-label="直す" {...edit.inputProps} />
    ) : (
      <input aria-label="直す" {...edit.inputProps} />
    )
  ) : (
    <button type="button" onClick={edit.start}>
      {props.value}
    </button>
  )
}

function open(over: Partial<InlineEditOptions> = {}) {
  const onSave = vi.fn()
  const r = render(<Row value="会議室の予約" onSave={onSave} {...over} />)
  fireEvent.click(screen.getByText(over.value ?? '会議室の予約'))
  return { ...r, onSave, field: () => screen.getByLabelText('直す') as HTMLInputElement }
}

describe('S3 その場で直す（P3・D40・D48）', () => {
  it('押した出来事の中で欄を出してフォーカスし（iPhone でキーボードが出る）、カーソルは字の終わり', () => {
    const { field } = open()
    expect(document.activeElement).toBe(field())
    expect(field().selectionStart).toBe('会議室の予約'.length)
  })

  it('Enter で保存して閉じる（前後の空白は落とす）。変換中の Enter では保存しない（P16）', () => {
    const { field, onSave } = open()
    fireEvent.change(field(), { target: { value: ' 会議室の予約（2回目） ' } })
    fireEvent.keyDown(field(), { key: 'Enter', isComposing: true })
    fireEvent.keyDown(field(), { key: 'Enter', keyCode: 229 })
    expect(onSave).not.toHaveBeenCalled()
    fireEvent.keyDown(field(), { key: 'Enter' })
    expect(onSave).toHaveBeenCalledWith('会議室の予約（2回目）')
    expect(screen.queryByLabelText('直す')).toBeNull()
  })

  it('離れた時も保存する。同じ値なら書かない', () => {
    const { field, onSave } = open()
    act(() => field().blur())
    expect(onSave).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('会議室の予約'))
    fireEvent.change(field(), { target: { value: '会議室' } })
    act(() => field().blur())
    expect(onSave).toHaveBeenCalledWith('会議室')
  })

  it('空・空白だけにして離れた・Enter を押した時は保存せずに元に戻す。Esc は保存せずにやめる', () => {
    const { field, onSave } = open()
    fireEvent.change(field(), { target: { value: '   ' } })
    fireEvent.keyDown(field(), { key: 'Enter' })
    expect(onSave).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('会議室の予約'))
    expect(field().value).toBe('会議室の予約')
    fireEvent.change(field(), { target: { value: '別の字' } })
    fireEvent.keyDown(field(), { key: 'Escape' })
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByText('会議室の予約')).toBeTruthy()
  })

  it('複数行の欄: PC は Enter で保存・Shift+Enter は改行、指の端末の Enter は改行', () => {
    setTestMedia({ width: 'L', pointer: 'fine' })
    const pc = open({ multiline: true })
    fireEvent.keyDown(pc.field(), { key: 'Enter', shiftKey: true })
    expect(pc.onSave).not.toHaveBeenCalled()
    fireEvent.change(pc.field(), { target: { value: '1行目\n2行目' } })
    fireEvent.keyDown(pc.field(), { key: 'Enter' })
    expect(pc.onSave).toHaveBeenCalledWith('1行目\n2行目')
    pc.unmount()
    setTestMedia({ width: 'S', pointer: 'coarse' })
    const touch = open({ multiline: true })
    fireEvent.change(touch.field(), { target: { value: '1行目' } })
    expect(fireEvent.keyDown(touch.field(), { key: 'Enter' })).toBe(true)
    expect(touch.onSave).not.toHaveBeenCalled()
    expect(screen.getByLabelText('直す')).toBeTruthy()
  })

  it('autosaveMs を渡すと、止まってからその長さで打っている間も保存する（空の間は保存しない）', () => {
    vi.useFakeTimers()
    const { field, onSave } = open({ autosaveMs: 600 })
    fireEvent.change(field(), { target: { value: '会議' } })
    act(() => {
      vi.advanceTimersByTime(599)
    })
    expect(onSave).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(onSave).toHaveBeenCalledWith('会議')
    fireEvent.change(field(), { target: { value: '' } })
    act(() => {
      vi.advanceTimersByTime(600)
    })
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText('直す')).toBeTruthy()
  })

  it('打っている間に画面を閉じる・裏に回る時（下書きをまとめて保存する時）と、行が外れた時も保存する', () => {
    const first = open()
    fireEvent.change(first.field(), { target: { value: '会議室A' } })
    flushAllDrafts()
    expect(first.onSave).toHaveBeenCalledWith('会議室A')
    first.unmount()
    const second = open()
    fireEvent.change(second.field(), { target: { value: '会議室B' } })
    second.unmount()
    expect(second.onSave).toHaveBeenCalledWith('会議室B')
  })
})
