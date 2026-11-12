// メモの欄（docs/SPEC.md の 12.2 の 6・12.3・4.12）。自動で高さが伸びる入力欄（4行から）。長さの制限なし。
// - 登録の画面（autosave なし）: いつも入力欄。打つたびに onChange
// - 詳細の画面（autosave）: 0.6秒止まった時・離れた時に onChange（保存。fields/useAutosave.ts）。入力欄から離れている間は文章として出し、
//   URL は押せるリンク（新しいタブ・rel="noopener noreferrer"・下線）にする。リンク以外を押す（キーボードは右上の［書き換える］）と
//   入力欄になる（書式は付けない。12.3・ITEMS-216・FRAME-254）。メモが空の時は、そのまま入力欄を出す
import { useEffect, useRef, useState } from 'react'
import { EditIcon } from '../../../ui/icons'
import { testIds } from '../../calendar/common/testIds'
import { memoParts } from '../itemForm'
import { useAutosave } from './useAutosave'
import { useAutoGrow } from './useAutoGrow'

export interface MemoFieldProps {
  id: string
  value: string
  onChange: (memo: string) => void
  /** 詳細の画面: 直したそばから自動で保存し、離れている間は文章（リンク付き）で出す */
  autosave?: boolean
}

/** 文章で出しているメモ（押すと入力欄になる）の data-testid */
export const MEMO_VIEW_TEST_ID = 'item-memo-view'

export function MemoField({ id, value, onChange, autosave = false }: MemoFieldProps) {
  const auto = useAutosave(value, onChange)
  const text = autosave ? auto.draft : value
  const [editing, setEditing] = useState(false)
  /** 文章を押して入力欄にした時だけ、出した入力欄へフォーカスする */
  const focusNext = useRef(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  const asText = autosave && !editing && text !== ''
  useAutoGrow(ref, asText ? '' : text)

  useEffect(() => {
    if (!editing || !focusNext.current) return
    focusNext.current = false
    const el = ref.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [editing])

  const edit = () => {
    focusNext.current = true
    setEditing(true)
  }

  return (
    <div className="it-field">
      {asText ? (
        <span className="it-field-label">メモ</span>
      ) : (
        <label className="it-field-label" htmlFor={id}>
          メモ
        </label>
      )}
      {asText ? (
        // 押す所は文章の全体（リンクを除く。指・マウス）と、キーボードで届く右上の［書き換える］（リンクを中に持つので、全体を
        // ボタンにはしない）
        <div
          className="it-memo-view"
          onClick={(e) => {
            // リンクを押した時は、そのリンクを開くだけ
            if ((e.target as Element).closest('a, button')) return
            edit()
          }}
          data-testid={MEMO_VIEW_TEST_ID}
        >
          <button
            type="button"
            id={id}
            className="icon-btn it-memo-edit"
            aria-label="メモを書き換える"
            title="メモを書き換える"
            onClick={edit}
          >
            <EditIcon />
          </button>
          <p className="it-memo-text">
            {memoParts(text).map((p, i) =>
              'url' in p ? (
                <a key={i} href={p.url} target="_blank" rel="noopener noreferrer">
                  {p.url}
                </a>
              ) : (
                <span key={i}>{p.text}</span>
              ),
            )}
          </p>
        </div>
      ) : (
        <textarea
          ref={ref}
          id={id}
          className="textarea it-memo"
          rows={4}
          value={text}
          onChange={(e) => (autosave ? auto.change(e.target.value) : onChange(e.target.value))}
          onFocus={autosave ? () => setEditing(true) : undefined}
          onBlur={
            autosave
              ? () => {
                  auto.commit()
                  setEditing(false)
                }
              : undefined
          }
          {...(autosave ? auto.composition : {})}
          data-testid={testIds.itemMemo}
        />
      )}
    </div>
  )
}
