// すばやく足す（docs/SPEC.md の 12.1・6.13・D31・D42・AMB-ITEMS-21・D44・22. の段階2の終わりの確かめ）。ウィークリーの各日・各段の
// 「＋」、デイリーの各区切りの「＋ 予定を足す」の行が、その場でこの1行の入力欄に替わる（画面が出す・閉じる）。
// - 件名だけを打って Enter か［足す］（入力欄の右の端の✓）で足す。開始日と区分は押した場所（date・kind）、締め切り日・時刻は無し、
//   origin: 'calendar'・listed: false、order は今（足した予定はその日・その段の時刻の無い1日の予定のいちばん後に出る。7.5）。
//   細かい項目は後で詳細で
// - Enter・［足す］で足した後は開いたまま（空に戻り、フォーカスも入力欄に残る）。足した予定は入力欄のすぐ上に出るので目立たせない
// - 入力欄の外を押した時と、押さずにフォーカスが外れた時（iPhone のキーボードの上の✓（完了）・キーボードを閉じた）は、字があれば
//   足してから閉じ、「『件名』を足しました［元に戻す］」を出す（［元に戻す］はゴミ箱へ移して書きかけに戻す）。作者が iPhone で、
//   キーボードの上の✓を押しても何も起きず（✓は入力欄からフォーカスを外すだけで、前の作りはそれを窓の切り替えと同じに扱い何も
//   しなかった）、外を押すと閉じて字が消えたように見えた（書きかけには控えていたが、次に開くまで見えない）ことへの直し
//   （22. の段階2の終わりの確かめ）。空の時は、どちらも足さずに閉じる。日本語の変換を決める前に外れた時も、見えている字で足す
//   （変換中かでは分けない。iPhone で変換を決めずに✓を押した時に、また何も起きないことが無いように）
// - 足さずに閉じるのは Esc と、キーボード（Tab）でフォーカスを外の物へ移した時（書きかけは残り、次に開くと出る。［足す］へは Tab で
//   移れ、その次の Tab で外へ出ると閉じる）と、外を押してそのままカードをドラッグした時（WeekDnd が quickAddDragStarted で伝える。
//   離した後に、ドラッグのお知らせと重ねて足さない。ドラッグを Esc でやめた時も足さない）。窓・アプリの切り替えで外れただけの時と、
//   ドラッグを始めて画面がフォーカスを外した時（押している間なので、押した方で決める）は、足さず閉じない
// - 外を押した指でなぞってスクロール・拡大した時（ブラウザが指を受け取った pointercancel）は、外を押したとは扱わない。フォーカスが
//   入力欄に残っていれば（指でなぞってもフォーカスは動かない）、足さず閉じない（キーボードを出したまま週を見て、続けて打てる）
// - 日本語の変換中の Enter（isComposing・Safari の keyCode 229）と、空白だけの件名では足さない
// - 外を押して閉じる時は、押し終わってから閉じる（開発）: 押した時（pointerdown）にすぐ閉じると、入力欄が元の行に戻って下の物が
//   上へずれ（ウィークリーの S は入力欄 40px が「＋」の行 28px に戻る）、指を離した時（click）に指の下にあるのが押した物と違う物に
//   なる（違う予定の詳細が開く・違う予定が完了になる）。押した所からドラッグを始めた時（ウィークリー）も、並びが掴んだカードの下で
//   動かないようにする。そこで click の時（離してから CLICK_WAIT_MS たっても click が来ない時も）に、足して閉じる。
//   押した物の操作（click）は、閉じる前の並びのままで決まる。押していない時（Esc・Tab）はすぐ閉じる。押し終わる前に画面が外した
//   時（なぞって前後の日へ移った）も、字があれば足す
// - 押さずに外れたフォーカスは、BLUR_SETTLE_MS 待ってから決める（窓・アプリの切り替えは、要素の blur の後に window の blur・
//   見えなくなる出来事が来ることがある。来たら決めるのをやめる。その間に押した時は、押した方で決める）
// - 書きかけは diary-studio:draft:quick:{日付}:{区分} に控え（閉じても残し、同じ日・同じ区分で開き直すと戻る）、足したら消す。
//   ［元に戻す］で戻した字は、同じ日・同じ区分の入力欄が空で開いていれば、そこにも出す
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import { shortDateLabel } from '../../../../domain/dates'
import { toastText } from '../../../../domain/itemText'
import { ITEM_KIND_LABELS } from '../../../../domain/trash'
import type { ID, ItemKind } from '../../../../domain/types'
import { actions } from '../../../../store/actions'
import { quickDraftKey, readLocal, writeLocal } from '../../../../store/localDrafts'
import { attempt, attemptAsync, notify } from '../../../../store/uiStore'
import { CheckIcon } from '../../../../ui/icons'
import { scrollBehavior } from '../../../../ui/motion'
import { testIds } from '../testIds'
import { UNDO_LABEL } from './DoneToggle'
import { cls } from './itemLook'
import './parts.css'

/** 離してから click を待つ長さ（ms。軽く押した時の click はすぐ来る。来ない時（長押し・なぞった・ドラッグした）はこれで閉じる） */
export const CLICK_WAIT_MS = 300

/**
 * 押さずにフォーカスが外れてから、足して閉じると決めるまで待つ長さ（ms）。窓・アプリの切り替え（window の blur・見えなくなる）が
 * 後から来た時は足さない。iPhone のキーボードが閉じる動きより短い
 */
export const BLUR_SETTLE_MS = 120

/**
 * 閉じたきっかけ: Esc・入力欄の外を押し終えた・キーボード（Tab）でフォーカスを外の物へ移した・押さずにフォーカスが外れた
 * （iPhone のキーボードの上の✓など）・外を押してそのままドラッグした（離した後。足さない）
 */
export type QuickAddCloseReason = 'escape' | 'press' | 'focus' | 'blur' | 'drag'

/** 閉じる時に、字があれば足すきっかけ（外を押した・キーボードを閉じた） */
const ADDS_ON_CLOSE: ReadonlySet<QuickAddCloseReason> = new Set(['press', 'blur'])

export interface QuickAddProps {
  /** 足す日（開始日。'YYYY-MM-DD'） */
  date: string
  /** 足す区分 */
  kind: ItemKind
  /** 閉じる時（Esc・入力欄の外を押し終えた時・フォーカスを外へ移した時・キーボードを閉じた時。1回だけ呼ぶ） */
  onClose: (reason: QuickAddCloseReason) => void
  className?: string
}

/** 開いているすばやく足すの、ドラッグを始めた時に呼ぶ物（開いているのは1か所だが、外す時の取り違えが無いように組で持つ） */
const dragListeners = new Set<() => void>()

/**
 * ドラッグを始めた（WeekDnd の onDragStart。7.11）。開いているすばやく足すは、その押した分を「外を押した」ではなく「ドラッグした」と
 * して、離した後に足さずに閉じる（書きかけは残る）
 */
export function quickAddDragStarted(): void {
  for (const fn of dragListeners) fn()
}

/** 開いているすばやく足すの、書きかけを入力欄に戻す物（書きかけの控えの名前ごと。［元に戻す］で、空で開いている欄に字を出す） */
const openFields = new Map<string, (text: string) => void>()

/** 変換を決める Enter・変換をやめる Esc か（React の出来事は変換中かを持たないので元の出来事を見る。Safari は keyCode 229） */
function composing(e: KeyboardEvent): boolean {
  return e.nativeEvent.isComposing || e.keyCode === 229
}

/**
 * 押してもフォーカスを入力欄に残す（［足す］。iPhone のキーボードを閉じない・入力欄の blur を起こさない）。フォーカスを移すのは
 * mousedown（指の時も、離した後に来る）なので、そこだけ止める（pointerdown を止めると、指の時は mousedown が来なくなり、止められない）
 */
function keepFocus(e: ReactMouseEvent): void {
  e.preventDefault()
}

/**
 * 閉じる時に足した予定の［元に戻す］: ゴミ箱へ移し（30日は戻せる。18.5 の Claude が足した物を戻す時と同じ）、打った字を書きかけに
 * 戻す（その日・その区分に新しい書きかけが無い時だけ。次に開くと出る。同じ日・同じ区分の入力欄が空で開いていれば、そこにも出す）
 */
function undoAdd(id: ID, key: string, text: string): void {
  void attemptAsync(() => actions.trashItem(id)).then((entry) => {
    if (entry === undefined || readLocal(key)) return
    writeLocal(key, text)
    openFields.get(key)?.(text)
  })
}

export function QuickAdd({ date, kind, onClose, className }: QuickAddProps) {
  const key = quickDraftKey(date, kind)
  // 書きかけ（日付か区分が替わったら、その日・その区分の書きかけを読み直す）
  const [draft, setDraft] = useState(() => ({ key, text: readLocal(key) ?? '' }))
  if (draft.key !== key) setDraft({ key, text: readLocal(key) ?? '' })
  const text = draft.key === key ? draft.text : ''
  /** 足した数（足した予定が描かれた後に、入力欄を見える所に残すため） */
  const [added, setAdded] = useState(0)
  const box = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  /** 今の値（window の出来事・後片付けから読む） */
  const latest = useRef({ date, kind, key, text, onClose })
  latest.current = { date, kind, key, text, onClose }
  /** もう閉じると決めた（外を押した時は pointerdown と、続くフォーカスの移りの両方が来るので、1回だけ伝える） */
  const closing = useRef(false)
  /** 押し終わるのを待ってから閉じる時の、閉じたきっかけ */
  const pending = useRef<QuickAddCloseReason | null>(null)
  /**
   * 押している（どこでも。pointerdown から、click・pointercancel・離して CLICK_WAIT_MS たつまで。指の時は、離した後に
   * フォーカスの移り（入力欄の blur）と click が来るので、離した所では終わらない）。timer は離した後の待ち
   */
  const press = useRef<{ timer?: number } | null>(null)
  /** 押さずに外れたフォーカスを決めるまでの待ち */
  const settleTimer = useRef<number | undefined>(undefined)
  /** 窓・アプリを離れた（window の blur・ページが見えなくなった。窓・ページ・入力欄へ戻ると外す） */
  const away = useRef(false)
  /** 今押している分でドラッグを始めた（quickAddDragStarted。離した後は足さずに閉じる） */
  const dragged = useRef(false)

  /** 字があれば足して、［元に戻す］付きで知らせる（閉じる時）。足せなかった（決まりに合わない件名）時は false */
  const addOnClose = (): boolean => {
    const { date, kind, key, text } = latest.current
    if (!text.trim()) return true
    const id = attempt(() => actions.addItem({ origin: 'calendar', title: text, kind, start: date }))
    if (!id) return false
    writeLocal(key, null)
    latest.current = { ...latest.current, text: '' }
    setDraft({ key, text: '' })
    notify(toastText.added(text.trim()), { label: UNDO_LABEL, run: () => undoAdd(id, key, text) })
    return true
  }

  /** 画面へ閉じたと伝える（外を押した・キーボードを閉じた時は、字があれば足してから。外を押してドラッグした時は足さない） */
  const finish = (pressed: QuickAddCloseReason) => {
    pending.current = null
    const reason = pressed === 'press' && dragged.current ? 'drag' : pressed
    if (ADDS_ON_CLOSE.has(reason) && !addOnClose() && reason === 'blur') {
      // キーボードを閉じただけの時は、足せなければ開いたまま（お知らせを見て打ち直せるように）
      closing.current = false
      return
    }
    latest.current.onClose(reason)
  }

  /** 閉じる（1回だけ）。押している間は、押し終わる（click・pointercancel・離して CLICK_WAIT_MS）まで待つ */
  const close = (reason: QuickAddCloseReason) => {
    if (closing.current) return
    closing.current = true
    window.clearTimeout(settleTimer.current)
    if (press.current) {
      pending.current = reason
      return
    }
    finish(reason)
  }

  /** Esc: 足さずにすぐ閉じる（押し終わりを待っている時も、待つのをやめる） */
  const escape = () => {
    if (closing.current && !pending.current) return
    pending.current = null
    closing.current = true
    window.clearTimeout(settleTimer.current)
    latest.current.onClose('escape')
  }

  // 開いたらすぐ打てるように（押した出来事の中で描くので、iPhone でもキーボードが開く）。見える所まで出す。打つ欄は全部見えている
  // ことが大事なので、ここはページも動かしてよい（scrollIntoView。S・M の週・日の下の端は画面の下に少し出ている。ドラッグの後・
  // 目立たせる時はページを動かさない src/ui/scrollWithin.ts を使う）
  useLayoutEffect(() => {
    input.current?.focus({ preventScroll: true })
    input.current?.scrollIntoView({ block: 'nearest', behavior: scrollBehavior() })
  }, [])

  // 押した・離した・窓を離れたを、window の捕まえる段階で見る（押した物の pointerdown・mousedown（フォーカスの移り）・click より
  // 先に分かる）。入力欄の外を押したら、押し終わってから足して閉じる（押した所の操作はそのまま。ほかの日の「＋」なら、そこの
  // 入力欄が開く）
  useEffect(() => {
    const endPress = () => {
      const p = press.current
      if (!p) return
      window.clearTimeout(p.timer)
      press.current = null
      if (pending.current) finish(pending.current)
    }
    // ブラウザが指を受け取った（なぞってスクロール・拡大した）: 外を押したとは扱わない。フォーカスが入力欄に残っていれば（指で
    // なぞってもフォーカスは動かない）、閉じるのをやめて開いたまま（足さない）。外れていれば（ドラッグした・マウスで押した物へ
    // フォーカスが移った）、押し終わった時と同じ
    const cancelPress = () => {
      const p = press.current
      if (!p) return
      const active = document.activeElement
      if (pending.current && !dragged.current && active && box.current?.contains(active)) {
        window.clearTimeout(p.timer)
        press.current = null
        pending.current = null
        closing.current = false
        return
      }
      endPress()
    }
    const onDown = (e: PointerEvent) => {
      if (press.current) window.clearTimeout(press.current.timer)
      else dragged.current = false
      press.current = {}
      if (box.current && e.target instanceof Node && !box.current.contains(e.target)) close('press')
    }
    const onUp = () => {
      const p = press.current
      if (!p) return
      window.clearTimeout(p.timer)
      p.timer = window.setTimeout(endPress, CLICK_WAIT_MS)
    }
    // 窓・アプリを離れた: 押さずに外れたフォーカスを決めるのをやめる（iPhone はアプリを離れている間タイマーが止まり、戻った後に
    // 鳴るので、離れた時に捨てておく）。戻ったら外す（戻った後のキーボードの✓は、ふつうに足して閉じる）
    const leave = () => {
      away.current = true
      window.clearTimeout(settleTimer.current)
    }
    // window そのものの blur・focus だけ（要素の blur・focus は泡立たないので、捕まえる段階でなければ来ないが、念のため）
    const onWindowBlur = (e: Event) => {
      if (e.target === e.currentTarget) leave()
    }
    const onWindowFocus = (e: Event) => {
      if (e.target === e.currentTarget) away.current = false
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') away.current = false
      else leave()
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('pointerup', onUp, true)
    window.addEventListener('pointercancel', cancelPress, true)
    window.addEventListener('click', endPress, true)
    window.addEventListener('blur', onWindowBlur)
    window.addEventListener('focus', onWindowFocus)
    window.addEventListener('pagehide', leave)
    document.addEventListener('visibilitychange', onVisibility)
    const onDrag = () => {
      if (press.current) dragged.current = true
    }
    dragListeners.add(onDrag)
    return () => {
      dragListeners.delete(onDrag)
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('pointerup', onUp, true)
      window.removeEventListener('pointercancel', cancelPress, true)
      window.removeEventListener('click', endPress, true)
      window.removeEventListener('blur', onWindowBlur)
      window.removeEventListener('focus', onWindowFocus)
      window.removeEventListener('pagehide', leave)
      document.removeEventListener('visibilitychange', onVisibility)
      if (press.current) window.clearTimeout(press.current.timer)
      press.current = null
      window.clearTimeout(settleTimer.current)
      // 閉じた（画面が外した）・日が替わった時は、待つのをやめる。外を押して閉じると決めた後に、押し終わる前に画面が外した
      // （なぞって前後の日へ移った）時は、閉じたとは伝えないが、字があれば足す（ドラッグしている間に週が替わった時は足さない）
      if (pending.current) {
        pending.current = null
        if (!dragged.current) addOnClose()
      }
    }
    // 中で使う関数は ref だけを読む（初めに描いた時の物でよい）
  }, [])

  // ［元に戻す］で戻した字を、この入力欄が空なら出す（空でなければ、打っている字を残す）
  useEffect(() => {
    const fill = (restored: string) => {
      if (latest.current.text.trim() || latest.current.key !== key) return
      latest.current = { ...latest.current, text: restored }
      setDraft({ key, text: restored })
    }
    openFields.set(key, fill)
    return () => {
      if (openFields.get(key) === fill) openFields.delete(key)
    }
  }, [key])

  // 足した予定の分だけ入力欄が下へ動くので、描いた後に見える所に残す
  useLayoutEffect(() => {
    if (added) input.current?.scrollIntoView({ block: 'nearest', behavior: scrollBehavior() })
  }, [added])

  const change = (next: string) => {
    setDraft({ key, text: next })
    latest.current = { ...latest.current, text: next }
    // 空白だけの書きかけは控えない
    writeLocal(key, next.trim() ? next : null)
  }

  /** Enter・［足す］: 足して、開いたまま次を打てるようにする */
  const add = () => {
    if (!text.trim()) return
    const id = attempt(() => actions.addItem({ origin: 'calendar', title: text, kind, start: date }))
    if (!id) return
    setDraft({ key, text: '' })
    latest.current = { ...latest.current, text: '' }
    setAdded((n) => n + 1)
    writeLocal(key, null)
    input.current?.focus({ preventScroll: true })
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (composing(e) || e.key !== 'Enter') return
    e.preventDefault()
    add()
  }

  // Esc は入力欄と［足す］のどちらにフォーカスがあっても閉じる。下の小さな画面・休みを付ける状態へは渡さない
  const onBoxKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Escape' || composing(e)) return
    e.preventDefault()
    e.stopPropagation()
    escape()
  }

  /**
   * 押さずに外れたフォーカスを、BLUR_SETTLE_MS 待ってから決める（窓・アプリの切り替え・押した・入力欄へ戻った時は何もしない）。
   * 日本語の変換中かでは分けない（外れると、ブラウザが変換中の字をそのまま決める。見えている字を足す）
   */
  const settle = () => {
    settleTimer.current = undefined
    if (closing.current || press.current || away.current) return
    const active = document.activeElement
    if (active && box.current?.contains(active)) return
    if (document.visibilityState !== 'visible' || !document.hasFocus()) return
    close('blur')
  }

  // フォーカスが入力欄・［足す］の外へ出た
  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    const next = e.relatedTarget
    if (next instanceof Node && box.current?.contains(next)) return
    if (closing.current) return
    // キーボード（Tab など）でほかの物へ移した: 足さずに閉じる（書きかけは残る。押している間の移りは、押し終わってから閉じる）
    if (next instanceof Node) {
      close('focus')
      return
    }
    // 行き先の無い blur: 押している間は押した方で決める（外を押したなら押し終わってから足して閉じる。ドラッグを始めた時に画面が
    // 外したフォーカスもここ）。窓・アプリの切り替えでは何もしない
    if (press.current) return
    if (document.visibilityState !== 'visible' || !document.hasFocus()) {
      away.current = true
      return
    }
    if (away.current) return
    // 押さずに外れた（iPhone のキーボードの上の✓・キーボードを閉じた）: 少し待ってから、字があれば足して閉じる
    window.clearTimeout(settleTimer.current)
    settleTimer.current = window.setTimeout(settle, BLUR_SETTLE_MS)
  }

  const blank = !text.trim()

  return (
    <div ref={box} className={cls('cp-quick', className)} data-kind={kind} onKeyDown={onBoxKeyDown} onBlur={onBlur}>
      <div className="cp-quick-field">
        <input
          ref={input}
          className="input cp-quick-input"
          type="text"
          value={text}
          onChange={(e) => change(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => {
            // 入力欄へ戻った（押し終わりを待っている間は、そのまま閉じる）
            away.current = false
            window.clearTimeout(settleTimer.current)
            if (!pending.current) closing.current = false
          }}
          placeholder="件名"
          aria-label={`${shortDateLabel(date)}の${ITEM_KIND_LABELS[kind]}の予定を足す`}
          enterKeyHint="enter"
          autoComplete="off"
          data-testid={testIds.quickAddInput}
        />
        <button
          type="button"
          className="icon-btn cp-quick-add"
          aria-label="足す"
          aria-disabled={blank || undefined}
          onMouseDown={keepFocus}
          onClick={add}
          data-testid={testIds.quickAddButton}
        >
          <CheckIcon />
        </button>
      </div>
    </div>
  )
}
