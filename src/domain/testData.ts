// 単体テストの記録を作る小さな道具（src/domain の *.test.ts だけが使う。本番のコードからは読まない）
import type { AppData, Favorite, InboxRecord, Item, LabelName, MimNote, OffDay, Routine, RoutineCheck } from './types'
import { emptyData } from './types'

/** 2026-11-10 09:00（端末の時刻。テストの「今」） */
export const T0 = new Date(2026, 10, 10, 9, 0).getTime()
export const HOUR = 60 * 60 * 1000
export const DAY = 24 * HOUR

export function mkItem(p: Partial<Item> = {}): Item {
  return {
    id: 'i1',
    v: 1,
    kind: 'work',
    title: '定例会議',
    origin: 'calendar',
    start: '2026-11-10',
    due: null,
    startTime: null,
    endTime: null,
    listed: false,
    done: false,
    doneAt: null,
    doneOn: null,
    locked: false,
    label: null,
    requester: '',
    memo: '',
    order: T0,
    by: 'user',
    ai: null,
    via: null,
    createdAt: T0,
    updatedAt: T0,
    ...p,
  }
}

export function mkTask(p: Partial<Item> = {}): Item {
  return mkItem({ id: 't1', title: '見積書を出す', origin: 'list', start: null, due: null, listed: true, ...p })
}

export function mkRoutine(p: Partial<Routine> = {}): Routine {
  return {
    id: 'r1',
    v: 1,
    title: '朝の体操',
    cycle: 'daily',
    weekdays: [],
    monthDay: null,
    yearMonth: null,
    yearDay: null,
    order: 0,
    by: 'user',
    ai: null,
    via: null,
    createdAt: T0,
    updatedAt: T0,
    ...p,
  }
}

export function mkCheck(routineId: string, month: string, dates: string[], p: Partial<RoutineCheck> = {}): RoutineCheck {
  return {
    id: `${routineId}:${month}`,
    routineId,
    month,
    dates,
    updatedAt: T0,
    by: 'user',
    ai: null,
    via: null,
    ...p,
  }
}

export function mkFavorite(p: Partial<Favorite> = {}): Favorite {
  return {
    id: 'f1',
    v: 1,
    text: '積んでいる本を読む',
    done: false,
    doneAt: null,
    order: 0,
    by: 'user',
    ai: null,
    via: null,
    createdAt: T0,
    updatedAt: T0,
    ...p,
  }
}

export function mkMim(p: Partial<MimNote> = {}): MimNote {
  return {
    id: 'm1',
    v: 1,
    title: '会社の Wi-Fi',
    body: '受付の横',
    secrets: [{ id: 's1', name: 'パスワード', value: 'p@ss' }],
    qrs: [{ id: 'q1', caption: 'Wi-Fi', text: 'WIFI:S:office;T:WPA;P:p@ss;;' }],
    order: 0,
    by: 'user',
    ai: null,
    via: null,
    createdAt: T0,
    updatedAt: T0,
    ...p,
  }
}

export function mkOffDay(date: string, off = true, p: Partial<OffDay> = {}): OffDay {
  return { id: date, date, off, updatedAt: T0, by: 'user', ai: null, via: null, ...p }
}

export function mkLabelName(key: string, name: string, p: Partial<LabelName> = {}): LabelName {
  return { id: key, name, updatedAt: T0, by: 'user', ai: null, via: null, ...p }
}

/** 受け取り箱の1件（コネクタが作った時の形。status は pending） */
export function mkInbox(p: Partial<InboxRecord> & Pick<InboxRecord, 'id' | 'op' | 'table' | 'targetId'>): InboxRecord {
  return {
    v: 1,
    proposeOp: null,
    baseHash: null,
    patch: null,
    sourceKey: null,
    requestQuote: null,
    why: null,
    proposalId: null,
    by: 'connector',
    ai: 'claude',
    via: null,
    createdAt: T0,
    updatedAt: T0,
    status: 'pending',
    reason: null,
    message: null,
    appliedAt: null,
    answeredVia: null,
    answerId: null,
    supersededBy: null,
    undo: null,
    undoneAt: null,
    ...p,
  }
}

/** 記録の一覧から AppData を作る */
export function dataWith(parts: { [K in keyof AppData]?: AppData[K][string][] }): AppData {
  const d = emptyData()
  for (const [table, list] of Object.entries(parts) as [keyof AppData, { id: string }[]][]) {
    const rows = d[table] as Record<string, unknown>
    for (const r of list) rows[r.id] = r
  }
  return d
}
