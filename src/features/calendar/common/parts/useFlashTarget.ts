// 移った先・押した区切りを目立たせる（docs/SPEC.md の 4.9・7.12・11.2・12.2・7.11）。目立たせる側は
// useCalendarUi.getState().flashTarget(flashKey.item(id)) などでキーを置き（NS の reveal.ts の作り）、目立たせられる側（カード・行・
// 区切り・予定の枠）はこのフックの ref を要素に付ける。キーが合うと、その要素に src/ui/motion.ts の flash()（2px の --accent の枠を
// 1.2秒。最後の 400ms で薄くなる。視差効果を減らす設定では薄くならずに 1.2秒）を掛ける。
// - 見える所へ出す（scroll）のは flashTarget で置いた時だけ。ドラッグで落とした時は flashInPlace で置き、目立たせるだけにする
//   （出すのは WeekDnd が、動かした物を。目立つ物が動かした物と違う時（●を動かして、始点のカード・受けた表示が目立つ）に、
//   二つの送りがぶつからないように）
// - キー: 'item:{id}'（登録・ドラッグで移った予定、元に戻す・やり直すで当てた予定。デイリーの「+n」の札は、隠れた予定のキーを持つ）、'day-area:{区分}'（デイリーの区切り）、
//   'day-events:{区分}'（タイムスケジュールのその区分の予定。マンスリーの数字から来た時は区切りと一緒に。11.2）、'day-head:{日付}'
//   （ウィークリー・デイリーの日の見出し。元に戻す・やり直すで休みを当てた日。7.13・■26）。1つの要素に、いくつかのキーを渡せる
// - 見える所へ出す時は、画面の下のお知らせ（元に戻した・やり直したお知らせなど）と横に重なれば、その上まで（toastInset。4.9）
// - 今出ている目立たせられる要素を、キーごとに覚える（flashTargetsOf。元に戻す・やり直すで当てた予定が見えているかを見る。■26）
// - 枠は outline で出す（.flash）。目立たせる要素に outline・animation の CSS を付けない（隠れる）。
//   描き直しで要素の className が替わって .flash が消えた時は、目立たせている間だけ付け直す
// - 見つけた最初の 1.2秒の後に置いたキーを消す（後で同じ画面を開き直しても、もう一度は目立たせない）。どこにも出ないまま
//   FLASH_STALE_MS を過ぎたキーも消す（見えていない週に足した予定を、後で開いた時に目立たせない）
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import type { ID, ItemKind } from '../../../../domain/types'
import { flashMatches, useCalendarUi, type FlashTarget } from '../../../../store/uiStore'
import { FLASH_MS, flash, scrollBehavior } from '../../../../ui/motion'
import { scrollIntoViewWithin, toastInset } from '../../../../ui/scrollWithin'

/** 目立たせる所のキー（目立たせる側・目立たせられる側が同じ物を使う） */
export const flashKey = {
  /** 登録・ドラッグで移った予定のカード・行・予定の枠 */
  item: (id: ID) => `item:${id}`,
  /** デイリーの区切り（領域） */
  dayArea: (kind: ItemKind) => `day-area:${kind}`,
  /** タイムスケジュールのその区分の予定の枠 */
  dayEvents: (kind: ItemKind) => `day-events:${kind}`,
  /** ウィークリー・デイリーの日の見出し（元に戻す・やり直すで休みを当てた日） */
  dayHead: (date: string) => `day-head:${date}`,
} as const

/** 今出ている目立たせられる要素（キー → 要素。1つの要素に、いくつかのフックがキーを付けることがある） */
const mounted = new Map<string, Map<Element, number>>()

function attach(el: Element, keys: readonly string[]): void {
  for (const k of keys) {
    const els = mounted.get(k) ?? new Map<Element, number>()
    els.set(el, (els.get(el) ?? 0) + 1)
    mounted.set(k, els)
  }
}

function detach(el: Element, keys: readonly string[]): void {
  for (const k of keys) {
    const els = mounted.get(k)
    const n = els?.get(el) ?? 0
    if (!els || n === 0) continue
    if (n > 1) els.set(el, n - 1)
    else els.delete(el)
    if (els.size === 0) mounted.delete(k)
  }
}

/** そのキーで今出ている目立たせられる要素（ページに付いている物だけ） */
export function flashTargetsOf(key: string): Element[] {
  return [...(mounted.get(key)?.keys() ?? [])].filter((el) => el.isConnected)
}

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
  /**
   * 付け直してよい間か（目立たせてから FLASH_MS − REAPPLY_MARGIN_MS の間。時計ではなくタイマーで数える: 時計を止めた E2E
   * （page.clock.setFixedTime）・端末の時計を直した時も、終わった後に付け直さない）
   */
  const live = useRef(false)
  const liveTimer = useRef<number | undefined>(undefined)

  /** 覚えさせている要素とキー（flashTargetsOf） */
  const shown = useRef<{ el: T; keys: readonly string[] } | null>(null)
  const keysNow = useRef(joined)
  keysNow.current = joined
  /** 覚えさせている要素・キーを、今の物にそろえる */
  const sync = useCallback((el: T | null, joinedKeys: string) => {
    const prev = shown.current
    const keys = joinedKeys ? joinedKeys.split('\n') : []
    if (prev && prev.el === el && prev.keys.join('\n') === joinedKeys) return
    if (prev) detach(prev.el, prev.keys)
    shown.current = el && keys.length > 0 ? { el, keys } : null
    if (shown.current) attach(el as T, keys)
  }, [])

  const start = useCallback((el: T) => {
    const { seq: s, scroll } = latest.current
    if (!s || done.current === s) return
    done.current = s
    flash(el)
    live.current = true
    window.clearTimeout(liveTimer.current)
    liveTimer.current = window.setTimeout(() => (live.current = false), FLASH_MS - REAPPLY_MARGIN_MS)
    if (scroll) {
      // 画面の下のお知らせ（6秒の［元に戻す］・元に戻した・やり直したお知らせ）の下に隠さない（4.9）
      const inset = toastInset(el)
      scrollIntoViewWithin(el, inset > 0 ? { behavior: scrollBehavior(), bottomInset: inset } : { behavior: scrollBehavior() })
    }
    clearAfter(s, FLASH_MS)
  }, [])

  // キーが替わった時は覚え直し、外れた時（部品を外した時）は忘れる。替わったキーが目立たせている所ともう合わない時（デイリーの日の
  // 見出しが次の日の物になった時など）は、出している枠をすぐ外す（別の日・別の予定を目立たせたままにしない）
  useLayoutEffect(() => {
    sync(node.current, joined)
    if (live.current && matchedSeq(useCalendarUi.getState().flash, joined) !== done.current) {
      live.current = false
      window.clearTimeout(liveTimer.current)
      node.current?.classList.remove('flash')
    }
  }, [joined, sync])
  // 外した時は、目立たせた印も忘れる（StrictMode（開発の画面・E2E）は出した部品を一度外して出し直す。付け直す間だけを終わらせて
  // 目立たせ終えた seq を残すと、出し直した時に目立たせ直さず、付け直す間も終わらないので、後の描き直しのたびに付け直していた）
  useLayoutEffect(
    () => () => {
      sync(null, '')
      window.clearTimeout(liveTimer.current)
      live.current = false
      done.current = 0
    },
    [sync],
  )

  // キーを置いた時（要素はもう出ている）
  useEffect(() => {
    if (seq && node.current) start(node.current)
  }, [seq, start])

  // 描き直し（className の替わり・要素の入れ替わり）で枠が消えたら付け直す
  useLayoutEffect(() => {
    const el = node.current
    if (el && live.current && !el.classList.contains('flash')) flash(el)
  })

  // 要素が付いた時（キーを置いた後に出た要素も、出た時に目立つ）
  return useCallback(
    (el: T | null) => {
      node.current = el
      sync(el, keysNow.current)
      if (el) start(el)
    },
    [start, sync],
  )
}
