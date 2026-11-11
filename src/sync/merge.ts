// 同期の3者マージ（docs/SPEC.md の 2.4・6.10）。
// base   = 最後にクラウドと揃えた時の内容（null = その時クラウドに無かった）
// mine   = この端末の内容（null = この端末で削除した）
// theirs = クラウドの最新の内容（null = 別の端末で削除された）
// 項目ごとに、この端末が base から変えた項目だけをクラウド側に重ねる。
// NS の src/sync/merge.ts の仕組み（mergeRemote・mergeFields・mergeUnrelated・mergeList・unionList・insertMissing・joinConflictText）を
// そのまま写し、表ごとの指定を DS の表で書き直した（6.10）。足した仕組みは4つ:
// - 1組の項目（FIELD_GROUPS）: items の done・doneAt・doneOn は、変えた側の3つをまとめて採る（両方で変えたらこの端末）
// - 受け取り箱（inbox）の結果の組: 両方で変えたら 6.10 の強い方の組をまとめて採る（src/domain/inbox.ts の combineInboxOutcomes）
// - 並べ直し（NORMALIZE）: routines.weekdays・routineChecks.dates は、要素ごとに合わせた時だけ小さい順・重なりなしにする（知らない値は残す）
// - MIM の欄（mimNotes の secrets・qrs）: 1つの欄の中身を両方で変えていたら、この端末の中身を採り、相手の記録を overwritten で返す
//   （呼び出し側がゴミ箱に「同期の競合で残した内容」として控える。パスワードを2つつながないように）
import { contentEqual, deepEqual, stableStringify } from '../domain/equal'
import { combineInboxOutcomes, inboxGroupFields } from '../domain/inbox'
import { normalizeDatesKeeping, normalizeKeeping } from '../domain/routines'
import type { InboxRecord, TableName } from '../domain/types'
import type { Rec } from './codec'

export { contentEqual, deepEqual, stableStringify }
export type { Rec }

type KeyOf = (item: unknown) => string

const asString: KeyOf = (x) => String(x)
const byId: KeyOf = (x) => String((x as { id?: unknown })?.id)

/**
 * 並び（ID の一覧など）として合わせる項目（6.10）。両方の端末で変わっていたら、この端末の並びを基本に、
 * 相手が消したものを除き、相手が足したものを相手の並びでの直前の要素の後ろに入れる。
 */
export const LIST_FIELDS: Partial<Record<TableName, Record<string, KeyOf>>> = {
  // 毎週の曜日（値で。マージの後に小さい順に並べ直す）
  routines: { weekdays: asString },
  // チェックした日（値で。マージの後に小さい順に並べ直す。2台で別々に付けても両方残り、片方で外せば外れる）
  routineChecks: { dates: asString },
  // MIM の伏せる欄・QR の欄（id で。1つの欄の中身の競合は mergeMimFields）
  mimNotes: { secrets: byId, qrs: byId },
  trashEntries: { recordIds: asString },
}

/** MIM の欄（1つの欄の中身を両方で変えたら、この端末の中身を採って相手の記録を控える。6.10） */
const MIM_FIELDS: ReadonlySet<string> = new Set(['secrets', 'qrs'])

/**
 * 片方で削除・片方で編集された時に、編集された内容をゴミ箱に残す表（6.10 の TEXT_TABLES）。
 * routineChecks は入れない（親のルーチンが消えたら控えずに片付ける）。
 */
export const TEXT_TABLES: ReadonlySet<TableName> = new Set<TableName>(['items', 'routines', 'favorites', 'mimNotes'])

/**
 * 長い文章の項目（6.10 の TEXT_FIELDS）。両方の端末で別々に書き換えていたら、どちらも捨てずに、クラウド側の文章の後ろに
 * この端末の文章を印付きで続ける（その場で両方が見え、利用者が整理できる）。
 */
export const TEXT_FIELDS: Partial<Record<TableName, readonly string[]>> = {
  items: ['memo'],
  favorites: ['text'],
  mimNotes: ['body'],
}

/** 1組として扱う項目（変えた側の組をまとめて採る。両方で変えたらこの端末。6.10） */
export const FIELD_GROUPS: Partial<Record<TableName, readonly (readonly string[])[]>> = {
  items: [['done', 'doneAt', 'doneOn']],
}

/**
 * マージの後に並べ直す項目（6.10）。並べ直すのは、そのマージで両方の端末が変えて要素ごとに合わせた並び（と、共通の履歴が無くて足し合わせた
 * 並び）だけ。知っている形の値（曜日 0〜6・YYYY-MM-DD）だけを小さい順に並べて重なりを除き、知らない値は捨てずに後ろに残す（形3:
 * 新しい版が足した値を、古い版のマージが全端末から消さないように）
 */
export const NORMALIZE: Partial<Record<TableName, Record<string, (v: unknown[]) => unknown[]>>> = {
  routines: { weekdays: (v) => normalizeKeeping(v, isWeekday, (a, b) => a - b) },
  routineChecks: { dates: normalizeDatesKeeping },
}

const isWeekday = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= 6

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

/** primary の並びに、secondary にしか無い要素を、secondary での直前の要素の後ろに入れる */
function insertMissing(out: unknown[], seen: Set<string>, secondary: unknown[], skip: Set<string>, key: KeyOf): void {
  secondary.forEach((y, i) => {
    const k = key(y)
    if (seen.has(k) || skip.has(k)) return
    let pos = 0
    for (let j = i - 1; j >= 0; j--) {
      const pk = key(secondary[j])
      const idx = out.findIndex((z) => key(z) === pk)
      if (idx >= 0) {
        pos = idx + 1
        break
      }
    }
    out.splice(pos, 0, y)
    seen.add(k)
  })
}

export function mergeList(base: unknown, mine: unknown, theirs: unknown, key: KeyOf): unknown[] {
  if (deepEqual(mine, base)) return asArray(theirs)
  if (deepEqual(theirs, base)) return asArray(mine)
  const b = asArray(base)
  const m = asArray(mine)
  const t = asArray(theirs)
  const baseItems = new Map(b.map((x) => [key(x), x]))
  const theirItems = new Map(t.map((x) => [key(x), x]))
  const out: unknown[] = []
  const seen = new Set<string>()
  for (const x of m) {
    const k = key(x)
    if (seen.has(k)) continue
    // 相手が消したものは除く
    if (baseItems.has(k) && !theirItems.has(k)) continue
    seen.add(k)
    // 中身を持つ要素は、この端末で変えていなければ相手の中身を使う
    const bx = baseItems.get(k)
    const tx = theirItems.get(k)
    out.push(tx !== undefined && bx !== undefined && deepEqual(x, bx) ? tx : x)
  }
  // 相手が足したもの（この端末で消したものは足さない）
  insertMissing(out, seen, t, new Set(baseItems.keys()), key)
  return out
}

/**
 * MIM の欄（secrets・qrs）を合わせる（6.10）。並びは mergeList と同じ。1つの欄の中身を両方で別々に変えていたら、この端末の中身を採り、
 * conflict を true にする（呼び出し側が相手の記録をゴミ箱に控える）。片方で消し・片方で中身を変えた欄は、変えた中身を残す
 * （パスワードなどを黙って失わないように）
 */
export function mergeMimFields(base: unknown, mine: unknown, theirs: unknown): { list: unknown[]; conflict: boolean } {
  if (deepEqual(mine, base)) return { list: asArray(theirs), conflict: false }
  if (deepEqual(theirs, base)) return { list: asArray(mine), conflict: false }
  const b = new Map(asArray(base).map((x) => [byId(x), x]))
  const m = new Map(asArray(mine).map((x) => [byId(x), x]))
  const t = new Map(asArray(theirs).map((x) => [byId(x), x]))
  const out = mergeList(base, mine, theirs, byId)
  const seen = new Set(out.map(byId))
  let conflict = false
  const chosen = new Map<string, unknown>()
  for (const k of new Set([...b.keys(), ...m.keys(), ...t.keys()])) {
    const bx = b.get(k)
    const mx = m.get(k)
    const tx = t.get(k)
    if (bx === undefined) {
      if (mx !== undefined && tx !== undefined && !deepEqual(mx, tx)) conflict = true
      if (mx !== undefined) chosen.set(k, mx)
      else if (tx !== undefined) chosen.set(k, tx)
      continue
    }
    const mChanged = mx === undefined || !deepEqual(mx, bx)
    const tChanged = tx === undefined || !deepEqual(tx, bx)
    if (!mChanged) {
      if (tx !== undefined) chosen.set(k, tx)
      continue
    }
    if (!tChanged) {
      if (mx !== undefined) chosen.set(k, mx)
      continue
    }
    if (mx !== undefined && tx !== undefined) {
      if (!deepEqual(mx, tx)) conflict = true
      chosen.set(k, mx)
    } else if (mx !== undefined) chosen.set(k, mx)
    else if (tx !== undefined) chosen.set(k, tx)
  }
  // 片方で消し・片方で変えた欄（mergeList では消える）を、元の並びの位置に戻す
  const dropped = new Set([...b.keys(), ...m.keys(), ...t.keys()].filter((k) => !chosen.has(k)))
  insertMissing(out, seen, asArray(mine), dropped, byId)
  insertMissing(out, seen, asArray(theirs), dropped, byId)
  const list = out.filter((x) => chosen.has(byId(x))).map((x) => chosen.get(byId(x)))
  return { list, conflict }
}

/** 共通の履歴が無い2つの並びを合わせる: primary の並びに、secondary にしか無い要素を足す */
export function unionList(primary: unknown, secondary: unknown, key: KeyOf): unknown[] {
  const out: unknown[] = []
  const seen = new Set<string>()
  for (const x of asArray(primary)) {
    const k = key(x)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(x)
  }
  insertMissing(out, seen, asArray(secondary), new Set(), key)
  return out
}

export function joinConflictText(theirs: string, mine: string, device: string): string {
  return `${theirs}\n\n――――（同期の競合: ${device}で同時に書かれた内容）――――\n${mine}`
}

export interface MergeOptions {
  /** この端末の呼び名（文章をつないだ時の印に使う） */
  device: string
}

export interface FieldMerge {
  record: Rec
  /** 両方の文章をつないだ項目 */
  joined: string[]
  /** MIM の欄の中身が両方で変わっていて、この端末の中身を採った（相手の記録を控える） */
  overwritten?: Rec
}

const pick = (r: Record<string, unknown>, fields: readonly string[]) => fields.map((f) => r[f])

/** 並べ直しを当てる（6.10。fields は要素ごとに合わせた項目） */
function normalize(table: TableName, out: Record<string, unknown>, fields: ReadonlySet<string>): void {
  for (const [field, fn] of Object.entries(NORMALIZE[table] ?? {})) {
    if (fields.has(field) && Array.isArray(out[field])) out[field] = fn(out[field] as unknown[])
  }
}

/** 受け取り箱の結果の組（6.10）。両方で変えていたら強い方の組。片方だけなら変えた側の組 */
function mergeInboxGroup(
  out: Record<string, unknown>,
  b: Record<string, unknown> | null,
  m: Record<string, unknown>,
  t: Record<string, unknown>,
): void {
  const fields = inboxGroupFields(m as unknown as InboxRecord) as readonly string[]
  const mChanged = !b || !deepEqual(pick(m, fields), pick(b, fields))
  const tChanged = !b || !deepEqual(pick(t, fields), pick(b, fields))
  let src: Record<string, unknown>
  if (!mChanged) src = t
  else if (!tChanged) src = m
  else src = combineInboxOutcomes(m as unknown as InboxRecord, t as unknown as InboxRecord) as unknown as Record<string, unknown>
  for (const f of fields) {
    if (src[f] === undefined) delete out[f]
    else out[f] = src[f]
  }
  // 元に戻した日時は、入っている方（6.10）
  const undone = out.undoneAt ?? m.undoneAt ?? t.undoneAt
  if (undone !== undefined) out.undoneAt = undone
}

/**
 * 両方にあるレコードを項目ごとに合わせる。同じ項目を両方が別々に変えていたら、並びは要素ごとに合わせ、
 * 長い文章はつなぎ、それ以外はこの端末を優先する。
 */
export function mergeFields(table: TableName, base: Rec | null, mine: Rec, theirs: Rec, opts: MergeOptions): FieldMerge {
  const out: Record<string, unknown> = { ...theirs }
  const b = (base ?? {}) as Record<string, unknown>
  const m = mine as unknown as Record<string, unknown>
  const t = theirs as unknown as Record<string, unknown>
  const joined: string[] = []
  const listMerged = new Set<string>()
  let overwritten: Rec | undefined
  const groups = FIELD_GROUPS[table] ?? []
  const grouped = new Set(groups.flat())
  const inboxFields = table === 'inbox' ? new Set<string>([...inboxGroupFields(m as never), 'undoneAt']) : new Set<string>()
  const keys = new Set([...Object.keys(m), ...Object.keys(b)])
  for (const k of keys) {
    if (k === 'id' || k === 'updatedAt' || grouped.has(k) || inboxFields.has(k)) continue
    const mv = m[k]
    const bv = b[k]
    const tv = t[k]
    if (deepEqual(mv, bv)) continue
    if (deepEqual(tv, bv) || deepEqual(tv, mv)) {
      out[k] = mv
    } else {
      const listKey = LIST_FIELDS[table]?.[k]
      if (table === 'mimNotes' && MIM_FIELDS.has(k)) {
        const r = mergeMimFields(bv, mv, tv)
        out[k] = r.list
        if (r.conflict) overwritten = theirs
      } else if (listKey) {
        out[k] = mergeList(bv, mv, tv, listKey)
        listMerged.add(k)
      } else if (TEXT_FIELDS[table]?.includes(k) && typeof mv === 'string' && typeof tv === 'string') {
        out[k] = joinConflictText(tv, mv, opts.device)
        joined.push(k)
      } else out[k] = mv
    }
    if (out[k] === undefined) delete out[k]
  }
  // 1組の項目: 変えた側の組をまとめて採る（両方で変えたらこの端末）
  for (const fields of groups) {
    const mChanged = !deepEqual(pick(m, fields), pick(b, fields))
    if (!mChanged) continue
    for (const f of fields) {
      if (m[f] === undefined) delete out[f]
      else out[f] = m[f]
    }
  }
  if (table === 'inbox') mergeInboxGroup(out, base as Record<string, unknown> | null, m, t)
  normalize(table, out, listMerged)
  if (mine.updatedAt !== undefined || theirs.updatedAt !== undefined)
    out.updatedAt = Math.max(mine.updatedAt ?? 0, theirs.updatedAt ?? 0)
  return { record: out as Rec, joined, ...(overwritten ? { overwritten } : {}) }
}

export interface MergeResult {
  /** 合わせた結果（null = 削除） */
  record: Rec | null
  /** 片方で削除・片方で編集されていた: 削除を優先し、編集された内容をここに返す（TEXT_TABLES ならゴミ箱へ） */
  deletedEdit?: Rec
  /** 共通の履歴が無く、クラウド側を採った時のこの端末の内容（TEXT_TABLES ならゴミ箱へ） */
  keptCopy?: Rec
  /** MIM の欄の中身が両方で変わっていて、この端末の中身を採った時の相手の記録（ゴミ箱へ） */
  overwritten?: Rec
  /** 両方の文章をつないだ項目 */
  joined?: string[]
}

/**
 * 共通の履歴が無い（初めてのログイン・アカウントの切り替えで、この端末の内容をクラウドの内容と突き合わせる）時。
 * クラウド側を正とし、この端末にしか無い文章は控える。並びにはこの端末にしか無い要素を足す。
 */
function mergeUnrelated(table: TableName, mine: Rec | null, theirs: Rec | null): MergeResult {
  if (!mine) return { record: theirs }
  // クラウドで削除されていた: 削除を優先し、この端末の内容は控える
  if (!theirs) return { record: null, deletedEdit: mine }
  if (contentEqual(mine, theirs)) return { record: theirs }
  const out: Record<string, unknown> = { ...theirs }
  const m = mine as unknown as Record<string, unknown>
  const united = new Set<string>()
  for (const [field, key] of Object.entries(LIST_FIELDS[table] ?? {})) {
    if (!(field in out || field in m)) continue
    // MIM の欄はクラウドのまま（この端末の内容はまるごと控える）
    if (table === 'mimNotes' && MIM_FIELDS.has(field)) continue
    // 同じ並びなら足し合わせない（並べ直しもしない）
    if (deepEqual(out[field], m[field])) continue
    out[field] = unionList(out[field], m[field], key)
    united.add(field)
  }
  // 受け取り箱の結果の組は、強い方（6.10）
  if (table === 'inbox') mergeInboxGroup(out, null, m, out)
  normalize(table, out, united)
  const result: MergeResult = { record: out as Rec }
  if (TEXT_TABLES.has(table) && !contentEqual(mine, result.record)) result.keptCopy = mine
  return result
}

export function mergeRemote(
  table: TableName,
  base: Rec | null,
  mine: Rec | null,
  theirs: Rec | null,
  opts: MergeOptions & { noHistory?: boolean },
): MergeResult {
  if (opts.noHistory) return mergeUnrelated(table, mine, theirs)
  if (contentEqual(mine, base)) return { record: theirs }
  // 同じ内容になっていれば、クラウドの内容をそのまま使う（端末内とクラウドを完全に揃えるため）
  if (contentEqual(theirs, mine)) return { record: theirs }
  if (contentEqual(theirs, base)) return { record: mine }
  if (!mine) {
    // この端末で削除・別の端末で編集
    return theirs ? { record: null, deletedEdit: theirs } : { record: null }
  }
  if (!theirs) {
    // 別の端末で削除・この端末で編集（クラウドに無かったものはこの端末で作ったものなので残す）
    return base ? { record: null, deletedEdit: mine } : { record: mine }
  }
  const { record, joined, overwritten } = mergeFields(table, base, mine, theirs, opts)
  const result: MergeResult = { record }
  if (joined.length) result.joined = joined
  if (overwritten) result.overwritten = overwritten
  return result
}

/**
 * 同期の規則を使わない時（控えの作り方を渡さずに保存した時）の3者マージ: base から mine で変えた項目だけを
 * theirs に重ね、同じ項目を両方が変えていたらこの端末を優先する。
 */
export function mergeRecordLegacy(base: Rec, mine: Rec, theirs: Rec, table?: TableName): Rec {
  if (table) return mergeFields(table, base, mine, theirs, { device: 'この端末' }).record
  const out: Record<string, unknown> = { ...theirs }
  const b = base as unknown as Record<string, unknown>
  const m = mine as unknown as Record<string, unknown>
  for (const key of Object.keys(m)) {
    if (key === 'updatedAt') continue
    if (!deepEqual(m[key], b[key])) out[key] = m[key]
  }
  out.updatedAt = Math.max(mine.updatedAt ?? 0, theirs.updatedAt ?? 0)
  return out as Rec
}
