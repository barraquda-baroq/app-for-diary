// メモの欄（docs/SPEC.md の 12.2 の 6・12.3・4.12）。自動で高さが伸びる入力欄（4行から）。長さの制限なし。
// - 登録の画面（autosave なし）: いつも入力欄。打つたびに onChange
// - 詳細の画面（autosave）: 0.6秒止まった時・離れた時に onChange（保存。fields/useAutosave.ts）。入力欄から離れている間は文章として出し、
//   URL は押せるリンク（新しいタブ・rel="noopener noreferrer"・下線）にする。リンク以外を押す（キーボードは右上の［書き換える］）と
//   入力欄になる（書式は付けない。12.3・ITEMS-216・FRAME-254）。メモが空の時は、そのまま入力欄を出す
// - 入力欄から離れて文章に戻すのは、指・マウスで押し終わってから（開発。12.3。12.1 のすばやく足すと同じ）: 4行の入力欄が1行の文章に
//   戻ると、下の欄（ロック・Task List・ラベルの色）が上へずれ、L の真ん中の画面・M の下からのシートは画面ごと縮んで［×］も動く。
//   押した時（pointerdown の後のフォーカスの移り）にすぐ戻すと、指を離した時（click）に指の下にあるのが押した物と違う物になり、
//   押した物が効かない。そこで保存はすぐ行い、文章に戻すのは click・pointercancel の時（離して CLICK_WAIT_MS たっても click が来ない
//   時も）にする。押していない時（Tab など）はすぐ戻す
import { useEffect, useRef, useState } from 'react'
import { EditIcon } from '../../../ui/icons'
import { CLICK_WAIT_MS } from '../../calendar/common/parts/QuickAdd'
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
  /** 指・マウスで押している最中（押し始めから、押し終わる（click・pointercancel・離して CLICK_WAIT_MS）まで） */
  const pressing = useRef(false)
  /** 押している間に入力欄から離れた（押し終わったら文章に戻す） */
  const leaveAfterPress = useRef(false)

  // 押している最中かを見る（詳細の画面だけ）。window の捕まえる段階で見るので、押した物の pointerdown・mousedown（フォーカスの
  // 移り）・click より先に分かる。指の時は離した後に mousedown（フォーカスの移り）と click が来るので、離しても CLICK_WAIT_MS は待つ
  useEffect(() => {
    if (!autosave) return
    let timer: number | undefined
    const end = () => {
      window.clearTimeout(timer)
      pressing.current = false
      if (!leaveAfterPress.current) return
      leaveAfterPress.current = false
      setEditing(false)
    }
    const down = () => {
      window.clearTimeout(timer)
      pressing.current = true
    }
    const up = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(end, CLICK_WAIT_MS)
    }
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('pointerup', up, true)
    window.addEventListener('pointercancel', end, true)
    window.addEventListener('click', end, true)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('pointerup', up, true)
      window.removeEventListener('pointercancel', end, true)
      window.removeEventListener('click', end, true)
      pressing.current = false
      leaveAfterPress.current = false
    }
  }, [autosave])

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
          onFocus={
            autosave
              ? () => {
                  // 押し終わりを待っている間に入力欄へ戻った時は、入力欄のまま
                  leaveAfterPress.current = false
                  setEditing(true)
                }
              : undefined
          }
          onBlur={
            autosave
              ? () => {
                  auto.commit()
                  // 押している間は入力欄のまま（押した物は押した時の並びのまま押される）。押し終わったら文章に戻す
                  if (pressing.current) leaveAfterPress.current = true
                  else setEditing(false)
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
