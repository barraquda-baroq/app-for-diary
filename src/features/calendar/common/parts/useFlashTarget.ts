// 移った先・押した区切りを目立たせる（docs/SPEC.md の 4.9・7.12・11.2・12.2・7.11）。目立たせる側は
// useCalendarUi.getState().flashTarget(flashKey.item(id)) などでキーを置き（NS の reveal.ts の作り）、目立たせられる側（カード・行・
// 区切り・予定の枠）はこのフックの ref を要素に付ける。キーが合うと、その要素に src/ui/motion.ts の flash()（2px の --accent の枠を
// 1.2秒。最後の 400ms で薄くなる。視差効果を減らす設定では薄くならずに 1.2秒）を掛ける。
// - 見える所へ出す（scroll）のは flashTarget で置いた時だけ。ドラッグで落とした時は flashInPlace で置き、目立たせるだけにする
//   （出すのは WeekDnd が、動かした物を。目立つ物が動かした物と違う時（●を動かして、始点のカード・受けた表示が目立つ）に、
//   二つの送りがぶつからないように）
// - キー: 'item:{id}'（登録・ドラッグで移った予定）、'day-area:{区分}'（デイリーの区切り）、'day-events:{区分}'（タイムスケジュールの
//   その区分の予定。マンスリーの数字から来た時は区切りと一緒に。11.2）。1つの要素に、いくつかのキーを渡せる
// - 枠は outline で出す（.flash）。目立たせる要素に outline・animation の CSS を付けない（隠れる）。
//   描き直しで要素の className が替わって .flash が消えた時は、目立たせている間だけ付け直す
// - 見つけた最初の 1.2秒の後に置いたキーを消す（後で同じ画面を開き直しても、もう一度は目立たせない）。どこにも出ないまま
//   FLASH_STALE_MS を過ぎたキーも消す（見えていない週に足した予定を、後で開いた時に目立たせない）
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import type { ID, ItemKind } from '../../../../domain/types'
import { flashMatches, useCalendarUi, type FlashTarget } from '../../../../store/uiStore'
import { FLASH_MS, flash, scrollBehavior } from '../../../../ui/motion'
import { scrollIntoViewWithin } from '../../../../ui/scrollWithin'

/** 目立たせる所のキー（目立たせる側・目立たせられる側が同じ物を使う） */
export const flashKey = {
  /** 登録・ドラッグで移った予定のカード・行・予定の枠 */
  item: (id: ID) => `item:${id}`,
  /** デイリーの区切り（領域） */
  dayArea: (kind: ItemKind) => `day-area:${kind}`,
  /** タイムスケジュールのその区分の予定の枠 */
  dayEvents: (kind: ItemKind) => `day-events:${kind}`,
} as const

/** 置いたキーが、どこにも出ないまま消えるまで（移った先の画面が出るまでは待つ） */
export const FLASH_STALE_MS = 3000

/** 付け直すのは、目立たせる時間がまだこれより多く残っている時だけ（終わりぎわに付け直して長くしない） */
const REAPPLY_MARGIN_MS = 200

/** 消すことにした seq（いくつもの要素が同じキーで目立っても、消すのは1回） */
const clearing = new Set<number>()

function clearAfter(seq: number, ms: number): void {
  if (clearing.has(seq)) return
  clearing.add(seq)
  window.setTimeout(() => {
    clearing.delete(seq)
    useCalendarUi.getState().clearFlash(seq)
  }, ms)
}

// 置いたキーは、どこにも出なくても FLASH_STALE_MS で消す（このファイルを読み込んだ時から見張る）
useCalendarUi.subscribe((s, prev) => {
  const f = s.flash
  if (f && f.seq !== prev.flash?.seq) {
    const seq = f.seq
    window.setTimeout(() => useCalendarUi.getState().clearFlash(seq), FLASH_STALE_MS)
  }
})

/** keys（改行でつないだ物）のどれかが目立たせる所なら、その seq（無ければ 0） */
function matchedSeq(f: FlashTarget | null, joined: string): number {
  if (!f || !joined) return 0
  return joined.split('\n').some((k) => flashMatches(f, k)) ? f.seq : 0
}

/** 目立たせる所で、動かさずに目立たせるだけの時（uiStore の flashInPlace。ドラッグで落とした時）か */
function matchedInPlace(f: FlashTarget | null, joined: string): boolean {
  return matchedSeq(f, joined) !== 0 && !f?.scroll
}

export interface FlashOptions {
  /**
   * 目立たせる時に、要素を見える所まで動かす（カレンダーの中のスクロールだけを動かし、ページは動かさない。src/ui/scrollWithin.ts。
   * 視差効果を減らす設定ではすぐに。デイリーの行・予定の枠、ウィークリーのカード・受けた表示）。目立たせる側が flashInPlace で
   * キーを置いた時（ドラッグで落とした時。出すのは WeekDnd）は動かさない
   */
  scroll?: boolean
}

/**
 * 目立たせられる要素に付ける ref を返す。keys が無い（null）時は何もしない。
 * 例: const ref = useFlashTarget([flashKey.item(item.id), flashKey.dayEvents(item.kind)])
 */
export function useFlashTarget<T extends Element = HTMLElement>(
  keys: string | readonly string[] | null | undefined,
  opts: FlashOptions = {},
): (el: T | null) => void {
  const joined = keys == null ? '' : typeof keys === 'string' ? keys : keys.join('\n')
  const seq = useCalendarUi((s) => matchedSeq(s.flash, joined))
  const inPlace = useCalendarUi((s) => matchedInPlace(s.flash, joined))
  const scroll = Boolean(opts.scroll) && !inPlace
  // 描いた時の値（要素が付いた時・seq が替わった時に読む）
  const latest = useRef({ seq, scroll })
  latest.current = { seq, scroll }
  const node = useRef<T | null>(null)
  /** 目立たせ終えた seq（同じ seq で2回目立たせない） */
  const done = useRef(0)
  /** 目立たせている間の終わり（Date.now() のミリ秒。0 は目立たせていない） */
  const until = useRef(0)

  const start = useCallback((el: T) => {
    const { seq: s, scroll } = latest.current
    if (!s || done.current === s) return
    done.current = s
    flash(el)
    until.current = Date.now() + FLASH_MS
    if (scroll) scrollIntoViewWithin(el, { behavior: scrollBehavior() })
    clearAfter(s, FLASH_MS)
  }, [])

  // キーを置いた時（要素はもう出ている）
  useEffect(() => {
    if (seq && node.current) start(node.current)
  }, [seq, start])

  // 描き直し（className の替わり・要素の入れ替わり）で枠が消えたら付け直す
  useLayoutEffect(() => {
    const el = node.current
    if (el && until.current - REAPPLY_MARGIN_MS > Date.now() && !el.classList.contains('flash')) flash(el)
  })

  // 要素が付いた時（キーを置いた後に出た要素も、出た時に目立つ）
  return useCallback(
    (el: T | null) => {
      node.current = el
      if (el) start(el)
    },
    [start],
  )
}
