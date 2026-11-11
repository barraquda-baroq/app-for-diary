// 受け取り箱（docs/SPEC.md の 6.14・19.4・19.5・18.5・18.6）の依頼と提案を当てる決まり（純粋な関数）。
// コネクタ（段階6）は記録を直接書き換えず、受け取り箱に依頼（足す・直す・ゴミ箱へ）か提案を作るだけ。アプリが同期の時に、
// 依頼は確かめて本物の表に当て、提案は記録を変えずに確かめて作者の答えを待つ。結果と元に戻すための控えをその記録に書く。
// 段階1では画面無しで中身を作ってテストで確かめ、画面とアプリを開いた時に自動で当てる所は段階5で作る（形5）。
// - data は端末の raw のデータ（クラウドの json と同じ。表示用に直した内容ではない）。指紋（revOf）も raw の記録で取り、patch も raw に
//   当てる。決まりの確かめ（6.2〜6.8・12.4）だけは当てた後の内容で、直す項目に関わる決まりで見る（知らない値は残す。形3）
// - 結果は { data, touched } で返す。touched は依頼（提案）の id → その依頼で書いた記録のキー（'表/id'。受け取り箱の記録は最後）。
//   ストアは依頼ごとに、送信待ちの1つのまとまり（OutboxItem.group）にして1つのトランザクションで送る（19.5）
// - 2台が同じ依頼を当てても1回分にまとまる: 足すは作る id が同じ（内容から作る id）、直すは「もう当たっていました」、ゴミ箱へは
//   ゴミ箱の id が同じ（te-{依頼の id}）。受け取り箱の結果の組は 6.10 の強い方（strongerInboxOutcome。src/sync/merge.ts が使う）
import { isYmd, ymdOfMs } from './dates'
import { derivedFavoriteId, derivedItemId, derivedRoutineId, parseRoutineCheckId } from './derivedId'
import { deepEqual, stableStringify } from './equal'
import { hashJson, revOf } from './hash'
import { itemProblems } from './items'
import { itemDateFixes } from './repair'
import { isLabelKey, labelKeyOf } from './labels'
import { checkDatesProblem, isRoutineCycle, keepUnknownDates, keepUnknownWeekdays, routineProblems } from './routines'
import { inboxTrashIds, isInTrash, restoreTrashEntry, trashRecord } from './trash'
import { transact } from './tx'
import {
  DomainError,
  INBOX_OPS,
  INBOX_TABLES,
  LIMITS,
  RECORD_VERSION,
  type AppData,
  type ContentTableName,
  type DerivedTableName,
  type Favorite,
  type ID,
  type InboxOp,
  type InboxReason,
  type InboxRecord,
  type InboxStatus,
  type InboxTable,
  type InboxUndo,
  type Item,
  type LabelName,
  type OffDay,
  type ProposalStatus,
  type RequestStatus,
  type Routine,
  type RoutineCheck,
  type TableName,
  type UndoUpdated,
} from './types'
import { DAY_MS, charCount, compareStr, nextOrder, topOrder } from './util'

// ---------- 定数 ----------

/** 作ってから 7日を過ぎた直す・ゴミ箱への依頼は当てずに競合（stale）にする（6.14） */
export const STALE_MS = 7 * DAY_MS
/** 答えの無い提案は 30日で expired（6.14） */
export const PROPOSAL_EXPIRE_MS = 30 * DAY_MS
/** 処理して 90日たった記録を消す・競合を rejected（expired）にする（6.14） */
export const INBOX_KEEP_MS = 90 * DAY_MS
/** undo.after で、値の代わりに指紋を入れる長さ（200字を超える値。6.14） */
export const UNDO_VALUE_MAX = 200

/** 受け取り箱の記録の形の版（これより新しい版の依頼は触らずに残す。整数でない・1 より小さい版は断る） */
export const INBOX_VERSION = 1

/** 新しい版の形の依頼（触らずに残す。19.5） */
const isNewerVersion = (rec: Pick<InboxRecord, 'v'>): boolean =>
  typeof rec.v === 'number' && Number.isInteger(rec.v) && rec.v > INBOX_VERSION

/** コネクタが作る時は null の項目（6.14。結果の組と、元に戻した日時・答え方） */
const PENDING_EMPTY_FIELDS = [
  'reason',
  'message',
  'appliedAt',
  'undo',
  'undoneAt',
  'answeredVia',
  'answerId',
  'supersededBy',
] as const satisfies readonly (keyof InboxRecord)[]

/** 依頼の結果の強さ（6.10。強い方の組を採る） */
export const REQUEST_STATUS_RANK: Record<RequestStatus, number> = { pending: 0, rejected: 1, conflict: 2, applied: 3 }
/** 提案の結果の強さ（6.10） */
export const PROPOSAL_STATUS_RANK: Record<ProposalStatus, number> = {
  pending: 0,
  rejected: 1,
  expired: 2,
  superseded: 3,
  declined: 4,
  accepted: 5,
}
/** 6.10 の強さの順（依頼・提案。src/sync/merge.ts が使う） */
export const STATUS_RANK = { request: REQUEST_STATUS_RANK, proposal: PROPOSAL_STATUS_RANK } as const

/** 1組として扱う項目（依頼。6.10） */
export const REQUEST_GROUP_FIELDS = ['status', 'reason', 'message', 'appliedAt', 'undo'] as const
/** 1組として扱う項目（提案。6.10） */
export const PROPOSAL_GROUP_FIELDS = [...REQUEST_GROUP_FIELDS, 'answeredVia', 'answerId', 'supersededBy'] as const

export function inboxGroupFields(rec: Pick<InboxRecord, 'op'>): readonly (keyof InboxRecord)[] {
  return rec.op === 'propose' ? PROPOSAL_GROUP_FIELDS : REQUEST_GROUP_FIELDS
}

// ---------- 6.10 の強さ（マージで使う） ----------

function rankOf(rec: Pick<InboxRecord, 'op' | 'status'>): number {
  const table = (rec.op === 'propose' ? PROPOSAL_STATUS_RANK : REQUEST_STATUS_RANK) as Record<string, number>
  return table[rec.status] ?? -1
}

/** 本当に当てた組か（元に戻す値がある。「もう当たっていました」の { afterHash } だけの組より強い） */
function hasRealUndo(rec: Pick<InboxRecord, 'undo'>): boolean {
  const u = rec.undo as unknown as Record<string, unknown> | null
  return Boolean(u && ('before' in u || 'created' in u || 'trashEntryId' in u))
}

/**
 * 2台で別々に変えた受け取り箱の結果の組を比べる（a が強ければ正、b が強ければ負、同じなら 0）。6.10: status の強い方。同じ当てた
 * （applied・accepted）どうしなら、元に戻す値がある組（本当に当てた方）を先に、その中で appliedAt の早い方
 */
export function compareInboxOutcome(a: InboxRecord, b: InboxRecord): number {
  const r = rankOf(a) - rankOf(b)
  if (r !== 0) return r
  if (a.status === 'applied' || a.status === 'accepted') {
    const u = Number(hasRealUndo(a)) - Number(hasRealUndo(b))
    if (u !== 0) return u
  }
  const ta = typeof a.appliedAt === 'number' ? a.appliedAt : Infinity
  const tb = typeof b.appliedAt === 'number' ? b.appliedAt : Infinity
  return ta === tb ? 0 : ta < tb ? 1 : -1
}

/** 強い方の記録（同じ強さなら a。マージでは a をこの端末にする） */
export function strongerInboxOutcome(a: InboxRecord, b: InboxRecord): InboxRecord {
  return compareInboxOutcome(a, b) >= 0 ? a : b
}

/**
 * 2台で別々に変えた受け取り箱の記録の、結果の組と undoneAt（6.10）: 組は強い方からまとめて採り、undoneAt は入っている方を採る。
 * ほかの項目は mine のまま（src/sync/merge.ts が3者マージの後に重ねる）
 */
export function combineInboxOutcomes(mine: InboxRecord, theirs: InboxRecord): InboxRecord {
  const win = strongerInboxOutcome(mine, theirs)
  const out: InboxRecord = { ...mine }
  for (const f of inboxGroupFields(mine)) (out as unknown as Record<string, unknown>)[f] = win[f]
  out.undoneAt = mine.undoneAt ?? theirs.undoneAt ?? null
  return out
}

// ---------- 文脈 ----------

/** アプリの許可（config/connector。連携していない間はすべて断る。6.14） */
export interface InboxPerms {
  linked: boolean
  adds: boolean
  edits: boolean
  proposals: boolean
}

export interface InboxContext {
  /** 今（Date.now()） */
  now: number
  perms: InboxPerms
  /** 内容から作った id の記録に、クラウドの削除の印があるか（端末の _gone の控え。19.5 の previously_deleted） */
  isGone?: (table: DerivedTableName, id: ID) => boolean
  /** その記録を画面で直している間は、その依頼を待つ（19.5 の「待つ時」。段階5） */
  isEditing?: (table: InboxTable, id: ID) => boolean
  /** ミリ秒 → 端末の暦の日付（テスト用。無い時は ymdOfMs） */
  dayOf?: (ms: number) => string
}

interface Ctx {
  now: number
  perms: InboxPerms
  isGone: (table: DerivedTableName, id: ID) => boolean
  isEditing: (table: InboxTable, id: ID) => boolean
  dayOf: (ms: number) => string
}

const resolve = (c: InboxContext): Ctx => ({
  now: c.now,
  perms: c.perms,
  isGone: c.isGone ?? (() => false),
  isEditing: c.isEditing ?? (() => false),
  dayOf: c.dayOf ?? ymdOfMs,
})

/** 送信待ちのキー（'表/id'。src/db/persistence.ts の送信待ちと同じ形） */
export function recordKey(table: TableName, id: ID): string {
  return `${table}/${id}`
}

/** 依頼（提案）の id → その依頼で書いた記録のキー（受け取り箱の記録は最後） */
export type Touched = Map<ID, string[]>

/** 2つのデータの違う記録のキー（受け取り箱の記録は最後） */
function changedKeys(before: AppData, after: AppData): string[] {
  const keys: string[] = []
  const inbox: string[] = []
  for (const table of Object.keys(after) as TableName[]) {
    const a = after[table] as Record<ID, unknown>
    const b = before[table] as Record<ID, unknown>
    if (a === b) continue
    for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (a[id] === b[id]) continue
      ;(table === 'inbox' ? inbox : keys).push(recordKey(table, id))
    }
  }
  return [...keys, ...inbox]
}

function addTouched(touched: Touched, id: ID, keys: string[]): void {
  if (keys.length === 0) return
  const list = touched.get(id) ?? []
  for (const k of keys) if (!list.includes(k)) list.push(k)
  // 受け取り箱の記録は最後（その依頼の記録をいちばん後に）
  const rank = (k: string) => (k === `inbox/${id}` ? 2 : k.startsWith('inbox/') ? 1 : 0)
  list.sort((x, y) => rank(x) - rank(y))
  touched.set(id, list)
}

// ---------- 表示の言葉 ----------

/** 項目の名前（「その後に直された項目（締め切り日）は戻しません」など） */
export const FIELD_LABELS: Record<string, string> = {
  title: '件名',
  kind: '区分',
  start: '開始日',
  due: '締め切り日',
  startTime: '開始時刻',
  endTime: '終了時刻',
  label: 'ラベル',
  requester: '依頼者',
  memo: 'メモ',
  listed: 'Task List に出すか',
  done: '完了',
  doneAt: '完了した日時',
  doneOn: '完了した日',
  locked: 'ロック',
  text: '中身',
  cycle: '種類',
  weekdays: '曜日',
  monthDay: '日',
  yearMonth: '月',
  yearDay: '日',
  dates: 'チェックした日',
  off: '休み',
  name: '呼び名',
}

const MESSAGES: Partial<Record<InboxReason, string>> = {
  changed: 'Claude が読んだ後に、ここで直されていたので反映していません',
  stale: '何日も前の依頼なので、まだ反映していません',
  duplicate: 'もうあります',
  previously_deleted: '以前に消されています',
  not_found: '対象が見つかりません',
  in_trash: '対象はゴミ箱にあります',
  proposal_mismatch: '提案の中身と違います',
  declined: '拒否しました',
  expired: '90日たっても選ばれなかったので、反映していません',
  replaced: '同じ項目に新しい提案が来ました',
  already_done: 'もうその内容になっています',
  previously_declined: '前に拒否した（答えなかった）提案と同じです',
}

// ---------- 初めの確かめ（19.5） ----------

/** 指せない表（MIM・ゴミ箱・受け取り箱・月の束） */
const UNPOINTABLE = new Set(['mimNotes', 'trashEntries', 'trashRecords', 'inbox', 'itemPack'])

/** 足す依頼の patch の項目（19.4） */
const ADD_FIELDS: Record<Exclude<InboxTable, 'routineChecks'>, readonly string[]> = {
  items: ['origin', 'kind', 'title', 'start', 'due', 'startTime', 'endTime', 'label', 'requester', 'memo', 'listed'],
  favorites: ['text'],
  routines: ['title', 'cycle', 'weekdays', 'monthDay', 'yearMonth', 'yearDay'],
  offDays: ['date'],
  labelNames: ['key', 'name'],
}
/** タスク（list 生まれ）として足す時に使える項目 */
const ADD_TASK_FIELDS = ['origin', 'kind', 'title', 'start', 'due', 'requester', 'memo']

/** 直す依頼・直す提案の patch の項目（直せない項目: id・v・origin・createdAt・updatedAt・by・ai・via・order・doneAt・doneOn。19.4） */
export const UPDATE_FIELDS: Record<InboxTable, readonly string[]> = {
  items: ['title', 'kind', 'start', 'due', 'startTime', 'endTime', 'label', 'requester', 'memo', 'listed', 'done', 'locked'],
  favorites: ['text', 'done'],
  routines: ['title', 'cycle', 'weekdays', 'monthDay', 'yearMonth', 'yearDay'],
  routineChecks: ['dates'],
  offDays: ['off'],
  labelNames: ['name'],
}

type FieldCheck = (v: unknown) => boolean
const isStr: FieldCheck = (v) => typeof v === 'string'
const isStrOrNull: FieldCheck = (v) => v === null || typeof v === 'string'
const isBool: FieldCheck = (v) => typeof v === 'boolean'
const isNumOrNull: FieldCheck = (v) => v === null || (typeof v === 'number' && Number.isFinite(v))
const longText: FieldCheck = (v) => typeof v === 'string' && Array.from(v).length <= LIMITS.requestText

/** patch の値の形（型と長さ。意味の決まりは当てた後の内容で見る） */
const FIELD_CHECKS: Record<string, FieldCheck> = {
  origin: isStr,
  kind: isStr,
  title: isStr,
  start: isStrOrNull,
  due: isStrOrNull,
  startTime: isStrOrNull,
  endTime: isStrOrNull,
  label: isStrOrNull,
  requester: isStr,
  memo: longText,
  listed: isBool,
  done: isBool,
  locked: isBool,
  text: longText,
  cycle: isStr,
  weekdays: (v) => Array.isArray(v),
  monthDay: isNumOrNull,
  yearMonth: isNumOrNull,
  yearDay: isNumOrNull,
  dates: (v) => Array.isArray(v),
  off: isBool,
  name: isStr,
  date: isStr,
  key: isStr,
}

const isObj = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v)
const optText = (v: unknown, max: number, required: boolean): boolean =>
  v === null || v === undefined ? !required : typeof v === 'string' && charCount(v) >= 1 && Array.from(v).length <= max

/** 種類と表の組が 19.4 の表で「—」か */
function invalidCombo(op: InboxOp, proposeOp: unknown, table: InboxTable): boolean {
  if (op === 'add' && table === 'routineChecks') return true
  if (op === 'trash' && (table === 'offDays' || table === 'labelNames' || table === 'routineChecks')) return true
  if (op === 'propose' && table === 'routineChecks') return true
  if (op === 'propose' && proposeOp === 'trash' && (table === 'offDays' || table === 'labelNames')) return true
  return false
}

interface Problem {
  reason: InboxReason
  message: string
}

const invalid = (message: string): Problem => ({ reason: 'invalid', message })

function patchShapeProblem(rec: InboxRecord): string | null {
  const isUpdate = rec.op === 'update' || (rec.op === 'propose' && rec.proposeOp === 'update')
  if (rec.op === 'add') {
    if (!isObj(rec.patch)) return '足す中身（patch）がありません'
    const allowed =
      rec.table === 'items' && rec.patch.origin === 'list' ? ADD_TASK_FIELDS : ADD_FIELDS[rec.table as keyof typeof ADD_FIELDS]
    for (const [k, v] of Object.entries(rec.patch)) {
      if (!allowed.includes(k)) return `足す依頼に「${FIELD_LABELS[k] ?? k}」は入れられません`
      if (!FIELD_CHECKS[k]?.(v)) return `「${FIELD_LABELS[k] ?? k}」の形が正しくありません`
    }
    return null
  }
  if (isUpdate) {
    if (!isObj(rec.patch) || Object.keys(rec.patch).length === 0) return '直す中身（patch）がありません'
    for (const [k, v] of Object.entries(rec.patch)) {
      if (!UPDATE_FIELDS[rec.table].includes(k)) return `「${FIELD_LABELS[k] ?? k}」は直せません`
      if (!FIELD_CHECKS[k]?.(v)) return `「${FIELD_LABELS[k] ?? k}」の形が正しくありません`
    }
    return null
  }
  return rec.patch == null ? null : 'ゴミ箱へ移す依頼には中身（patch）を入れません'
}

/**
 * どの依頼でも初めに確かめる（提案も。19.5）。合わなければ断る理由（rejected）。新しい版の形の依頼（v が違う）はここに来ない
 */
function firstProblem(data: AppData, rec: InboxRecord, ctx: Ctx): Problem | null {
  // 形（6.14・19.4）
  if (rec.v !== INBOX_VERSION) return invalid('依頼の形の版が正しくありません')
  // コネクタが作る時の結果の項目は空で、updatedAt は createdAt と同じ（6.14）。入っていたら当てる前に断る（当てた後に偽の
  // 「会話で答えた」「元に戻しました」などが残らないように）
  for (const f of PENDING_EMPTY_FIELDS) if (rec[f] != null) return invalid('作った時に入れない項目が入っています')
  if (rec.updatedAt !== rec.createdAt) return invalid('作った日時と直した日時が合いません')
  if (!INBOX_OPS.includes(rec.op)) return invalid('依頼の種類が分かりません')
  const prefix = rec.op === 'add' ? 'xa-' : rec.op === 'propose' ? 'xp-' : 'xe-'
  if (!rec.id.startsWith(prefix)) return invalid('依頼の id と種類が合いません')
  if (typeof rec.targetId !== 'string' || !rec.targetId) return invalid('対象の id がありません')
  if (typeof rec.createdAt !== 'number' || !Number.isFinite(rec.createdAt)) return invalid('作った日時がありません')
  if (rec.by !== 'connector') return invalid('作った人が正しくありません')
  if (typeof rec.ai !== 'string' || !new RegExp(`^[a-z0-9-]{1,${LIMITS.ai}}$`).test(rec.ai))
    return invalid('AI の名前の形が正しくありません')
  // 指せる表か
  if (UNPOINTABLE.has(rec.table as string)) return { reason: 'not_allowed', message: 'この表は Claude から指せません' }
  if (!INBOX_TABLES.includes(rec.table)) return invalid('表が分かりません')
  if (rec.op === 'propose' ? rec.proposeOp !== 'update' && rec.proposeOp !== 'trash' : rec.proposeOp != null) {
    return invalid('提案の種類が正しくありません')
  }
  if (invalidCombo(rec.op, rec.proposeOp, rec.table)) return invalid('この表にはこの依頼を作れません')
  // 連携とアプリの許可（6.14）
  const p = ctx.perms
  if (!p.linked) return { reason: 'not_allowed', message: 'Claude と連携していません' }
  if (rec.op === 'add' && !p.adds) return { reason: 'not_allowed', message: '「Claude が足すのを許可」がオフです' }
  if ((rec.op === 'update' || rec.op === 'trash') && !p.edits) {
    return { reason: 'not_allowed', message: '「頼まれた時に直す・消すのを許可」がオフです' }
  }
  if (rec.op === 'propose' && !p.proposals) return { reason: 'not_allowed', message: '「Claude からの提案を受け取る」がオフです' }
  // 項目ごとの決まり
  if (stableStringify(rec).length > LIMITS.inboxJson) return invalid('依頼が大きすぎます')
  const needsQuote = rec.op === 'update' || rec.op === 'trash'
  if (!optText(rec.requestQuote, LIMITS.requestQuote, needsQuote)) return invalid('頼んだ言葉（requestQuote）が正しくありません')
  if (rec.op === 'propose' && rec.requestQuote != null) return invalid('提案には頼んだ言葉を入れません')
  if (!optText(rec.why, LIMITS.why, rec.op === 'propose') || (rec.op !== 'propose' && rec.why != null)) {
    return invalid('提案の理由（why）が正しくありません')
  }
  if (!optText(rec.via, LIMITS.via, rec.op === 'add' || rec.op === 'propose')) return invalid('出どころ（via）が正しくありません')
  if (rec.sourceKey != null && (rec.op !== 'add' || !optText(rec.sourceKey, LIMITS.sourceKey, true))) {
    return invalid('出どころの鍵（sourceKey）が正しくありません')
  }
  if (rec.op === 'add' ? rec.baseHash != null : typeof rec.baseHash !== 'string' || !rec.baseHash) {
    return invalid('読んだ時の指紋（baseHash）が正しくありません')
  }
  if (rec.baseHash === 'none' && !(rec.op === 'update' && rec.table === 'routineChecks'))
    return invalid('指紋の none はチェックの記録だけです')
  if (rec.baseHash === 'after:' || rec.baseHash === `after:${rec.id}`) return invalid('前の依頼の id が正しくありません')
  const shape = patchShapeProblem(rec)
  if (shape) return invalid(shape)
  // 会話で提案に答えた依頼（19.5・19.6）
  if (rec.proposalId != null) {
    if (!needsQuote || typeof rec.proposalId !== 'string')
      return invalid('提案の id（proposalId）を入れられるのは直す・ゴミ箱へ移す依頼だけです')
    const prop = data.inbox[rec.proposalId]
    if (
      !prop ||
      prop.op !== 'propose' ||
      prop.table !== rec.table ||
      prop.targetId !== rec.targetId ||
      prop.proposeOp !== rec.op
    ) {
      return invalid('指した提案が、この依頼と同じ項目・同じ種類の提案ではありません')
    }
    if (rec.op === 'update' && stableStringify(rec.patch) !== stableStringify(prop.patch)) {
      return { reason: 'proposal_mismatch', message: MESSAGES.proposal_mismatch! }
    }
  }
  // チェックの記録: ルーチンが無い・ゴミ箱にある
  if (rec.table === 'routineChecks') {
    const parsed = parseRoutineCheckId(rec.targetId)
    if (!parsed) return invalid('チェックの記録の id の形が正しくありません')
    if (!data.routines[parsed.routineId]) {
      return isInTrash(data, 'routines', parsed.routineId)
        ? { reason: 'in_trash', message: 'ルーチンはゴミ箱にあります' }
        : { reason: 'not_found', message: 'ルーチンが見つかりません' }
    }
  }
  return null
}

// ---------- 記録の読み書き ----------

type Target = Item | Favorite | Routine | RoutineCheck | OffDay | LabelName

function targetOf(data: AppData, rec: Pick<InboxRecord, 'table' | 'targetId'>): Target | undefined {
  return (data[rec.table] as Record<ID, Target>)[rec.targetId]
}

/** 対象が無い時の理由（ゴミ箱にあれば in_trash、無ければ not_found） */
function missingReason(data: AppData, rec: Pick<InboxRecord, 'table' | 'targetId'>): 'in_trash' | 'not_found' {
  return rec.table !== 'offDays' && rec.table !== 'labelNames' && isInTrash(data, rec.table, rec.targetId)
    ? 'in_trash'
    : 'not_found'
}

/** 前の依頼（after:{id}）の記録。指していなければ undefined */
function pointerOf(data: AppData, rec: InboxRecord): { id: ID; rec: InboxRecord | undefined } | undefined {
  if (typeof rec.baseHash !== 'string' || !rec.baseHash.startsWith('after:')) return undefined
  const id = rec.baseHash.slice('after:'.length)
  return { id, rec: data.inbox[id] }
}

/** 指した前の依頼がまだ当たっていない（待つ） */
function isWaiting(data: AppData, rec: InboxRecord): boolean {
  const p = pointerOf(data, rec)
  return Boolean(p && (!p.rec || p.rec.status === 'pending'))
}

/**
 * Claude が読んだ時から変わっていないか（19.5 の直すの 4.）: baseHash が指紋なら今の指紋と同じか、after:{id} なら指した依頼が当たっていて
 * その afterHash と今の指紋が同じか、none ならその月の記録がまだ無いか
 */
function unchangedSinceRead(data: AppData, rec: InboxRecord, target: Target | undefined): boolean {
  if (rec.baseHash === 'none') return target === undefined
  const p = pointerOf(data, rec)
  const now = revOf(target)
  if (p) {
    const st = p.rec?.status
    const u = p.rec?.undo as { afterHash?: string } | null | undefined
    return (st === 'applied' || st === 'accepted') && typeof u?.afterHash === 'string' && u.afterHash === now
  }
  return rec.baseHash === now
}

/** patch の値を当てる形に（ラベルは呼び名からキーに引く）。見つからないラベルは理由を返す */
function resolvePatch(data: AppData, rec: InboxRecord): { patch: Record<string, unknown> } | { problem: string } {
  const patch: Record<string, unknown> = { ...(rec.patch ?? {}) }
  if (rec.table === 'items' && typeof patch.label === 'string') {
    const key = labelKeyOf(patch.label, data.labelNames)
    if (!key) return { problem: `ラベル『${patch.label}』が見つかりません` }
    patch.label = key
  }
  for (const k of ['title', 'requester', 'name'] as const)
    if (typeof patch[k] === 'string') patch[k] = (patch[k] as string).trim()
  return { patch }
}

/**
 * 今の内容に patch の値がもう全部入っているか（チェックした日・毎週の曜日は、当てる時と同じに今の記録の知らない値を後ろに残した形で
 * 比べる。2台が同じ依頼を当てた時、後の端末が「もう当たっていました」にできるように。patched）
 */
function alreadyApplied(table: InboxTable, target: Target | undefined, patch: Record<string, unknown>): boolean {
  if (!target) return false
  const t = target as unknown as Record<string, unknown>
  const kept = (k: string, v: unknown) =>
    !Array.isArray(v)
      ? v
      : table === 'routineChecks' && k === 'dates'
        ? keepUnknownDates(v, t[k])
        : table === 'routines' && k === 'weekdays' && (!('cycle' in patch) || patch.cycle === t.cycle)
          ? keepUnknownWeekdays(v, t[k])
          : v
  return Object.entries(patch).every(([k, v]) => deepEqual(t[k], kept(k, v)))
}

/** 200字を超える値は指紋にする（undo.after。6.14） */
export function undoValue(v: unknown): unknown {
  return typeof v === 'string' && Array.from(v).length > UNDO_VALUE_MAX ? hashJson(v) : v
}

/** 今の値が undo.after の値と同じか（指紋にした長い値は、今の値の指紋と比べる） */
export function matchesUndoValue(current: unknown, stored: unknown): boolean {
  return deepEqual(undoValue(current), stored)
}

/**
 * 当てた後の記録と、決まりに合わない時の理由。決まりは直す項目に関わる物だけで見る（直していない項目の知らない値・形の分からない値は
 * そのまま残し、それを理由に断らない。形3）
 */
function patched(
  data: AppData,
  rec: InboxRecord,
  target: Target | undefined,
  patch: Record<string, unknown>,
  ctx: Ctx,
): { next: Target } | { problem: string } {
  const keys = new Set(Object.keys(patch))
  const touches = (fields: readonly string[]) => fields.some((f) => keys.has(f))
  switch (rec.table) {
    case 'items': {
      const cur = target as Item
      const next: Item = { ...cur, ...(patch as Partial<Item>), updatedAt: ctx.now }
      if ('done' in patch && patch.done !== cur.done) {
        next.doneAt = patch.done ? rec.createdAt : null
        next.doneOn = patch.done ? ctx.dayOf(rec.createdAt) : null
      }
      const problem = itemProblems(next).find((p) => touches(p.fields))
      // 保存の時と同じに、日付と時刻の並びの直し（6.12 の「（書き戻す）」の3つ）を重ねて書く（形3）
      return problem ? { problem: problem.message } : { next: { ...next, ...itemDateFixes(next) } }
    }
    case 'favorites': {
      const cur = target as Favorite
      const next: Favorite = { ...cur, ...(patch as Partial<Favorite>), updatedAt: ctx.now }
      if ('text' in patch && charCount(next.text) < 1) return { problem: '中身を入れてください' }
      if ('done' in patch && patch.done !== cur.done) next.doneAt = patch.done ? rec.createdAt : null
      return { next }
    }
    case 'routines': {
      const cur = target as Routine
      const next: Routine = { ...cur, ...(patch as Partial<Routine>), updatedAt: ctx.now }
      const problem = routineProblems(next).find((p) => touches(p.fields))
      if (problem) return { problem: problem.message }
      // 種類を変えていない毎週の曜日は、今の記録の知らない値（新しい版が足した値など）を捨てずに後ろに残す（手で直した時と同じ。形3。6.12）
      if ('weekdays' in patch && next.cycle === cur.cycle && Array.isArray(next.weekdays))
        next.weekdays = keepUnknownWeekdays(next.weekdays, cur.weekdays) as number[]
      // 種類が変わったら、手で変えた時と同じく、新しい種類のいちばん下に並べる（src/domain/ops.ts の updateRoutine）
      if (next.cycle !== cur.cycle) next.order = routineOrderFor(data, cur.id, next.cycle)
      return { next }
    }
    case 'routineChecks': {
      const parsed = parseRoutineCheckId(rec.targetId)!
      const routine = data.routines[parsed.routineId]
      const cur = target as RoutineCheck | undefined
      const problem = checkDatesProblem(routine, parsed.month, cur?.dates ?? [], patch.dates, ctx.dayOf(rec.createdAt))
      if (problem) return { problem }
      // patch の dates は正しい日付だけ。今の記録の知らない値（YYYY-MM-DD でない値）は捨てずに後ろに残す（形3。6.12）
      const next: RoutineCheck = cur
        ? { ...cur, dates: keepUnknownDates(patch.dates as string[], cur.dates) as string[], updatedAt: ctx.now }
        : {
            id: rec.targetId,
            routineId: parsed.routineId,
            month: parsed.month,
            dates: patch.dates as string[],
            updatedAt: ctx.now,
            by: 'connector',
            ai: rec.ai,
            via: rec.via,
          }
      return { next }
    }
    case 'offDays':
      return { next: { ...(target as OffDay), off: patch.off as boolean, updatedAt: ctx.now } }
    case 'labelNames': {
      const name = patch.name as string
      if (charCount(name) > LIMITS.labelName) return { problem: `呼び名は${LIMITS.labelName}字までです` }
      return { next: { ...(target as LabelName), name, updatedAt: ctx.now } }
    }
  }
}

/** 種類（cycle）を変えたルーチンの並び: その種類のいちばん下（ほかのルーチンの order の次） */
const routineOrderFor = (data: AppData, id: ID, cycle: unknown): number =>
  nextOrder(Object.values(data.routines).filter((r) => r.id !== id && r.cycle === cycle))

/** 直す前・後の控え（6.14。完了を変えた時は doneAt・doneOn も） */
function updateUndo(target: Target | undefined, next: Target, patch: Record<string, unknown>): UndoUpdated {
  const fields = Object.keys(patch)
  const t = (target ?? {}) as unknown as Record<string, unknown>
  const n = next as unknown as Record<string, unknown>
  if ('done' in patch && t.done !== n.done) for (const f of ['doneAt', 'doneOn']) if (f in n) fields.push(f)
  const before: Record<string, unknown> = {}
  const after: Record<string, unknown> = {}
  for (const f of fields) {
    before[f] = target ? (t[f] ?? null) : f === 'dates' ? [] : null
    after[f] = undoValue(n[f] ?? null)
  }
  return { before, after, beforeHash: revOf(target), afterHash: revOf(next) }
}

/** 受け取り箱の記録を書き換える（結果の組。appliedAt・updatedAt は今） */
function settle(
  rec: InboxRecord,
  status: InboxStatus,
  ctx: Ctx,
  fields: Partial<Pick<InboxRecord, 'reason' | 'message' | 'undo' | 'answeredVia' | 'answerId' | 'supersededBy'>> = {},
): InboxRecord {
  return {
    ...rec,
    status,
    reason: null,
    message: null,
    undo: null,
    answeredVia: null,
    answerId: null,
    supersededBy: null,
    undoneAt: null,
    ...fields,
    appliedAt: ctx.now,
    updatedAt: ctx.now,
  }
}

const reject = (rec: InboxRecord, p: Problem, ctx: Ctx) => settle(rec, 'rejected', ctx, { reason: p.reason, message: p.message })
const conflict = (rec: InboxRecord, reason: 'changed' | 'stale', ctx: Ctx) =>
  settle(rec, 'conflict', ctx, { reason, message: MESSAGES[reason]! })

/** 会話で提案に答えた依頼が当たった時、指した提案がまだ答え待ちなら accepted（会話で）にする（19.5） */
function acceptLinkedProposal(data: AppData, rec: InboxRecord, ctx: Ctx): AppData {
  const prop = rec.proposalId ? data.inbox[rec.proposalId] : undefined
  if (!prop || prop.status !== 'pending') return data
  return transact(data, (tx) =>
    tx.put(
      'inbox',
      settle(prop, 'accepted', ctx, { answeredVia: 'chat', answerId: rec.id, message: '会話で頼まれて反映しました' }),
    ),
  ).data
}

// ---------- 足す（19.5） ----------

type Built = { table: InboxTable; record: Target; message: string | null }

/** 足す記録を作る（id の確かめ・もうあるかの確かめの後に決まりで確かめる） */
function buildAdd(rec: InboxRecord): { id: ID } | Problem {
  const p = rec.patch as Record<string, unknown>
  switch (rec.table) {
    case 'items': {
      if (p.origin !== 'calendar' && p.origin !== 'list') return invalid('生まれ（origin）は calendar か list です')
      if (typeof p.title !== 'string') return invalid('件名がありません')
      if (p.origin === 'calendar' && !isYmd(p.start)) return invalid('予定には開始日が要ります')
      if (p.origin === 'calendar' && p.kind === undefined) return invalid('予定には区分が要ります')
      return {
        id: derivedItemId(
          {
            origin: p.origin,
            start: (p.start as string | null) ?? null,
            due: (p.due as string | null) ?? null,
            startTime: (p.startTime as string | null) ?? null,
            title: p.title,
          },
          rec.sourceKey,
        ),
      }
    }
    case 'favorites':
      if (typeof p.text !== 'string' || !p.text.trim()) return invalid('中身がありません')
      return { id: derivedFavoriteId({ text: p.text }, rec.sourceKey) }
    case 'routines':
      if (typeof p.title !== 'string') return invalid('件名がありません')
      if (!isRoutineCycle(p.cycle)) return invalid('種類が正しくありません')
      return {
        id: derivedRoutineId(
          {
            title: p.title,
            cycle: p.cycle,
            weekdays: (p.weekdays as number[] | undefined) ?? [],
            monthDay: (p.monthDay as number | null | undefined) ?? null,
            yearMonth: (p.yearMonth as number | null | undefined) ?? null,
            yearDay: (p.yearDay as number | null | undefined) ?? null,
          },
          rec.sourceKey,
        ),
      }
    case 'offDays':
      if (!isYmd(p.date)) return invalid('日付の形が正しくありません')
      return { id: p.date }
    case 'labelNames':
      if (!isLabelKey(p.key)) return invalid('ラベルが見つかりません')
      return { id: p.key }
    case 'routineChecks':
      return invalid('チェックの記録は足せません')
  }
}

function makeRecord(data: AppData, rec: InboxRecord): Built | Problem {
  const p = rec.patch as Record<string, unknown>
  const prov = { by: 'connector' as const, ai: rec.ai, via: rec.via }
  const stamps = { createdAt: rec.createdAt, updatedAt: rec.createdAt }
  switch (rec.table) {
    case 'items': {
      let label: string | null = null
      let message: string | null = null
      if (typeof p.label === 'string' && p.label.trim()) {
        label = labelKeyOf(p.label, data.labelNames)
        if (!label) message = `ラベル『${p.label}』が見つからないので、ラベルなしで入れました`
      }
      const origin = p.origin as Item['origin']
      const item: Item = {
        id: rec.targetId,
        v: RECORD_VERSION,
        kind: (p.kind as Item['kind'] | undefined) ?? 'work',
        title: (p.title as string).trim(),
        origin,
        start: (p.start as string | null | undefined) ?? null,
        due: (p.due as string | null | undefined) ?? null,
        startTime: (p.startTime as string | null | undefined) ?? null,
        endTime: (p.endTime as string | null | undefined) ?? null,
        listed: origin === 'list' ? true : ((p.listed as boolean | undefined) ?? false),
        done: false,
        doneAt: null,
        doneOn: null,
        locked: false,
        label,
        requester: ((p.requester as string | undefined) ?? '').trim(),
        memo: (p.memo as string | undefined) ?? '',
        // 依頼の createdAt から決める（2台が同じ依頼を当てても同じ記録になる）
        order: rec.createdAt,
        ...prov,
        ...stamps,
      }
      const problem = itemProblems(item)[0]
      return problem ? invalid(problem.message) : { table: 'items', record: item, message }
    }
    case 'favorites': {
      const fav: Favorite = {
        id: rec.targetId,
        v: RECORD_VERSION,
        text: p.text as string,
        done: false,
        doneAt: null,
        // いちばん上へ（6.8）。2台で値が違っても、指紋（revOf）は order を見ないので要らない競合にならない（形2）
        order: topOrder(Object.values(data.favorites)),
        ...prov,
        ...stamps,
      }
      return { table: 'favorites', record: fav, message: null }
    }
    case 'routines': {
      const cycle = p.cycle as Routine['cycle']
      const routine: Routine = {
        id: rec.targetId,
        v: RECORD_VERSION,
        title: (p.title as string).trim(),
        cycle,
        weekdays: (p.weekdays as number[] | undefined) ?? [],
        monthDay: (p.monthDay as number | null | undefined) ?? null,
        yearMonth: (p.yearMonth as number | null | undefined) ?? null,
        yearDay: (p.yearDay as number | null | undefined) ?? null,
        // その種類のいちばん下へ（19.4）
        order: nextOrder(Object.values(data.routines).filter((r) => r.cycle === cycle)),
        ...prov,
        ...stamps,
      }
      const problem = routineProblems(routine)[0]
      return problem ? invalid(problem.message) : { table: 'routines', record: routine, message: null }
    }
    case 'offDays': {
      const date = p.date as string
      return { table: 'offDays', record: { id: date, date, off: true, updatedAt: rec.createdAt, ...prov }, message: null }
    }
    case 'labelNames': {
      const name = typeof p.name === 'string' ? p.name.trim() : ''
      if (charCount(name) < 1 || charCount(name) > LIMITS.labelName) return invalid(`呼び名は1〜${LIMITS.labelName}字です`)
      return { table: 'labelNames', record: { id: p.key as string, name, updatedAt: rec.createdAt, ...prov }, message: null }
    }
    case 'routineChecks':
      return invalid('チェックの記録は足せません')
  }
}

function applyAdd(data: AppData, rec: InboxRecord, ctx: Ctx): AppData {
  const put = (r: InboxRecord) => transact(data, (tx) => tx.put('inbox', r)).data
  // 1. 内容から作る id と合うか
  const expected = buildAdd(rec)
  if ('reason' in expected) return put(reject(rec, expected, ctx))
  if (expected.id !== rec.targetId) return put(reject(rec, invalid('対象の id が中身から作る id と合いません'), ctx))
  // 2. もうあるか
  const existing = targetOf(data, rec)
  if (rec.table === 'offDays') {
    if (existing) {
      const off = (existing as OffDay).off === true
      return put(
        reject(
          rec,
          off
            ? { reason: 'duplicate', message: 'もう休みです' }
            : { reason: 'previously_deleted', message: '以前に外された休みです' },
          ctx,
        ),
      )
    }
  } else if (rec.table === 'labelNames') {
    if (existing) {
      const named = typeof (existing as LabelName).name === 'string' && (existing as LabelName).name.trim() !== ''
      return put(
        reject(
          rec,
          named
            ? invalid('この色にはもう呼び名があります（変えるのは直す依頼で）')
            : { reason: 'previously_deleted', message: '以前に消された呼び名です' },
          ctx,
        ),
      )
    }
  } else {
    const table = rec.table as DerivedTableName
    if (existing) return put(reject(rec, { reason: 'duplicate', message: MESSAGES.duplicate! }, ctx))
    if (isInTrash(data, table, rec.targetId) || ctx.isGone(table, rec.targetId)) {
      return put(reject(rec, { reason: 'previously_deleted', message: MESSAGES.previously_deleted! }, ctx))
    }
  }
  // 3. 作る
  const built = makeRecord(data, rec)
  if ('reason' in built) return put(reject(rec, built, ctx))
  return transact(data, (tx) => {
    tx.put(built.table, built.record as never)
    tx.put(
      'inbox',
      settle(rec, 'applied', ctx, { message: built.message, undo: { created: true, afterHash: revOf(built.record) } }),
    )
  }).data
}

// ---------- 直す・ゴミ箱へ（19.5） ----------

type Step = { data: AppData; waiting?: false } | { waiting: true }

function applyEdit(data: AppData, rec: InboxRecord, ctx: Ctx): Step {
  const put = (r: InboxRecord): Step => ({ data: transact(data, (tx) => tx.put('inbox', r)).data })
  const stale = ctx.now - rec.createdAt > STALE_MS
  // 1. 前の依頼（after:）がまだ当たっていなければ待つ（指した依頼がまだ届いていない時も。7日を過ぎたら、待たずに競合（stale））
  if (isWaiting(data, rec)) return stale ? put(conflict(rec, 'stale', ctx)) : { waiting: true }
  if (ctx.isEditing(rec.table, rec.targetId)) return { waiting: true }
  // 2. 対象が無い・ゴミ箱にある
  const target = targetOf(data, rec)
  if (!target && !(rec.table === 'routineChecks' && rec.baseHash === 'none')) {
    // 同じ依頼をもう当てていた（ほかの端末が移したゴミ箱の件が先に届いた）
    if (rec.op === 'trash' && data.trashEntries[inboxTrashIds(rec.id).entry]) {
      return put(
        settle(rec, 'applied', ctx, { undo: { trashEntryId: inboxTrashIds(rec.id).entry }, message: 'もう当たっていました' }),
      )
    }
    const reason = missingReason(data, rec)
    return put(reject(rec, { reason, message: MESSAGES[reason]! }, ctx))
  }
  let patch: Record<string, unknown> = {}
  if (rec.op === 'update') {
    const resolved = resolvePatch(data, rec)
    if ('problem' in resolved) return put(reject(rec, invalid(resolved.problem), ctx))
    patch = resolved.patch
    // 3. もう当たっている（2台が同時に当てた・同期の行き違い）。競合にしない
    if (alreadyApplied(rec.table, target, patch)) {
      const next = acceptLinkedProposal(
        transact(data, (tx) =>
          tx.put('inbox', settle(rec, 'applied', ctx, { undo: { afterHash: revOf(target) }, message: 'もう当たっていました' })),
        ).data,
        rec,
        ctx,
      )
      return { data: next }
    }
  }
  // 4. 指紋（Claude が読んだ後に変わっていたら競合）
  if (!unchangedSinceRead(data, rec, target)) return put(conflict(rec, 'changed', ctx))
  // 5. 7日を過ぎた依頼
  if (stale) return put(conflict(rec, 'stale', ctx))
  return { data: applyNow(data, rec, target, patch, ctx) }
}

/**
 * 依頼（または［承認］した競合）を今の内容に当てる。当てた後が決まりに合わなければ断る（invalid）。
 * 戻り値は書き換えたデータ（記録・ゴミ箱・受け取り箱。会話で提案に答えた依頼なら提案も accepted に）
 */
function applyNow(
  data: AppData,
  rec: InboxRecord,
  target: Target | undefined,
  patch: Record<string, unknown>,
  ctx: Ctx,
): AppData {
  if (rec.op === 'trash') {
    const ids = inboxTrashIds(rec.id)
    const moved = trashRecord(data, rec.table as ContentTableName, rec.targetId, {
      at: ctx.now,
      by: 'connector',
      ai: rec.ai,
      inboxId: rec.id,
      ids,
    })
    const done = transact(moved.data, (tx) =>
      tx.put('inbox', settle(rec, 'applied', ctx, { undo: { trashEntryId: moved.result } })),
    ).data
    return acceptLinkedProposal(done, rec, ctx)
  }
  const result = patched(data, rec, target, patch, ctx)
  if ('problem' in result) return transact(data, (tx) => tx.put('inbox', reject(rec, invalid(result.problem), ctx))).data
  const done = transact(data, (tx) => {
    tx.put(rec.table, result.next as never)
    tx.put('inbox', settle(rec, 'applied', ctx, { undo: updateUndo(target, result.next, patch) }))
  }).data
  return acceptLinkedProposal(done, rec, ctx)
}

// ---------- 提案（19.5） ----------

const samePatch = (a: InboxRecord, b: InboxRecord) => stableStringify(a.patch) === stableStringify(b.patch)
/** 作者が断ったのと同じ提案（拒否・30日答えが無かった・承認した後に元に戻した）。同じ中身の提案をまた出さない控え（19.5 の 4.） */
const declinedLike = (o: InboxRecord) =>
  o.status === 'declined' || o.status === 'expired' || (o.status === 'accepted' && o.undoneAt != null)
const earlier = (a: InboxRecord, b: InboxRecord) =>
  a.createdAt < b.createdAt || (a.createdAt === b.createdAt && compareStr(a.id, b.id) < 0)

function checkProposal(data: AppData, rec: InboxRecord, ctx: Ctx): Step {
  const put = (r: InboxRecord): Step => ({ data: transact(data, (tx) => tx.put('inbox', r)).data })
  // 7. 30日答えが無い
  if (ctx.now - rec.createdAt >= PROPOSAL_EXPIRE_MS) {
    return put(settle(rec, 'expired', ctx, { message: '30日答えが無かったので取り下げました' }))
  }
  // 1. 前の依頼（after:）を待つ。断られて記録ができなかった時は取り下げ
  const pointer = pointerOf(data, rec)
  if (isWaiting(data, rec)) return { waiting: true }
  const target = targetOf(data, rec)
  // 2. 対象が無い・ゴミ箱にある（項目が先に変わった）
  if (!target) {
    const reason = pointer?.rec?.status === 'rejected' ? 'not_found' : missingReason(data, rec)
    return put(
      settle(rec, 'superseded', ctx, { reason, message: reason === 'in_trash' ? 'ゴミ箱へ移されました' : 'もうありません' }),
    )
  }
  let patch: Record<string, unknown> = {}
  if (rec.proposeOp === 'update') {
    const resolved = resolvePatch(data, rec)
    if ('problem' in resolved) return put(reject(rec, invalid(resolved.problem), ctx))
    patch = resolved.patch
    // 3. 直す提案の値がもう全部入っている
    if (alreadyApplied(rec.table, target, patch))
      return put(settle(rec, 'superseded', ctx, { reason: 'already_done', message: MESSAGES.already_done! }))
  }
  // 4. 同じ項目への同じ中身の提案（前に作った物）
  const same = Object.values(data.inbox).filter(
    (o) =>
      o.id !== rec.id &&
      o.op === 'propose' &&
      o.table === rec.table &&
      o.targetId === rec.targetId &&
      o.proposeOp === rec.proposeOp &&
      samePatch(o, rec) &&
      earlier(o, rec),
  )
  if (same.some((o) => o.status === 'pending'))
    return put(reject(rec, { reason: 'duplicate', message: '同じ提案が答えを待っています' }, ctx))
  // 承認した後に作者が［元に戻す］で戻した提案も、断ったのと同じに扱う（戻したばかりの変更を、同じメールを読み直すたびに出し直さない）
  if (same.some(declinedLike)) {
    return put(reject(rec, { reason: 'previously_declined', message: MESSAGES.previously_declined! }, ctx))
  }
  // 新しい提案に置き換わった提案と同じ中身なら、出し直さない（同じメールを読み直すたびに、提案が入れ替わらないように。19.7 の 7.）
  if (same.some((o) => o.status === 'superseded' && o.reason === 'replaced'))
    return put(reject(rec, { reason: 'duplicate', message: '前に新しい提案へ置き換わった提案と同じです' }, ctx))
  // 5. 当てると決まりに合わない（Claude が読んだ時のままの時だけ見る。読んだ後に直されていたら［承認］の時に確かめる。
  //    同期のたびに確かめ直しても、提案の後の作者の編集で取り下げにならないように）
  if (rec.proposeOp === 'update' && unchangedSinceRead(data, rec, target)) {
    const result = patched(data, rec, target, patch, ctx)
    if ('problem' in result) return put(reject(rec, invalid(result.problem), ctx))
  }
  // 6. 答え待ちのまま（「Claude からの提案」に出す）
  return { data }
}

/** 同じ項目に答え待ちの提案が2つ以上ある時は、createdAt がいちばん新しい物だけを残す（19.5 の提案の 6.。待っている物は除く） */
function supersedeOlder(data: AppData, ctx: Ctx, touched: Touched): AppData {
  const groups = new Map<string, InboxRecord[]>()
  for (const r of Object.values(data.inbox)) {
    if (r.v !== INBOX_VERSION || r.op !== 'propose' || r.status !== 'pending' || isWaiting(data, r)) continue
    const key = `${r.table}/${r.targetId}`
    groups.set(key, [...(groups.get(key) ?? []), r])
  }
  let out = data
  for (const list of groups.values()) {
    if (list.length < 2) continue
    const newest = list.reduce((a, b) => (earlier(a, b) ? b : a))
    for (const r of list) {
      if (r.id === newest.id) continue
      const before = out
      out = transact(out, (tx) =>
        tx.put(
          'inbox',
          settle(r, 'superseded', ctx, { reason: 'replaced', supersededBy: newest.id, message: MESSAGES.replaced! }),
        ),
      ).data
      addTouched(touched, r.id, changedKeys(before, out))
    }
  }
  return out
}

// ---------- まとめて当てる ----------

export interface ProcessResult {
  data: AppData
  /** 依頼（提案）の id → その依頼で書いた記録のキー（受け取り箱の記録は最後。依頼ごとに送信待ちの1つのまとまりにする） */
  touched: Touched
  /** 待っている依頼・提案（前の依頼が当たっていない・画面で直している） */
  waiting: ID[]
}

/** 当てる順（createdAt の順、同じなら id の順） */
function pendingOrder(data: AppData): InboxRecord[] {
  return Object.values(data.inbox)
    .filter((r) => r.status === 'pending' && !isNewerVersion(r))
    .sort((a, b) => a.createdAt - b.createdAt || compareStr(a.id, b.id))
}

/** 1件を処理する（依頼は当てる・競合にする・断る。提案は確かめるだけ） */
function step(data: AppData, rec: InboxRecord, ctx: Ctx): Step {
  const problem = firstProblem(data, rec, ctx)
  if (problem) return { data: transact(data, (tx) => tx.put('inbox', reject(rec, problem, ctx))).data }
  if (rec.op === 'add') return { data: applyAdd(data, rec, ctx) }
  if (rec.op === 'propose') return checkProposal(data, rec, ctx)
  return applyEdit(data, rec, ctx)
}

/**
 * 受け取り箱の待っている依頼と提案を、createdAt の順に1件ずつ処理する（19.5）。ストアは、クラウドと揃っている時（最初の受け取りが
 * 終わっていて、送信待ちが1件も無い時）にだけ呼ぶ。新しい版の形の依頼（v が違う）は触らずに残す
 */
export function processInbox(data: AppData, context: InboxContext): ProcessResult {
  const ctx = resolve(context)
  const touched: Touched = new Map()
  let cur = data
  const settled = new Set<ID>()
  let progress = true
  while (progress) {
    progress = false
    for (const r of pendingOrder(cur)) {
      if (settled.has(r.id)) continue
      const rec = cur.inbox[r.id]
      if (!rec || rec.status !== 'pending') continue
      const res = step(cur, rec, ctx)
      if (res.waiting) continue
      settled.add(r.id)
      if (res.data === cur) continue
      addTouched(touched, r.id, changedKeys(cur, res.data))
      if (res.data.inbox[r.id]?.status !== 'pending') progress = true
      // 会話の依頼で提案が accepted になった時は、提案の記録も依頼のまとまりに入る（changedKeys）
      cur = res.data
    }
  }
  cur = supersedeOlder(cur, ctx, touched)
  const waiting = pendingOrder(cur)
    .filter((r) => !settled.has(r.id))
    .map((r) => r.id)
  return { data: cur, touched, waiting }
}

// ---------- 提案に答える（アプリ。18.6・19.5） ----------

/** 直す提案の、変える項目ごとの今の値と提案の値（［承認］の確かめと一覧の「前 → 後」） */
export interface FieldDiff {
  field: string
  current: unknown
  proposed: unknown
}

export function proposalDiff(data: AppData, rec: InboxRecord): FieldDiff[] {
  const target = targetOf(data, rec) as unknown as Record<string, unknown> | undefined
  if (!target || !isObj(rec.patch)) return []
  return Object.entries(rec.patch).map(([field, proposed]) => ({ field, current: target[field] ?? null, proposed }))
}

export type AnswerResult =
  | { status: 'accepted' | 'declined' | 'superseded'; message: string | null }
  /** Claude が読んだ後に直されている。違い（diff）を出して、もう一度［承認］［拒否］を選んでもらう（confirmed で当てる） */
  | { status: 'needsConfirm'; message: string; diff: FieldDiff[] }
  /** 当てた後が決まりに合わない（提案は答え待ちのまま） */
  | { status: 'invalid'; message: string }

/**
 * 提案に答える（［承認］［拒否］）。答えると記録と提案の書き換えを1つのまとまりで送る（touched）。答え待ちでない提案は DomainError
 */
export function answerProposal(
  data: AppData,
  id: ID,
  answer: 'accept' | 'decline',
  context: InboxContext,
  opts: { confirmed?: boolean } = {},
): { data: AppData; result: AnswerResult; touched: Touched } {
  const ctx = resolve(context)
  const rec = data.inbox[id]
  if (!rec || rec.op !== 'propose') throw new DomainError('提案が見つかりません。')
  if (rec.status !== 'pending') throw new DomainError('この提案はもう答えが出ています。')
  if (isWaiting(data, rec)) throw new DomainError('この提案は、前の依頼が反映されるのを待っています。')
  const touched: Touched = new Map()
  const finish = (next: AppData, result: AnswerResult) => {
    addTouched(touched, id, changedKeys(data, next))
    return { data: next, result, touched }
  }
  if (answer === 'decline') {
    const next = transact(data, (tx) =>
      tx.put('inbox', settle(rec, 'declined', ctx, { answeredVia: 'app', message: '拒否しました' })),
    ).data
    return finish(next, { status: 'declined', message: null })
  }
  // 1. 対象が無い・ゴミ箱にある・もうその内容
  const target = targetOf(data, rec)
  if (!target) {
    const reason = missingReason(data, rec)
    const message = reason === 'in_trash' ? 'ゴミ箱にあります' : 'この項目はもうありません'
    const next = transact(data, (tx) => tx.put('inbox', settle(rec, 'superseded', ctx, { reason, message }))).data
    return finish(next, { status: 'superseded', message })
  }
  let patch: Record<string, unknown> = {}
  if (rec.proposeOp === 'update') {
    const resolved = resolvePatch(data, rec)
    if ('problem' in resolved) return { data, result: { status: 'invalid', message: resolved.problem }, touched }
    patch = resolved.patch
    if (alreadyApplied(rec.table, target, patch)) {
      const message = MESSAGES.already_done!
      const next = transact(data, (tx) =>
        tx.put('inbox', settle(rec, 'superseded', ctx, { reason: 'already_done', message })),
      ).data
      return finish(next, { status: 'superseded', message })
    }
  }
  // 2. Claude が読んだ後に直されていた（競合にはせず、その場で選び直してもらう）
  if (!unchangedSinceRead(data, rec, target) && !opts.confirmed) {
    return {
      data,
      result: { status: 'needsConfirm', message: 'Claude が読んだ後に、ここで直されています', diff: proposalDiff(data, rec) },
      touched,
    }
  }
  // 4. 当てる（ゴミ箱の件の id は te-{提案の id}。7日の stale は見ない）
  if (rec.proposeOp === 'trash') {
    const moved = trashRecord(data, rec.table as ContentTableName, rec.targetId, {
      at: ctx.now,
      by: 'connector',
      ai: rec.ai,
      inboxId: rec.id,
      ids: inboxTrashIds(rec.id),
    })
    const next = transact(moved.data, (tx) =>
      tx.put(
        'inbox',
        settle(rec, 'accepted', ctx, { answeredVia: 'app', undo: { trashEntryId: moved.result }, message: '承認しました' }),
      ),
    ).data
    return finish(next, { status: 'accepted', message: null })
  }
  // 3. 当てた後が決まりに合わない（提案は答え待ちのまま）
  const result = patched(data, rec, target, patch, ctx)
  if ('problem' in result) return { data, result: { status: 'invalid', message: result.problem }, touched }
  const next = transact(data, (tx) => {
    tx.put(rec.table, result.next as never)
    tx.put(
      'inbox',
      settle(rec, 'accepted', ctx, { answeredVia: 'app', undo: updateUndo(target, result.next, patch), message: '承認しました' }),
    )
  }).data
  return finish(next, { status: 'accepted', message: null })
}

// ---------- 競合を選ぶ（18.5） ----------

export type ConflictResult =
  | { status: 'applied' | 'rejected'; message: string | null }
  | { status: 'invalid' | 'blocked'; message: string }

/**
 * 競合（changed・stale）の［承認］: 今の内容に patch を当てる（当てた後が決まりに合わなければ当てずに理由を返す。競合のまま）。
 * 対象がゴミ箱にある時は当てない（blocked）。対象が無ければ断る（not_found）
 */
export function approveConflict(
  data: AppData,
  id: ID,
  context: InboxContext,
): { data: AppData; result: ConflictResult; touched: Touched } {
  const ctx = resolve(context)
  const rec = data.inbox[id]
  if (!rec || rec.op === 'add' || rec.op === 'propose' || rec.status !== 'conflict')
    throw new DomainError('競合の依頼が見つかりません。')
  const touched: Touched = new Map()
  const finish = (next: AppData, result: ConflictResult) => {
    addTouched(touched, id, changedKeys(data, next))
    return { data: next, result, touched }
  }
  const target = targetOf(data, rec)
  if (!target && !(rec.table === 'routineChecks' && rec.baseHash === 'none')) {
    if (missingReason(data, rec) === 'in_trash')
      return { data, result: { status: 'blocked', message: 'ゴミ箱にあります（戻してから承認できます）' }, touched }
    const next = transact(data, (tx) =>
      tx.put('inbox', reject(rec, { reason: 'not_found', message: MESSAGES.not_found! }, ctx)),
    ).data
    return finish(next, { status: 'rejected', message: MESSAGES.not_found! })
  }
  let patch: Record<string, unknown> = {}
  if (rec.op === 'update') {
    const resolved = resolvePatch(data, rec)
    if ('problem' in resolved) return { data, result: { status: 'invalid', message: resolved.problem }, touched }
    patch = resolved.patch
    if (alreadyApplied(rec.table, target, patch)) {
      const next = acceptLinkedProposal(
        transact(data, (tx) =>
          tx.put('inbox', settle(rec, 'applied', ctx, { undo: { afterHash: revOf(target) }, message: 'もう当たっていました' })),
        ).data,
        rec,
        ctx,
      )
      return finish(next, { status: 'applied', message: 'もう当たっていました' })
    }
    const result = patched(data, rec, target, patch, ctx)
    if ('problem' in result) return { data, result: { status: 'invalid', message: result.problem }, touched }
  }
  const next = applyNow(data, rec, target, patch, ctx)
  return finish(next, { status: 'applied', message: null })
}

/** 競合の［拒否］: rejected（declined）にする。記録は変えない */
export function declineConflict(data: AppData, id: ID, context: InboxContext): { data: AppData; touched: Touched } {
  const ctx = resolve(context)
  const rec = data.inbox[id]
  if (!rec || rec.status !== 'conflict') throw new DomainError('競合の依頼が見つかりません。')
  const next = transact(data, (tx) => tx.put('inbox', reject(rec, { reason: 'declined', message: MESSAGES.declined! }, ctx))).data
  const touched: Touched = new Map()
  addTouched(touched, id, changedKeys(data, next))
  return { data: next, touched }
}

// ---------- 元に戻す（18.5） ----------

const isUpdated = (u: InboxUndo | null): u is UndoUpdated => Boolean(u && 'before' in u)

/** 元に戻せるか（できない時は画面に出す理由）。もう当たっていた依頼・断った・競合のままの依頼・会話で当たった提案は出さない */
export function canUndo(data: AppData, rec: InboxRecord): { ok: true } | { ok: false; message: string | null } {
  if (rec.undoneAt != null) return { ok: false, message: '元に戻しました' }
  if (rec.status !== 'applied' && rec.status !== 'accepted') return { ok: false, message: null }
  const u = rec.undo as unknown as Record<string, unknown> | null
  if (!u || !hasRealUndo(rec)) return { ok: false, message: null }
  if ('trashEntryId' in u) {
    const entry = data.trashEntries[u.trashEntryId as string]
    if (!entry) return { ok: false, message: 'ゴミ箱から消えています' }
    // この依頼で移したゴミ箱の件だけを戻す（ほかの件を指す記録で、作者が消した物を戻さないように）
    return entry.inboxId === rec.id ? { ok: true } : { ok: false, message: null }
  }
  const target = targetOf(data, rec)
  if (!target) {
    return missingReason(data, rec) === 'in_trash'
      ? { ok: false, message: 'ゴミ箱にあります（戻してから元に戻せます）' }
      : { ok: false, message: 'もうありません' }
  }
  // 足した物を戻せるのは、Claude が足した記録だけ（作者が作った記録を指す記録で、作者の記録をゴミ箱へ移さないように）
  if ('created' in u && (target as { by?: unknown }).by !== 'connector') return { ok: false, message: null }
  return { ok: true }
}

export type UndoResult =
  | { status: 'done'; message: string | null }
  /** 足した後・直した後に直されている。確かめてから（confirmed で）戻す */
  | { status: 'needsConfirm'; message: string; skipped: string[] }

/**
 * ［元に戻す］（1回の操作で戻す。18.5）。戻すと undoneAt を書く。
 * - 足した: 足した記録をゴミ箱へ（休みは外す・呼び名は消す）。その後に直されていたら確かめる
 * - 直した: 今の値が undo.after と同じ項目だけを undo.before に戻す。その後に直した項目は戻さず、あれば確かめる
 * - ゴミ箱へ移した: ゴミ箱から戻す
 */
export function undoRequest(
  data: AppData,
  id: ID,
  context: InboxContext,
  opts: { confirmed?: boolean } = {},
): { data: AppData; result: UndoResult; touched: Touched } {
  const ctx = resolve(context)
  const rec = data.inbox[id]
  if (!rec) throw new DomainError('依頼が見つかりません。')
  if (rec.op === 'propose' && rec.answeredVia === 'chat')
    throw new DomainError('会話で答えた提案は、その依頼の行で元に戻してください。')
  const can = canUndo(data, rec)
  if (!can.ok) throw new DomainError(can.message ?? '元に戻せません。')
  const touched: Touched = new Map()
  const markUndone = (d: AppData) =>
    transact(d, (tx) => {
      tx.put('inbox', { ...rec, undoneAt: ctx.now, updatedAt: ctx.now, message: '元に戻しました' })
      // 会話で答えた提案（この依頼で当たった）も、承認した後に元に戻した提案と同じく控えにする（同じ中身の提案をまた出さない。19.5 の 4.）
      const prop = rec.proposalId ? d.inbox[rec.proposalId] : undefined
      if (
        prop &&
        !isNewerVersion(prop) &&
        prop.op === 'propose' &&
        prop.status === 'accepted' &&
        prop.answerId === rec.id &&
        prop.undoneAt == null
      )
        tx.put('inbox', { ...prop, undoneAt: ctx.now, updatedAt: ctx.now, message: '元に戻しました' })
    }).data
  const finish = (next: AppData, result: UndoResult) => {
    addTouched(touched, id, changedKeys(data, next))
    return { data: next, result, touched }
  }
  const undo = rec.undo as unknown as Record<string, unknown>
  if ('trashEntryId' in undo) {
    const restored = restoreTrashEntry(data, undo.trashEntryId as string)
    return finish(markUndone(restored.data), { status: 'done', message: null })
  }
  const target = targetOf(data, rec)!
  if ('created' in undo) {
    if (revOf(target) !== undo.afterHash && !opts.confirmed) {
      const message =
        rec.table === 'offDays' || rec.table === 'labelNames'
          ? '足した後に直されています。元に戻しますか？'
          : '足した後に直されています。ゴミ箱へ移しますか？'
      return { data, result: { status: 'needsConfirm', message, skipped: [] }, touched }
    }
    let next: AppData
    if (rec.table === 'offDays')
      next = transact(data, (tx) => tx.put('offDays', { ...(target as OffDay), off: false, updatedAt: ctx.now })).data
    else if (rec.table === 'labelNames')
      next = transact(data, (tx) => tx.put('labelNames', { ...(target as LabelName), name: '', updatedAt: ctx.now })).data
    else
      next = trashRecord(data, rec.table as ContentTableName, rec.targetId, {
        at: ctx.now,
        ids: inboxTrashIds(`u-${rec.id}`),
      }).data
    return finish(markUndone(next), { status: 'done', message: null })
  }
  const u = rec.undo
  if (!isUpdated(u)) throw new DomainError('元に戻せません。')
  const t = target as unknown as Record<string, unknown>
  const restore: Record<string, unknown> = {}
  const skipped: string[] = []
  for (const [f, before] of Object.entries(u.before)) {
    if (matchesUndoValue(t[f] ?? null, u.after[f] ?? null)) restore[f] = before
    else skipped.push(f)
  }
  // 組の項目（日付と時刻・完了・ルーチンの指定）の一部だけを戻さない・戻すと決まりに合わなくなる項目も戻さない
  const held = holdBackUndo(rec.table, target, restore, skipped)
  if ((skipped.length > 0 || held.length > 0) && !opts.confirmed) {
    const names = (fields: readonly string[]) => [...new Set(fields.map((f) => FIELD_LABELS[f] ?? f))].join('・')
    const message =
      skipped.length > 0 && held.length > 0
        ? `その後に直された項目（${names(skipped)}）と、戻すと組み合わせが合わなくなる項目（${names(held)}）は戻しません`
        : skipped.length > 0
          ? `その後に直された項目（${names(skipped)}）は戻しません`
          : `戻すと組み合わせが合わなくなる項目（${names(held)}）は戻しません`
    return { data, result: { status: 'needsConfirm', message, skipped: [...skipped, ...held] }, touched }
  }
  let next = data
  if (Object.keys(restore).length > 0) {
    const restored = { ...target, ...restore, updatedAt: ctx.now } as Target
    // ルーチンの種類を戻したら、手で変えた時と同じく、その種類のいちばん下に並べる
    if (rec.table === 'routines' && 'cycle' in restore && restore.cycle !== (target as Routine).cycle)
      (restored as Routine).order = routineOrderFor(data, rec.targetId, restore.cycle)
    // 保存の時と同じに、日付と時刻の並びの直し（6.12 の「（書き戻す）」の3つ）を重ねて書く（形3）
    const written = rec.table === 'items' ? { ...restored, ...itemDateFixes(restored as Item) } : restored
    next = transact(data, (tx) => tx.put(rec.table, written as never)).data
  }
  const kept = skipped.length + held.length
  return finish(markUndone(next), { status: 'done', message: kept > 0 ? `${kept}項目は戻していません` : null })
}

/**
 * 元に戻す時に組で扱う項目（組のどれかを戻さない時は、ほかも戻さない。片方だけを戻して、作者が後で直した値と混ざった、表示で直される
 * 記録にしないように。18.5）
 */
const UNDO_UNITS: Partial<Record<TableName, readonly (readonly string[])[]>> = {
  items: [
    ['start', 'due', 'startTime', 'endTime'],
    ['done', 'doneAt', 'doneOn'],
  ],
  routines: [['cycle', 'weekdays', 'monthDay', 'yearMonth', 'yearDay']],
}

/**
 * 戻す項目（restore）から、戻さない項目を外して返す（restore を書き換える）: 組の項目のほかの物を戻さない（skipped・外した物）時と、
 * 戻した後の記録が決まり（6.2〜6.4・6.7）に合わなくなる時。決まりは、戻す項目と戻さない項目の組み合わせで決まる物だけで見る（直して
 * いない項目の知らない値で止めない。戻す項目だけで決まる物は、直す前の記録にもあった物（このアプリの知らない値など）なので、
 * そのまま戻す。形3）
 */
function holdBackUndo(table: TableName, target: Target, restore: Record<string, unknown>, skipped: readonly string[]): string[] {
  const held: string[] = []
  const hold = (f: string) => {
    if (!(f in restore)) return
    delete restore[f]
    held.push(f)
  }
  const units = UNDO_UNITS[table] ?? []
  for (;;) {
    const out = new Set([...skipped, ...held])
    for (const unit of units) if (unit.some((f) => out.has(f))) unit.forEach(hold)
    const next = { ...target, ...restore }
    const problems = table === 'items' ? itemProblems(next as Item) : table === 'routines' ? routineProblems(next as Routine) : []
    const bad = problems.filter((p) => p.fields.some((f) => f in restore) && p.fields.some((f) => !(f in restore)))
    if (bad.length === 0) return held
    for (const p of bad) p.fields.forEach(hold)
  }
}

// ---------- 掃除（6.14） ----------

/** 提案の対象がまだあるか（ゴミ箱にある間も、ある） */
function targetExists(data: AppData, rec: InboxRecord): boolean {
  if (targetOf(data, rec)) return true
  return rec.table !== 'offDays' && rec.table !== 'labelNames' && isInTrash(data, rec.table, rec.targetId)
}

/**
 * 受け取り箱の掃除（6.14・19.5）。ストアが1日1回ほど呼ぶ。消した記録は削除の印として送る（6.11 で片付く）。
 * - 処理して 90日たった記録（依頼の applied・rejected、提案の accepted・superseded・rejected）は消す
 * - conflict は 90日たっても選ばれなければ当てずに rejected（expired）
 * - declined・expired の提案と、承認した後に元に戻した提案（accepted で undoneAt がある）は、対象の記録がある間は消さない（同じ中身の
 *   提案をまた出さない控え）。対象が無くなったら、ほかと同じく処理して 90日たった時に消す
 * - pending は消さない（答えの無い提案は processInbox が 30日で expired にする）
 */
export function cleanupInbox(data: AppData, context: InboxContext): { data: AppData; touched: Touched } {
  const ctx = resolve(context)
  const touched: Touched = new Map()
  const next = transact(data, (tx) => {
    for (const rec of Object.values(data.inbox)) {
      if (isNewerVersion(rec) || rec.status === 'pending' || typeof rec.appliedAt !== 'number') continue
      const age = ctx.now - rec.appliedAt
      if (rec.status === 'conflict') {
        if (age >= INBOX_KEEP_MS) tx.put('inbox', reject(rec, { reason: 'expired', message: MESSAGES.expired! }, ctx))
        continue
      }
      if (rec.op === 'propose' && declinedLike(rec)) {
        if (targetExists(data, rec)) continue
      }
      if (age >= INBOX_KEEP_MS) tx.delete('inbox', rec.id)
    }
  }).data
  const keys = changedKeys(data, next)
  for (const key of keys) addTouched(touched, key.slice('inbox/'.length), [key])
  return { data: keys.length > 0 ? next : data, touched }
}
