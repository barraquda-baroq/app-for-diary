// 3つのリストの入力欄の決まり（docs/SPEC.md の 3.6・12.1・13.2・14.2・15.1・6.13）: Enter で足すか改行か、端末に控える書きかけの
// キーと形、［足す］（✓）の押し方。画面（useListInput・ListInput）に頼らない純粋な決まり（*Model.ts。src/features/calendar/purity.test.ts）。
// ［足す］の押し方（addPressStep）は、すばやく足す（src/features/calendar/common/parts/QuickAdd.tsx の commit・addPress の ref）の
// ✓ と変換の決まりを写した物（QuickAdd は替えない。G4。2つを1つにまとめるのは段階5）。すばやく足すと違って、リストの入力欄は
// いつも出ている欄なので、外を押した時・キーボードを閉じた時（iPhone のキーボードの上の✓（完了））・押した指でスクロールした時は
// 足さず、打った字は欄に残す（FRAME-082・TASK-037・ROUTINE-089）。この決まりには「離れたら足す」の道が無い
import type { TaskEntry } from '../../../domain/taskList'

/** 3つのリスト（src/store/uiStore.ts の ListKey と同じ3つ。決まりのファイルなので store を読まずに同じ形をここに書く） */
export type ListName = 'routine' | 'task' | 'favorite'

/**
 * 入力欄の書きかけ（D23）。Task List は件名の字と［開始日］［締め切り日］［依頼者］、Routine List・Favorite List は字だけを持つ
 * （start・due は null、requester は '' のまま。Routine List の種類は端末の設定 routineAddCycle に覚え、［指定］は足すたびに戻す）。
 * 形は Task List の入力（src/domain/taskList.ts の TaskEntry）と同じ（足す時にそのまま taskInputOf へ渡せる）
 */
export type ListDraft = TaskEntry

/** 空の書きかけ */
export const EMPTY_DRAFT: ListDraft = { text: '', start: null, due: null, requester: '' }

/** 端末に控える書きかけのキー（diary-studio:draft:{routine,task,favorite}。6.13・FRAME-095） */
export const draftKey = (list: ListName) => `diary-studio:draft:${list}` as const

/** 'YYYY-MM-DD' の形の字か（控えた書きかけの［開始日］［締め切り日］。壊れた値は持ち込まない） */
const isDateText = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

/**
 * 控えた書きかけを読む（Task List は JSON の {text, start, due, requester}、ほかは字のまま）。壊れた値・知らない形は空の書きかけ
 * （Task List の JSON の中の型の違う値は、その欄だけ空にする）
 */
export function parseDraft(list: ListName, raw: string | null): ListDraft {
  if (raw === null || raw === '') return EMPTY_DRAFT
  if (list !== 'task') return { ...EMPTY_DRAFT, text: raw }
  let v: unknown
  try {
    v = JSON.parse(raw)
  } catch {
    return EMPTY_DRAFT
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return EMPTY_DRAFT
  const o = v as Record<string, unknown>
  return {
    text: typeof o.text === 'string' ? o.text : '',
    start: isDateText(o.start) ? o.start : null,
    due: isDateText(o.due) ? o.due : null,
    requester: typeof o.requester === 'string' ? o.requester : '',
  }
}

/** 書きかけが空か（字が空白だけで、［開始日］［締め切り日］［依頼者］も無い） */
export function isBlankDraft(d: ListDraft): boolean {
  return d.text.trim() === '' && d.start === null && d.due === null && d.requester.trim() === ''
}

/** 控える値（null はキーを消す: 空の書きかけ。空白だけの字は控えない） */
export function serializeDraft(list: ListName, d: ListDraft): string | null {
  if (isBlankDraft(d)) return null
  if (list !== 'task') return d.text
  return JSON.stringify({ text: d.text, start: d.start, due: d.due, requester: d.requester })
}

/**
 * Enter を押した時（変換の途中 isComposing・keyCode 229 は none）。Task List は PC の Shift+Enter が改行・ほかは足す（指の端末も。
 * 13.2）。Favorite List は指の端末は改行・PC は Shift+Enter が改行で Enter が足す（15.1。指の端末は［足す］で足す）。Routine List は
 * 足す（1行の欄）
 */
export function enterAction(
  list: ListName,
  e: { shift: boolean; composing: boolean; coarse: boolean },
): 'add' | 'newline' | 'none' {
  if (e.composing) return 'none'
  if (list === 'routine') return 'add'
  if (list === 'favorite' && e.coarse) return 'newline'
  return e.shift && !e.coarse ? 'newline' : 'add'
}

// ---------- ［足す］（✓）の押し方（12.1。すばやく足すの決まりを写した物） ----------

/** 変換を決める前に［足す］を押して入力欄から外してから、変換の終わり（compositionend）を待つ長さ（ms。すばやく足すと同じ） */
export const COMMIT_WAIT_MS = 150

/** ［足す］の押し方の今の状態 */
export interface AddPressState {
  /** 変換中（compositionstart から compositionend まで。入力欄にフォーカスが来た所は変換していない所） */
  composing: boolean
  /**
   * 変換中に［足す］を押して入力欄から外した分（足すか決まるまで）。waiting は変換の終わり（compositionend か COMMIT_WAIT_MS）を
   * 待っている間、add は［足す］で押し終えた（足すと決めた）。待ち終えて、押し終えていれば足す
   */
  commit: { waiting: boolean; add: boolean } | null
  /**
   * 変換中に［足す］を押した指・マウス（pointerdown から、離した後の click まで。up は離した）。この間の mousedown・click は、どこに
   * 来ても押した物の操作にしない
   */
  press: { pointer: number; up: boolean } | null
}

export const INITIAL_ADD_PRESS: AddPressState = { composing: false, commit: null, press: null }

/**
 * 入力欄・［足す］・window（捕まえる段階）で起きた出来事:
 * - down: ［足す］を押した（pointerdown。左のボタン）。composing は画面が渡す変換中か（今の画面 useListInput.ts は、この決まりが数えた
 *   composing をそのまま渡す。すばやく足すと同じく変換中の印は1つ）、hasText は空白でない字があるか
 * - up: 押した指・マウスを離した（window の pointerup）。inside は［足す］の上で離したか（指は横の幅だけを見る。12.1 の横のゆとり）
 * - cancel: 押した指をブラウザが受け取った（pointercancel。押した指でスクロールした）
 * - windowdown: どこかを押した（window の pointerdown。［足す］の down より先に来る）。前に変換中に押した［足す］の click が来な
 *   かった分は、待つのをやめる（次に押した物の click は捨てない）
 * - mousedown: 押した後の mousedown（window。指の時は離した後に来る。画面が動いて、指の下に別の物が来ていても）
 * - click: ［足す］の click と Enter（押した出来事の無い click は、読み上げ・スイッチの操作など）。fromPress は変換中に押した分の
 *   click（window で受ける）か、hasText は空白でない字があるか
 * - compositionstart・compositionend・focus（入力欄へフォーカスが来た）・timeout（COMMIT_WAIT_MS か、変換の終わりの後の 0ms）
 * - reset: 足さずに全部やめる（打ちかけを捨てた時。■34）・flush: 押し終えた分だけは足してやめる（欄が外れる時）
 */
export type AddPressEvent =
  | { type: 'down'; pointer: number; composing: boolean; hasText: boolean }
  | { type: 'up'; pointer: number; inside: boolean }
  | { type: 'cancel'; pointer: number }
  | { type: 'windowdown' }
  | { type: 'mousedown' }
  | { type: 'click'; fromPress: boolean; hasText: boolean }
  | { type: 'compositionstart' }
  | { type: 'compositionend' }
  | { type: 'focus' }
  | { type: 'timeout' }
  | { type: 'reset' }
  | { type: 'flush' }

/**
 * 画面がすること（並べた順に）:
 * - preventMouseDown: その mousedown を止める（フォーカスを動かさない。［足す］の外の物なら押した物の操作にもしない）
 * - blur: 入力欄からフォーカスを外す（ブラウザ・キーボードが変換中の字を決める。押した出来事と同じ出来事の中で外す）
 * - refocus: 入力欄へフォーカスを戻す（iPhone はその出来事の中でないとキーボードが出ない）
 * - startWait: COMMIT_WAIT_MS の後に timeout を送る（前の待ちはやめる）
 * - waitTick: 0ms の後に timeout を送る（変換の終わりの後、ブラウザが決まった字を入力欄へ書いてから足す。WebKit は compositionend の
 *   後に書く。前の待ちはやめる）
 * - stopWait: 待ちをやめる
 * - add: 入力欄の今の字（空なら押した時に見えていた字）で足す
 * - swallowClick: その click を止める（押した物の操作にしない）
 */
export type AddPressEffect =
  | 'preventMouseDown'
  | 'blur'
  | 'refocus'
  | 'startWait'
  | 'waitTick'
  | 'stopWait'
  | 'add'
  | 'swallowClick'

export interface AddPressStep {
  state: AddPressState
  effects: AddPressEffect[]
}

/** 変換中に押した［足す］を、押し終えた（足すと決めた）: 入力欄へ戻し、変換を待ち終えていれば足す */
function finishPress(s: AddPressState): AddPressStep {
  if (!s.commit) return { state: s, effects: ['refocus'] }
  if (!s.commit.waiting) return { state: { ...s, commit: null, composing: false }, effects: ['refocus', 'add'] }
  return { state: { ...s, commit: { ...s.commit, add: true } }, effects: ['refocus'] }
}

/** 変換中に押した［足す］の外で離した: 足さずに入力欄へ戻す（変換は決まったまま） */
function cancelPress(s: AddPressState): AddPressStep {
  return { state: { ...s, commit: null, composing: false }, effects: ['stopWait', 'refocus'] }
}

/** 変換中の入力欄から外して、変換を決めてもらう（待ち始める） */
function startCommit(s: AddPressState): AddPressState {
  return { ...s, commit: { waiting: true, add: false } }
}

/** ［足す］の押し方の1歩（純粋。今の状態と出来事から、次の状態と画面がすること） */
export function addPressStep(s: AddPressState, e: AddPressEvent): AddPressStep {
  switch (e.type) {
    case 'down': {
      // 変換していない時は外さない（mousedown を止めるだけ。iPhone のキーボードを閉じない）。待っている間の2回目も外さない。
      // 変換中かは、この決まりが数えた物（compositionstart〜compositionend・focus）と、画面が渡した composing の両方が変換中の時
      if (!s.composing || !e.composing || !e.hasText || s.commit) return { state: s, effects: [] }
      return { state: { ...startCommit(s), press: { pointer: e.pointer, up: false } }, effects: ['blur', 'startWait'] }
    }
    case 'up': {
      const p = s.press
      if (!p || p.up || p.pointer !== e.pointer) return { state: s, effects: [] }
      const next = { ...s, press: { ...p, up: true } }
      return e.inside ? finishPress(next) : cancelPress(next)
    }
    case 'cancel': {
      // 押した指でスクロールした: 外れたまま（フォーカスを戻せる出来事が無い）。足さず、打った字は残す（キーボードを閉じた時と同じ）
      const p = s.press
      if (!p || p.up || p.pointer !== e.pointer) return { state: s, effects: [] }
      return { state: { ...s, press: null, commit: null }, effects: ['stopWait'] }
    }
    case 'windowdown':
      return { state: s.press?.up ? { ...s, press: null } : s, effects: [] }
    case 'mousedown':
      return { state: s, effects: s.press ? ['preventMouseDown'] : [] }
    case 'click': {
      if (e.fromPress && s.press) {
        // 離した出来事が来なかった: ここで押し終えたとする。来ていれば、離した時に戻したフォーカスをもう一度（iPhone で離した時に
        // キーボードが出なかった時のため）
        const ended = { ...s, press: null }
        const r = s.press.up ? { state: ended, effects: ['refocus'] as AddPressEffect[] } : finishPress(ended)
        return { state: r.state, effects: ['swallowClick', ...r.effects] }
      }
      // 変換中に click だけが来た（押した出来事の無い操作）: ここで外して変換を決めてもらう（同じ出来事の中で戻すので、iPhone では
      // キーボードへ伝わらないことがある。できるだけの扱い）
      if (!s.commit && s.composing && e.hasText) {
        const r = finishPress(startCommit(s))
        return { state: r.state, effects: ['blur', 'startWait', ...r.effects] }
      }
      // 変換の終わりを待っている（変換中の［足す］で押し終えた後の Enter は、その分と重ねない）
      if (s.commit) return finishPress(s)
      return { state: s, effects: e.hasText ? ['add'] : [] }
    }
    case 'compositionstart':
      return { state: { ...s, composing: true }, effects: [] }
    case 'compositionend': {
      const c = s.commit
      if (!c || !c.waiting) return { state: { ...s, composing: false }, effects: [] }
      // まだ押し終えていない: 変換は終わったとみなす（押し終えた時に足す）
      if (!c.add) return { state: { ...s, composing: false, commit: { ...c, waiting: false } }, effects: ['stopWait'] }
      // 押し終えた後に変換が終わった: ブラウザが決まった字を入力欄へ書いてから足す
      return { state: { ...s, composing: false }, effects: ['waitTick'] }
    }
    case 'focus':
      // フォーカスが来た所は変換していない（外れた後に変換の終わりが来ないブラウザで、変換中の印を残さない）
      return { state: { ...s, composing: false }, effects: [] }
    case 'timeout': {
      const c = s.commit
      if (!c || !c.waiting) return { state: s, effects: [] }
      if (c.add) return { state: { ...s, commit: null, composing: false }, effects: ['add'] }
      return { state: { ...s, composing: false, commit: { ...c, waiting: false } }, effects: [] }
    }
    case 'reset':
      return { state: INITIAL_ADD_PRESS, effects: ['stopWait'] }
    case 'flush':
      // 押し終えた分（変換の終わりを待っている間）は、押した時に決めたので足す。押し終えていない分はやめる
      return { state: INITIAL_ADD_PRESS, effects: s.commit?.add ? ['stopWait', 'add'] : ['stopWait'] }
  }
}
