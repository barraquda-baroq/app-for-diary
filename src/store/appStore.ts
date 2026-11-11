// アプリ全体の状態（Zustand）と、IndexedDB への自動保存・クラウドから届いた変更の反映（docs/SPEC.md の 2.4・6.12・6.13）。
//
// データは3層で持つ:
// - raw:       端末内（IndexedDB）の内容そのもの（このタブが知っている範囲。クラウドの json と同じ物）
// - persisted: raw を修復（repairData。6.12）に通した表示用の内容。保存の差分の基準
// - data:      persisted に、まだ保存していないこのタブの編集を重ねたもの（画面が見る内容）
// 修復は表示用の内容にだけ当て、端末内やクラウドには書き戻さない。保存する時は、raw の記録に、このタブで変えた項目と、日付と時刻の
// 並びの直しだけを重ねて書く（src/domain/repair.ts の storedData。形3: 新しい版のアプリが足した知らない値を、古い版が既定値で
// 上書きしないように）。
// NS の src/store/appStore.ts を写し、幕の知らせと小説の表の控えの順を外し、保存を形3の書き方にした。受け取り箱の依頼を当てた書き込み
// （commitRaw）は、依頼ごとのまとまり（19.5）を保存に渡す。
import { create } from 'zustand'
import {
  createPersistence,
  type AnyRecord,
  type Change,
  type ConflictHooks,
  type ConflictNote,
  type Persistence,
  type ReplaceOptions,
  type SaveOutcome,
} from '../db/persistence'
import { mimTrashIds, type RestoreKeep } from '../domain/backup'
import { repairData, storedData, storedRecord } from '../domain/repair'
import { purgeExpiredTrash } from '../domain/trash'
import { TABLE_NAMES, emptyData, type AppData, type TableName } from '../domain/types'
import { newId } from '../domain/util'
import { createConflictHooks, deviceLabel } from '../sync/conflicts'
import { deepEqual, mergeRemote, TEXT_TABLES } from '../sync/merge'
import { notify } from './uiStore'

export type SaveStatus = 'saved' | 'pending' | 'saving' | 'error'

export interface AppState {
  data: AppData
  status: 'loading' | 'ready' | 'error'
  loadError: string | null
  saveStatus: SaveStatus
  saveError: string | null
  /** 別のタブ・ウィンドウでデータが変更された */
  externalChange: boolean
  /** 入力欄にまだストアへ反映していない下書きがある */
  draftsDirty: boolean
  /** 前回の終了時に保存しきれなかった変更を起動時に復元した件数 */
  recoveredCount: number
  /** 別タブの変更と合わせて保存したレコードの数（直近の保存） */
  mergedCount: number
}

const initialState = (): AppState => ({
  data: emptyData(),
  status: 'loading',
  loadError: null,
  saveStatus: 'saved',
  saveError: null,
  externalChange: false,
  draftsDirty: false,
  recoveredCount: 0,
  mergedCount: 0,
})

export const useApp = create<AppState>(() => initialState())

const SAVE_DELAY_MS = 400
/** 操作が続いても、最初の未保存の変更からこの時間以内には必ず保存する */
const SAVE_MAX_WAIT_MS = 2000
/** データの変化を別のタブに知らせる（同期の状態は src/sync/controller.ts の diary-studio-sync-status。2.4） */
const CHANNEL_NAME = 'diary-studio-sync'

let persistence: Persistence | null = null
let raw: AppData = emptyData()
let persisted: AppData = emptyData()
let timer: ReturnType<typeof setTimeout> | null = null
let pendingSince: number | null = null
let chain: Promise<void> = Promise.resolve()
let channel: BroadcastChannel | null = null
/** 次の保存で送信待ちに付ける、受け取り箱の依頼ごとのまとまり（依頼の id → 書いた記録のキー） */
let pendingGroups = new Map<string, string[]>()
const tabId = Math.random().toString(36).slice(2)

type Listener = () => void
const savedListeners = new Set<Listener>()
const externalListeners = new Set<Listener>()

/** 端末内に何か書いた時（同期の送信のきっかけ） */
export function onLocalSave(fn: Listener): () => void {
  savedListeners.add(fn)
  return () => savedListeners.delete(fn)
}

/** 別のタブが端末内に書いた時 */
export function onExternalSave(fn: Listener): () => void {
  externalListeners.add(fn)
  return () => externalListeners.delete(fn)
}

const emit = (set: Set<Listener>) => {
  for (const fn of [...set]) {
    try {
      fn()
    } catch (e) {
      console.error(e)
    }
  }
}

export function getPersistence(): Persistence | null {
  return persistence
}

/** 端末の中の raw のデータ（クラウドの json と同じ。受け取り箱の当て方・バックアップの書き出し・月の束の候補） */
export function getRaw(): AppData {
  return raw
}

export async function initStore(p: Persistence = createPersistence()): Promise<void> {
  persistence = p
  try {
    const loaded = await p.load()
    raw = loaded
    const view = repairData(loaded)
    if (view.fixes.length) console.warn('データを表示用に直しました（端末の記録は直していません）', view.fixes)
    persisted = view.data
    const recovered = applyRecoveryJournal(view.data)
    const data = recovered.count > 0 ? repairData(recovered.data).data : view.data
    useApp.setState({ data, status: 'ready', loadError: null, recoveredCount: recovered.count })
    if (recovered.count > 0) {
      // 取り込んだ控えは、このタブの控えとして1つにまとめ直してから古いものを消す
      writeRecoveryJournal()
      removeAdoptedJournals()
      useApp.setState({ saveStatus: 'pending' })
      scheduleSave()
    } else {
      clearRecoveryJournal()
    }
  } catch (e) {
    useApp.setState({ status: 'error', loadError: e instanceof Error ? e.message : String(e) })
    return
  }
  try {
    channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL_NAME)
    if (channel) {
      channel.onmessage = (ev: MessageEvent<{ from: string }>) => {
        if (ev.data?.from === tabId) return
        emit(externalListeners)
        const s = useApp.getState()
        // このタブに未保存の編集が無ければ、黙って読み込み直す
        if (s.data === persisted && !s.draftsDirty && s.saveStatus === 'saved') void reloadFromDisk()
        else useApp.setState({ externalChange: true })
      }
    }
  } catch {
    channel = null
  }
}

export interface CommitOptions {
  /** 受け取り箱の依頼ごとのまとまり（src/domain/inbox.ts の touched。19.5） */
  groups?: ReadonlyMap<string, readonly string[]>
}

function addGroups(groups: ReadonlyMap<string, readonly string[]> | undefined): void {
  if (!groups) return
  for (const [g, keys] of groups) {
    const list = pendingGroups.get(g) ?? []
    for (const k of keys) if (!list.includes(k)) list.push(k)
    pendingGroups.set(g, list)
  }
}

/** 新しいデータ（表示用の内容に編集を重ねた物）を反映し、少し待ってから保存する */
export function commit(next: AppData, opts: CommitOptions = {}): void {
  const { data } = useApp.getState()
  if (next === data) return
  addGroups(opts.groups)
  useApp.setState({ data: next, saveStatus: 'pending' })
  scheduleSave()
}

function scheduleSave(): void {
  const t = Date.now()
  if (pendingSince === null) pendingSince = t
  if (timer) clearTimeout(timer)
  const delay = Math.max(0, Math.min(SAVE_DELAY_MS, pendingSince + SAVE_MAX_WAIT_MS - t))
  timer = setTimeout(() => {
    timer = null
    void flushNow()
  }, delay)
}

let retryTimer: ReturnType<typeof setTimeout> | null = null
let retryCount = 0
const RETRY_DELAYS_MS = [3000, 10000, 30000, 60000]

function scheduleRetry(): void {
  if (retryTimer) return
  const delay = RETRY_DELAYS_MS[Math.min(retryCount, RETRY_DELAYS_MS.length - 1)]
  retryCount += 1
  retryTimer = setTimeout(() => {
    retryTimer = null
    void flushNow()
  }, delay)
}

type Tables = Record<TableName, Record<string, AnyRecord>>

/** 変化をデータに当てる（変わった表だけ複製する） */
export function applyChanges(base: AppData, changes: readonly Change[]): AppData {
  if (!changes.length) return base
  const out = { ...base } as unknown as Tables
  const copied = new Set<TableName>()
  for (const ch of changes) {
    if (!(ch.table in out)) continue
    if (!copied.has(ch.table)) {
      out[ch.table] = { ...out[ch.table] }
      copied.add(ch.table)
    }
    if (ch.record) out[ch.table][ch.id] = ch.record
    else delete out[ch.table][ch.id]
  }
  return out as unknown as AppData
}

/** 保存で別タブの変更と合わせたレコード・別タブで消されていたレコード・競合の控え */
function outcomeChanges(outcome: SaveOutcome): Change[] {
  const changes: Change[] = []
  for (const t of Object.keys(outcome.merged) as TableName[])
    for (const r of outcome.merged[t] ?? []) changes.push({ table: t, id: r.id, record: r })
  for (const t of Object.keys(outcome.dropped) as TableName[])
    for (const id of outcome.dropped[t] ?? []) changes.push({ table: t, id, record: null })
  changes.push(...outcome.extra)
  return changes
}

// ---------- 競合の控え（どちらの内容も消さない） ----------

/** 競合の控え方。report で集めたものは、保存・反映が終わってからまとめて知らせる */
function conflictHooks(notes: ConflictNote[]): ConflictHooks {
  // 控えの表記（場所・名前）は、保存・反映する前の表示用の内容で作る
  return createConflictHooks({ device: deviceLabel(), data: () => persisted, newId, report: (n) => notes.push(n) })
}

/** 競合を控えたことを知らせる文（知らせるものが無ければ null） */
export function conflictMessage(notes: readonly ConflictNote[]): string | null {
  if (!notes.length) return null
  const parts: string[] = []
  const trashed = notes.filter((n) => n.kind === 'trash').length
  const joined = notes.filter((n) => n.kind === 'joined').length
  if (trashed) parts.push(`削除と編集が重なった内容など ${trashed} 件をゴミ箱に残しました`)
  if (joined) parts.push(`両方で書き換えられた文章 ${joined} 件は、両方の文章をつないで残しました`)
  if (!parts.length) return null
  return `ほかの端末と同時に編集されていました。${parts.join('。')}。`
}

function announceConflicts(notes: ConflictNote[]): void {
  const message = conflictMessage(notes)
  if (message) notify(message)
}

/**
 * oldBase から newBase への変化を、その後に編集された latest に重ねる。
 * このタブでも編集し直したレコードは、項目ごとに合わせる（同期と同じ規則）。
 * raws = oldBase・newBase の表示用に直す前の記録（raw）。競合の控え（ゴミ箱）は、表示用に直す前の記録で作る（知らない値を残す。
 * 形3・6.15）: このタブの内容は raw にこのタブの変更を重ねた物、ほかのタブ・端末の内容は newBase の raw
 */
export function rebaseView(latest: AppData, oldBase: AppData, newBase: AppData, raws?: { old: AppData; new: AppData }): AppData {
  if (latest === oldBase) return newBase
  const out = { ...latest } as unknown as Tables
  const extras: Change[] = []
  const hooks = conflictHooks([])
  for (const t of TABLE_NAMES) {
    const o = oldBase[t] as Record<string, AnyRecord>
    const n = newBase[t] as Record<string, AnyRecord>
    if (o === n) continue
    const l = latest[t] as Record<string, AnyRecord>
    let table = l
    const write = (id: string, rec: AnyRecord | null) => {
      if (table === l) table = { ...l }
      if (rec) table[id] = rec
      else delete table[id]
    }
    const ids = new Set([...Object.keys(o), ...Object.keys(n)])
    for (const id of ids) {
      if (o[id] === n[id]) continue
      const mine = l[id]
      if (mine === o[id]) {
        write(id, n[id] ?? null)
        continue
      }
      // このタブでも編集していた
      const r = mergeRemote(t, o[id] ?? null, mine ?? null, n[id] ?? null, { device: deviceLabel() })
      if (r.record !== mine) write(id, r.record)
      const rawOf = (kept: AnyRecord): AnyRecord => {
        if (!raws) return kept
        if (kept === mine) {
          const oldRaw = (raws.old[t] as Record<string, AnyRecord>)[id]
          return (storedRecord(t, oldRaw as never, o[id] as never, mine as never) as AnyRecord | undefined) ?? kept
        }
        if (kept === n[id]) return (raws.new[t] as Record<string, AnyRecord>)[id] ?? kept
        return kept
      }
      for (const kept of [r.deletedEdit, r.keptCopy, r.overwritten])
        if (kept && TEXT_TABLES.has(t)) extras.push(...hooks.trashCopy(t, rawOf(kept)))
    }
    out[t] = table
  }
  let result = out as unknown as AppData
  for (const ex of extras)
    if (ex.record) result = applyChanges(result, [{ table: ex.table, id: ex.record.id, record: ex.record }])
  return result
}

/** 保留中の変更を保存する（chain の中で呼ぶ） */
async function saveOnce(): Promise<boolean> {
  if (!persistence) return true
  const next = useApp.getState().data
  if (next === persisted) {
    if (useApp.getState().saveStatus !== 'error') useApp.setState({ saveStatus: 'saved' })
    return useApp.getState().saveStatus !== 'error'
  }
  useApp.setState({ saveStatus: 'saving' })
  const groups = pendingGroups
  pendingGroups = new Map()
  try {
    const notes: ConflictNote[] = []
    // 形3: raw に、このタブで変えた項目と日付・時刻の並びの直しだけを重ねて書く
    const rawNext = storedData(raw, persisted, next)
    const outcome = await persistence.save(raw, rawNext, conflictHooks(notes), groups.size ? { groups } : undefined)
    const dropped: Change[] = []
    for (const t of Object.keys(outcome.dropped) as TableName[])
      for (const id of outcome.dropped[t] ?? []) dropped.push({ table: t, id, record: null })
    raw = applyChanges(raw, [...outcome.written, ...dropped])
    const rawWritten = raw
    const mergedCount = Object.values(outcome.merged).reduce((n, a) => n + (a?.length ?? 0), 0) + dropped.length
    // 別タブの変更と合わせたレコード・競合の控えは、修復した表示用の内容にしてから使う
    const changed = outcomeChanges(outcome)
    const written = changed.length > 0 ? repairData(applyChanges(next, changed)).data : next
    persisted = written
    const latest = useApp.getState().data
    if (latest === next) {
      useApp.setState({ data: written, saveStatus: 'saved', saveError: null, mergedCount })
      clearRecoveryJournal()
      // 保存している間に別のタブが書いていた: 下書きも無ければ、すぐに読み込み直す（このタブの raw を古いままにしない）
      if (useApp.getState().externalChange && !useApp.getState().draftsDirty) void reloadFromDisk()
    } else {
      useApp.setState({
        data: rebaseView(latest, next, written, { old: rawNext, new: rawWritten }),
        saveStatus: 'pending',
        saveError: null,
        mergedCount,
      })
      scheduleSave()
    }
    retryCount = 0
    if (retryTimer) {
      clearTimeout(retryTimer)
      retryTimer = null
    }
    if (outcome.written.length) {
      channel?.postMessage({ from: tabId })
      emit(savedListeners)
    }
    announceConflicts(notes)
    return true
  } catch (e) {
    // まとまりは次の保存に持ち越す
    for (const [g, keys] of groups) addGroups(new Map([[g, keys]]))
    useApp.setState({ saveStatus: 'error', saveError: e instanceof Error ? e.message : String(e) })
    scheduleRetry()
    return false
  }
}

/**
 * 保留中の変更をすぐに保存する（画面を離れる時など）。
 * 保存できたら true、失敗したら false で終わる（失敗時は少し待って自動で再試行する）。
 */
export function flushNow(): Promise<boolean> {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  pendingSince = null
  const run = chain.then(saveOnce)
  chain = run.then(() => undefined)
  return run
}

/** raw に当てた変化を、表示用の内容と画面の内容にも重ねる（chain の中で呼ぶ）。rawBefore = 当てる前の raw */
function refreshView(changes: readonly Change[], rawBefore: AppData): void {
  if (!changes.length) return
  const view = repairData(raw).data
  const oldBase = persisted
  persisted = view
  const latest = useApp.getState().data
  const next = rebaseView(latest, oldBase, view, { old: rawBefore, new: raw })
  if (next === view) useApp.setState({ data: next })
  else {
    useApp.setState({ data: next, saveStatus: 'pending' })
    scheduleSave()
  }
}

/** 2つのデータの違う記録（b の内容。b に無ければ削除） */
function diffChanges(a: AppData, b: AppData): Change[] {
  const out: Change[] = []
  for (const t of TABLE_NAMES) {
    const x = a[t] as Record<string, AnyRecord>
    const y = b[t] as Record<string, AnyRecord>
    if (x === y) continue
    for (const id in y) if (!deepEqual(x[id], y[id])) out.push({ table: t, id, record: y[id] })
    for (const id in x) if (!(id in y)) out.push({ table: t, id, record: null })
  }
  return out
}

/**
 * 端末の中（IndexedDB）を読み直して raw にする（chain の中で、このタブの変更を保存した後に呼ぶ）。別のタブ・同期を受け持つタブが
 * 書いた後でも、このタブの raw を「端末の今」として使えるように（受け取り箱の当て方・ゴミ箱の出し入れ・バックアップの書き出し）
 */
async function refreshRawFromDisk(p: Persistence): Promise<AppData> {
  const changes = diffChanges(raw, await p.load())
  if (changes.length) {
    const before = raw
    raw = applyChanges(raw, changes)
    refreshView(changes, before)
  }
  const s = useApp.getState()
  if (s.externalChange && s.data === persisted) useApp.setState({ externalChange: false })
  return raw
}

/**
 * 端末の中の今の raw のデータ（このタブの変更を保存してから、IndexedDB から読み直す。バックアップの書き出し）
 */
export function loadFromDisk(): Promise<AppData> {
  const run = chain.then(async (): Promise<AppData> => {
    if (!persistence) return raw
    if (!(await saveOnce())) throw new Error('この端末の変更を保存できないため、読み込めません')
    return refreshRawFromDisk(persistence)
  })
  chain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

/**
 * raw のデータに直接当てる書き込み（受け取り箱の依頼・提案の当て方。src/domain/inbox.ts は raw の記録に当てる。19.5）。
 * 先にこのタブの未保存の変更を保存し、端末の中を読み直してから fn を当て、groups（依頼ごとのまとまり）を付けて保存する。fn の結果を返す
 */
export function commitRaw<R>(
  fn: (raw: AppData) => { data: AppData; groups?: ReadonlyMap<string, readonly string[]>; result?: R },
): Promise<R | undefined> {
  const run = chain.then(async (): Promise<R | undefined> => {
    if (!persistence) throw new Error('保存先が初期化されていません')
    if (!(await saveOnce())) throw new Error('この端末の変更を保存できないため、書き込めません')
    // 指紋（Claude が読んだ後に変わったか）・ゴミ箱に控える内容は、端末の今の記録と比べる（このタブの raw は古いことがある）
    await refreshRawFromDisk(persistence)
    const r = fn(raw)
    if (r.data === raw) return r.result
    const notes: ConflictNote[] = []
    const outcome = await persistence.save(raw, r.data, conflictHooks(notes), r.groups?.size ? { groups: r.groups } : undefined)
    const dropped: Change[] = []
    for (const t of Object.keys(outcome.dropped) as TableName[])
      for (const id of outcome.dropped[t] ?? []) dropped.push({ table: t, id, record: null })
    const changes = [...outcome.written, ...dropped]
    const before = raw
    raw = applyChanges(raw, changes)
    refreshView(changes, before)
    if (outcome.written.length) {
      channel?.postMessage({ from: tabId })
      emit(savedListeners)
    }
    announceConflicts(notes)
    return r.result
  })
  chain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

/**
 * クラウドから届いた変更を反映する（同期を受け持つタブだけが呼ぶ）。
 * 先にこのタブの未保存の変更を保存し、端末内で送信待ちと3者マージしてから、画面の内容にも重ねる。
 * 実際に端末内に書いた内容を返す。
 */
export function applyRemoteChanges(
  changes: Change[],
  cursor?: unknown,
  opts: { direct?: boolean } = {},
): Promise<Change[] | null> {
  const run = chain.then(async (): Promise<Change[] | null> => {
    if (!persistence) throw new Error('保存先が初期化されていません')
    if (!(await saveOnce())) throw new Error('この端末の変更を保存できないため、クラウドの変更を反映できません')
    const notes: ConflictNote[] = []
    const written = await persistence.applyRemote(changes, { cursor, ...opts, ...conflictHooks(notes) })
    announceConflicts(notes)
    if (!written || !written.length) return written
    const before = raw
    raw = applyChanges(raw, written)
    refreshView(written, before)
    // 端末内に新しく積んだ送信待ち（競合の控え）があれば送ってもらう
    emit(savedListeners)
    channel?.postMessage({ from: tabId })
    return written
  })
  chain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

/** 全部を受け取り直した後に、クラウドにも送信待ちにも無い端末の中の記録を消す（6.11。同期を受け持つタブだけが呼ぶ） */
export function dropMissingRecords(keys: ReadonlySet<string>): Promise<Change[]> {
  const run = chain.then(async (): Promise<Change[]> => {
    if (!persistence) throw new Error('保存先が初期化されていません')
    if (!(await saveOnce())) throw new Error('この端末の変更を保存できません')
    const dropped = await persistence.dropMissing(keys)
    if (!dropped.length) return dropped
    const before = raw
    raw = applyChanges(raw, dropped)
    refreshView(dropped, before)
    channel?.postMessage({ from: tabId })
    return dropped
  })
  chain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

/** 復元で残す物（src/domain/backup.ts の RestoreKeep）を、保存先の残し方にする */
function keepOptions(keep?: RestoreKeep): ReplaceOptions {
  if (!keep?.mimNotes) return {}
  return {
    tables: ['mimNotes'],
    keys: [...keep.trashEntryIds.map((id) => `trashEntries/${id}`), ...keep.trashRecordIds.map((id) => `trashRecords/${id}`)],
    keepMimTrash: true,
  }
}

/**
 * バックアップから全データを置き換える（raw の記録）。keep の物（MIM を含まないファイルの時の MIM とゴミ箱の MIM）と受け取り箱は
 * 「必ず上書き」にしない（6.16・形4）。input に関数を渡すと、保存先のトランザクションの中で読んだ端末の今の記録から、置き換える内容と
 * 残す物を作る（復元。src/domain/backup.ts の restoreData。このタブの raw が古くても、ほかの端末で直したばかりの MIM・受け取り箱を
 * 古い内容で上書きしないように）
 */
export async function replaceAllData(
  input: AppData | ((disk: AppData) => { data: AppData; keep?: RestoreKeep }),
  keep?: RestoreKeep,
): Promise<void> {
  await flushNow()
  if (!persistence) throw new Error('保存先が初期化されていません')
  const p = persistence
  const run = chain.then(async () => {
    const stored = await p.replaceAll(
      typeof input === 'function'
        ? (disk) => {
            const r = input(disk)
            return { data: { ...emptyData(), ...r.data }, opts: keepOptions(r.keep) }
          }
        : { ...emptyData(), ...input },
      keepOptions(keep),
    )
    raw = stored
    persisted = repairData(stored).data
    pendingGroups = new Map()
    clearRecoveryJournal()
    useApp.setState({ data: persisted, saveStatus: 'saved', saveError: null, externalChange: false })
    channel?.postMessage({ from: tabId })
    emit(savedListeners)
  })
  chain = run.then(
    () => undefined,
    () => undefined,
  )
  await run
}

/** MIM を含まないファイルの時に残す、今の端末のゴミ箱の中の MIM（テスト・表示用） */
export function currentMimTrash(): ReturnType<typeof mimTrashIds> {
  return mimTrashIds(raw)
}

/**
 * 別タブの変更を読み込み直す。先にこのタブの変更を保存する（別タブが先に変えた項目は上書きせずに合わせる）。
 * このタブの保存に失敗している時は、読み込み直すと未保存の変更が消えるので読み込まない。
 */
export async function reloadFromDisk(): Promise<boolean> {
  if (!persistence) return false
  const p = persistence
  const saved = await flushNow()
  if (!saved) return false
  const run = chain.then(async () => {
    const loaded = await p.load()
    const before = raw
    raw = loaded
    const view = repairData(loaded).data
    const oldBase = persisted
    persisted = view
    const latest = useApp.getState().data
    const next = rebaseView(latest, oldBase, view, { old: before, new: loaded })
    useApp.setState({ data: next, externalChange: false })
    if (next !== view) scheduleSave()
  })
  chain = run.then(
    () => undefined,
    () => undefined,
  )
  await run
  return true
}

// ---------- ゴミ箱の期限切れ（6.15。1時間ごと） ----------

const TRASH_PURGE_MS = 60 * 60 * 1000
let purgeTimer: ReturnType<typeof setInterval> | null = null

/**
 * ゴミ箱の期限切れを決める時刻（null = まだ決められないので消さない）。同期の司令塔が、ログインしている時はサーバーの時刻の見積もりで
 * 決める物に差し替える（src/sync/controller.ts の trashPurgeTime。6.15）
 */
let trashClock: () => number | null = () => Date.now()

export function setTrashClock(fn: () => number | null): void {
  trashClock = fn
}

/** 期限（30日）を過ぎたゴミ箱の物を完全に削除する（nowTs が null なら、まだ消さない） */
export function purgeTrashNow(nowTs: number | null = trashClock()): void {
  if (nowTs === null) return
  if (useApp.getState().status !== 'ready') return
  const data = useApp.getState().data
  const next = purgeExpiredTrash(data, nowTs)
  if (next !== data) commit(next)
}

/** 起動時に呼ぶ: 今と、その後1時間ごとにゴミ箱の期限切れを消す */
export function startTrashPurge(): void {
  if (purgeTimer) return
  purgeTrashNow()
  purgeTimer = setInterval(() => purgeTrashNow(), TRASH_PURGE_MS)
}

// ---------- 復旧用の控え（localStorage。6.13 の diary-studio:recovery:{タブ}） ----------
// IndexedDB への書き込みは非同期なので、画面を閉じる直前に始めた保存は完了する保証がない。
// そこで閉じる・裏に回る時に「まだ保存できていない変更」を localStorage に同期的に控えておき、
// 次回起動時に IndexedDB の内容より新しいものだけを書き戻す。

const JOURNAL_PREFIX = 'diary-studio:recovery:'
const ownJournalKey = () => JOURNAL_PREFIX + tabId
let adoptedJournalKeys: string[] = []

interface RecoveryJournal {
  at: number
  puts: Partial<Record<TableName, AnyRecord[]>>
  dels: Partial<Record<TableName, string[]>>
  /** このタブで新しく作ったレコード（保存先に無くても書き戻してよいもの） */
  created?: Partial<Record<TableName, string[]>>
  /**
   * puts の記録の、このタブで直す前の内容（id → 内容。表示用の内容）。書き戻す時に、保存先の今の記録へこのタブで変えた項目だけを
   * 重ねる（3者マージ）。控えきれない時は外す（その時は、直した日時の新しい方を採る）
   */
  bases?: Partial<Record<TableName, Record<string, AnyRecord>>>
}

/** 控えの大きさの上限（localStorage は 5MB 程度。UTF-16 で数えた文字数） */
const JOURNAL_BUDGET = 2_000_000
/** 控えきれない時に先に諦める順（後ろほど大事） */
const JOURNAL_DROP_ORDER: TableName[] = [
  'inbox',
  'trashRecords',
  'trashEntries',
  'labelNames',
  'offDays',
  'routineChecks',
  'routines',
  'favorites',
  'mimNotes',
  'items',
]

function diffTables(prev: AppData, next: AppData): Omit<RecoveryJournal, 'at'> | null {
  const puts: RecoveryJournal['puts'] = {}
  const dels: RecoveryJournal['dels'] = {}
  const created: NonNullable<RecoveryJournal['created']> = {}
  const bases: NonNullable<RecoveryJournal['bases']> = {}
  let any = false
  for (const t of TABLE_NAMES) {
    const a = prev[t] as Record<string, AnyRecord>
    const b = next[t] as Record<string, AnyRecord>
    if (a === b) continue
    const p: AnyRecord[] = []
    const d: string[] = []
    const c: string[] = []
    const base: Record<string, AnyRecord> = {}
    for (const id in b) {
      if (a[id] === b[id]) continue
      p.push(b[id])
      if (!(id in a)) c.push(id)
      else base[id] = a[id]
    }
    for (const id in a) if (!(id in b)) d.push(id)
    if (p.length) puts[t] = p
    if (d.length) dels[t] = d
    if (c.length) created[t] = c
    if (Object.keys(base).length) bases[t] = base
    if (p.length || d.length) any = true
  }
  return any ? { puts, dels, created, bases } : null
}

function fitJournal(journal: RecoveryJournal): string | null {
  let json = JSON.stringify(journal)
  // 入りきらない時は、まず直す前の内容を外す（書き戻す時は、直した日時の新しい方を採る）
  if (json.length > JOURNAL_BUDGET && journal.bases) {
    delete journal.bases
    json = JSON.stringify(journal)
  }
  for (const t of JOURNAL_DROP_ORDER) {
    if (json.length <= JOURNAL_BUDGET) return json
    if (!journal.puts[t]) continue
    delete journal.puts[t]
    if (journal.created) delete journal.created[t]
    json = JSON.stringify(journal)
  }
  return json.length <= JOURNAL_BUDGET ? json : null
}

/** まだ保存できていない変更を localStorage に控える。保存済みなら控えを消す */
export function writeRecoveryJournal(): void {
  const next = useApp.getState().data
  if (!persistence || useApp.getState().status !== 'ready') return
  const diff = diffTables(persisted, next)
  try {
    if (!diff) {
      localStorage.removeItem(ownJournalKey())
      return
    }
    const journal: RecoveryJournal = { at: Date.now(), ...diff }
    const json = fitJournal(journal)
    if (json === null) {
      localStorage.removeItem(ownJournalKey())
      return
    }
    try {
      localStorage.setItem(ownJournalKey(), json)
    } catch {
      // 容量不足: 古い控えを消し、予定・タスクだけでも控える
      localStorage.removeItem(ownJournalKey())
      const minimal: RecoveryJournal = {
        at: journal.at,
        puts: { items: journal.puts.items },
        dels: {},
        created: { items: journal.created?.items },
      }
      if (minimal.puts.items?.length) localStorage.setItem(ownJournalKey(), JSON.stringify(minimal))
    }
  } catch (e) {
    console.warn('復旧用の控えを書けませんでした', e)
  }
}

function clearRecoveryJournal(): void {
  try {
    localStorage.removeItem(ownJournalKey())
  } catch {
    /* noop */
  }
  removeAdoptedJournals()
}

function removeAdoptedJournals(): void {
  try {
    for (const k of adoptedJournalKeys) if (k !== ownJournalKey()) localStorage.removeItem(k)
  } catch {
    /* noop */
  }
  adoptedJournalKeys = []
}

function readRecoveryJournals(): { key: string; journal: RecoveryJournal }[] {
  const out: { key: string; journal: RecoveryJournal }[] = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key || !key.startsWith(JOURNAL_PREFIX)) continue
      try {
        const j = JSON.parse(localStorage.getItem(key) ?? '') as RecoveryJournal
        if (j && typeof j.at === 'number' && typeof j.puts === 'object' && typeof j.dels === 'object')
          out.push({ key, journal: j })
        else localStorage.removeItem(key)
      } catch {
        localStorage.removeItem(key)
      }
    }
  } catch {
    return []
  }
  return out.sort((a, b) => a.journal.at - b.journal.at)
}

/** 控え（古い順）のうち、読み込んだデータより新しい変更だけを適用する */
export function applyRecoveryJournal(base: AppData): { data: AppData; count: number } {
  const journals = readRecoveryJournals()
  adoptedJournalKeys = journals.map((j) => j.key)
  let data = base
  let count = 0
  for (const { journal } of journals) {
    const r = applyOneJournal(data, journal)
    data = r.data
    count += r.count
  }
  return { data, count }
}

function applyOneJournal(base: AppData, j: RecoveryJournal): { data: AppData; count: number } {
  const data = { ...base } as Record<TableName, Record<string, AnyRecord>>
  let count = 0
  for (const t of TABLE_NAMES) {
    const puts = j.puts[t] ?? []
    const dels = j.dels[t] ?? []
    if (!puts.length && !dels.length) continue
    let table = data[t]
    const ensure = () => {
      if (table === base[t]) table = { ...table }
    }
    const created = new Set(j.created?.[t] ?? [])
    const bases = j.bases?.[t]
    for (const r of puts) {
      if (!r || typeof r.id !== 'string') continue
      const cur = table[r.id]
      // 保存先に無いのに、このタブで新しく作ったものでない = 後で別タブが削除した。復活させない
      if (!cur && j.created && !created.has(r.id)) continue
      let next = r
      if (cur) {
        // 保存先に今の記録がある: 丸ごと置き換えずに、このタブで変えた項目だけを重ねる（ほかのタブ・ほかの端末がその後に変えた
        // 項目を消さないように。このタブで新しく作ったつもりの記録が保存先にもあった時は、共通の元が無い3者マージ）
        const isNew = created.has(r.id)
        const base = isNew ? null : bases?.[r.id]
        if (isNew || base) {
          const m = mergeRemote(t, base ?? null, r, cur, { device: deviceLabel() })
          if (!m.record) continue
          next = m.record
        } else if ((cur.updatedAt ?? 0) > (r.updatedAt ?? 0)) continue
      }
      if (cur && deepEqual(cur, next)) continue
      ensure()
      table[r.id] = next
      count += 1
    }
    for (const id of dels) {
      const cur = table[id]
      if (!cur || (cur.updatedAt ?? 0) > j.at) continue
      ensure()
      delete table[id]
      count += 1
    }
    data[t] = table
  }
  return { data: data as unknown as AppData, count }
}

export function getData(): AppData {
  return useApp.getState().data
}

// ---------- React 用の小さなセレクタ ----------

export function useData(): AppData {
  return useApp((s) => s.data)
}

export function useRecord<T extends TableName>(table: T, id: string | null | undefined): AppData[T][string] | undefined {
  return useApp((s) => (id ? (s.data[table][id] as AppData[T][string] | undefined) : undefined))
}

/** テスト用: 状態とタイマーを初期化する */
export function resetStoreForTests(): void {
  if (timer) clearTimeout(timer)
  timer = null
  pendingSince = null
  chain = Promise.resolve()
  persistence = null
  raw = emptyData()
  persisted = emptyData()
  pendingGroups = new Map()
  savedListeners.clear()
  externalListeners.clear()
  adoptedJournalKeys = []
  retryCount = 0
  if (retryTimer) clearTimeout(retryTimer)
  retryTimer = null
  if (purgeTimer) clearInterval(purgeTimer)
  purgeTimer = null
  channel?.close()
  channel = null
  useApp.setState(initialState())
}
