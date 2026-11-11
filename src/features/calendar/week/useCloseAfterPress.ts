// すばやく足す（docs/SPEC.md の 12.1・10.2・10.4・D44）の入力欄を、外を押して閉じる時は、押し終わってから閉じる（開発）。
// 共通の部品 QuickAdd は、入力欄の外で指・マウスを押した時（pointerdown）に「閉じる」と伝えてくる。そこですぐ閉じると、7日を縦（S）
// では入力欄（40px）が「＋」の行（28px）に戻ってその日のかたまりが縮み、下のかたまりが上へずれる。指を離した時（click）に指の下に
// あるのは、押した物の下の別のカード・点線の丸・「＋」になり、押した所と違う予定の詳細が開いたり、違う予定が完了になったりする。
// そこで、押し終わる（click・pointercancel。離してから CLICK_WAIT_MS たっても click が来ない時も）まで待ってから閉じる。押した物の
// 操作（click）は、閉じる前の並びのままで決まる。押していない時（Esc・Tab でフォーカスが外へ移った時）はすぐ閉じる
import { useCallback, useEffect, useRef } from 'react'

/** 離してから click を待つ長さ（ms。軽く押した時の click はすぐ来る。来ない時（長押し・なぞった）はこれで閉じる） */
export const CLICK_WAIT_MS = 300

/**
 * 閉じる時に呼ぶ関数を返す（open は入力欄を開いている間 true）。押している間に呼ばれたら押し終わるまで待ち、ほかはすぐ close を呼ぶ。
 * 待っている間に閉じた（週を移った・ほかの所で閉じた）時は、待つのをやめるだけ
 */
export function useCloseAfterPress(open: boolean, close: () => void): () => void {
  const closeRef = useRef(close)
  closeRef.current = close
  /** 指・マウスを押している（入力欄を開いている間だけ見る） */
  const pressed = useRef(false)
  /** 押し終わりを待っている時の、待つのをやめる関数 */
  const waiting = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!open) return
    // window の捕まえる段階で見る（QuickAdd の document の pointerdown より先に、押していると分かる）
    const down = () => {
      pressed.current = true
    }
    const up = () => {
      pressed.current = false
    }
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('pointerup', up, true)
    window.addEventListener('pointercancel', up, true)
    return () => {
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('pointerup', up, true)
      window.removeEventListener('pointercancel', up, true)
      pressed.current = false
      waiting.current?.()
    }
  }, [open])

  return useCallback(() => {
    if (!pressed.current) {
      closeRef.current()
      return
    }
    if (waiting.current) return
    let timer: number | undefined
    const stop = () => {
      window.clearTimeout(timer)
      window.removeEventListener('click', finish, true)
      window.removeEventListener('pointercancel', finish, true)
      window.removeEventListener('pointerup', released, true)
      waiting.current = null
    }
    const finish = () => {
      stop()
      closeRef.current()
    }
    const released = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(finish, CLICK_WAIT_MS)
    }
    window.addEventListener('click', finish, true)
    window.addEventListener('pointercancel', finish, true)
    window.addEventListener('pointerup', released, true)
    waiting.current = stop
  }, [])
}
