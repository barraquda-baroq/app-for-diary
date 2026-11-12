// 端末ごとの表示の設定（外観・起動アニメーション・最後のモード・畳んだ状態など）とお知らせ（トースト）。
// 表示の設定は localStorage の diary-studio:prefs に保存する（同期しない。使えない環境でも既定値で動く。docs/SPEC.md の 4.2・6.13）。
// NS の src/store/uiStore.ts の仕組み（resolveAppearance・migratePrefs・THEME_COLORS・トースト・attempt・アプリの更新）を写した物
import { create } from 'zustand'
import { DomainError, ROUTINE_CYCLES, type RoutineCycle } from '../domain/types'

/** 外観。ホワイト／ダーク／ディープダーク（区分の地の色も無くし、最小限の色だけ。docs/SPEC.md の 4.2） */
export type Appearance = 'white' | 'dark' | 'deep-dark'
/** 外観の設定。system は端末の設定（ライト／ダーク）に合わせてホワイトかダークになる */
export type AppearanceMode = 'system' | Appearance
/** カレンダーのモード（イヤー・マンスリー・ウィークリー・デイリー） */
export type CalendarMode = 'year' | 'month' | 'week' | 'day'
/** ルーチンの種類（docs/SPEC.md の 14.1。データの型なので src/domain/types.ts に置き、ここから再び公開する） */
export type { RoutineCycle }
export { ROUTINE_CYCLES }

export type RoutineFlags = Record<RoutineCycle, boolean>

/** 3つのリスト */
export type ListKey = 'routine' | 'task' | 'favorite'

/** 畳んだ状態（true が畳んでいる）。docs/SPEC.md の 3.6・6.13 */
export interface Collapsed {
  /**
   * 右の列の3つのリストそのもの。幅 L（PC）の時だけ読み書きする。S・M の縦に積んだリストはここに覚えず、
   * アプリを開くたびに3つとも畳んで始める（useStackedLists。docs/SPEC.md の 3.5・3.6・6.13）
   */
  routine: boolean
  task: boolean
  favorite: boolean
  /** Routine List の種類ごとの区切り */
  routineGroups: RoutineFlags
  /** Routine List の種類ごとの「済み n件」 */
  routineDone: RoutineFlags
  /** Task List の「済み n件」 */
  taskDone: boolean
  /** Favorite List の「済み n件」 */
  favoriteDone: boolean
}

export interface Prefs {
  appearance: AppearanceMode
  /**
   * 起動アニメーションを出す（既定オン）。index.html に埋め込んだ src/launch/launch.js が、アプリより先にこの値を読む
   * （false の時だけ出さない）
   */
  launchAnimation: boolean
  /** 最後に開いていたモード（トップを開くと、このモードの今日を含む期間へ。Q20） */
  lastMode: CalendarMode
  /** 登録の画面の「詳しく」を開いているか */
  detailsOpen: boolean
  /** Routine List の入力欄で最後に選んだ種類 */
  routineAddCycle: RoutineCycle
  collapsed: Collapsed
}

const APPEARANCE_MODES: readonly AppearanceMode[] = ['system', 'white', 'dark', 'deep-dark']
const CALENDAR_MODES: readonly CalendarMode[] = ['year', 'month', 'week', 'day']

const flags = (value: boolean): RoutineFlags =>
  Object.fromEntries(ROUTINE_CYCLES.map((c) => [c, value])) as unknown as RoutineFlags

/** 初めは「端末の設定に合わせる」・起動アニメーションはオン・マンスリー・リストは開く・「済み n件」は畳む（docs/SPEC.md の 6.13） */
export const DEFAULT_PREFS: Prefs = {
  appearance: 'system',
  launchAnimation: true,
  lastMode: 'month',
  detailsOpen: false,
  routineAddCycle: 'daily',
  collapsed: {
    routine: false,
    task: false,
    favorite: false,
    routineGroups: flags(false),
    routineDone: flags(true),
    taskDone: true,
    favoriteDone: true,
  },
}

export const PREFS_KEY = 'diary-studio:prefs'

/** 保存形式の版（保存する時に v として書く。設定の値には含めない） */
export const PREFS_VERSION = 1

const isRecord = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v)
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback)
const oneOf = <T extends string>(v: unknown, list: readonly T[], fallback: T): T => (list.includes(v as T) ? (v as T) : fallback)

function migrateFlags(v: unknown, fallback: RoutineFlags): RoutineFlags {
  const raw = isRecord(v) ? v : {}
  return Object.fromEntries(ROUTINE_CYCLES.map((c) => [c, bool(raw[c], fallback[c])])) as unknown as RoutineFlags
}

/** localStorage に保存していた表示の設定を今の形に直す（知らない値・型の違う値・壊れた値は既定値にする） */
export function migratePrefs(stored: unknown): Prefs {
  if (!isRecord(stored)) return DEFAULT_PREFS
  const d = DEFAULT_PREFS
  const c = isRecord(stored.collapsed) ? stored.collapsed : {}
  return {
    appearance: oneOf(stored.appearance, APPEARANCE_MODES, d.appearance),
    launchAnimation: bool(stored.launchAnimation, d.launchAnimation),
    lastMode: oneOf(stored.lastMode, CALENDAR_MODES, d.lastMode),
    detailsOpen: bool(stored.detailsOpen, d.detailsOpen),
    routineAddCycle: oneOf(stored.routineAddCycle, ROUTINE_CYCLES, d.routineAddCycle),
    collapsed: {
      routine: bool(c.routine, d.collapsed.routine),
      task: bool(c.task, d.collapsed.task),
      favorite: bool(c.favorite, d.collapsed.favorite),
      routineGroups: migrateFlags(c.routineGroups, d.collapsed.routineGroups),
      routineDone: migrateFlags(c.routineDone, d.collapsed.routineDone),
      taskDone: bool(c.taskDone, d.collapsed.taskDone),
      favoriteDone: bool(c.favoriteDone, d.collapsed.favoriteDone),
    },
  }
}

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (!raw) return DEFAULT_PREFS
    return migratePrefs(JSON.parse(raw))
  } catch {
    return DEFAULT_PREFS
  }
}

/** 外観の設定から実際の外観を決める（「端末の設定に合わせる」は端末がダークならダーク、そうでなければホワイト） */
export function resolveAppearance(mode: AppearanceMode, systemDark: boolean): Appearance {
  if (mode === 'system') return systemDark ? 'dark' : 'white'
  return mode
}

/**
 * ブラウザの枠（アドレスバー・ステータスバー）の色。ヘッダーの背景（--surface）に合わせる（docs/SPEC.md の 4.2）。
 * 最初の描画の前に外観を決める src/launch/launch.js（index.html に埋め込む）にも同じ値がある（変える時は両方そろえる）。
 */
export const THEME_COLORS: Record<Appearance, string> = {
  white: '#ffffff',
  dark: '#17181b',
  'deep-dark': '#0e0f11',
}

interface PrefsState extends Prefs {
  setPrefs: (patch: Partial<Prefs>) => void
  /** 畳んだ状態の一部だけを変える */
  setCollapsed: (patch: Partial<Collapsed>) => void
}

function savePrefs(prefs: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ v: PREFS_VERSION, ...prefs }))
  } catch {
    /* 保存できなくても動作は続ける */
  }
}

/** 今の設定（関数を除く） */
function currentPrefs(s: PrefsState): Prefs {
  const { appearance, launchAnimation, lastMode, detailsOpen, routineAddCycle, collapsed } = s
  return { appearance, launchAnimation, lastMode, detailsOpen, routineAddCycle, collapsed }
}

export const usePrefs = create<PrefsState>((set, get) => ({
  ...loadPrefs(),
  setPrefs: (patch) => {
    set(patch)
    savePrefs(currentPrefs(get()))
  },
  setCollapsed: (patch) => {
    set({ collapsed: { ...get().collapsed, ...patch } })
    savePrefs(currentPrefs(get()))
  },
}))

// ---------- S・M の縦に積んだリストの畳んだ状態（docs/SPEC.md の 3.5・3.6・6.13） ----------

interface StackedListsState {
  /** true が畳んでいる。アプリを開くたびに3つとも畳んだ状態で始まる（端末に覚えない。開いている間だけ保つ） */
  collapsed: Record<ListKey, boolean>
  setCollapsed: (key: ListKey, collapsed: boolean) => void
}

export const useStackedLists = create<StackedListsState>((set, get) => ({
  collapsed: { routine: true, task: true, favorite: true },
  setCollapsed: (key, collapsed) => set({ collapsed: { ...get().collapsed, [key]: collapsed } }),
}))

// ---------- お知らせ（トースト。docs/SPEC.md の 3.9） ----------

export interface ToastAction {
  label: string
  run: () => void
}

export interface Toast {
  id: number
  kind: 'info' | 'error'
  message: string
  /** ［元に戻す］などのボタン */
  action?: ToastAction
}

/** 消えるまで: ふつうは4秒、ボタン付き・エラーは6秒 */
export const TOAST_MS = { info: 4000, long: 6000 }
/** 重ねて出す数 */
const TOAST_MAX = 3

interface ToastState {
  toasts: Toast[]
  push: (kind: Toast['kind'], message: string, action?: ToastAction) => void
  dismiss: (id: number) => void
}

let toastSeq = 0

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push: (kind, message, action) => {
    const id = ++toastSeq
    set({ toasts: [...get().toasts.slice(-(TOAST_MAX - 1)), { id, kind, message, action }] })
    setTimeout(() => get().dismiss(id), kind === 'error' || action ? TOAST_MS.long : TOAST_MS.info)
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}))

export function notify(message: string, action?: ToastAction): void {
  useToasts.getState().push('info', message, action)
}

export function notifyError(message: string): void {
  useToasts.getState().push('error', message)
}

/** 操作の失敗を知らせる（仕様上できない操作 DomainError は文だけ、思いがけない失敗はコンソールにも残す） */
function reportFailure(e: unknown): void {
  if (e instanceof DomainError) {
    notifyError(e.message)
    return
  }
  notifyError(e instanceof Error ? e.message : String(e))
  console.error(e)
}

/**
 * 操作を実行し、仕様上できない操作（DomainError）はエラーのお知らせで知らせる。
 * 成功時は戻り値を、失敗時は undefined を返す。Promise を返す操作（ゴミ箱へ移す・戻す）は attemptAsync を使う
 * （attempt は投げた例外だけを受け、Promise の失敗は受けない）
 */
export function attempt<R>(fn: () => R): R | undefined {
  try {
    return fn()
  } catch (e) {
    reportFailure(e)
    return undefined
  }
}

/**
 * Promise を返す操作（actions.trashItem・restoreTrashEntry など）を実行し、失敗（投げた例外も、Promise の失敗も）を
 * attempt と同じくお知らせで知らせる。成功時は結果を、失敗時は undefined を返す
 */
export async function attemptAsync<R>(fn: () => Promise<R>): Promise<R | undefined> {
  try {
    return await fn()
  } catch (e) {
    reportFailure(e)
    return undefined
  }
}

// ---------- カレンダーの画面の状態（開いている間だけ。端末に覚えない。docs/SPEC.md の 3.7・4.9・6.4・9.5） ----------

/**
 * 目立たせる所（4.9 の 1.2秒の枠）。キーは 'item:{id}'（登録・ドラッグで移った予定のカード）・'day-area:{区分}'（デイリーの区分の
 * 区切り）・'day-events:{区分}'（タイムスケジュールのその区分の予定）。keys の全部を一緒に目立たせる（マンスリーの数字から来た時の
 * 区切りと予定。7.12）。key は keys の最初の物。seq は同じ所をもう一度目立たせる時にも変わる連番（NS の reveal.ts の作り）。
 * scroll は、目立たせられる側が自分を見える所まで出してよいか（useFlashTarget の scroll。flashInPlace の時は false）
 */
export interface FlashTarget {
  key: string
  keys: readonly string[]
  seq: number
  scroll: boolean
}

export interface CalendarUi {
  /**
   * 見ている日（'YYYY-MM-DD'）。月・年の行き先は日を持たないので、モードを替えた時に引き継ぐ日をここに覚える
   * （行き先の期間の中にあればこの日、無ければ今日・期間の最初の日。確かめ A2・D02）。開いている間だけ
   */
  viewed: string | null
  /** マンスリーの「休みを付ける」の状態（9.5。‹ ›・今日・スワイプ・［＋ 登録］では続き、マンスリーを離れると終わる。D30） */
  offMode: boolean
  /** 目立たせる所（無ければ null） */
  flash: FlashTarget | null
  /** 最後に押した・キーを打った時刻（ミリ秒。裏から戻って6時間たったら今日へ移す決まり 6.4 に使う。D31） */
  lastInteraction: number
}

export interface CalendarUiState extends CalendarUi {
  setViewed: (date: string | null) => void
  setOffMode: (on: boolean) => void
  /** 目立たせる（キーを1つ以上）。目立たせられる側は、見えていなければ見える所まで出す（useFlashTarget の scroll を付けた物） */
  flashTarget: (...keys: string[]) => void
  /**
   * 目立たせるだけで、目立たせられる側は動かさない（見える所へ出すのは呼んだ側）。ドラッグで落とした時に使う: 出すのは WeekDnd が、
   * 動かした物（カード・始点のカード・●）を。目立つのはその予定の始点のカード・受けた表示でもあるので、そちらへ送ると、落とした●が
   * 画面の外へ外れる（7.11・4.9）
   */
  flashInPlace: (...keys: string[]) => void
  /** 目立たせ終えた（開き直した時にもう一度目立たせないよう、その seq の物だけ消す。新しく目立たせた物は残す） */
  clearFlash: (seq: number) => void
  /** 押した・打った（at は省くと今） */
  touch: (at?: number) => void
}

let flashSeq = 0

/** 初めの状態（テストで戻す時にも使う） */
export function initialCalendarUi(): CalendarUi {
  return { viewed: null, offMode: false, flash: null, lastInteraction: Date.now() }
}

export const useCalendarUi = create<CalendarUiState>((set, get) => ({
  ...initialCalendarUi(),
  setViewed: (viewed) => set({ viewed }),
  setOffMode: (offMode) => set({ offMode }),
  flashTarget: (...keys) => {
    if (keys.length === 0) return
    set({ flash: { key: keys[0], keys, seq: ++flashSeq, scroll: true } })
  },
  flashInPlace: (...keys) => {
    if (keys.length === 0) return
    set({ flash: { key: keys[0], keys, seq: ++flashSeq, scroll: false } })
  },
  clearFlash: (seq) => {
    if (get().flash?.seq === seq) set({ flash: null })
  },
  touch: (at = Date.now()) => set({ lastInteraction: at }),
}))

/** その所を目立たせる時か */
export function flashMatches(flash: FlashTarget | null, key: string): boolean {
  return Boolean(flash?.keys.includes(key))
}

// ---------- アプリ（PWA）の更新 ----------

interface UpdateState {
  /** 新しいバージョンが用意できた */
  ready: boolean
  /** 保存してから新しいバージョンに切り替える */
  apply: (() => Promise<void>) | null
}

export const useAppUpdate = create<UpdateState>(() => ({ ready: false, apply: null }))
