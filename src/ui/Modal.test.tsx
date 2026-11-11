// 小さな画面（docs/SPEC.md の 3.8・4.3・12.2・12.3）: 段階2で足した印（区分の地・ラベルの色の帯・題の左の区分のアイコン・
// data-testid・クラス）。動き（Esc・背景・×で閉じる）は今までどおり
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useEffect, useLayoutEffect } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BagIcon } from './icons'
import { Modal } from './Modal'

afterEach(cleanup)

describe('Modal の印（段階2）', () => {
  it('区分・ラベル・data-testid・クラスを .modal に付け、ラベルがあれば上の辺の帯（.label-band）にする', () => {
    render(
      <Modal title="予定" onClose={() => {}} testId="item-sheet" dataKind="private" dataLabel="peony-l" className="it-sheet">
        中身
      </Modal>,
    )
    const modal = screen.getByTestId('item-sheet')
    expect(modal.classList.contains('modal')).toBe(true)
    expect(modal.classList.contains('it-sheet')).toBe(true)
    expect(modal.classList.contains('label-band')).toBe(true)
    expect(modal.getAttribute('data-kind')).toBe('private')
    expect(modal.getAttribute('data-label')).toBe('peony-l')
    expect(modal.getAttribute('role')).toBe('dialog')
  })

  it('ラベルが無ければ帯も data-label も付けない。印を渡さなければ今までの形のまま', () => {
    render(
      <Modal title="予定" onClose={() => {}} testId="a" dataKind="work" dataLabel={null}>
        中身
      </Modal>,
    )
    const modal = screen.getByTestId('a')
    expect(modal.className).toBe('modal')
    expect(modal.hasAttribute('data-label')).toBe(false)
    expect(modal.getAttribute('data-kind')).toBe('work')
    cleanup()
    render(
      <Modal title="確かめ" onClose={() => {}} wide>
        中身
      </Modal>,
    )
    const plain = screen.getByRole('dialog')
    expect(plain.className).toBe('modal wide')
    expect(plain.hasAttribute('data-kind')).toBe(false)
    expect(plain.hasAttribute('data-testid')).toBe(false)
  })

  it('題の左の区分のアイコンは読み上げず、題の名前は題の文だけ', () => {
    render(
      <Modal title="予定" onClose={() => {}} titleIcon={<BagIcon />}>
        中身
      </Modal>,
    )
    const dialog = screen.getByRole('dialog', { name: '予定' })
    const icon = dialog.querySelector('.modal-head h2 .modal-title-icon')
    expect(icon?.getAttribute('aria-hidden')).toBe('true')
    expect(icon?.querySelector('svg')).not.toBeNull()
  })

  it('Esc・背景・×で閉じる（今までどおり）', () => {
    const onClose = vi.fn()
    render(
      <Modal title="予定" onClose={onClose} testId="m">
        中身
      </Modal>,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.mouseDown(document.querySelector('.modal-backdrop')!)
    fireEvent.click(screen.getByTestId('modal-close'))
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it('開いた直後（描いたすぐ後・ブラウザが描く前）に押した Esc も聞き、その時にはもう中へフォーカスを移してある（開発）', () => {
    const onClose = vi.fn()
    const seen: boolean[] = []
    /** Modal の後に置いた部品。Modal と同じ描画の useLayoutEffect（Modal の物の後）で、中にフォーカスがあるかを見て Esc を押す */
    function PressEscRightAway() {
      useLayoutEffect(() => {
        seen.push(Boolean(document.querySelector('[data-testid="m"]')?.contains(document.activeElement)))
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      }, [])
      return null
    }
    // 開いたボタン（カードなど）にフォーカスがある所から開く
    const opener = <button type="button">開く</button>
    const { rerender } = render(opener)
    act(() => screen.getByText('開く').focus())
    rerender(
      <>
        {opener}
        <Modal title="予定" onClose={onClose} testId="m">
          <input aria-label="件名" />
        </Modal>
        <PressEscRightAway />
      </>,
    )
    expect(seen).toEqual([true])
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('開いた物（メニューの項目）が同じ描画で外れた時は、ほかの部品がフォーカスを戻した所（メニューを開いたボタン）を、閉じた後に戻る先にする', () => {
    /** メニュー（src/ui/PopupMenu と同じく、外れる時にフォーカスが body に落ちていれば開いたボタンへ戻す） */
    function Menu({ back }: { back: () => HTMLElement | null }) {
      useEffect(
        () => () => {
          if (document.activeElement === document.body) back()?.focus()
        },
        [back],
      )
      return <button type="button">削除</button>
    }
    const back = () => screen.queryByText('…')
    const view = (menu: boolean, dialog: boolean) => (
      <>
        <button type="button">…</button>
        {menu ? <Menu back={back} /> : null}
        {dialog ? (
          <Modal title="削除しますか？" onClose={() => {}} testId="m">
            <button type="button">やめる</button>
          </Modal>
        ) : null}
      </>
    )
    const { rerender } = render(view(true, false))
    act(() => screen.getByText('削除').focus())
    // メニューの項目を押した: メニューを閉じて、確かめを開く（同じ描画）
    rerender(view(false, true))
    expect(screen.getByTestId('m').contains(document.activeElement)).toBe(true)
    rerender(view(false, false))
    expect(document.activeElement).toBe(screen.getByText('…'))
  })

  it('日本語の変換を取り消す Esc（isComposing・Safari の keyCode 229）では閉じない', () => {
    const onClose = vi.fn()
    render(
      <Modal title="予定" onClose={onClose} testId="m">
        中身
      </Modal>,
    )
    fireEvent.keyDown(document, { key: 'Escape', isComposing: true })
    fireEvent.keyDown(document, { key: 'Escape', keyCode: 229 })
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Tab の囲いは見えている物だけを数える（checkVisibility。visibility: hidden の畳んだ欄は最後の物にしない）', () => {
    // jsdom は配置も checkVisibility も持たないので、見えるかどうかを data-shown で決める
    const before = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'checkVisibility')
    Object.defineProperty(HTMLElement.prototype, 'checkVisibility', {
      configurable: true,
      writable: true,
      value(this: HTMLElement) {
        return this.dataset.shown !== 'no'
      },
    })
    try {
      render(
        <Modal title="予定" onClose={() => {}} testId="m">
          <input aria-label="件名" />
          <button type="button">詳しく</button>
          <textarea aria-label="メモ" data-shown="no" />
        </Modal>,
      )
      // 見えている最後の物（詳しく）から Tab で最初（×）へ戻る。見えないメモへは行かない
      const more = screen.getByText('詳しく')
      more.focus()
      fireEvent.keyDown(document, { key: 'Tab' })
      expect(document.activeElement).toBe(screen.getByTestId('modal-close'))
      // 最初の物から Shift+Tab で、見えている最後の物へ
      fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
      expect(document.activeElement).toBe(more)
    } finally {
      if (before) Object.defineProperty(HTMLElement.prototype, 'checkVisibility', before)
      else Reflect.deleteProperty(HTMLElement.prototype, 'checkVisibility')
    }
  })
})
