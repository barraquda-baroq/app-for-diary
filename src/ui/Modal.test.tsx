// 小さな画面（docs/SPEC.md の 3.8・4.3・12.2・12.3）: 段階2で足した印（区分の地・ラベルの色の帯・題の左の区分のアイコン・
// data-testid・クラス）。動き（Esc・背景・×で閉じる）は今までどおり
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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
})
