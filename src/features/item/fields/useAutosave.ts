// 詳細の画面の文字の欄（件名・依頼者・メモ）の自動の保存（docs/SPEC.md の 12.3・2.9。ITEMS-207・208・FRAME-054・265）。
// 打っている間は欄の中に下書きを持ち、0.6秒止まった時かフォーカスを外した時に保存する（打ち続けていても 1.5秒ごとには保存する）。
// NS の src/ui/DraftField.tsx の useDraft（DS の src/ui/DraftField.tsx）と同じ作り（未保存の下書きを src/store/draftRegistry に
// 登録し、画面を閉じる・裏に回る時にまとめて保存する。部品が消える時も保存する）に、次の3つを足した物:
// - 保存した値と下書きが同じとみなせる時（件名・依頼者は前後の空白の違いだけ）は、外の値に合わせ直さない（保存で前後の空白を除いた
//   値が戻ってきても、打っている途中の最後の空白を消さない）・保存しない
// - 日本語の変換の途中では保存しない（変換を決めてから 0.6秒）
// - 件名は空にできない: 空のまま止まっても保存せず、離れた時に元の件名に戻す（revertBlank。12.3・ITEMS-004・D48）
// 別の記録を出す時は、包む部品に key（記録の id）を付けて作り直す
import { useCallback, useEffect, useRef, useState } from 'react'
import { markDraftClean, markDraftDirty } from '../../../store/draftRegistry'

/** 打つのが止まってから保存するまで（12.3） */
export const AUTOSAVE_MS = 600
/** 打ち続けていても、最初の未保存の字からこの時間以内には保存する（src/ui/DraftField.tsx と同じ） */
export const AUTOSAVE_MAX_WAIT_MS = 1500

export interface AutosaveOptions {
  delay?: number
  /** 下書きと保存した値が同じか（同じなら保存しない・外の値に合わせ直さない）。既定は字が全く同じ時 */
  same?: (draft: string, saved: string) => boolean
  /** 空（空白だけ）の下書きは保存せず、離れた時（commit）に保存した値へ戻す（件名） */
  revertBlank?: boolean
}

/** 前後の空白の違いだけなら同じ（件名・依頼者は保存の時に前後の空白を除くので） */
export const sameTrimmed = (draft: string, saved: string): boolean => draft.trim() === saved.trim()

export interface Autosave {
  /** 欄に出す下書き */
  draft: string
  /** 打った（下書きを替えて、0.6秒後に保存する） */
  change: (v: string) => void
  /** 今すぐ保存する（未保存の下書きがあれば） */
  flush: () => void
  /** 欄を離れた・Enter: 保存し、空にできない欄が空なら元の値に戻す */
  commit: () => void
  /** 日本語の変換の始まり・終わり（欄の onCompositionStart・onCompositionEnd に付ける） */
  composition: { onCompositionStart: () => void; onCompositionEnd: () => void }
}

/**
 * value は保存した値、save は保存する関数（同じとみなせない下書きの時だけ呼ぶ。空の件名では呼ばない）。
 * 返す change・flush・commit は描き直しても同じ関数
 */
export function useAutosave(value: string, save: (v: string) => void, opts: AutosaveOptions = {}): Autosave {
  const { delay = AUTOSAVE_MS, same = Object.is, revertBlank = false } = opts
  const [draft, setDraft] = useState(value)
  const st = useRef({ draft: value, value, save, same, revertBlank, delay, dirty: false, since: 0, composing: false })
  Object.assign(st.current, { value, save, same, revertBlank, delay })
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const registryKey = useRef(Symbol('autosave'))

  const stop = () => {
    if (timer.current !== null) {
      clearTimeout(timer.current)
      timer.current = null
    }
  }

  const flush = useCallback(() => {
    stop()
    const s = st.current
    if (!s.dirty) return
    s.dirty = false
    markDraftClean(registryKey.current)
    if (s.revertBlank && s.draft.trim() === '') return
    if (!s.same(s.draft, s.value)) s.save(s.draft)
  }, [])

  const schedule = useCallback(() => {
    stop()
    const s = st.current
    const wait = Math.max(0, Math.min(s.delay, s.since + AUTOSAVE_MAX_WAIT_MS - Date.now()))
    timer.current = setTimeout(() => {
      timer.current = null
      // 変換の途中なら、変換を決めた時（compositionend）にもう一度待つ
      if (!st.current.composing) flush()
    }, wait)
  }, [flush])

  const change = useCallback(
    (v: string) => {
      const s = st.current
      s.draft = v
      setDraft(v)
      if (!s.dirty) {
        s.dirty = true
        s.since = Date.now()
        // 画面を閉じる・裏に回る時にまとめて保存できるよう登録する（src/store/lifecycle.ts の flushAllDrafts）
        markDraftDirty(registryKey.current, flush)
      }
      schedule()
    },
    [flush, schedule],
  )

  const commit = useCallback(() => {
    flush()
    const s = st.current
    if (s.revertBlank && s.draft.trim() === '' && s.draft !== s.value) {
      s.draft = s.value
      setDraft(s.value)
    }
  }, [flush])

  const composition = useRef({
    onCompositionStart: () => {
      st.current.composing = true
    },
    onCompositionEnd: () => {
      st.current.composing = false
      if (st.current.dirty) schedule()
    },
  })

  // 外で値が変わった（ほかの端末・Claude が直した）時は、未保存の下書きが無く、下書きと違えば合わせる
  useEffect(() => {
    const s = st.current
    if (!s.dirty && !s.same(s.draft, value)) {
      s.draft = value
      setDraft(value)
    }
  }, [value])

  // 消える時（閉じた・別の予定に替わった）は保存漏れを防ぐ（閉じる前に 0.6秒待ちの字を保存する。ITEMS-208）
  useEffect(() => flush, [flush])

  return { draft, change, flush, commit, composition: composition.current }
}
