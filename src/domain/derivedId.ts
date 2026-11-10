// 内容から作る id（docs/SPEC.md の 19.4）。Claude（受け取り箱の足す依頼）から足す予定・タスク・やりたいこと・ルーチンの id を、
// 内容（か出どころの鍵）から作る。同じ内容からは必ず同じ id になるので、同じ物を2回足そうとしても「もうあります」になり、
// 2台の端末が同じ依頼を当てても1件になる。コネクタ（段階6）とアプリは、このファイルの同じ計算を使う。
// 形: `c` + 種類の1文字（e＝予定・t＝タスク・f＝やりたいこと・r＝ルーチン）+ `-` + 指紋（hashJson。[0-9a-z.]）。
// 手で作った記録の id（crypto.randomUUID）とは重ならない。NS の src/claude/derivedId.ts の考え方（hashJson・c?- の形）だけを借り、
// 材料は 19.4 のとおりのオブジェクトを stableStringify した物にする。
import { stableStringify } from './equal'
import { hashJson } from './hash'
import { periodOf } from './items'
import type { ID, ItemOrigin, RoutineCycle } from './types'

/** 文字をそろえる（NFKC で全角と半角を同じに、空白を詰め（前後を除き、続く空白を1つに）、英字を小文字に。19.4） */
export function normalizeIdText(s: string): string {
  return s.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase()
}

const hashOf = (material: Record<string, unknown>) => hashJson(stableStringify(material))

const keyOf = (sourceKey: string | null | undefined): string | null =>
  typeof sourceKey === 'string' && sourceKey.trim() ? sourceKey.trim() : null

/** 予定・タスクの材料 */
export interface ItemIdInput {
  origin: ItemOrigin
  start?: string | null
  due?: string | null
  startTime?: string | null
  title: string
}

/**
 * 予定（calendar 生まれ。ce-）・タスク（list 生まれ。ct-）の id。
 * sourceKey がある時は { table, origin, sourceKey, from, to }、無い時は { table, origin, from, to, startTime, title }。
 * from・to は 6.3 の期間（カレンダーに出ないタスクは null）。kind・memo・requester・label・endTime・listed・ai・via は入れない
 */
export function derivedItemId(input: ItemIdInput, sourceKey?: string | null): ID {
  const period = periodOf({ origin: input.origin, start: input.start ?? null, due: input.due ?? null })
  const from = period?.from ?? null
  const to = period?.to ?? null
  const key = keyOf(sourceKey)
  const material = key
    ? { table: 'items', origin: input.origin, sourceKey: key, from, to }
    : {
        table: 'items',
        origin: input.origin,
        from,
        to,
        startTime: input.startTime ?? null,
        title: normalizeIdText(input.title),
      }
  return `c${input.origin === 'calendar' ? 'e' : 't'}-${hashOf(material)}`
}

/** やりたいこと（cf-）の id。sourceKey がある時は { table, origin: null, sourceKey, from: null, to: null }、無い時は { table, text } */
export function derivedFavoriteId(input: { text: string }, sourceKey?: string | null): ID {
  const key = keyOf(sourceKey)
  const material = key
    ? { table: 'favorites', origin: null, sourceKey: key, from: null, to: null }
    : { table: 'favorites', text: normalizeIdText(input.text) }
  return `cf-${hashOf(material)}`
}

export interface RoutineIdInput {
  title: string
  cycle: RoutineCycle
  weekdays?: number[] | null
  monthDay?: number | null
  yearMonth?: number | null
  yearDay?: number | null
}

/** ルーチン（cr-）の id。sourceKey が無い時は { table, title, cycle, weekdays, monthDay, yearMonth, yearDay } */
export function derivedRoutineId(input: RoutineIdInput, sourceKey?: string | null): ID {
  const key = keyOf(sourceKey)
  const material = key
    ? { table: 'routines', origin: null, sourceKey: key, from: null, to: null }
    : {
        table: 'routines',
        title: normalizeIdText(input.title),
        cycle: input.cycle,
        weekdays: input.weekdays ?? [],
        monthDay: input.monthDay ?? null,
        yearMonth: input.yearMonth ?? null,
        yearDay: input.yearDay ?? null,
      }
  return `cr-${hashOf(material)}`
}

const DERIVED_RE = /^c[etfr]-[0-9a-z.]+$/

/** 内容から作った id か（ce-・ct-・cf-・cr-。月の束の「片付けない削除の印」と、ゴミ箱から戻す時の見分けに使う。6.11・6.15） */
export function isDerivedId(id: unknown): boolean {
  return typeof id === 'string' && DERIVED_RE.test(id)
}

// ---------- 決まった id（19.4） ----------

/** 休みの id（日付そのもの） */
export function offDayId(date: string): ID {
  return date
}

/** ラベルの呼び名の id（ラベルのキーそのもの） */
export function labelNameId(key: string): ID {
  return key
}

/** ルーチンのチェックの記録の id（{routineId}:{YYYY-MM}） */
export function routineCheckId(routineId: ID, month: string): ID {
  return `${routineId}:${month}`
}

/** チェックの記録の id を分ける（ルーチンの id にはコロンが入らないので、最後のコロンで分ける。形が違えば null） */
export function parseRoutineCheckId(id: string): { routineId: ID; month: string } | null {
  const m = /^(.+):(\d{4}-(?:0[1-9]|1[0-2]))$/.exec(id)
  return m ? { routineId: m[1], month: m[2] } : null
}
