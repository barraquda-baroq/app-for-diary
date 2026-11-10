// データの型・表の一覧（docs/SPEC.md の 2.9・6.）。端末の中（Dexie v1）とクラウドの記録は、この形で持つ。
// 段階1の終わりでデータの形を固める（19.8）ので、AI 連携の下地（by・ai・via・受け取り箱・内容から作る id・MIM の表を分けること）も
// ここで全部入れる。NS の src/domain/types.ts の AppData・TableName・TABLE_NAMES・emptyData・TrashEntry・TrashRecord・DomainError の
// 作りだけを写し、小説の型は持ち込まない。
// このファイルと src/domain の下は、sync・store・Firebase・React を import しない（段階6のコネクタが同じ計算を使うため）。

export type ID = string

/** 決まりの上でできない操作（画面ではエラーのお知らせにする。src/store/uiStore.ts の attempt） */
export class DomainError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DomainError'
  }
}

// ---------- 共通の項目（6.1） ----------

/** 誰が作ったか（手／コネクタ）。作った時の値のまま変えない（Claude が直しても 'user' のまま。I6） */
export type By = 'user' | 'connector'

/** 記録の出どころ（すべての記録が持つ。6.1・19.3） */
export interface Provenance {
  by: By
  /** どの AI か（今は 'claude' だけ。手は null。知らない値は「AI」と出す。I6） */
  ai: string | null
  /** 出どころのメモ（0〜500字。手で作った物は null、コネクタから足した物は必ず入る。19.4） */
  via: string | null
}

/** 中身の表（items・routines・favorites・mimNotes）の記録の共通の項目（6.1） */
export interface ContentBase extends Provenance {
  /** 手で作った物は crypto.randomUUID()、受け取り箱から足した物は内容から作る id（19.4。src/domain/derivedId.ts） */
  id: ID
  /** 記録の形の版（今は 1） */
  v: number
  /** 作った・直した日時（Date.now() のミリ秒。UTC。6.4） */
  createdAt: number
  updatedAt: number
}

/** 記録の形の版（中身の表と受け取り箱。6.1・6.14） */
export const RECORD_VERSION = 1

// ---------- 項目（6.2） ----------

/** 区分（仕事／プライベート） */
export type ItemKind = 'work' | 'private'
export const ITEM_KINDS: readonly ItemKind[] = ['work', 'private']

/** 生まれ（カレンダーで入れたか、Task List で入れたか。後から変えない。6.3） */
export type ItemOrigin = 'calendar' | 'list'
export const ITEM_ORIGINS: readonly ItemOrigin[] = ['calendar', 'list']

/** 予定・タスク（同じ1件。6.2） */
export interface Item extends ContentBase {
  kind: ItemKind
  /** 件名（1〜200字） */
  title: string
  origin: ItemOrigin
  /** 開始日 'YYYY-MM-DD'（calendar 生まれは必ずある） */
  start: string | null
  /** 締め切り日 'YYYY-MM-DD' */
  due: string | null
  /** 開始時刻 'HH:MM' */
  startTime: string | null
  /** 終了時刻 'HH:MM'（'24:00' も持てる。startTime が無い時は持てない。6.4） */
  endTime: string | null
  /** Task List に出すか（list 生まれは初め true、calendar 生まれは初め false） */
  listed: boolean
  /** 完了（予定全体で1回）。done・doneAt・doneOn は1組（6.10） */
  done: boolean
  doneAt: number | null
  /** 完了にした日（端末の暦の 'YYYY-MM-DD'） */
  doneOn: string | null
  locked: boolean
  /** ラベルのキー（4.6。src/domain/labels.ts）。null はラベルなし */
  label: string | null
  /** 依頼者（0〜60字。空はなし） */
  requester: string
  /** メモ（長さの制限なし） */
  memo: string
  /** 同じ日の中の手での並び（今は使わない。作った時の Date.now()。依頼から作った物は依頼の createdAt） */
  order: number
}

// ---------- 休み・ラベルの呼び名（6.5・6.6） ----------

/** 休み（1日 = 1記録。id は日付。付ける・外すは off を切り替え、記録は消さない。ゴミ箱に入れない） */
export interface OffDay extends Provenance {
  id: string
  date: string
  off: boolean
  updatedAt: number
}

/** ラベルの呼び名（1色 = 1記録。id はラベルのキー。name は 0〜12字（空は名前なし）。消す時も空にするだけ） */
export interface LabelName extends Provenance {
  id: string
  name: string
  updatedAt: number
}

// ---------- ルーチン（6.7） ----------

/** ルーチンの種類（毎日・毎週・毎月・四半期・毎年） */
export type RoutineCycle = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly'
export const ROUTINE_CYCLES: readonly RoutineCycle[] = ['daily', 'weekly', 'monthly', 'quarterly', 'yearly']

export interface Routine extends ContentBase {
  /** 1〜200字 */
  title: string
  cycle: RoutineCycle
  /** 毎週の曜日（0＝日〜6＝土。小さい順・重なりなし）。[] は指定なし。毎週以外は [] */
  weekdays: number[]
  /** 毎月の日（1〜31）。null は指定なし。毎月以外は null */
  monthDay: number | null
  /** 毎年の月日（1〜12・1〜31）。両方 null は指定なし。毎年以外は null */
  yearMonth: number | null
  yearDay: number | null
  /** 種類の中の並び（小さいほど上） */
  order: number
}

/** ルーチンのチェックの記録（1ルーチン×1か月。id は {routineId}:{YYYY-MM}） */
export interface RoutineCheck extends Provenance {
  id: string
  routineId: ID
  /** 'YYYY-MM' */
  month: string
  /** その月にチェックした日（'YYYY-MM-DD'。小さい順・重なりなし） */
  dates: string[]
  updatedAt: number
}

// ---------- やりたいこと・MIM（6.8・6.9） ----------

export interface Favorite extends ContentBase {
  /** 中身（改行できる。1字以上、長さの制限なし） */
  text: string
  done: boolean
  doneAt: number | null
  /** 並び（小さいほど上。新しい物は今のいちばん小さい値 − 1） */
  order: number
}

/** MIM の伏せる欄（name 0〜40字・value 0〜2,000字） */
export interface MimSecret {
  id: ID
  name: string
  value: string
}

/** MIM の QR の欄（caption 0〜40字・text は UTF-8 で 2,953 バイトまで） */
export interface MimQr {
  id: ID
  caption: string
  text: string
}

/** MIM のメモ（コネクタからは読めない・書けない。by はいつも 'user'。D8・I6） */
export interface MimNote extends ContentBase {
  /** 題名（0〜100字。空は「無題」と出す） */
  title: string
  body: string
  secrets: MimSecret[]
  qrs: MimQr[]
  order: number
}

// ---------- 受け取り箱（6.14） ----------

/** 受け取り箱の種類: 足す・直す・ゴミ箱へ移す（ここまでが依頼）・提案する */
export type InboxOp = 'add' | 'update' | 'trash' | 'propose'
export const INBOX_OPS: readonly InboxOp[] = ['add', 'update', 'trash', 'propose']

/** 提案の種類（直す提案・ゴミ箱へ移す提案） */
export type ProposeOp = 'update' | 'trash'

/** 依頼・提案が指せる表（mimNotes・ゴミ箱・inbox は指せない。X3） */
export type InboxTable = 'items' | 'favorites' | 'routines' | 'routineChecks' | 'offDays' | 'labelNames'
export const INBOX_TABLES: readonly InboxTable[] = ['items', 'favorites', 'routines', 'routineChecks', 'offDays', 'labelNames']

/** 依頼の状態: 待っている・当てた・競合・断った */
export type RequestStatus = 'pending' | 'applied' | 'conflict' | 'rejected'
/** 提案の状態: 答え待ち・当てた・当てない・取り下げた・30日答えが無かった・受け付けなかった */
export type ProposalStatus = 'pending' | 'accepted' | 'declined' | 'superseded' | 'expired' | 'rejected'
export type InboxStatus = RequestStatus | ProposalStatus

/** 競合・断った理由と、提案の取り下げ・受け付けなかった理由（6.14） */
export type InboxReason =
  | 'changed'
  | 'stale'
  | 'duplicate'
  | 'previously_deleted'
  | 'not_found'
  | 'in_trash'
  | 'invalid'
  | 'not_allowed'
  | 'proposal_mismatch'
  | 'declined'
  | 'expired'
  | 'replaced'
  | 'already_done'
  | 'previously_declined'

/**
 * 元に戻すための控え（当てた時にアプリが書く。6.14）。
 * - 足した: { created: true, afterHash }
 * - 直した: { before, after, beforeHash, afterHash }（after の 200字を超える値は指紋。before は値のまま）
 * - もう当たっていた: { afterHash } だけ（戻す値は無い）
 * - ゴミ箱へ移した: { trashEntryId }
 * 指紋はどれも src/domain/hash.ts の revOf（updatedAt と order を除いた内容の指紋。形2）
 */
export type InboxUndo = UndoCreated | UndoUpdated | UndoAlready | UndoTrashed

export interface UndoCreated {
  created: true
  afterHash: string
}

export interface UndoUpdated {
  before: Record<string, unknown>
  after: Record<string, unknown>
  beforeHash: string
  afterHash: string
}

export interface UndoAlready {
  afterHash: string
}

export interface UndoTrashed {
  trashEntryId: ID
}

/** 受け取り箱の1件（依頼と提案。コネクタが作り、アプリが書き換える。6.14） */
export interface InboxRecord {
  /** 足す依頼は xa-{uuid}、直す・ゴミ箱へ移す依頼は xe-{uuid}、提案は xp-{uuid} */
  id: ID
  /** 依頼の形の版（今は 1。これより新しい版の依頼は触らずに残す） */
  v: number
  op: InboxOp
  /** propose の時だけ。ほかは null */
  proposeOp: ProposeOp | null
  table: InboxTable
  /** add では作る記録の id、ほかは直す・移す記録の id */
  targetId: ID
  /** Claude が読んだ時の指紋（revOf）・'after:{依頼の id}'・'none'（routineChecks の記録がまだ無い時）。add は null */
  baseHash: string | null
  /** add: 作る中身。update と直す提案: 変える項目と新しい値。trash とゴミ箱へ移す提案: null */
  patch: Record<string, unknown> | null
  /** add の出どころの鍵（メールの Message-ID など。200字まで） */
  sourceKey: string | null
  /** 作者が頼んだ言葉（1〜500字）。update・trash は必須、add は会話の時だけ、propose はいつも null */
  requestQuote: string | null
  /** 提案の理由（1〜500字）。propose は必須、ほかは null */
  why: string | null
  /** 会話で提案に答えた update・trash の時の、その提案の id（xp-…） */
  proposalId: ID | null
  by: 'connector'
  ai: string
  via: string | null
  createdAt: number
  updatedAt: number
  status: InboxStatus
  reason: InboxReason | null
  message: string | null
  /** アプリが処理した日時（提案は pending でなくなった日時） */
  appliedAt: number | null
  answeredVia: 'app' | 'chat' | null
  answerId: ID | null
  supersededBy: ID | null
  undo: InboxUndo | null
  undoneAt: number | null
}

// ---------- ゴミ箱（6.15） ----------

/** ゴミ箱の種類（予定・タスク・やりたいこと・済みのやりたいこと・ルーチン・MIM のメモ） */
export type TrashKind = 'event' | 'task' | 'favorite' | 'favoritesDone' | 'routine' | 'mimNote'

/**
 * 削除した時点の場所（戻す時はここへ戻す）。NS の TrashOrigin の、並びの部分だけ。
 * index は order の値（無い・分からない時は -1）、prevId は並びの中で直前にあった記録の id（先頭なら null）
 */
export interface TrashOrigin {
  index: number
  prevId: ID | null
}

/**
 * ゴミ箱の1件（削除の単位。ルーチンはチェックの記録ごと1件）。中身は1件ずつ trashRecords に入れる。30日で中身ごと消す。
 * 依頼・提案で移した時の id は te-{受け取り箱の id}（中身は tr-{id}・tr-{id}-{i}。2台が同じ依頼を当てても1件。19.5）
 */
export interface TrashEntry {
  id: ID
  kind: TrashKind
  /** 一覧に出す名前（削除した時点の件名など） */
  label: string
  /** 場所の表記（「カレンダー 11/10（火） 仕事」「Task List」「Favorite List」「Routine List › 毎週」「MIM」） */
  place: string
  origin: TrashOrigin
  /** 中身（trashRecords の id）。先頭が削除したもの本体 */
  recordIds: ID[]
  /** deleted = 消した。conflict = 同期で片方が消し、片方が直していたので、直した内容を控えた（同じ id が残っていれば複製で戻す） */
  reason: 'deleted' | 'conflict'
  /** 誰が移したか（Claude の依頼・提案で移した時は 'connector'） */
  by: By
  ai: string | null
  /** Claude の依頼・提案で移した時の受け取り箱の id（札の「Claude の依頼」「Claude の提案」を決める。ほかは null） */
  inboxId: ID | null
  deletedAt: number
  createdAt: number
  updatedAt: number
}

/** ゴミ箱の中身の1件（削除した時点の記録そのもの） */
export interface TrashRecord {
  id: ID
  entryId: ID
  table: TrashTableName
  /** 元の記録（id もそのまま） */
  record: TrashableRecord
  createdAt: number
  updatedAt: number
}

// ---------- 表の一覧 ----------

/** 端末の中の全部の記録（表 → id → 記録） */
export interface AppData {
  items: Record<ID, Item>
  offDays: Record<ID, OffDay>
  labelNames: Record<ID, LabelName>
  routines: Record<ID, Routine>
  routineChecks: Record<ID, RoutineCheck>
  favorites: Record<ID, Favorite>
  mimNotes: Record<ID, MimNote>
  inbox: Record<ID, InboxRecord>
  trashEntries: Record<ID, TrashEntry>
  trashRecords: Record<ID, TrashRecord>
}

export type TableName = keyof AppData

/** 表の一覧（並びを固定する。Dexie v1 の表の並び・バックアップの表の並びと同じ） */
export const TABLE_NAMES: readonly TableName[] = [
  'items',
  'offDays',
  'labelNames',
  'routines',
  'routineChecks',
  'favorites',
  'mimNotes',
  'inbox',
  'trashEntries',
  'trashRecords',
]

/** 中身の表（v・createdAt を持ち、order で並ぶ。6.1） */
export type ContentTableName = 'items' | 'routines' | 'favorites' | 'mimNotes'
export const CONTENT_TABLES: readonly ContentTableName[] = ['items', 'routines', 'favorites', 'mimNotes']

/** ゴミ箱に入る表（中身の表と、ルーチンといっしょに入るチェックの記録） */
export type TrashTableName = ContentTableName | 'routineChecks'
export const TRASH_TABLES: readonly TrashTableName[] = ['items', 'routines', 'routineChecks', 'favorites', 'mimNotes']

/** ゴミ箱に入る記録 */
export type TrashableRecord = AppData[TrashTableName][string]

/** どの表の記録でもよい時の型 */
export type AnyRecord = AppData[TableName][string]

/** 内容から作る id を使う表（Claude から足す時。19.4） */
export type DerivedTableName = 'items' | 'favorites' | 'routines'

export function emptyData(): AppData {
  return {
    items: {},
    offDays: {},
    labelNames: {},
    routines: {},
    routineChecks: {},
    favorites: {},
    mimNotes: {},
    inbox: {},
    trashEntries: {},
    trashRecords: {},
  }
}

export function isTableName(v: unknown): v is TableName {
  return typeof v === 'string' && (TABLE_NAMES as readonly string[]).includes(v)
}

export function isTrashTable(v: unknown): v is TrashTableName {
  return typeof v === 'string' && (TRASH_TABLES as readonly string[]).includes(v)
}

// ---------- 文字数の上限（6.1〜6.9・6.14・19.4） ----------

/** 文字数は Unicode の文字（コードポイント）で、前後の空白を除いて数える（src/domain/util.ts の charCount） */
export const LIMITS = {
  /** 件名（予定・タスク・ルーチン） */
  title: 200,
  /** 依頼者 */
  requester: 60,
  /** ラベルの呼び名 */
  labelName: 12,
  /** MIM の題名 */
  mimTitle: 100,
  /** MIM の伏せる欄の名前・QR の欄の説明 */
  fieldName: 40,
  /** MIM の伏せる欄の値 */
  secretValue: 2000,
  /** MIM の QR の欄の中身（UTF-8 のバイト数） */
  qrBytes: 2953,
  /** 出どころのメモ・頼んだ言葉・提案の理由 */
  via: 500,
  requestQuote: 500,
  why: 500,
  /** 出どころの鍵 */
  sourceKey: 200,
  /** 依頼で入れるメモ・やりたいことの中身 */
  requestText: 100_000,
  /** 受け取り箱の1件の JSON（コネクタが作る時） */
  inboxJson: 200_000,
  /** AI の名前（英小文字・数字・'-'） */
  ai: 20,
} as const
