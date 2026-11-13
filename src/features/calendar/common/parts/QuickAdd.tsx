// すばやく足す（docs/SPEC.md の 12.1・6.13・D31・D42・AMB-ITEMS-21・D44・22. の段階2の終わりの確かめ）。ウィークリーの各日・各段の
// 「＋」、デイリーの各区切りの「＋ 予定を足す」の行が、その場でこの1行の入力欄に替わる（画面が出す・閉じる）。
// - 件名だけを打って Enter か［足す］（入力欄の右の端の✓）で足す。開始日と区分は押した場所（date・kind）、締め切り日・時刻は無し、
//   origin: 'calendar'・listed: false、order は今（足した予定はその日・その段の時刻の無い1日の予定のいちばん後に出る。7.5）。
//   細かい項目は後で詳細で
// - Enter・［足す］で足した後は開いたまま（空に戻り、フォーカスも入力欄に残る）。足した予定は入力欄のすぐ上に出るので目立たせない
// - 入力欄の外を押した時と、押さずにフォーカスが外れた時（iPhone のキーボードの上の✓（完了）・キーボードを閉じた）は、字があれば
//   足してから閉じ、「『件名』を足しました［元に戻す］」を出す（［元に戻す］はゴミ箱へ移して書きかけに戻す）。どちらの足し方も、
//   元に戻す・やり直すの並びに積む（ツールバーの元に戻すでも、ゴミ箱へ移して書きかけに戻す。やり直すとゴミ箱から戻し、戻した字が
//   書きかけのままなら消す。7.13）。作者が iPhone で、
//   キーボードの上の✓を押しても何も起きず（✓は入力欄からフォーカスを外すだけで、前の作りはそれを窓の切り替えと同じに扱い何も
//   しなかった）、外を押すと閉じて字が消えたように見えた（書きかけには控えていたが、次に開くまで見えない）ことへの直し
//   （22. の段階2の終わりの確かめ）。空の時は、どちらも足さずに閉じる。日本語の変換を決める前に外れた時も、見えている字で足す
//   （変換中かでは分けない。iPhone で変換を決めずに✓を押した時に、また何も起きないことが無いように）
// - 変換中（IME で字を組み立てている間。日本語の変換など）に［足す］を押した時は、押した時（pointerdown）に入力欄から一度フォーカスを
//   外して変換を決めてもらい（外れるとブラウザ・キーボードが変換中の字を決める）、［足す］で離した時（pointerup）に入力欄へ
//   フォーカスを戻し、変換の終わり（compositionend。来なければ COMMIT_WAIT_MS）の後に、決まった字を1回だけ足して空に戻す（開発。
//   22. の段階2の終わりの確かめ）。作者が iPhone で、変換を決める前に［足す］を押すと、足した後もキーボードの変換候補が残り続けた:
//   前の作りは［足す］でフォーカスを入力欄に残した（mousedown を止めた）ので、押しても変換が終わらず、変換中のまま入力欄を空にして
//   いた。iPhone のキーボード（変換中の字と候補）は、ページが字を書き換えても知らされず、入力欄の中身と食い違ったまま残る。
//   外すのは pointerdown（指の時は離すより前の別の出来事。同じ出来事の中で外してすぐ戻すと、iPhone は外れたことをキーボードへ
//   伝えない）。戻すのは離した出来事の中（iPhone はそうでないとキーボードが出ない。続く click の中でもう一度戻す）。
//   離した時に決めるのは、外したのでキーボードが閉じ始め、画面が縦に動いて、click が指の下に来た別の物へ行くことがあるため
//   （その click・mousedown は捨てる。指は押した［足す］に捕まえられているので、離した出来事は［足す］に来る）。マウスを［足す］の外で
//   離した時と、指を横へなぞって［足す］の横の幅の外で離した時は、足さずに入力欄へ戻す。押した指でスクロールした
//   （pointercancel）時は、キーボードを閉じた時と同じ。押した出来事の無い click（読み上げの操作など）は、その中で外して戻す
//   （iPhone ではキーボードへ伝わらないことがある。できるだけの扱い）
// - 足さずに閉じるのは Esc と、キーボード（Tab）でフォーカスを外の物へ移した時（書きかけは残り、次に開くと出る。［足す］へは Tab で
//   移れ、その次の Tab で外へ出ると閉じる）と、外を押してそのままカードをドラッグした時（WeekDnd が quickAddDragStarted で伝える。
//   離した後に、ドラッグのお知らせと重ねて足さない。ドラッグを Esc でやめた時も足さない）。窓・アプリの切り替えで外れただけの時と、
//   ドラッグを始めて画面がフォーカスを外した時（押している間なので、押した方で決める）は、足さず閉じない
// - 外を押した指でなぞってスクロール・拡大した時（ブラウザが指を受け取った pointercancel）は、外を押したとは扱わない。フォーカスが
//   入力欄に残っていれば（指でなぞってもフォーカスは動かない）、足さず閉じない（キーボードを出したまま週を見て、続けて打てる）
// - 日本語の変換中の Enter（isComposing・Safari の keyCode 229）と、空白だけの件名では足さない（D42）
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
// - iPhone の端からのフリックでモードが替わる時（quickAddModeChanging。CalendarView）は、モードのボタンを押した時（外を押した時）と
//   同じく、字があれば足してから閉じ、「『件名』を足しました［元に戻す］」を出す（press。身振りの指は、離す出来事が来ないので待たない）
// - ツールバーの元に戻す・やり直す（7.13）を押しても、開いている入力欄は閉じない（外を押したとは扱わない。フォーカスも入力欄に
//   残る。押した時に字を足してから戻すと、戻るのが今足した物になるため）。KEEP_QUICK_ADD の印の付いた物の上で押した時
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { shortDateLabel } from '../../../../domain/dates'
import { toastText, undoText } from '../../../../domain/itemText'
import { ITEM_KIND_LABELS } from '../../../../domain/trash'
import type { ID, ItemKind } from '../../../../domain/types'
import { actions } from '../../../../store/actions'
import { getData } from '../../../../store/appStore'
import { quickDraftKey, readLocal, writeLocal } from '../../../../store/localDrafts'
import { overCalendarGone } from '../../../../history/swipePicture'
import { attempt } from '../../../../store/uiStore'
import { itemChange, notifyUndoable, recordStep } from '../../../../store/undoStore'
import { CheckIcon } from '../../../../ui/icons'
import { scrollBehavior } from '../../../../ui/motion'
import { SWIPE_SLOP_PX } from '../swipe'
import { testIds } from '../testIds'
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
 * 変換を決める前に［足す］を押して入力欄からフォーカスを外してから、変換の終わり（compositionend）を待つ長さ（ms）。来なければ、
 * これで見えている字を決まった字として足す（iPhone は外れた後に変換の終わりを送らないことがある。外れた時にキーボードは変換を
 * 終えている）。軽く押して離すまでより短い（たいていは押し終える前に待ち終わる）
 */
export const COMMIT_WAIT_MS = 150

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

/** 開いているすばやく足すの、モードが替わる時に閉じる物 */
const modeListeners = new Set<() => void>()

/**
 * iPhone の端からのフリックでモードが替わる（CalendarView の ring。docs/SPEC.md の 3.1・12.1）: 開いているすばやく足すを、モードの
 * ボタンを押した時（外を押した時）と同じく閉じる（字があれば足して［元に戻す］付きで知らせる）。身振りが取った指は離す出来事が
 * 来ないので、押し終わりを待たない
 */
export function quickAddModeChanging(): void {
  for (const fn of [...modeListeners]) fn()
}

/**
 * 開いているすばやく足すの、書きかけを入力欄に戻す・消す物（書きかけの控えの名前ごと。［元に戻す］で、空で開いている欄に字を出す。
 * やり直すで、戻した字のままの欄を空にする）
 */
const openFields = new Map<string, { fill: (text: string) => void; clear: (text: string) => void }>()

/**
 * この印（data-keep-quick-add）の付いた物の上で押しても、開いているすばやく足すを閉じない（外を押したとは扱わない）。元に戻す・
 * やり直すのボタン（7.13）。押してもフォーカスを動かさないのは、その物の側（mousedown を止める）
 */
export const KEEP_QUICK_ADD = 'data-keep-quick-add'

/** 変換を決める Enter・変換をやめる Esc か（React の出来事は変換中かを持たないので元の出来事を見る。Safari は keyCode 229） */
function composing(e: KeyboardEvent): boolean {
  return e.nativeEvent.isComposing || e.keyCode === 229
}

/**
 * 押してもフォーカスを入力欄に残す（［足す］。iPhone のキーボードを閉じない・入力欄の blur を起こさない。変換中は、この前の
 * pointerdown で入力欄から外している）。フォーカスを移すのは mousedown（指の時も、離した後に来る）なので、そこだけ止める
 * （pointerdown を止めると、指の時は mousedown が来なくなり、止められない）
 */
function keepFocus(e: ReactMouseEvent): void {
  e.preventDefault()
}

/**
 * 足した予定を元に戻す・やり直すの並びに積む（7.13）。戻す（お知らせの［元に戻す］・ツールバーの元に戻す）とゴミ箱へ移し（30日は
 * 戻せる。18.5 の Claude が足した物を戻す時と同じ）、打った字を書きかけに戻す（その日・その区分に新しい書きかけが無い時だけ。次に
 * 開くと出る。同じ日・同じ区分の入力欄が空で開いていれば、そこにも出す）。やり直すとゴミ箱から戻し、戻した字が書きかけのままなら
 * 消す（入力欄に出したままなら空にする。同じ予定を二度足さないように）
 */
function recordAdd(id: ID, key: string, text: string) {
  return recordStep(undoText.added(text), [itemChange(id, null, getData().items[id])], {
    afterUndo: () => {
      if (readLocal(key)) return
      writeLocal(key, text)
      openFields.get(key)?.fill(text)
    },
    afterRedo: () => {
      if (readLocal(key) !== text) return
      writeLocal(key, null)
      openFields.get(key)?.clear(text)
    },
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
  /** 変換中（compositionstart から compositionend まで。日本語に限らず IME の。入力欄にフォーカスが来た時は、変換していない所から） */
  const composingText = useRef(false)
  /**
   * 変換中に［足す］を押して入力欄から外した分（足すか決まるまで）。text は押した時に見えていた字、timer は変換の終わり
   * （compositionend か COMMIT_WAIT_MS）を待っている間だけある。add は［足す］で押し終えた（足すと決めた）。待ち終えて、押し終えて
   * いれば足す
   */
  const commit = useRef<{ text: string; timer?: number; add: boolean } | null>(null)
  /**
   * 変換中に［足す］を押した分（pointerdown から、離した後の click か CLICK_WAIT_MS まで。id は押した指・マウス、up は離した）。
   * この間の mousedown・click は、どこに来ても押した物の操作にしない
   */
  const addPress = useRef<{ id: number; up: boolean } | null>(null)
  const addButton = useRef<HTMLButtonElement>(null)

  /** 字があれば足して、［元に戻す］付きで知らせる（閉じる時）。足せなかった（決まりに合わない件名）時は false */
  const addOnClose = (): boolean => {
    const { date, kind, key, text } = latest.current
    if (!text.trim()) return true
    const id = attempt(() => actions.addItem({ origin: 'calendar', title: text, kind, start: date }))
    if (!id) return false
    writeLocal(key, null)
    latest.current = { ...latest.current, text: '' }
    setDraft({ key, text: '' })
    notifyUndoable(toastText.added(text.trim()), recordAdd(id, key, text))
    return true
  }

  /**
   * 足して、開いたまま次を打てるようにする（入力欄の今の字で。変換中に［足す］を押した時は、変換を決めた後に、押した時に見えていた字
   * pressed を添えて呼ぶ）。足したら true（空・決まりに合わない件名の時は false）
   */
  const addNow = (pressed?: string): boolean => {
    // 変換を決めた字は入力欄の中が確か（変換の終わりの後に入力の出来事が来るブラウザもある）。外した時に変換中の字を捨てるブラウザ
    // では空になるので、押した時に見えていた字を足す（見えていた字で足す。打った字を黙って消さない）
    let shown = input.current?.value ?? latest.current.text
    if (!shown.trim() && pressed?.trim()) shown = pressed
    if (shown !== latest.current.text) {
      latest.current = { ...latest.current, text: shown }
      setDraft({ key: latest.current.key, text: shown })
      writeLocal(latest.current.key, shown.trim() ? shown : null)
    }
    const { date, kind, key, text } = latest.current
    if (!text.trim()) return false
    const id = attempt(() => actions.addItem({ origin: 'calendar', title: text, kind, start: date }))
    if (!id) return false
    setDraft({ key, text: '' })
    latest.current = { ...latest.current, text: '' }
    setAdded((n) => n + 1)
    writeLocal(key, null)
    recordAdd(id, key, text)
    return true
  }

  /** 変換中に押した［足す］の分を足す（変換を待ち終え、［足す］で押し終えた後。1回だけ） */
  const addCommitted = () => {
    const c = commit.current
    if (!c) return
    window.clearTimeout(c.timer)
    commit.current = null
    composingText.current = false
    addNow(c.text)
  }

  /** 変換中に押した［足す］の分を、足さずにやめる */
  const dropCommit = () => {
    const c = commit.current
    if (!c) return
    window.clearTimeout(c.timer)
    commit.current = null
  }

  /** 閉じる時（Esc・閉じる・画面が外した）: ［足す］で押し終えた分（変換の終わりを待っている間）は足す。押し終えていない分はやめる */
  const flushCommit = () => {
    if (commit.current?.add) addCommitted()
    else dropCommit()
  }

  /** 変換の終わりを待ち終えた（compositionend・COMMIT_WAIT_MS）。変換は終わったとみなし、［足す］で押し終えていれば足す */
  const commitEnded = () => {
    const c = commit.current
    if (!c || c.timer === undefined) return
    window.clearTimeout(c.timer)
    c.timer = undefined
    composingText.current = false
    if (c.add) addCommitted()
  }

  /** 変換中の入力欄からフォーカスを外して、変換を決めてもらう（決まったら commitEnded。Chromium は外した時にすぐ決める） */
  const startCommit = (el: HTMLInputElement) => {
    commit.current = { text: el.value, add: false, timer: window.setTimeout(commitEnded, COMMIT_WAIT_MS) }
    el.blur()
  }

  /**
   * 変換中に押した［足す］を、［足す］で押し終えた: 入力欄へフォーカスを戻し（押し終えた出来事の中で。iPhone はそうでないと
   * キーボードが出ない）、変換を待ち終えていれば足す（まだなら、待ち終えた時に足す）
   */
  const finishAddPress = () => {
    input.current?.focus({ preventScroll: true })
    const c = commit.current
    if (!c) return
    c.add = true
    if (c.timer === undefined) addCommitted()
  }

  /** 変換中に押した［足す］の外で離した（マウスでずらした・指で横へなぞった）: 足さずに入力欄へ戻す（変換は決まったまま） */
  const cancelAddPress = () => {
    dropCommit()
    composingText.current = false
    input.current?.focus({ preventScroll: true })
  }

  /** 画面へ閉じたと伝える（外を押した・キーボードを閉じた時は、字があれば足してから。外を押してドラッグした時は足さない） */
  const finish = (pressed: QuickAddCloseReason) => {
    pending.current = null
    // ［足す］で押し終えた後、変換の終わりを待っている間に閉じる: 押した分を先に足す
    flushCommit()
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
    // 先に押し終えた［足す］の分（変換の終わりを待っている間）は足す
    flushCommit()
    latest.current.onClose('escape')
  }

  // 開いたらすぐ打てるように（押した出来事の中で描くので、iPhone でもキーボードが開く）。見える所まで出す。打つ欄は全部見えている
  // ことが大事なので、ここはページも動かしてよい（scrollIntoView。S・M の週・日の下の端は画面の下に少し出ている。ドラッグの後・
  // 目立たせる時はページを動かさない src/ui/scrollWithin.ts を使う）
  useLayoutEffect(() => {
    input.current?.focus({ preventScroll: true })
    input.current?.scrollIntoView({ block: 'nearest', behavior: scrollBehavior() })
  }, [])

  // 閉じた（外した）時を知らせる: iPhone で、閉じた後すぐに小さな画面を開く時は、入力欄の消えた画面が描かれてから開き、アプリの履歴は
  // 消えた画面が描かれた後に、端からのフリックの間に見える絵を写し直す（Esc・キーボードの完了で閉じた時も。3.1）
  useLayoutEffect(() => overCalendarGone, [])

  // 押した・離した・窓を離れたを、window の捕まえる段階で見る（押した物の pointerdown・mousedown（フォーカスの移り）・click より
  // 先に分かる）。入力欄の外を押したら、押し終わってから足して閉じる（押した所の操作はそのまま。ほかの日の「＋」なら、そこの
  // 入力欄が開く）
  useEffect(() => {
    const endPress = () => {
      const p = press.current
      if (!p) return
      window.clearTimeout(p.timer)
      press.current = null
      const a = addPress.current
      addPress.current = null
      if (pending.current) finish(pending.current)
      else if (a && !a.up) {
        // 変換中に押した［足す］を、離さずに終えた（ブラウザが指を受け取った: 押した指でスクロールした）: 外れたままなので
        // （フォーカスを戻せる出来事が無い）、キーボードを閉じた時と同じに決める
        dropCommit()
        window.clearTimeout(settleTimer.current)
        settleTimer.current = window.setTimeout(settle, BLUR_SETTLE_MS)
      }
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
      // 前に変換中に押した［足す］の click は来なかった（待つのをやめる。次に押した物の click は捨てない）
      if (addPress.current?.up) addPress.current = null
      press.current = {}
      // 元に戻す・やり直すのボタン（KEEP_QUICK_ADD）の上では閉じない
      const keep = e.target instanceof Element && e.target.closest(`[${KEEP_QUICK_ADD}]`) !== null
      if (box.current && e.target instanceof Node && !box.current.contains(e.target) && !keep) close('press')
    }
    const onUp = (e: PointerEvent) => {
      const a = addPress.current
      if (a && !a.up && e.pointerId === a.id) {
        // 変換中に押した［足す］を離した。指は押した［足す］に捕まえられているので、離した出来事は［足す］に来る（外したので
        // キーボードが閉じ始め、画面が縦に動いても）。横へなぞって［足す］の横の幅の外で離した時と、マウスを［足す］の外で離した
        // 時は、足さない
        a.up = true
        const btn = addButton.current
        const r = btn?.getBoundingClientRect()
        const onButton =
          e.pointerType === 'mouse'
            ? e.target instanceof Node && !!btn?.contains(e.target)
            : !r || (e.clientX >= r.left - SWIPE_SLOP_PX && e.clientX <= r.right + SWIPE_SLOP_PX)
        if (onButton) finishAddPress()
        else cancelAddPress()
      }
      const p = press.current
      if (!p) return
      window.clearTimeout(p.timer)
      p.timer = window.setTimeout(endPress, CLICK_WAIT_MS)
    }
    // 変換中に押した［足す］の分の mousedown・click（指の時は離した後に来る。画面が動いて、指の下に別の物が来ていても）: フォーカスを
    // 動かさず、押した物の操作にしない（［足す］は離した時に決めている）
    const onMouseDown = (e: MouseEvent) => {
      if (!addPress.current) return
      e.preventDefault()
      if (!(e.target instanceof Node && addButton.current?.contains(e.target))) e.stopPropagation()
    }
    const onClick = (e: MouseEvent) => {
      const a = addPress.current
      if (a) {
        e.preventDefault()
        e.stopPropagation()
        // 離した出来事が来なかった: ここで押し終えたとする
        if (!a.up) {
          a.up = true
          finishAddPress()
        } else if (!closing.current && document.activeElement === input.current) {
          // 離した時に戻したフォーカスを、もう一度入力欄へ（iPhone で、離した時にキーボードが出なかった時のため。フォーカスの
          // ある所へ戻すと、キーボードを出し直す）
          input.current?.focus({ preventScroll: true })
        }
      }
      endPress()
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
    window.addEventListener('mousedown', onMouseDown, true)
    window.addEventListener('click', onClick, true)
    window.addEventListener('blur', onWindowBlur)
    window.addEventListener('focus', onWindowFocus)
    window.addEventListener('pagehide', leave)
    document.addEventListener('visibilitychange', onVisibility)
    const onDrag = () => {
      if (press.current) dragged.current = true
    }
    dragListeners.add(onDrag)
    // モードが替わる（端からのフリック）: 押し終わりを待たずに、外を押した時と同じく閉じる（Esc で閉じた後なら何もしない）
    const onModeChange = () => {
      if (press.current) window.clearTimeout(press.current.timer)
      press.current = null
      addPress.current = null
      if (closing.current && !pending.current) return
      closing.current = true
      window.clearTimeout(settleTimer.current)
      finish(pending.current ?? 'press')
    }
    modeListeners.add(onModeChange)
    return () => {
      dragListeners.delete(onDrag)
      modeListeners.delete(onModeChange)
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('pointerup', onUp, true)
      window.removeEventListener('pointercancel', cancelPress, true)
      window.removeEventListener('mousedown', onMouseDown, true)
      window.removeEventListener('click', onClick, true)
      window.removeEventListener('blur', onWindowBlur)
      window.removeEventListener('focus', onWindowFocus)
      window.removeEventListener('pagehide', leave)
      document.removeEventListener('visibilitychange', onVisibility)
      if (press.current) window.clearTimeout(press.current.timer)
      press.current = null
      window.clearTimeout(settleTimer.current)
      addPress.current = null
      // ［足す］で押し終えた後、変換の終わりを待っている間に画面が外した: 押した分は足す
      flushCommit()
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
  // やり直すで、戻した字のままの入力欄を空にする（打ち直していれば残す）
  useEffect(() => {
    const field = {
      fill: (restored: string) => {
        if (latest.current.text.trim() || latest.current.key !== key) return
        latest.current = { ...latest.current, text: restored }
        setDraft({ key, text: restored })
      },
      clear: (restored: string) => {
        if (latest.current.text !== restored || latest.current.key !== key) return
        latest.current = { ...latest.current, text: '' }
        setDraft({ key, text: '' })
      },
    }
    openFields.set(key, field)
    return () => {
      if (openFields.get(key) === field) openFields.delete(key)
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

  /**
   * Enter・［足す］の click（Tab で移った［足す］の Enter・Space も）: 足して、開いたまま次を打てるようにする。変換中に押した［足す］
   * （押した出来事の有る分）は、ここへは来ない（離した時に決める）
   */
  const add = () => {
    const el = input.current
    // 変換中に click だけが来た（読み上げ・スイッチの操作など、押した出来事の無い操作）: ここで外して変換を決めてもらう。同じ出来事の
    // 中で戻すので、iPhone ではキーボードへ伝わらないことがある（できるだけの扱い）
    if (!commit.current && composingText.current && el && latest.current.text.trim()) startCommit(el)
    // 変換の終わりを待っている（変換中の［足す］で押し終えた後の Enter は、その分と重ねない）
    if (commit.current) {
      finishAddPress()
      return
    }
    // 足した時だけ入力欄へ（空・決まりに合わない件名の時は、押した所（Tab で移った［足す］）にフォーカスを残す。何もしない）
    if (addNow()) el?.focus({ preventScroll: true })
  }

  /**
   * ［足す］を押した（pointerdown）: 変換中なら、入力欄から一度フォーカスを外して変換を決めてもらう（変換中のまま入力欄を空にすると、
   * iPhone のキーボードに変換候補が残り続ける。22. の段階2の終わりの確かめ）。足すのは離した時（window の pointerup）。画面のなぞりの
   * 見張り（カレンダーの中の pointerdown）はこの前に入力欄のフォーカスを見ている（React はいちばん外で聞く）ので、外してもなぞったとは
   * みなされない
   */
  const onAddPointerDown = (e: ReactPointerEvent) => {
    const el = input.current
    if (e.button !== 0 || !composingText.current || commit.current || !el || !latest.current.text.trim()) return
    addPress.current = { id: e.pointerId, up: false }
    startCommit(el)
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
    // 変換中の［足す］で変換を決めるために外した（押し終えた時に戻す）。押し終えて戻した後に外れた時は、ふつうに決める
    if (closing.current || (commit.current && !commit.current.add)) return
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
          onCompositionStart={() => {
            composingText.current = true
          }}
          onCompositionUpdate={() => {
            composingText.current = true
          }}
          onCompositionEnd={() => {
            composingText.current = false
            const c = commit.current
            if (!c || c.timer === undefined) return
            if (!c.add) {
              commitEnded()
              return
            }
            // ［足す］で押し終えた後に変換が終わった: ブラウザが決まった字を入力欄へ書いてから足す（WebKit は compositionend の後に
            // 書く。ここで空にすると、後から書かれた字が空にした欄に残る）
            window.clearTimeout(c.timer)
            c.timer = window.setTimeout(commitEnded, 0)
          }}
          onFocus={() => {
            // 入力欄へ戻った（押し終わりを待っている間は、そのまま閉じる）。フォーカスが来た所は変換していない（外れた後に変換の
            // 終わりが来ないブラウザで、変換中の印を残さない）
            away.current = false
            composingText.current = false
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
          ref={addButton}
          type="button"
          className="icon-btn cp-quick-add"
          aria-label="足す"
          aria-disabled={blank || undefined}
          onPointerDown={onAddPointerDown}
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
