// 3つのリストの入力欄の動き（docs/SPEC.md の 3.6・12.1・13.2・14.2・15.1・6.13）。決まり（common/listInputModel.ts）を DOM の出来事に
// つなぎ、書きかけ（common/listDraft.ts）を読み書きする。見た目は common/ListInput.tsx。各リストの中身（*ListBody）が呼ぶ:
//   const input = useListInput({ list: 'task', onAdd: (d) => addTask(d) })
//   <ListInput input={input} below={<TaskChips draft={input.draft} onChange={input.setDraft} />} />
// - Enter（enterAction。変換中の Enter は足さない）と［足す］（✓）で onAdd を呼び、足せたら欄（とチップ）を空に戻す。フォーカスは
//   入力欄に残す（続けて足せる。13.2・14.2・15.1）。Tab で移った［足す］の Enter・Space で足した時も、足せたら入力欄へ戻す
// - ［足す］を押してもフォーカスは入力欄から動かない（mousedown を止める。iPhone のキーボードが閉じない）。変換中に押した時は、
//   すばやく足すと同じく、押した時に外して変換を決めてもらい、離した時に戻して、変換の終わりの後に1回だけ足す（addPressStep。■15）
// - 外を押した・キーボードを閉じた（iPhone のキーボードの上の✓）・Esc・Tab では足さず、閉じもしない（いつも出ている欄。打った字は
//   欄と書きかけに残る。FRAME-082・100）
// - 書きかけは打つたびに控え（少し待ってまとめる。閉じる・裏に回る時はまとめて控える）、開いた時に戻す。足したら消す
// - ■34: 開いているリストを端からのフリック・OS の［戻る］で畳む時（discardListDraft）は、欄を空にし（変換の途中なら決めた字も
//   入れない）、書きかけも消す。変換の途中で欄にフォーカスがあれば、先にフォーカスをそのリストの見出しの畳む・開くボタンへ移して
//   （欄から外して変換を終えてもらって）から空にする（変換中のまま欄を空にすると、iPhone ではキーボードの変換候補が残り続けた。12.1）
// - iPhone でキーボードが出た時は、欄をキーボードの上 16px まで送る（src/ui/keyboardInset.ts の useKeyboardInset が、打っている欄を
//   見張る。ここでは何もしない。2.7）
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  ChangeEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from 'react'
import type { ListKey } from '../../../store/uiStore'
import { useMediaQuery } from '../../../ui/hooks'
import { SWIPE_SLOP_PX } from '../../calendar/common/swipe'
import { flushListDraft, readListDraft, registerDraftClear, writeListDraft } from './listDraft'
import { releaseFocusBeforeFold } from './ListSection'
import {
  addPressStep,
  COMMIT_WAIT_MS,
  EMPTY_DRAFT,
  enterAction,
  INITIAL_ADD_PRESS,
  type AddPressEffect,
  type AddPressEvent,
  type ListDraft,
} from './listInputModel'

export interface ListInputOptions {
  list: ListKey
  /**
   * 足す（今の書きかけを渡す。字は打ったまま。前後の空白を落とすのは足す側）。足せたら true（欄とチップを空に戻す）。決まりに合わない
   * 時（201字など）は知らせて false（字は残す）
   */
  onAdd: (draft: ListDraft) => boolean
}

type Field = HTMLTextAreaElement | HTMLInputElement

export interface ListInputApi {
  list: ListKey
  /** 今の書きかけ（字とチップ） */
  draft: ListDraft
  /** 空白でない字があるか（無い間は［足す］を淡くし aria-disabled、押しても何もしない） */
  hasText: boolean
  /** チップなどの書きかけを替える（Task List の［開始日］［締め切り日］［依頼者］。字も替えられる） */
  setDraft: (patch: Partial<ListDraft>) => void
  /** 入力欄へフォーカスする（押した出来事の中で呼ぶと、iPhone でもキーボードが出る。空のかたまりの＋など。P3） */
  focus: () => void
  /** 入力欄に付ける */
  fieldProps: {
    ref: (el: Field | null) => void
    value: string
    onChange: (e: ChangeEvent<Field>) => void
    onKeyDown: (e: ReactKeyboardEvent<Field>) => void
    onCompositionStart: () => void
    onCompositionUpdate: () => void
    onCompositionEnd: () => void
    onFocus: () => void
  }
  /** ［足す］に付ける */
  addProps: {
    ref: (el: HTMLButtonElement | null) => void
    'aria-disabled': true | undefined
    onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => void
    onMouseDown: (e: ReactMouseEvent<HTMLButtonElement>) => void
    onClick: () => void
  }
}

/** 変換を決める Enter（React の出来事は変換中かを持たないので元の出来事を見る。Safari は keyCode 229） */
const composingKey = (e: ReactKeyboardEvent) => e.nativeEvent.isComposing || e.keyCode === 229

/** 打ちかけを捨てた時に、続く変換の決まった字（blur で決まって入力欄へ書かれる）を入れない長さ（ms） */
const DROP_COMPOSITION_MS = 300

export function useListInput({ list, onAdd }: ListInputOptions): ListInputApi {
  const [draft, setDraftState] = useState<ListDraft>(() => readListDraft(list))
  const coarse = useMediaQuery('(pointer: coarse)')
  const field = useRef<Field | null>(null)
  const addButton = useRef<HTMLButtonElement | null>(null)
  /** 今の値（window の出来事・タイマー・後片付けから読む） */
  const latest = useRef({ draft, onAdd, list })
  latest.current = { draft, onAdd, list }
  /** ［足す］の押し方の状態（addPressStep） */
  const press = useRef(INITIAL_ADD_PRESS)
  /** 変換の終わりを待つタイマー */
  const wait = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  /** 変換中に押した時に見えていた字（外した時にブラウザが変換中の字を捨てても、見えていた字を足す） */
  const pressed = useRef('')
  /** 打ちかけを捨てた後の、変換の決まった字を入れない間 */
  const dropping = useRef(false)
  const dropTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  /** 書きかけを替えて控える（now は待たずに） */
  const update = useCallback((next: ListDraft, now = false) => {
    latest.current = { ...latest.current, draft: next }
    setDraftState(next)
    writeListDraft(latest.current.list, next, { now })
  }, [])

  /** 足す（入力欄の今の字で。空なら押した時に見えていた字）。足せたら欄とチップを空にして true */
  const addNow = useCallback(
    (fallback?: string): boolean => {
      const cur = latest.current.draft
      let shown = field.current?.value ?? cur.text
      if (!shown.trim() && fallback?.trim()) shown = fallback
      if (shown !== cur.text) update({ ...cur, text: shown })
      if (!shown.trim()) return false
      if (!latest.current.onAdd({ ...cur, text: shown })) return false
      update(EMPTY_DRAFT, true)
      return true
    },
    [update],
  )

  /** 出来事を決まりに渡し、画面がすることをする（その出来事でしかできない物は呼んだ側へ返す） */
  const dispatch = useCallback(
    (e: AddPressEvent): { effects: AddPressEffect[]; added: boolean } => {
      const r = addPressStep(press.current, e)
      press.current = r.state
      let added = false
      for (const fx of r.effects) {
        switch (fx) {
          case 'blur':
            pressed.current = field.current?.value ?? latest.current.draft.text
            field.current?.blur()
            break
          case 'refocus':
            field.current?.focus({ preventScroll: true })
            break
          case 'startWait':
          case 'waitTick':
            clearTimeout(wait.current)
            wait.current = setTimeout(() => dispatch({ type: 'timeout' }), fx === 'startWait' ? COMMIT_WAIT_MS : 0)
            break
          case 'stopWait':
            clearTimeout(wait.current)
            wait.current = undefined
            break
          case 'add':
            added = addNow(pressed.current) || added
            pressed.current = ''
            break
        }
      }
      return { effects: r.effects, added }
    },
    [addNow],
  )

  // 押した・離した・押した後の mousedown・click を、window の捕まえる段階で見る（変換中に押した［足す］の分だけ。指を離した後の
  // mousedown・click は、画面が動いて指の下に別の物が来ていても、その物の操作にしない）
  useEffect(() => {
    const onDown = () => void dispatch({ type: 'windowdown' })
    const onUp = (e: PointerEvent) => {
      const p = press.current.press
      if (!p || p.up || p.pointer !== e.pointerId) return
      const btn = addButton.current
      const r = btn?.getBoundingClientRect()
      const inside =
        e.pointerType === 'mouse'
          ? e.target instanceof Node && Boolean(btn?.contains(e.target))
          : !r || (e.clientX >= r.left - SWIPE_SLOP_PX && e.clientX <= r.right + SWIPE_SLOP_PX)
      dispatch({ type: 'up', pointer: e.pointerId, inside })
    }
    const onCancel = (e: PointerEvent) => void dispatch({ type: 'cancel', pointer: e.pointerId })
    const onMouseDown = (e: MouseEvent) => {
      if (!dispatch({ type: 'mousedown' }).effects.includes('preventMouseDown')) return
      e.preventDefault()
      if (!(e.target instanceof Node && addButton.current?.contains(e.target))) e.stopPropagation()
    }
    const onClick = (e: MouseEvent) => {
      if (!press.current.press) return
      const r = dispatch({ type: 'click', fromPress: true, hasText: Boolean(latest.current.draft.text.trim()) })
      if (r.effects.includes('swallowClick')) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('pointerup', onUp, true)
    window.addEventListener('pointercancel', onCancel, true)
    window.addEventListener('mousedown', onMouseDown, true)
    window.addEventListener('click', onClick, true)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('pointerup', onUp, true)
      window.removeEventListener('pointercancel', onCancel, true)
      window.removeEventListener('mousedown', onMouseDown, true)
      window.removeEventListener('click', onClick, true)
    }
  }, [dispatch])

  // ■34: 打ちかけを捨てる（字・チップ。変換の途中なら、続いて決まる字も入れない）
  useEffect(
    () =>
      registerDraftClear(list, () => {
        const composing = press.current.composing || press.current.commit !== null
        dispatch({ type: 'reset' })
        pressed.current = ''
        if (composing) {
          dropping.current = true
          clearTimeout(dropTimer.current)
          dropTimer.current = setTimeout(() => (dropping.current = false), DROP_COMPOSITION_MS)
        }
        const el = field.current
        // 変換の途中で欄にフォーカスがあれば、先に外して変換を終えてもらう（フォーカスは、畳む時と同じくそのリストの見出しの畳む・
        // 開くボタンへ。リストの枠の外の欄なら外すだけ）。続いて決まる字は dropping の間なので入れない
        if (el && composing && document.activeElement === el && !releaseFocusBeforeFold(el.closest('.list-panel'))) el.blur()
        if (el) el.value = ''
        latest.current = { ...latest.current, draft: EMPTY_DRAFT }
        setDraftState(EMPTY_DRAFT)
      }),
    [list, dispatch],
  )

  // 外れる時: 変換中に［足す］で押し終えた分（変換の終わりを待っている間）は足し、控えていない書きかけは控える
  useEffect(
    () => () => {
      dispatch({ type: 'flush' })
      clearTimeout(wait.current)
      clearTimeout(dropTimer.current)
      flushListDraft(latest.current.list)
    },
    [dispatch],
  )

  const setDraft = useCallback((patch: Partial<ListDraft>) => update({ ...latest.current.draft, ...patch }), [update])
  const fieldRef = useCallback((el: Field | null) => {
    field.current = el
  }, [])
  const addRef = useCallback((el: HTMLButtonElement | null) => {
    addButton.current = el
  }, [])
  const focus = useCallback(() => field.current?.focus({ preventScroll: true }), [])
  const hasText = draft.text.trim() !== ''

  const fieldProps = useMemo<ListInputApi['fieldProps']>(
    () => ({
      ref: fieldRef,
      value: draft.text,
      onChange: (e) => {
        // 打ちかけを捨てた後に決まった変換の字は入れない（欄は空のまま）
        if (dropping.current) return
        update({ ...latest.current.draft, text: e.target.value })
      },
      onKeyDown: (e) => {
        if (e.key !== 'Enter') return
        const act = enterAction(latest.current.list, { shift: e.shiftKey, composing: composingKey(e), coarse })
        // 変換を決める Enter・改行はブラウザのまま
        if (act !== 'add') return
        e.preventDefault()
        dispatch({ type: 'click', fromPress: false, hasText: Boolean(latest.current.draft.text.trim()) })
      },
      onCompositionStart: () => void dispatch({ type: 'compositionstart' }),
      onCompositionUpdate: () => void dispatch({ type: 'compositionstart' }),
      onCompositionEnd: () => void dispatch({ type: 'compositionend' }),
      onFocus: () => {
        dropping.current = false
        dispatch({ type: 'focus' })
      },
    }),
    [draft.text, coarse, dispatch, update, fieldRef],
  )

  const addProps = useMemo<ListInputApi['addProps']>(
    () => ({
      ref: addRef,
      'aria-disabled': hasText ? undefined : true,
      onPointerDown: (e) => {
        if (e.button !== 0) return
        dispatch({
          type: 'down',
          pointer: e.pointerId,
          composing: press.current.composing,
          hasText: Boolean((field.current?.value ?? latest.current.draft.text).trim()),
        })
      },
      // 押してもフォーカスを入力欄に残す（iPhone のキーボードを閉じない。変換中は、この前の pointerdown で外している）
      onMouseDown: (e) => e.preventDefault(),
      onClick: () => {
        const r = dispatch({ type: 'click', fromPress: false, hasText: Boolean(latest.current.draft.text.trim()) })
        // Tab で移った［足す］の Enter・Space で足した時は、入力欄へ戻す（足せなかった時は［足す］に残す）
        if (r.added && document.activeElement === addButton.current) field.current?.focus({ preventScroll: true })
      },
    }),
    [hasText, dispatch, addRef],
  )

  return { list, draft, hasText, setDraft, focus, fieldProps, addProps }
}
