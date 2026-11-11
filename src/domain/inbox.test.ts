// 受け取り箱の依頼の当て方（docs/SPEC.md の 2.10・6.14・19.4・19.5・19.7・18.5・18.6・形2・形5）。時計を決めて（今 = 2026-11-10 09:00）、
// 足す・直す・ゴミ箱へ・after:・ルーチンのチェック・7日・断る組・許可・元に戻す・提案の受け付け・取り下げ・30日・［承認］［拒否］・
// 会話の依頼・proposal_mismatch・2台で同じ依頼を当てる時・掃除を1つずつ確かめる
import { describe, expect, it } from 'vitest'
import { addDaysYmd } from './dates'
import { derivedFavoriteId, derivedItemId, derivedRoutineId } from './derivedId'
import { hashJson, revOf } from './hash'
import {
  INBOX_KEEP_MS,
  PROPOSAL_STATUS_RANK,
  REQUEST_STATUS_RANK,
  STATUS_RANK,
  answerProposal,
  approveConflict,
  canUndo,
  cleanupInbox,
  combineInboxOutcomes,
  compareInboxOutcome,
  declineConflict,
  inboxGroupFields,
  processInbox,
  strongerInboxOutcome,
  undoRequest,
  type InboxContext,
} from './inbox'
import { updateItem } from './ops'
import {
  DAY,
  HOUR,
  T0,
  dataWith,
  mkCheck,
  mkFavorite,
  mkInbox,
  mkItem,
  mkLabelName,
  mkOffDay,
  mkRoutine,
  mkTask,
} from './testData'
import { trashItem, trashRoutine } from './trash'
import type { AppData, InboxRecord, Item } from './types'

const PERMS = { linked: true, adds: true, edits: true, proposals: true }
const ctx = (p: Partial<InboxContext> = {}): InboxContext => ({ now: T0, perms: PERMS, ...p })

const MAIL_A = '<CAF=12-3-uchiawase@mail.gmail.com>'
const VIA_A = 'メール: 12/3 打ち合わせのご案内 / 山田さん / 2026-11-10 08:12 / https://mail.google.com/mail/a'
const VIA_B = 'メール: 【変更】打ち合わせは 12/5 に / 山田さん / 2026-11-12 09:58 / https://mail.google.com/mail/b'

/** 予定（12/3 打ち合わせ）を足す依頼（19.7 の 1.） */
function addMeeting(p: Partial<InboxRecord> = {}, patch: Record<string, unknown> = {}): InboxRecord {
  const body = {
    origin: 'calendar',
    kind: 'work',
    title: '打ち合わせ',
    start: '2026-12-03',
    startTime: '10:00',
    endTime: '11:00',
    ...patch,
  }
  const targetId = derivedItemId(body as never, MAIL_A)
  return mkInbox({
    id: 'xa-1',
    op: 'add',
    table: 'items',
    targetId,
    patch: body,
    sourceKey: MAIL_A,
    via: VIA_A,
    createdAt: T0 - HOUR,
    ...p,
  })
}

const MEETING_ID = derivedItemId({ origin: 'calendar', start: '2026-12-03', title: '打ち合わせ' }, MAIL_A)
const meeting = (p: Partial<Item> = {}) =>
  mkItem({
    id: MEETING_ID,
    title: '打ち合わせ',
    start: '2026-12-03',
    startTime: '10:00',
    endTime: '11:00',
    by: 'connector',
    ai: 'claude',
    via: VIA_A,
    ...p,
  })

/** 直す依頼（会話で頼まれた。Claude が読んだ時の指紋は今の記録の指紋） */
function edit(
  id: string,
  target: { id: string } & object,
  patch: Record<string, unknown>,
  p: Partial<InboxRecord> = {},
): InboxRecord {
  return mkInbox({
    id,
    op: 'update',
    table: 'items',
    targetId: target.id,
    baseHash: revOf(target),
    patch,
    requestQuote: '締め切りを 27日にして',
    createdAt: T0 - HOUR,
    ...p,
  })
}

const run = (data: AppData, c: Partial<InboxContext> = {}) => processInbox(data, ctx(c))

describe('足す（19.5 の足す）', () => {
  it('予定を足す: 内容から作る id で、by: connector・ai・via を写し、createdAt・updatedAt・order は依頼の createdAt。ラベルは呼び名から引く', () => {
    const rec = addMeeting({}, { label: '会議', requester: '山田さん', memo: '議題: 来期の計画' })
    const data = dataWith({ inbox: [rec], labelNames: [mkLabelName('sky-l', '会議')] })
    const { data: out, touched } = run(data)
    const item = out.items[rec.targetId]
    expect(item).toMatchObject({
      origin: 'calendar',
      kind: 'work',
      title: '打ち合わせ',
      start: '2026-12-03',
      due: null,
      startTime: '10:00',
      endTime: '11:00',
      listed: false,
      done: false,
      label: 'sky-l',
      requester: '山田さん',
      memo: '議題: 来期の計画',
      by: 'connector',
      ai: 'claude',
      via: VIA_A,
      createdAt: T0 - HOUR,
      updatedAt: T0 - HOUR,
      order: T0 - HOUR,
      v: 1,
    })
    expect(out.inbox['xa-1']).toMatchObject({
      status: 'applied',
      reason: null,
      appliedAt: T0,
      updatedAt: T0,
      undo: { created: true, afterHash: revOf(item) },
    })
    // 依頼ごとのまとまり（作った記録 → 受け取り箱の記録の順）
    expect(touched.get('xa-1')).toEqual([`items/${rec.targetId}`, 'inbox/xa-1'])
  })

  it('ラベルが見つからなければラベルなしで足し、message に残す', () => {
    const rec = addMeeting({}, { label: '打ち合わせ用' })
    const out = run(dataWith({ inbox: [rec] })).data
    expect(out.items[rec.targetId].label).toBeNull()
    expect(out.inbox['xa-1']).toMatchObject({
      status: 'applied',
      message: 'ラベル『打ち合わせ用』が見つからないので、ラベルなしで入れました',
    })
  })

  it('タスク・やりたいこと（いちばん上）・ルーチン（その種類のいちばん下）', () => {
    const task = { origin: 'list', title: '見積書を出す', due: '2026-11-20' }
    const fav = { text: '積んでいる本を読む' }
    const rt = { title: '朝の体操', cycle: 'weekly', weekdays: [1, 4] }
    const data = dataWith({
      favorites: [mkFavorite({ id: 'f0', order: -2 })],
      routines: [mkRoutine({ id: 'r0', cycle: 'weekly', order: 4 }), mkRoutine({ id: 'r9', cycle: 'daily', order: 9 })],
      inbox: [
        mkInbox({ id: 'xa-t', op: 'add', table: 'items', targetId: derivedItemId(task as never), patch: task, via: 'メモ' }),
        mkInbox({ id: 'xa-f', op: 'add', table: 'favorites', targetId: derivedFavoriteId(fav), patch: fav, via: 'メモ' }),
        mkInbox({ id: 'xa-r', op: 'add', table: 'routines', targetId: derivedRoutineId(rt as never), patch: rt, via: 'メモ' }),
      ],
    })
    const out = run(data).data
    expect(out.items[derivedItemId(task as never)]).toMatchObject({
      origin: 'list',
      kind: 'work',
      listed: true,
      due: '2026-11-20',
    })
    expect(out.favorites[derivedFavoriteId(fav)]).toMatchObject({ order: -3, done: false, by: 'connector' })
    expect(out.routines[derivedRoutineId(rt as never)]).toMatchObject({ order: 5, weekdays: [1, 4] })
  })

  it('id が内容と合わない → invalid。形が違う（予定に区分が無い・開始日が締め切り日より後・足せない項目） → invalid', () => {
    const wrong = addMeeting({ targetId: 'ce-made.up.id' })
    expect(run(dataWith({ inbox: [wrong] })).data.inbox['xa-1']).toMatchObject({ status: 'rejected', reason: 'invalid' })
    const noKind = { origin: 'calendar', title: '会議', start: '2026-12-03' }
    const r1 = mkInbox({
      id: 'xa-2',
      op: 'add',
      table: 'items',
      targetId: derivedItemId(noKind as never),
      patch: noKind,
      via: 'v',
    })
    const late = { origin: 'calendar', kind: 'work', title: '会議', start: '2026-12-05', due: '2026-12-03' }
    const r2 = mkInbox({ id: 'xa-3', op: 'add', table: 'items', targetId: derivedItemId(late as never), patch: late, via: 'v' })
    const done = { origin: 'list', title: '済み', done: true }
    const r3 = mkInbox({ id: 'xa-4', op: 'add', table: 'items', targetId: derivedItemId(done as never), patch: done, via: 'v' })
    const out = run(dataWith({ inbox: [r1, r2, r3] })).data
    for (const id of ['xa-2', 'xa-3', 'xa-4']) expect(out.inbox[id]).toMatchObject({ status: 'rejected', reason: 'invalid' })
    expect(Object.keys(out.items)).toEqual([])
  })

  it('もうある → duplicate。ゴミ箱にある・クラウドの削除の印がある → previously_deleted（19.7 の 7.: 同じメールを読み直しても増えない・消した物は戻らない）', () => {
    const rec = addMeeting()
    expect(run(dataWith({ inbox: [rec], items: [meeting()] })).data.inbox['xa-1']).toMatchObject({
      status: 'rejected',
      reason: 'duplicate',
    })
    const trashed = trashItem(dataWith({ items: [meeting()] }), MEETING_ID).data
    expect(run({ ...trashed, inbox: { 'xa-1': rec } }).data.inbox['xa-1']).toMatchObject({
      status: 'rejected',
      reason: 'previously_deleted',
    })
    const gone = run(dataWith({ inbox: [rec] }), { isGone: (t, id) => t === 'items' && id === MEETING_ID }).data
    expect(gone.inbox['xa-1']).toMatchObject({ status: 'rejected', reason: 'previously_deleted' })
    expect(gone.items).toEqual({})
  })

  it('休み: 記録の無い日に付ける。付いている日は duplicate、外した日は previously_deleted', () => {
    const rec = (id: string, date: string) =>
      mkInbox({ id, op: 'add', table: 'offDays', targetId: date, patch: { date }, via: 'シフト表' })
    const data = dataWith({
      offDays: [mkOffDay('2026-11-21'), mkOffDay('2026-11-22', false)],
      inbox: [rec('xa-1', '2026-11-20'), rec('xa-2', '2026-11-21'), rec('xa-3', '2026-11-22'), rec('xa-4', '2026-11-31')],
    })
    const out = run(data).data
    expect(out.offDays['2026-11-20']).toEqual({
      id: '2026-11-20',
      date: '2026-11-20',
      off: true,
      updatedAt: T0,
      by: 'connector',
      ai: 'claude',
      via: 'シフト表',
    })
    expect(out.inbox['xa-2']).toMatchObject({ status: 'rejected', reason: 'duplicate' })
    expect(out.inbox['xa-3']).toMatchObject({ status: 'rejected', reason: 'previously_deleted' })
    expect(out.inbox['xa-4']).toMatchObject({ status: 'rejected', reason: 'invalid' })
  })

  it('ラベルの呼び名: 記録の無い色に付ける。名前がある色は invalid、名前を消した色は previously_deleted', () => {
    const rec = (id: string, key: string, name = '会議') =>
      mkInbox({ id, op: 'add', table: 'labelNames', targetId: key, patch: { key, name }, via: 'v' })
    const data = dataWith({
      labelNames: [mkLabelName('rose-l', '私用'), mkLabelName('mint-l', '')],
      inbox: [
        rec('xa-1', 'sky-l'),
        rec('xa-2', 'rose-l'),
        rec('xa-3', 'mint-l'),
        rec('xa-4', 'teal-l', 'とても長い呼び名を付けてみる'),
        rec('xa-5', 'gold-l'),
      ],
    })
    const out = run(data).data
    expect(out.labelNames['sky-l']).toMatchObject({ name: '会議', by: 'connector' })
    expect(out.inbox['xa-2']).toMatchObject({ status: 'rejected', reason: 'invalid' })
    expect(out.inbox['xa-3']).toMatchObject({ status: 'rejected', reason: 'previously_deleted' })
    expect(out.inbox['xa-4']).toMatchObject({ status: 'rejected', reason: 'invalid' })
    expect(out.inbox['xa-5']).toMatchObject({ status: 'rejected', reason: 'invalid' })
  })

  it('足す依頼は日数を問わず当てる（7日の stale は無い）', () => {
    const old = addMeeting({ createdAt: T0 - 40 * DAY, updatedAt: T0 - 40 * DAY })
    expect(run(dataWith({ inbox: [old] })).data.inbox['xa-1'].status).toBe('applied')
  })
})

describe('直す（19.5 の直す）', () => {
  const task = mkTask({ id: 't1', due: '2026-11-20', by: 'user' })

  it('当てる: 変えた項目の前と後・前後の指紋を控え、記録の by は変えない', () => {
    const rec = edit('xe-1', task, { due: '2026-11-27' })
    const { data: out, touched } = run(dataWith({ items: [task], inbox: [rec] }))
    expect(out.items.t1).toMatchObject({ due: '2026-11-27', updatedAt: T0, by: 'user', ai: null })
    expect(out.inbox['xe-1']).toMatchObject({
      status: 'applied',
      undo: {
        before: { due: '2026-11-20' },
        after: { due: '2026-11-27' },
        beforeHash: revOf(task),
        afterHash: revOf(out.items.t1),
      },
    })
    expect(touched.get('xe-1')).toEqual(['items/t1', 'inbox/xe-1'])
  })

  it('ルーチンの種類を変えたら、手で変えた時と同じく、新しい種類のいちばん下に並べる（元に戻した時も）', () => {
    const r1 = mkRoutine({ id: 'r1', cycle: 'daily', order: 0 })
    const r2 = mkRoutine({ id: 'r2', cycle: 'weekly', weekdays: [1], order: 0 })
    const r0 = mkRoutine({ id: 'r0', cycle: 'weekly', weekdays: [2], order: 1 })
    const d3 = mkRoutine({ id: 'r3', cycle: 'daily', order: 5 })
    const rec = mkInbox({
      id: 'xe-r',
      op: 'update',
      table: 'routines',
      targetId: 'r1',
      baseHash: revOf(r1),
      patch: { cycle: 'weekly', weekdays: [3] },
      requestQuote: '毎週水曜にして',
      createdAt: T0 - HOUR,
    })
    const out = run(dataWith({ routines: [r1, r2, r0, d3], inbox: [rec] })).data
    expect(out.routines.r1).toMatchObject({ cycle: 'weekly', order: 2 })
    expect(out.inbox['xe-r'].status).toBe('applied')
    const back = undoRequest(out, 'xe-r', ctx()).data
    expect(back.routines.r1).toMatchObject({ cycle: 'daily', order: 6 })
  })

  it('Claude が読んだ後にここで直されていたら当てずに conflict（changed）', () => {
    const rec = edit('xe-1', task, { due: '2026-11-27' })
    const edited = updateItem(dataWith({ items: [task] }), 't1', { memo: '先方に確認' }, T0 - 1).data
    const out = run({ ...edited, inbox: { 'xe-1': rec } }).data
    expect(out.inbox['xe-1']).toMatchObject({ status: 'conflict', reason: 'changed', undo: null })
    expect(out.items.t1.due).toBe('2026-11-20')
  })

  it('直した日時（updatedAt）と並びの数（order）だけが違う時は、変わっていないとみなす（形2）', () => {
    const rec = edit('xe-1', task, { due: '2026-11-27' })
    const touchedOnly = { ...task, updatedAt: T0 - 5, order: 123 }
    expect(run(dataWith({ items: [touchedOnly], inbox: [rec] })).data.inbox['xe-1'].status).toBe('applied')
  })

  it('値がもう全部入っていれば、何も変えずに applied（undo は afterHash だけ・「もう当たっていました」）。指紋が違っても競合にしない', () => {
    const now27 = { ...task, due: '2026-11-27', memo: '別の端末で直した' }
    const rec = edit('xe-1', task, { due: '2026-11-27' })
    const out = run(dataWith({ items: [now27], inbox: [rec] })).data
    expect(out.inbox['xe-1']).toMatchObject({
      status: 'applied',
      message: 'もう当たっていました',
      undo: { afterHash: revOf(now27) },
    })
    expect(out.items.t1).toBe(now27)
    expect(canUndo(out, out.inbox['xe-1'])).toEqual({ ok: false, message: null })
  })

  it('当てた後が決まりに合わなければ invalid（自動の直しはしない）', () => {
    const ranged = mkTask({ id: 't1', start: '2026-11-10', due: '2026-11-20' })
    const out = run(dataWith({ items: [ranged], inbox: [edit('xe-1', ranged, { due: '2026-11-05' })] })).data
    expect(out.inbox['xe-1']).toMatchObject({
      status: 'rejected',
      reason: 'invalid',
      message: '開始日が締め切り日より後になります',
    })
    expect(out.items.t1.due).toBe('2026-11-20')
  })

  it('直していない項目の知らない値（新しい版の区分）では断らず、そのまま残す（形3）', () => {
    const future = { ...task, kind: 'family' } as unknown as Item
    const out = run(dataWith({ items: [future], inbox: [edit('xe-1', future, { due: '2026-11-27' })] })).data
    expect(out.inbox['xe-1'].status).toBe('applied')
    expect(out.items.t1.kind).toBe('family')
  })

  it('完了にすると doneAt は依頼の createdAt、doneOn はその日（端末の暦）。外すと3つとも消す', () => {
    const at = new Date(2026, 10, 9, 23, 30).getTime()
    const out = run(dataWith({ items: [task], inbox: [edit('xe-1', task, { done: true }, { createdAt: at })] })).data
    expect(out.items.t1).toMatchObject({ done: true, doneAt: at, doneOn: '2026-11-09' })
    expect(out.inbox['xe-1'].undo).toMatchObject({
      before: { done: false, doneAt: null, doneOn: null },
      after: { done: true, doneAt: at, doneOn: '2026-11-09' },
    })
    const back = run({ ...out, inbox: { 'xe-2': edit('xe-2', out.items.t1, { done: false }) } }).data
    expect(back.items.t1).toMatchObject({ done: false, doneAt: null, doneOn: null })
  })

  it('ラベルは呼び名で指せる。見つからない呼び名は invalid（今のラベルを黙って外さない）', () => {
    const data = dataWith({
      items: [task],
      labelNames: [mkLabelName('sky-l', '会議')],
      inbox: [edit('xe-1', task, { label: '会議' }), edit('xe-2', task, { label: '無い名前' }, { createdAt: T0 - 30 * 60_000 })],
    })
    const out = run(data).data
    expect(out.items.t1.label).toBe('sky-l')
    expect(out.inbox['xe-2']).toMatchObject({ status: 'rejected', reason: 'invalid' })
  })

  it('200字を超える値は、undo.after に値の代わりに指紋を入れる（before は値のまま）', () => {
    const memo = 'あ'.repeat(300)
    const out = run(dataWith({ items: [task], inbox: [edit('xe-1', task, { memo })] })).data
    expect(out.inbox['xe-1'].undo).toMatchObject({ before: { memo: '' }, after: { memo: hashJson(memo) } })
  })

  it('作ってから 7日を過ぎた依頼は conflict（stale）。ちょうど 7日はまだ当てる', () => {
    const old = edit('xe-1', task, { due: '2026-11-27' }, { createdAt: T0 - 7 * DAY - 1 })
    expect(run(dataWith({ items: [task], inbox: [old] })).data.inbox['xe-1']).toMatchObject({
      status: 'conflict',
      reason: 'stale',
    })
    const just = edit('xe-1', task, { due: '2026-11-27' }, { createdAt: T0 - 7 * DAY })
    expect(run(dataWith({ items: [task], inbox: [just] })).data.inbox['xe-1'].status).toBe('applied')
  })

  it('対象が無い → not_found、ゴミ箱にある → in_trash', () => {
    const rec = edit('xe-1', task, { due: '2026-11-27' })
    expect(run(dataWith({ inbox: [rec] })).data.inbox['xe-1']).toMatchObject({ status: 'rejected', reason: 'not_found' })
    const trashed = trashItem(dataWith({ items: [task] }), 't1').data
    expect(run({ ...trashed, inbox: { 'xe-1': rec } }).data.inbox['xe-1']).toMatchObject({
      status: 'rejected',
      reason: 'in_trash',
    })
  })

  it('直せない項目（origin・order・by など）は invalid', () => {
    for (const patch of [{ origin: 'list' }, { order: 1 }, { by: 'user' }, { doneAt: 1 }, {}]) {
      const out = run(dataWith({ items: [task], inbox: [edit('xe-1', task, patch)] })).data
      expect(out.inbox['xe-1']).toMatchObject({ status: 'rejected', reason: 'invalid' })
    }
  })

  it('画面で直している間は、その依頼だけ待つ（閉じたら当てる）', () => {
    const data = dataWith({ items: [task], inbox: [edit('xe-1', task, { due: '2026-11-27' })] })
    const waiting = run(data, { isEditing: (_t, id) => id === 't1' })
    expect(waiting.data).toBe(data)
    expect(waiting.waiting).toEqual(['xe-1'])
    expect(run(data).data.inbox['xe-1'].status).toBe('applied')
  })
})

describe('前の依頼の後に当てる（after:）', () => {
  it('足したばかりでまだ当たっていない予定を直す: 同じ同期で、足す依頼を当ててから直す依頼を当てる', () => {
    const add = addMeeting({ createdAt: T0 - 2 * HOUR })
    const fix = mkInbox({
      id: 'xe-2',
      op: 'update',
      table: 'items',
      targetId: add.targetId,
      baseHash: 'after:xa-1',
      patch: { memo: 'Zoom の URL は後で' },
      requestQuote: 'さっきの予定にメモを足して',
      createdAt: T0 - HOUR,
    })
    const out = run(dataWith({ inbox: [fix, add] })).data
    expect(out.inbox['xa-1'].status).toBe('applied')
    expect(out.inbox['xe-2'].status).toBe('applied')
    expect(out.items[add.targetId].memo).toBe('Zoom の URL は後で')
  })

  it('指した依頼がまだ届いていない・待っている間は待つ。断られた・競合だった時は conflict', () => {
    const fix = mkInbox({
      id: 'xe-2',
      op: 'update',
      table: 'items',
      targetId: MEETING_ID,
      baseHash: 'after:xa-1',
      patch: { memo: 'x' },
      requestQuote: 'q',
    })
    const alone = run(dataWith({ inbox: [fix] }))
    expect(alone.waiting).toEqual(['xe-2'])
    expect(alone.data.inbox['xe-2'].status).toBe('pending')
    // 指した依頼が届かないまま 7日を過ぎたら、待たずに stale
    expect(
      run(dataWith({ inbox: [{ ...fix, createdAt: T0 - 8 * DAY, updatedAt: T0 - 8 * DAY }] })).data.inbox['xe-2'],
    ).toMatchObject({
      status: 'conflict',
      reason: 'stale',
    })
    const rejectedAdd = { ...addMeeting(), status: 'rejected' as const, reason: 'duplicate' as const, appliedAt: T0 - 1 }
    const out = run(dataWith({ items: [meeting()], inbox: [fix, rejectedAdd] })).data
    expect(out.inbox['xe-2']).toMatchObject({ status: 'conflict', reason: 'changed' })
  })

  it('指した依頼が当たった後に直されていたら conflict（undo.afterHash と今の指紋を比べる）', () => {
    const item = meeting()
    const applied = {
      ...addMeeting(),
      status: 'applied' as const,
      appliedAt: T0 - 1,
      undo: { created: true as const, afterHash: revOf(item) },
    }
    const fix = mkInbox({
      id: 'xe-2',
      op: 'update',
      table: 'items',
      targetId: MEETING_ID,
      baseHash: 'after:xa-1',
      patch: { memo: 'x' },
      requestQuote: 'q',
    })
    expect(run(dataWith({ items: [item], inbox: [fix, applied] })).data.inbox['xe-2'].status).toBe('applied')
    const edited = { ...item, title: '打ち合わせ（会議室B）' }
    expect(run(dataWith({ items: [edited], inbox: [fix, applied] })).data.inbox['xe-2']).toMatchObject({
      status: 'conflict',
      reason: 'changed',
    })
  })
})

describe('ルーチンのチェック（19.4 の routineChecks）', () => {
  const routine = mkRoutine({ id: 'r1', cycle: 'weekly' })
  const check = (dates: string[], baseHash: string, p: Partial<InboxRecord> = {}) =>
    mkInbox({
      id: 'xe-c',
      op: 'update',
      table: 'routineChecks',
      targetId: 'r1:2026-11',
      baseHash,
      patch: { dates },
      requestQuote: '体操にチェックして',
      ...p,
    })

  it('その月の記録がまだ無い時は none で作る（今日 = 依頼を作った日の分だけ）', () => {
    const out = run(dataWith({ routines: [routine], inbox: [check(['2026-11-10'], 'none')] })).data
    expect(out.routineChecks['r1:2026-11']).toEqual(
      mkCheck('r1', '2026-11', ['2026-11-10'], { updatedAt: T0, by: 'connector', ai: 'claude', via: null }),
    )
    expect(out.inbox['xe-c'].undo).toMatchObject({ before: { dates: [] }, after: { dates: ['2026-11-10'] }, beforeHash: '' })
  })

  it('昨日の分は付けられない（invalid）。記録がもうあれば none は conflict', () => {
    expect(run(dataWith({ routines: [routine], inbox: [check(['2026-11-09'], 'none')] })).data.inbox['xe-c']).toMatchObject({
      status: 'rejected',
      reason: 'invalid',
    })
    const rc = mkCheck('r1', '2026-11', ['2026-11-03'])
    expect(
      run(dataWith({ routines: [routine], routineChecks: [rc], inbox: [check(['2026-11-03', '2026-11-10'], 'none')] })).data
        .inbox['xe-c'],
    ).toMatchObject({
      status: 'conflict',
      reason: 'changed',
    })
  })

  it('記録があれば指紋で確かめて今日を足す。外せるのはいちばん新しい戻る日以後だけ', () => {
    const rc = mkCheck('r1', '2026-11', ['2026-11-03', '2026-11-09'])
    const add = run(
      dataWith({
        routines: [routine],
        routineChecks: [rc],
        inbox: [check(['2026-11-03', '2026-11-09', '2026-11-10'], revOf(rc))],
      }),
    ).data
    expect(add.routineChecks['r1:2026-11'].dates).toEqual(['2026-11-03', '2026-11-09', '2026-11-10'])
    const remove = run(dataWith({ routines: [routine], routineChecks: [rc], inbox: [check(['2026-11-03'], revOf(rc))] })).data
    expect(remove.routineChecks['r1:2026-11'].dates).toEqual(['2026-11-03'])
    const tooOld = run(dataWith({ routines: [routine], routineChecks: [rc], inbox: [check(['2026-11-09'], revOf(rc))] })).data
    expect(tooOld.inbox['xe-c']).toMatchObject({ status: 'rejected', reason: 'invalid' })
  })

  it('今の記録の YYYY-MM-DD でない値（新しい版の形かもしれない値）は、付けても外しても後ろに残す。元に戻すとそのまま戻る（形3）', () => {
    const unknown = ['2026-11-04T07:30', { day: '2026-11-05' }]
    const rc = mkCheck('r1', '2026-11', ['2026-11-03', unknown[0], '2026-11-09', unknown[1]] as string[])
    const add = run(
      dataWith({
        routines: [routine],
        routineChecks: [rc],
        inbox: [check(['2026-11-03', '2026-11-09', '2026-11-10'], revOf(rc))],
      }),
    ).data
    expect(add.inbox['xe-c'].status).toBe('applied')
    expect(add.routineChecks['r1:2026-11'].dates).toEqual(['2026-11-03', '2026-11-09', '2026-11-10', ...unknown])
    const remove = run(dataWith({ routines: [routine], routineChecks: [rc], inbox: [check(['2026-11-03'], revOf(rc))] })).data
    expect(remove.routineChecks['r1:2026-11'].dates).toEqual(['2026-11-03', ...unknown])
    const undone = undoRequest(remove, 'xe-c', ctx())
    expect(undone.result.status).toBe('done')
    expect(undone.data.routineChecks['r1:2026-11'].dates).toEqual(rc.dates)
  })

  it('YYYY-MM-DD でない値のある記録に2台で同じ依頼を当てても、後の端末は「もう当たっていました」（競合にしない）', () => {
    const rc = mkCheck('r1', '2026-11', ['2026-11-03', 'x-new'])
    const data = dataWith({ routines: [routine], routineChecks: [rc], inbox: [check(['2026-11-03', '2026-11-10'], revOf(rc))] })
    const a = run(data).data
    expect(a.routineChecks['r1:2026-11'].dates).toEqual(['2026-11-03', '2026-11-10', 'x-new'])
    // B には A が当てた記録だけが届き、受け取り箱の記録はまだ pending
    const b = run({ ...data, routineChecks: a.routineChecks }, { now: T0 + 1000 }).data
    expect(b.inbox['xe-c']).toMatchObject({ status: 'applied', message: 'もう当たっていました' })
    expect(b.routineChecks).toEqual(a.routineChecks)
  })

  it('ルーチンが無ければ not_found、ゴミ箱にあれば in_trash', () => {
    expect(run(dataWith({ inbox: [check(['2026-11-10'], 'none')] })).data.inbox['xe-c']).toMatchObject({
      status: 'rejected',
      reason: 'not_found',
    })
    const trashed = trashRoutine(dataWith({ routines: [routine] }), 'r1').data
    const out = run({ ...trashed, inbox: { 'xe-c': check(['2026-11-10'], 'none') } }).data
    expect(out.inbox['xe-c']).toMatchObject({ status: 'rejected', reason: 'in_trash' })
    expect(out.routineChecks).toEqual({})
  })
})

describe('ゴミ箱へ（19.5 のゴミ箱へ）', () => {
  const item = meeting()
  const toTrash = (p: Partial<InboxRecord> = {}) =>
    mkInbox({
      id: 'xe-t',
      op: 'trash',
      table: 'items',
      targetId: item.id,
      baseHash: revOf(item),
      requestQuote: '打ち合わせを消して',
      ...p,
    })

  it('作者が消した時と同じ形でゴミ箱へ（件と中身の id は依頼から。by: connector・ai・inboxId）', () => {
    const { data: out, touched } = run(dataWith({ items: [item], inbox: [toTrash()] }))
    expect(out.items[item.id]).toBeUndefined()
    expect(out.trashEntries['te-xe-t']).toMatchObject({
      kind: 'event',
      by: 'connector',
      ai: 'claude',
      inboxId: 'xe-t',
      recordIds: ['tr-xe-t'],
    })
    expect(out.inbox['xe-t']).toMatchObject({ status: 'applied', undo: { trashEntryId: 'te-xe-t' } })
    expect(touched.get('xe-t')).toEqual([`items/${item.id}`, 'trashEntries/te-xe-t', 'trashRecords/tr-xe-t', 'inbox/xe-t'])
  })

  it('ルーチンはチェックの記録ごと（tr-{id}・tr-{id}-{i}）', () => {
    const r = mkRoutine({ id: 'cr-x' })
    const rec = mkInbox({ id: 'xe-r', op: 'trash', table: 'routines', targetId: 'cr-x', baseHash: revOf(r), requestQuote: 'q' })
    const out = run(dataWith({ routines: [r], routineChecks: [mkCheck('cr-x', '2026-11', ['2026-11-10'])], inbox: [rec] })).data
    expect(out.trashEntries['te-xe-r'].recordIds).toEqual(['tr-xe-r', 'tr-xe-r-1'])
    expect(out.routineChecks).toEqual({})
  })

  it('読んだ後に直されていたら conflict（直した後の物を確かめずに消さない）。7日を過ぎたら stale', () => {
    expect(run(dataWith({ items: [{ ...item, memo: '大事' }], inbox: [toTrash()] })).data.inbox['xe-t']).toMatchObject({
      status: 'conflict',
      reason: 'changed',
    })
    expect(run(dataWith({ items: [item], inbox: [toTrash({ createdAt: T0 - 8 * DAY })] })).data.inbox['xe-t']).toMatchObject({
      status: 'conflict',
      reason: 'stale',
    })
  })

  it('もうゴミ箱にある → in_trash。同じ依頼でほかの端末が移した件が先に届いていれば applied', () => {
    const trashed = trashItem(dataWith({ items: [item] }), item.id).data
    expect(run({ ...trashed, inbox: { 'xe-t': toTrash() } }).data.inbox['xe-t']).toMatchObject({
      status: 'rejected',
      reason: 'in_trash',
    })
    const byOther = trashItem(dataWith({ items: [item] }), item.id, {
      inboxId: 'xe-t',
      by: 'connector',
      ids: { entry: 'te-xe-t', record: () => 'tr-xe-t' },
    }).data
    expect(run({ ...byOther, inbox: { 'xe-t': toTrash() } }).data.inbox['xe-t']).toMatchObject({
      status: 'applied',
      undo: { trashEntryId: 'te-xe-t' },
    })
  })
})

describe('初めの確かめ（19.5）: 断る組・許可・形', () => {
  const task = mkTask()
  const base = (p: Partial<InboxRecord>) =>
    mkInbox({
      id: 'xe-1',
      op: 'update',
      table: 'items',
      targetId: 't1',
      baseHash: revOf(task),
      patch: { title: 'x' },
      requestQuote: 'q',
      ...p,
    })
  const statusOf = (rec: InboxRecord, c: Partial<InboxContext> = {}) => {
    const r = run(dataWith({ items: [task], routines: [mkRoutine()], inbox: [rec] }), c).data.inbox[rec.id]
    return [r.status, r.reason]
  }

  it('MIM・ゴミ箱・受け取り箱を指す依頼は not_allowed', () => {
    expect(statusOf(base({ table: 'mimNotes' as never }))).toEqual(['rejected', 'not_allowed'])
    expect(statusOf(base({ table: 'trashEntries' as never }))).toEqual(['rejected', 'not_allowed'])
    expect(statusOf(base({ table: 'inbox' as never }))).toEqual(['rejected', 'not_allowed'])
    expect(statusOf(base({ table: 'attachments' as never }))).toEqual(['rejected', 'invalid'])
  })

  it('op と id の頭が合わない（xa- の直す・xe- の足す・xp- の直す）は invalid', () => {
    expect(statusOf(base({ id: 'xa-1' }))).toEqual(['rejected', 'invalid'])
    expect(statusOf(base({ id: 'xp-1' }))).toEqual(['rejected', 'invalid'])
    expect(
      statusOf(
        mkInbox({
          id: 'xe-9',
          op: 'add',
          table: 'favorites',
          targetId: derivedFavoriteId({ text: 'a' }),
          patch: { text: 'a' },
          via: 'v',
        }),
      ),
    ).toEqual(['rejected', 'invalid'])
  })

  it('19.4 の表で「—」の組は invalid（チェックの記録への足す、休み・呼び名・チェックへのゴミ箱へ、チェックへの提案、休み・呼び名をゴミ箱へ移す提案）', () => {
    expect(
      statusOf(
        mkInbox({ id: 'xa-1', op: 'add', table: 'routineChecks', targetId: 'r1:2026-11', patch: { dates: [] }, via: 'v' }),
      ),
    ).toEqual(['rejected', 'invalid'])
    for (const table of ['offDays', 'labelNames', 'routineChecks'] as const) {
      expect(statusOf(base({ op: 'trash', table, targetId: 'x', patch: null }))).toEqual(['rejected', 'invalid'])
    }
    const prop = (p: Partial<InboxRecord>) =>
      mkInbox({
        id: 'xp-1',
        op: 'propose',
        proposeOp: 'update',
        table: 'items',
        targetId: 't1',
        baseHash: revOf(task),
        patch: { title: 'x' },
        why: 'w',
        via: 'v',
        ...p,
      })
    expect(statusOf(prop({ table: 'routineChecks', targetId: 'r1:2026-11', patch: { dates: [] } }))).toEqual([
      'rejected',
      'invalid',
    ])
    expect(statusOf(prop({ proposeOp: 'trash', table: 'offDays', targetId: '2026-11-20', patch: null }))).toEqual([
      'rejected',
      'invalid',
    ])
    expect(statusOf(prop({ proposeOp: 'trash', table: 'labelNames', targetId: 'sky-l', patch: null }))).toEqual([
      'rejected',
      'invalid',
    ])
  })

  it('連携していない時・その種類の許可がオフの時は not_allowed', () => {
    expect(statusOf(base({}), { perms: { ...PERMS, linked: false } })).toEqual(['rejected', 'not_allowed'])
    expect(statusOf(base({}), { perms: { ...PERMS, edits: false } })).toEqual(['rejected', 'not_allowed'])
    const add = addMeeting()
    expect(run(dataWith({ inbox: [add] }), { perms: { ...PERMS, adds: false } }).data.inbox['xa-1'].reason).toBe('not_allowed')
    // 足すの許可がオフでも、直す依頼は当たる
    expect(statusOf(base({}), { perms: { ...PERMS, adds: false } })).toEqual(['applied', null])
  })

  it('直す・ゴミ箱へに頼んだ言葉が無い・足す依頼に出どころが無い・提案に理由が無い → invalid', () => {
    expect(statusOf(base({ requestQuote: null }))).toEqual(['rejected', 'invalid'])
    expect(statusOf(base({ requestQuote: 'あ'.repeat(501) }))).toEqual(['rejected', 'invalid'])
    expect(run(dataWith({ inbox: [addMeeting({ via: null })] })).data.inbox['xa-1'].reason).toBe('invalid')
    expect(
      statusOf(
        mkInbox({
          id: 'xp-1',
          op: 'propose',
          proposeOp: 'update',
          table: 'items',
          targetId: 't1',
          baseHash: revOf(task),
          patch: { title: 'x' },
          via: 'v',
        }),
      ),
    ).toEqual(['rejected', 'invalid'])
  })

  it('新しい版の形の依頼（v が違う）は触らずに残す', () => {
    const data = dataWith({ items: [task], inbox: [base({ v: 2 })] })
    const r = run(data)
    expect(r.data).toBe(data)
    expect(r.touched.size).toBe(0)
  })
})

describe('提案（19.5 の提案・19.7 の例）', () => {
  const item = meeting()
  const propose = (p: Partial<InboxRecord> = {}): InboxRecord =>
    mkInbox({
      id: 'xp-1',
      op: 'propose',
      proposeOp: 'update',
      table: 'items',
      targetId: item.id,
      baseHash: revOf(item),
      patch: { start: '2026-12-05' },
      why: '山田さんから、12/3 の打ち合わせを 12/5 に変えるとメールがありました',
      via: VIA_B,
      createdAt: new Date(2026, 10, 10, 8, 0).getTime(),
      ...p,
    })

  it('受け付けると、記録は変えずに答え待ちのまま（19.7 の 2.・3.）', () => {
    const data = dataWith({ items: [item], inbox: [propose()] })
    const r = run(data)
    expect(r.data).toBe(data)
    expect(r.data.items[item.id].start).toBe('2026-12-03')
  })

  it('［承認］→ 予定が 12/5 に移り、accepted（アプリで）。undo は提案の記録に控え、記録と提案を1つのまとまりで（19.7 の 4.）', () => {
    const data = dataWith({ items: [item], inbox: [propose()] })
    const { data: out, result, touched } = answerProposal(data, 'xp-1', 'accept', ctx())
    expect(result.status).toBe('accepted')
    expect(out.items[item.id].start).toBe('2026-12-05')
    expect(out.inbox['xp-1']).toMatchObject({
      status: 'accepted',
      answeredVia: 'app',
      appliedAt: T0,
      undo: { before: { start: '2026-12-03' }, after: { start: '2026-12-05' } },
    })
    expect(touched.get('xp-1')).toEqual([`items/${item.id}`, 'inbox/xp-1'])
  })

  it('［承認］した提案は［元に戻す］で戻せる（提案の記録の undo）', () => {
    const accepted = answerProposal(dataWith({ items: [item], inbox: [propose()] }), 'xp-1', 'accept', ctx()).data
    expect(canUndo(accepted, accepted.inbox['xp-1'])).toEqual({ ok: true })
    const back = undoRequest(accepted, 'xp-1', ctx({ now: T0 + HOUR })).data
    expect(back.items[item.id].start).toBe('2026-12-03')
    expect(back.inbox['xp-1']).toMatchObject({ status: 'accepted', undoneAt: T0 + HOUR })
  })

  it('承認して元に戻した提案と同じ中身の提案（同じメールを読み直した）は previously_declined。対象がある間は 90日たっても消さない', () => {
    const accepted = answerProposal(dataWith({ items: [item], inbox: [propose()] }), 'xp-1', 'accept', ctx()).data
    const back = undoRequest(accepted, 'xp-1', ctx({ now: T0 + HOUR })).data
    const again = propose({ id: 'xp-2', createdAt: T0 + 2 * HOUR, baseHash: revOf(back.items[item.id]) })
    const out = run({ ...back, inbox: { ...back.inbox, 'xp-2': again } }, { now: T0 + 2 * HOUR }).data
    expect(out.inbox['xp-2']).toMatchObject({ status: 'rejected', reason: 'previously_declined' })
    const cleaned = cleanupInbox(back, ctx({ now: T0 + INBOX_KEEP_MS + DAY })).data
    expect(cleaned.inbox['xp-1']).toBeDefined()
  })

  it('［拒否］→ 記録は変えずに declined。同じメールを読み直した同じ提案は previously_declined（19.7 の 4.・7.）', () => {
    const declined = answerProposal(dataWith({ items: [item], inbox: [propose()] }), 'xp-1', 'decline', ctx()).data
    expect(declined.inbox['xp-1']).toMatchObject({ status: 'declined', answeredVia: 'app' })
    expect(declined.items[item.id].start).toBe('2026-12-03')
    const again = propose({ id: 'xp-2', createdAt: T0 })
    const out = run({ ...declined, inbox: { ...declined.inbox, 'xp-2': again } }).data
    expect(out.inbox['xp-2']).toMatchObject({ status: 'rejected', reason: 'previously_declined' })
  })

  it('同じ中身の提案が答えを待っている → 新しい方を rejected（duplicate）。中身の違う新しい提案 → 古い方を superseded（replaced）', () => {
    const dup = run(dataWith({ items: [item], inbox: [propose(), propose({ id: 'xp-2', createdAt: T0 })] })).data
    expect(dup.inbox['xp-1'].status).toBe('pending')
    expect(dup.inbox['xp-2']).toMatchObject({ status: 'rejected', reason: 'duplicate' })
    const other = propose({ id: 'xp-3', createdAt: T0, patch: { start: '2026-12-07' } })
    const rep = run(dataWith({ items: [item], inbox: [propose(), other] }))
    expect(rep.data.inbox['xp-1']).toMatchObject({ status: 'superseded', reason: 'replaced', supersededBy: 'xp-3' })
    expect(rep.data.inbox['xp-3'].status).toBe('pending')
    expect(rep.touched.get('xp-1')).toEqual(['inbox/xp-1'])
    // 置き換わった古い提案と同じ中身がもう一度来ても（同じメールの読み直し）、出し直さない。答え待ちは xp-3 のまま
    const again = propose({ id: 'xp-4', createdAt: T0 + 1 })
    const re = run({ ...rep.data, inbox: { ...rep.data.inbox, 'xp-4': again } }).data
    expect(re.inbox['xp-4']).toMatchObject({ status: 'rejected', reason: 'duplicate' })
    expect(re.inbox['xp-3'].status).toBe('pending')
  })

  it('項目が先に変わった: もうその内容 → already_done（19.7 の 6.）、ゴミ箱へ移った → in_trash、消えた → not_found', () => {
    const moved = updateItem(dataWith({ items: [item] }), item.id, { start: '2026-12-05' }, T0 - 1).data
    expect(run({ ...moved, inbox: { 'xp-1': propose() } }).data.inbox['xp-1']).toMatchObject({
      status: 'superseded',
      reason: 'already_done',
    })
    const trashed = trashItem(dataWith({ items: [item] }), item.id).data
    expect(run({ ...trashed, inbox: { 'xp-1': propose() } }).data.inbox['xp-1']).toMatchObject({
      status: 'superseded',
      reason: 'in_trash',
    })
    expect(run(dataWith({ inbox: [propose()] })).data.inbox['xp-1']).toMatchObject({ status: 'superseded', reason: 'not_found' })
  })

  it('当てると決まりに合わない提案は rejected（invalid）。提案の後に作者が直しただけなら取り下げず、［承認］の時に確かめる', () => {
    const bad = propose({ patch: { endTime: '09:00' } })
    expect(run(dataWith({ items: [item], inbox: [bad] })).data.inbox['xp-1']).toMatchObject({
      status: 'rejected',
      reason: 'invalid',
    })
    // 提案の後に作者がメモを直した（19.7 の 6.）
    const edited = updateItem(dataWith({ items: [item] }), item.id, { memo: '資料を持っていく' }, T0 - 1).data
    const data = { ...edited, inbox: { 'xp-1': propose() } }
    expect(run(data).data.inbox['xp-1'].status).toBe('pending')
    const first = answerProposal(data, 'xp-1', 'accept', ctx())
    expect(first.result).toMatchObject({ status: 'needsConfirm', message: 'Claude が読んだ後に、ここで直されています' })
    expect(first.result.status === 'needsConfirm' && first.result.diff).toEqual([
      { field: 'start', current: '2026-12-03', proposed: '2026-12-05' },
    ])
    expect(first.data).toBe(data)
    const second = answerProposal(data, 'xp-1', 'accept', ctx(), { confirmed: true })
    expect(second.data.items[item.id]).toMatchObject({ start: '2026-12-05', memo: '資料を持っていく' })
    expect(second.data.inbox['xp-1'].status).toBe('accepted')
  })

  it('［承認］で当てた後が決まりに合わない時は当てずに理由（提案は答え待ちのまま）', () => {
    // 提案の後に作者が締め切り日を入れた（12/3〜12/4）。開始日を 12/5 にすると締め切り日より後になる
    const edited = updateItem(dataWith({ items: [item] }), item.id, { due: '2026-12-04' }, T0 - 1).data
    const data = { ...edited, inbox: { 'xp-1': propose() } }
    const r = answerProposal(data, 'xp-1', 'accept', ctx(), { confirmed: true })
    expect(r.result).toEqual({ status: 'invalid', message: '開始日が締め切り日より後になります' })
    expect(r.data.inbox['xp-1'].status).toBe('pending')
  })

  it('ゴミ箱へ移す提案の［承認］: ゴミ箱の件の id は te-{提案の id}。札は「Claude の提案」', () => {
    const data = dataWith({ items: [item], inbox: [propose({ proposeOp: 'trash', patch: null })] })
    const { data: out } = answerProposal(data, 'xp-1', 'accept', ctx())
    expect(out.trashEntries['te-xp-1']).toMatchObject({ by: 'connector', inboxId: 'xp-1' })
    expect(out.inbox['xp-1']).toMatchObject({ status: 'accepted', undo: { trashEntryId: 'te-xp-1' } })
  })

  it('［承認］の時に対象が無い・ゴミ箱にある → superseded にして知らせる。答え待ちでない提案は答えられない', () => {
    const trashed = trashItem(dataWith({ items: [item] }), item.id).data
    const r = answerProposal({ ...trashed, inbox: { 'xp-1': propose() } }, 'xp-1', 'accept', ctx())
    expect(r.result).toEqual({ status: 'superseded', message: 'ゴミ箱にあります' })
    expect(r.data.inbox['xp-1']).toMatchObject({ status: 'superseded', reason: 'in_trash' })
    expect(() => answerProposal(r.data, 'xp-1', 'accept', ctx())).toThrow('もう答えが出ています')
  })

  it('30日答えが無ければ expired（記録は元のまま）', () => {
    const old = propose({ createdAt: T0 - 30 * DAY })
    const out = run(dataWith({ items: [item], inbox: [old] })).data
    expect(out.inbox['xp-1'].status).toBe('expired')
    expect(out.items[item.id]).toBe(item)
    expect(run(dataWith({ items: [item], inbox: [propose({ createdAt: T0 - 30 * DAY + 1 })] })).data.inbox['xp-1'].status).toBe(
      'pending',
    )
  })

  it('提案の許可をオフにすると、答え待ちの提案は rejected（not_allowed）', () => {
    const out = run(dataWith({ items: [item], inbox: [propose()] }), { perms: { ...PERMS, proposals: false } }).data
    expect(out.inbox['xp-1']).toMatchObject({ status: 'rejected', reason: 'not_allowed' })
  })

  it('前の依頼（after:）を待っている提案は、その依頼が当たるまで出さない。断られて記録ができなかった時は not_found', () => {
    const p = propose({ baseHash: 'after:xa-1' })
    expect(run(dataWith({ inbox: [p] })).waiting).toEqual(['xp-1'])
    const rejectedAdd = { ...addMeeting(), status: 'rejected' as const, reason: 'invalid' as const, appliedAt: T0 - 1 }
    expect(run(dataWith({ inbox: [p, rejectedAdd] })).data.inbox['xp-1']).toMatchObject({
      status: 'superseded',
      reason: 'not_found',
    })
  })
})

describe('19.7 の例をはじめから（メール A で足し、取り消しのメールでゴミ箱へ移す提案）', () => {
  it('足す → ゴミ箱へ移す提案 →［承認］→ メール A を読み直しても、消した予定は戻らない（previously_deleted）', () => {
    // 11/10 09:00 の作業: メール A から予定を足す
    const step1 = run(dataWith({ inbox: [addMeeting()] })).data
    const id = step1.inbox['xa-1'].targetId
    expect(step1.items[id].start).toBe('2026-12-03')
    // 11/12 10:00 の作業: 取り消しのメールで、ゴミ箱へ移す提案を出す（記録は変えない）
    const t12 = new Date(2026, 10, 12, 10, 0).getTime()
    const cancel = mkInbox({
      id: 'xp-1',
      op: 'propose',
      proposeOp: 'trash',
      table: 'items',
      targetId: id,
      baseHash: revOf(step1.items[id]),
      why: '山田さんから、12/3 の打ち合わせは取りやめとメールがありました',
      via: 'メール: 【中止】12/3 打ち合わせ / 山田さん / 2026-11-12 09:58 / https://mail.google.com/mail/c',
      createdAt: t12,
    })
    const step2 = run({ ...step1, inbox: { ...step1.inbox, 'xp-1': cancel } }, { now: t12 + HOUR }).data
    expect(step2.items[id]).toBeDefined()
    expect(step2.inbox['xp-1'].status).toBe('pending')
    // 作者がアプリで［承認］
    const step3 = answerProposal(step2, 'xp-1', 'accept', ctx({ now: t12 + 2 * HOUR })).data
    expect(step3.items[id]).toBeUndefined()
    expect(step3.trashEntries['te-xp-1']).toMatchObject({ kind: 'event', by: 'connector', inboxId: 'xp-1' })
    // 次の作業がメール A をもう一度読んで、同じ予定を足す依頼を作った
    const reread = addMeeting({ id: 'xa-2', createdAt: t12 + 3 * HOUR })
    const step4 = run({ ...step3, inbox: { ...step3.inbox, 'xa-2': reread } }, { now: t12 + 4 * HOUR }).data
    expect(step4.inbox['xa-2']).toMatchObject({ status: 'rejected', reason: 'previously_deleted' })
    // ゴミ箱から完全に消えた後も、クラウドの削除の印（_gone）で戻らない
    const purged = { ...step3, trashEntries: {}, trashRecords: {}, inbox: { ...step3.inbox, 'xa-2': reread } }
    const step5 = run(purged, { now: t12 + 40 * DAY, isGone: (t, x) => t === 'items' && x === id }).data
    expect(step5.inbox['xa-2']).toMatchObject({ status: 'rejected', reason: 'previously_deleted' })
    expect(step5.items[id]).toBeUndefined()
  })
})

describe('会話で提案に答えた依頼（19.5・19.7 の 5.）', () => {
  const item = meeting()
  const prop = mkInbox({
    id: 'xp-1',
    op: 'propose',
    proposeOp: 'update',
    table: 'items',
    targetId: item.id,
    baseHash: revOf(item),
    patch: { start: '2026-12-05' },
    why: 'w',
    via: VIA_B,
    createdAt: T0 - 2 * HOUR,
  })
  const answer = (p: Partial<InboxRecord> = {}) =>
    mkInbox({
      id: 'xe-2',
      op: 'update',
      table: 'items',
      targetId: item.id,
      baseHash: revOf(item),
      patch: { start: '2026-12-05' },
      requestQuote: 'それでお願い',
      proposalId: 'xp-1',
      createdAt: T0 - HOUR,
      ...p,
    })

  it('依頼が当たると、同じまとまりの中で提案を accepted（会話で・answerId）にする', () => {
    const { data: out, touched } = run(dataWith({ items: [item], inbox: [prop, answer()] }))
    expect(out.items[item.id].start).toBe('2026-12-05')
    expect(out.inbox['xe-2'].status).toBe('applied')
    expect(out.inbox['xp-1']).toMatchObject({ status: 'accepted', answeredVia: 'chat', answerId: 'xe-2', undo: null })
    expect(touched.get('xe-2')).toEqual([`items/${item.id}`, 'inbox/xp-1', 'inbox/xe-2'])
    // 提案の行には［元に戻す］を出さない（依頼の行で戻す）
    expect(canUndo(out, out.inbox['xp-1']).ok).toBe(false)
    expect(() => undoRequest(out, 'xp-1', ctx())).toThrow('その依頼の行')
  })

  it('patch が提案と違えば proposal_mismatch で断り、提案は答え待ちのまま', () => {
    const out = run(dataWith({ items: [item], inbox: [prop, answer({ patch: { start: '2026-12-06' } })] })).data
    expect(out.inbox['xe-2']).toMatchObject({ status: 'rejected', reason: 'proposal_mismatch' })
    expect(out.inbox['xp-1'].status).toBe('pending')
    expect(out.items[item.id].start).toBe('2026-12-03')
  })

  it('依頼が競合した時は、提案を答え待ちのまま残す。競合を［承認］すると提案も accepted', () => {
    const edited = { ...item, memo: '直した' }
    const out = run(dataWith({ items: [edited], inbox: [prop, answer()] })).data
    expect(out.inbox['xe-2']).toMatchObject({ status: 'conflict', reason: 'changed' })
    expect(out.inbox['xp-1'].status).toBe('pending')
    const approved = approveConflict(out, 'xe-2', ctx())
    expect(approved.result.status).toBe('applied')
    expect(approved.data.items[item.id]).toMatchObject({ start: '2026-12-05', memo: '直した' })
    expect(approved.data.inbox['xp-1']).toMatchObject({ status: 'accepted', answeredVia: 'chat' })
  })

  it('指した物が同じ項目の提案でなければ invalid。提案にアプリで先に答えていたら、依頼だけを当てる', () => {
    const other = answer({ targetId: 'other' })
    expect(run(dataWith({ items: [item], inbox: [prop, other] })).data.inbox['xe-2']).toMatchObject({
      status: 'rejected',
      reason: 'invalid',
    })
    const declinedProp = { ...prop, status: 'declined' as const, answeredVia: 'app' as const, appliedAt: T0 - 1 }
    const out = run(dataWith({ items: [item], inbox: [declinedProp, answer()] })).data
    expect(out.inbox['xe-2'].status).toBe('applied')
    expect(out.inbox['xp-1'].status).toBe('declined')
  })
})

describe('競合を選ぶ（18.5）', () => {
  const task = mkTask({ due: '2026-11-20' })
  const conflicted = (data: AppData) => run(data).data

  it('［承認］は今の内容に patch を当てる。［拒否］は rejected（declined）', () => {
    const rec = edit('xe-1', task, { due: '2026-11-27' })
    const out = conflicted(dataWith({ items: [{ ...task, memo: '先方確認中' }], inbox: [rec] }))
    expect(out.inbox['xe-1'].status).toBe('conflict')
    const ok = approveConflict(out, 'xe-1', ctx({ now: T0 + DAY }))
    expect(ok.data.items.t1).toMatchObject({ due: '2026-11-27', memo: '先方確認中' })
    expect(ok.data.inbox['xe-1']).toMatchObject({ status: 'applied', reason: null, appliedAt: T0 + DAY })
    const no = declineConflict(out, 'xe-1', ctx())
    expect(no.data.inbox['xe-1']).toMatchObject({ status: 'rejected', reason: 'declined' })
    expect(no.data.items.t1).toBe(out.items.t1)
  })

  it('［承認］で当てた後が決まりに合わなければ当てずに理由（競合のまま）。ゴミ箱にある時は当てない', () => {
    const ranged = mkTask({ start: '2026-11-10', due: '2026-11-20' })
    const rec = edit('xe-1', ranged, { due: '2026-11-15' })
    const out = conflicted(dataWith({ items: [{ ...ranged, start: '2026-11-16' }], inbox: [rec] }))
    const r = approveConflict(out, 'xe-1', ctx())
    expect(r.result).toEqual({ status: 'invalid', message: '開始日が締め切り日より後になります' })
    expect(r.data.inbox['xe-1'].status).toBe('conflict')
    const trashed = trashItem(out, 't1').data
    expect(approveConflict(trashed, 'xe-1', ctx()).result.status).toBe('blocked')
  })

  it('stale のゴミ箱への依頼を［承認］するとゴミ箱へ移す', () => {
    const rec = mkInbox({
      id: 'xe-t',
      op: 'trash',
      table: 'items',
      targetId: 't1',
      baseHash: revOf(task),
      requestQuote: 'q',
      createdAt: T0 - 10 * DAY,
    })
    const out = conflicted(dataWith({ items: [task], inbox: [rec] }))
    expect(out.inbox['xe-t']).toMatchObject({ status: 'conflict', reason: 'stale' })
    const ok = approveConflict(out, 'xe-t', ctx())
    expect(ok.data.trashEntries['te-xe-t']).toBeDefined()
    expect(ok.data.items.t1).toBeUndefined()
  })
})

describe('元に戻す（18.5）', () => {
  it('足した予定: ゴミ箱へ移す（30日は戻せる）。その後に直されていたら確かめる', () => {
    const added = run(dataWith({ inbox: [addMeeting()] })).data
    const id = added.inbox['xa-1'].targetId
    const r = undoRequest(added, 'xa-1', ctx())
    expect(r.result.status).toBe('done')
    expect(r.data.items[id]).toBeUndefined()
    expect(r.data.trashEntries['te-u-xa-1']).toMatchObject({ by: 'user', kind: 'event' })
    expect(r.data.inbox['xa-1']).toMatchObject({ undoneAt: T0, message: '元に戻しました' })
    expect(canUndo(r.data, r.data.inbox['xa-1'])).toEqual({ ok: false, message: '元に戻しました' })
    // その後に直されていた
    const edited = updateItem(added, id, { memo: '会議室A' }, T0 + 1).data
    const ask = undoRequest(edited, 'xa-1', ctx())
    expect(ask.result).toMatchObject({ status: 'needsConfirm', message: '足した後に直されています。ゴミ箱へ移しますか？' })
    expect(ask.data).toBe(edited)
    expect(undoRequest(edited, 'xa-1', ctx(), { confirmed: true }).data.items[id]).toBeUndefined()
  })

  it('足した休みは外す（記録は残る）。その後の同じ日への足す依頼は previously_deleted。呼び名は消す（空にする）', () => {
    const rec = mkInbox({
      id: 'xa-1',
      op: 'add',
      table: 'offDays',
      targetId: '2026-11-20',
      patch: { date: '2026-11-20' },
      via: 'v',
    })
    const added = run(dataWith({ inbox: [rec] })).data
    const undone = undoRequest(added, 'xa-1', ctx()).data
    expect(undone.offDays['2026-11-20']).toMatchObject({ off: false, by: 'connector' })
    const again = mkInbox({
      id: 'xa-2',
      op: 'add',
      table: 'offDays',
      targetId: '2026-11-20',
      patch: { date: '2026-11-20' },
      via: 'v',
    })
    expect(run({ ...undone, inbox: { ...undone.inbox, 'xa-2': again } }).data.inbox['xa-2'].reason).toBe('previously_deleted')
    const name = mkInbox({
      id: 'xa-3',
      op: 'add',
      table: 'labelNames',
      targetId: 'sky-l',
      patch: { key: 'sky-l', name: '会議' },
      via: 'v',
    })
    const named = run(dataWith({ inbox: [name] })).data
    expect(undoRequest(named, 'xa-3', ctx()).data.labelNames['sky-l'].name).toBe('')
  })

  it('直した物: 今の値が undo.after と同じ項目だけを戻す。その後に直された項目は戻さず、確かめる', () => {
    const task = mkTask({ due: '2026-11-20', title: '見積書' })
    const applied = run(
      dataWith({ items: [task], inbox: [edit('xe-1', task, { due: '2026-11-27', title: '見積書（改訂）' })] }),
    ).data
    expect(undoRequest(applied, 'xe-1', ctx()).data.items.t1).toMatchObject({ due: '2026-11-20', title: '見積書' })
    const later = updateItem(applied, 't1', { due: '2026-11-30' }, T0 + 1).data
    const ask = undoRequest(later, 'xe-1', ctx())
    expect(ask.result).toEqual({
      status: 'needsConfirm',
      message: 'その後に直された項目（締め切り日）は戻しません',
      skipped: ['due'],
    })
    const done = undoRequest(later, 'xe-1', ctx(), { confirmed: true }).data
    expect(done.items.t1).toMatchObject({ due: '2026-11-30', title: '見積書' })
  })

  it('日付と時刻は組で戻す: その後に1つでも直されていたら、組のほかも戻さない（開始日が締め切り日の後にならない）', () => {
    const item = mkItem({ start: '2026-11-20', due: '2026-11-22' })
    const applied = run(dataWith({ items: [item], inbox: [edit('xe-1', item, { start: '2026-11-01', due: '2026-11-03' })] })).data
    const later = updateItem(applied, 'i1', { due: '2026-11-02' }, T0 + 1).data
    const ask = undoRequest(later, 'xe-1', ctx())
    expect(ask.result).toEqual({
      status: 'needsConfirm',
      message: 'その後に直された項目（締め切り日）と、戻すと組み合わせが合わなくなる項目（開始日）は戻しません',
      skipped: ['due', 'start'],
    })
    const done = undoRequest(later, 'xe-1', ctx(), { confirmed: true })
    expect(done.data.items.i1).toMatchObject({ start: '2026-11-01', due: '2026-11-02' })
    expect(done.result).toEqual({ status: 'done', message: '2項目は戻していません' })
    // 時刻も同じ（1日の予定で 14:00-09:30 にしない）
    const timed = mkItem({ id: 'i2', startTime: '14:00', endTime: '15:00' })
    const a2 = run(dataWith({ items: [timed], inbox: [edit('xe-2', timed, { startTime: '09:00', endTime: '10:00' })] })).data
    const l2 = updateItem(a2, 'i2', { endTime: '09:30' }, T0 + 1).data
    const d2 = undoRequest(l2, 'xe-2', ctx(), { confirmed: true }).data.items.i2
    expect([d2.startTime, d2.endTime]).toEqual(['09:00', '09:30'])
  })

  it('直されていなくても、戻すと決まりに合わなくなる項目は戻さず、確かめる（開始日の後の締め切り日・どこにも出ないタスク）', () => {
    const item = mkItem({ start: '2026-11-20', due: '2026-11-22' })
    const applied = run(dataWith({ items: [item], inbox: [edit('xe-1', item, { due: '2026-11-25' })] })).data
    const later = updateItem(applied, 'i1', { start: '2026-11-24' }, T0 + 1).data
    expect(undoRequest(later, 'xe-1', ctx()).result).toEqual({
      status: 'needsConfirm',
      message: '戻すと組み合わせが合わなくなる項目（締め切り日）は戻しません',
      skipped: ['due'],
    })
    expect(undoRequest(later, 'xe-1', ctx(), { confirmed: true }).data.items.i1).toMatchObject({
      start: '2026-11-24',
      due: '2026-11-25',
    })
    const task = mkTask()
    const a2 = run(dataWith({ items: [task], inbox: [edit('xe-2', task, { due: '2026-11-30' })] })).data
    const l2 = updateItem(a2, 't1', { listed: false }, T0 + 1).data
    const d2 = undoRequest(l2, 'xe-2', ctx(), { confirmed: true }).data.items.t1
    expect([d2.due, d2.listed]).toEqual(['2026-11-30', false])
  })

  it('ルーチンの指定（種類・曜日・日・月日）は組で戻す', () => {
    const routine = mkRoutine({ cycle: 'weekly', weekdays: [1] })
    const rec = mkInbox({
      id: 'xe-r',
      op: 'update',
      table: 'routines',
      targetId: 'r1',
      baseHash: revOf(routine),
      patch: { cycle: 'monthly', weekdays: [], monthDay: 25 },
      requestQuote: '毎月25日にして',
      createdAt: T0 - HOUR,
    })
    const applied = run(dataWith({ routines: [routine], inbox: [rec] })).data
    expect(applied.routines.r1).toMatchObject({ cycle: 'monthly', monthDay: 25 })
    const later = { ...applied, routines: { r1: { ...applied.routines.r1, monthDay: 20, updatedAt: T0 + 1 } } }
    const ask = undoRequest(later, 'xe-r', ctx())
    expect(ask.result).toMatchObject({ status: 'needsConfirm', skipped: ['monthDay', 'cycle', 'weekdays'] })
    expect(undoRequest(later, 'xe-r', ctx(), { confirmed: true }).data.routines.r1).toMatchObject({
      cycle: 'monthly',
      weekdays: [],
      monthDay: 20,
    })
  })

  it('長い値（指紋にした after）も、今の値の指紋と比べて戻す', () => {
    const task = mkTask()
    const memo = 'メモ'.repeat(150)
    const applied = run(dataWith({ items: [task], inbox: [edit('xe-1', task, { memo })] })).data
    expect(undoRequest(applied, 'xe-1', ctx()).data.items.t1.memo).toBe('')
  })

  it('ゴミ箱へ移した物: ゴミ箱から戻す。ゴミ箱から消えていれば押せない', () => {
    const item = meeting()
    const rec = mkInbox({ id: 'xe-t', op: 'trash', table: 'items', targetId: item.id, baseHash: revOf(item), requestQuote: 'q' })
    const applied = run(dataWith({ items: [item], inbox: [rec] })).data
    const back = undoRequest(applied, 'xe-t', ctx()).data
    expect(back.items[item.id]).toEqual(item)
    const purged = { ...applied, trashEntries: {}, trashRecords: {} }
    expect(canUndo(purged, purged.inbox['xe-t'])).toEqual({ ok: false, message: 'ゴミ箱から消えています' })
  })

  it('足した物・直した物の対象がゴミ箱にある時は押せない（ゴミ箱の中には書き戻さない）', () => {
    const added = run(dataWith({ inbox: [addMeeting()] })).data
    const trashed = trashItem(added, added.inbox['xa-1'].targetId).data
    expect(canUndo(trashed, trashed.inbox['xa-1'])).toEqual({ ok: false, message: 'ゴミ箱にあります（戻してから元に戻せます）' })
    expect(() => undoRequest(trashed, 'xa-1', ctx())).toThrow('ゴミ箱にあります')
  })
})

describe('2台で同じ依頼を当てる（2.10・19.5・6.10）', () => {
  it('足す: 2台が同時に当てても、作る記録は同じ id・同じ中身（1回分）。結果の組は appliedAt の早い方', () => {
    const data = dataWith({ inbox: [addMeeting()] })
    const a = processInbox(data, ctx({ now: T0 })).data
    const b = processInbox(data, ctx({ now: T0 + 5000 })).data
    const id = a.inbox['xa-1'].targetId
    expect(b.items[id]).toEqual(a.items[id])
    expect(strongerInboxOutcome(b.inbox['xa-1'], a.inbox['xa-1'])).toBe(a.inbox['xa-1'])
  })

  it('記録だけが先に届いた端末は duplicate で断るが、結果の組は当てた方の applied にまとまる（6.10）', () => {
    const data = dataWith({ inbox: [addMeeting()] })
    const a = processInbox(data, ctx()).data
    const id = a.inbox['xa-1'].targetId
    // B には、A が作った記録だけが届き、受け取り箱の記録はまだ pending
    const b = processInbox({ ...data, items: { [id]: a.items[id] } }, ctx({ now: T0 - 1000 })).data
    expect(b.inbox['xa-1']).toMatchObject({ status: 'rejected', reason: 'duplicate' })
    const merged = combineInboxOutcomes(b.inbox['xa-1'], a.inbox['xa-1'])
    expect(merged).toMatchObject({ status: 'applied', reason: null, undo: a.inbox['xa-1'].undo, appliedAt: T0 })
  })

  it('直す: 片方は当て、片方は「もう当たっていました」。B の時計が遅れていても、元に戻す値のある A の組を採る', () => {
    const task = mkTask({ due: '2026-11-20' })
    const data = dataWith({ items: [task], inbox: [edit('xe-1', task, { due: '2026-11-27' })] })
    const a = processInbox(data, ctx({ now: T0 })).data
    const b = processInbox({ ...data, items: a.items }, ctx({ now: T0 - 60_000 })).data
    expect(b.inbox['xe-1']).toMatchObject({ status: 'applied', message: 'もう当たっていました' })
    const merged = combineInboxOutcomes(b.inbox['xe-1'], a.inbox['xe-1'])
    expect(merged.undo).toEqual(a.inbox['xe-1'].undo)
    expect(compareInboxOutcome(a.inbox['xe-1'], b.inbox['xe-1'])).toBeGreaterThan(0)
  })

  it('直す: 2台が同時に当てて直した日時だけが違う記録になっても、後の after: の依頼は要らない競合にならない（形2）', () => {
    const task = mkTask({ due: '2026-11-20' })
    const data = dataWith({ items: [task], inbox: [edit('xe-1', task, { due: '2026-11-27' })] })
    const a = processInbox(data, ctx({ now: T0 })).data
    const b = processInbox(data, ctx({ now: T0 + 5000 })).data
    expect(a.items.t1.updatedAt).not.toBe(b.items.t1.updatedAt)
    // マージで記録は B の、受け取り箱の組は A の物が残った
    const merged: AppData = { ...b, inbox: { 'xe-1': combineInboxOutcomes(b.inbox['xe-1'], a.inbox['xe-1']) } }
    const next = mkInbox({
      id: 'xe-2',
      op: 'update',
      table: 'items',
      targetId: 't1',
      baseHash: 'after:xe-1',
      patch: { memo: '提出先は総務' },
      requestQuote: 'メモも直して',
    })
    const out = processInbox({ ...merged, inbox: { ...merged.inbox, 'xe-2': next } }, ctx({ now: T0 + DAY })).data
    expect(out.inbox['xe-2'].status).toBe('applied')
  })

  it('やりたいことを2台で足して order だけが違っても、指紋は同じ（形2）', () => {
    const fav = { text: '積んでいる本を読む' }
    const rec = mkInbox({ id: 'xa-f', op: 'add', table: 'favorites', targetId: derivedFavoriteId(fav), patch: fav, via: 'v' })
    const a = processInbox(dataWith({ inbox: [rec], favorites: [mkFavorite({ id: 'x', order: -5 })] }), ctx()).data
    const b = processInbox(dataWith({ inbox: [rec] }), ctx()).data
    const id = rec.targetId
    expect(a.favorites[id].order).not.toBe(b.favorites[id].order)
    expect(revOf(a.favorites[id])).toBe(revOf(b.favorites[id]))
  })

  it('ゴミ箱へ: 2台が同時に当てても、ゴミ箱の件と中身の id が同じで1件にまとまる', () => {
    const item = meeting()
    const rec = mkInbox({ id: 'xe-t', op: 'trash', table: 'items', targetId: item.id, baseHash: revOf(item), requestQuote: 'q' })
    const a = processInbox(dataWith({ items: [item], inbox: [rec] }), ctx({ now: T0 })).data
    const b = processInbox(dataWith({ items: [item], inbox: [rec] }), ctx({ now: T0 + 1 })).data
    expect(Object.keys(a.trashEntries)).toEqual(Object.keys(b.trashEntries))
    expect(Object.keys(a.trashRecords)).toEqual(Object.keys(b.trashRecords))
    expect(a.trashRecords['tr-xe-t'].record).toEqual(b.trashRecords['tr-xe-t'].record)
  })

  it('同じ提案に2台で別々に答えた（片方で［承認］・片方で［拒否］や取り下げ）→ accepted の組にまとまる', () => {
    const item = meeting()
    const prop = mkInbox({
      id: 'xp-1',
      op: 'propose',
      proposeOp: 'update',
      table: 'items',
      targetId: item.id,
      baseHash: revOf(item),
      patch: { start: '2026-12-05' },
      why: 'w',
      via: 'v',
    })
    const data = dataWith({ items: [item], inbox: [prop] })
    const a = answerProposal(data, 'xp-1', 'accept', ctx({ now: T0 + 10 })).data.inbox['xp-1']
    const b = answerProposal(data, 'xp-1', 'decline', ctx({ now: T0 })).data.inbox['xp-1']
    expect(combineInboxOutcomes(b, a)).toMatchObject({ status: 'accepted', answeredVia: 'app', undo: a.undo, appliedAt: T0 + 10 })
    const superseded = {
      ...prop,
      status: 'superseded' as const,
      reason: 'replaced' as const,
      supersededBy: 'xp-2',
      appliedAt: T0,
    }
    expect(combineInboxOutcomes(superseded, a)).toMatchObject({ status: 'accepted', supersededBy: null })
    expect(strongerInboxOutcome(a, b)).toBe(a)
  })
})

describe('6.10 の強さの順', () => {
  it('依頼: applied ＞ conflict ＞ rejected ＞ pending。提案: accepted ＞ declined ＞ superseded ＞ expired ＞ rejected ＞ pending', () => {
    const req = Object.entries(REQUEST_STATUS_RANK)
      .sort((x, y) => y[1] - x[1])
      .map(([k]) => k)
    expect(req).toEqual(['applied', 'conflict', 'rejected', 'pending'])
    const prop = Object.entries(PROPOSAL_STATUS_RANK)
      .sort((x, y) => y[1] - x[1])
      .map(([k]) => k)
    expect(prop).toEqual(['accepted', 'declined', 'superseded', 'expired', 'rejected', 'pending'])
    expect(STATUS_RANK.request).toBe(REQUEST_STATUS_RANK)
  })

  it('同じ強さなら appliedAt の早い方。undoneAt は入っている方', () => {
    const x = mkInbox({ id: 'xe-1', op: 'update', table: 'items', targetId: 't', status: 'conflict', appliedAt: T0 })
    const y = { ...x, appliedAt: T0 + 1, undoneAt: null }
    expect(strongerInboxOutcome(y, x)).toBe(x)
    const undone = { ...x, status: 'applied' as const, undo: { afterHash: 'h' }, undoneAt: T0 + 9 }
    expect(combineInboxOutcomes(undone, { ...undone, undoneAt: null, appliedAt: T0 - 1 }).undoneAt).toBe(T0 + 9)
    expect(inboxGroupFields(x)).toEqual(['status', 'reason', 'message', 'appliedAt', 'undo'])
    expect(inboxGroupFields({ op: 'propose' })).toContain('supersededBy')
  })
})

describe('掃除（6.14）', () => {
  const applied = mkInbox({
    id: 'xa-1',
    op: 'add',
    table: 'items',
    targetId: 'ce-x',
    status: 'applied',
    appliedAt: T0,
    updatedAt: T0,
  })

  it('処理して 90日たった applied・rejected は消す（89日は残す）。pending は消さない', () => {
    const data = dataWith({
      inbox: [applied, mkInbox({ id: 'xa-2', op: 'add', table: 'items', targetId: 'ce-y', createdAt: T0 - 400 * DAY })],
    })
    expect(cleanupInbox(data, ctx({ now: T0 + INBOX_KEEP_MS - 1 })).data).toBe(data)
    const r = cleanupInbox(data, ctx({ now: T0 + INBOX_KEEP_MS }))
    expect(Object.keys(r.data.inbox)).toEqual(['xa-2'])
    expect(r.touched.get('xa-1')).toEqual(['inbox/xa-1'])
  })

  it('conflict は 90日たっても選ばれなければ当てずに rejected（expired）', () => {
    const c = { ...applied, id: 'xe-1', op: 'update' as const, status: 'conflict' as const, reason: 'changed' as const }
    const out = cleanupInbox(dataWith({ inbox: [c] }), ctx({ now: T0 + INBOX_KEEP_MS })).data
    expect(out.inbox['xe-1']).toMatchObject({ status: 'rejected', reason: 'expired' })
  })

  it('declined・expired の提案は対象がある間は消さない。対象が無くなったら、処理して 90日で消す', () => {
    const item = mkItem({ id: 'ce-x' })
    const declined = mkInbox({
      id: 'xp-1',
      op: 'propose',
      proposeOp: 'trash',
      table: 'items',
      targetId: 'ce-x',
      status: 'declined',
      appliedAt: T0,
      updatedAt: T0,
    })
    const kept = cleanupInbox(dataWith({ items: [item], inbox: [declined] }), ctx({ now: T0 + 400 * DAY }))
    expect(kept.data.inbox['xp-1']).toBe(declined)
    // ゴミ箱にある間も残す
    const trashed = trashItem(dataWith({ items: [item], inbox: [declined] }), 'ce-x').data
    expect(cleanupInbox(trashed, ctx({ now: T0 + 400 * DAY })).data.inbox['xp-1']).toBe(declined)
    // 対象が無い: 処理して 90日たつまでは残し（書き直しもしない）、90日で消す
    const gone = dataWith({ inbox: [declined] })
    expect(cleanupInbox(gone, ctx({ now: T0 + INBOX_KEEP_MS - 1 })).data).toBe(gone)
    expect(cleanupInbox(gone, ctx({ now: T0 + INBOX_KEEP_MS })).data.inbox['xp-1']).toBeUndefined()
  })

  it('accepted・superseded・rejected の提案は処理して 90日で消す', () => {
    const acc = mkInbox({
      id: 'xp-2',
      op: 'propose',
      proposeOp: 'update',
      table: 'items',
      targetId: 'ce-x',
      status: 'superseded',
      appliedAt: T0,
    })
    expect(cleanupInbox(dataWith({ inbox: [acc] }), ctx({ now: T0 + INBOX_KEEP_MS })).data.inbox).toEqual({})
  })
})

describe('コネクタが作った形の確かめ（6.14。アクセスルールは json の中を見られないので、アプリが当てる前に断る）', () => {
  it('結果の項目（answeredVia・answerId・supersededBy・undoneAt など）が入った依頼は invalid。当てた後に偽の値が残らない', () => {
    const forged = addMeeting({ undoneAt: 123, answeredVia: 'chat', answerId: 'xe-forged', supersededBy: 'xp-forged' })
    const out = run(dataWith({ inbox: [forged] })).data
    expect(out.inbox['xa-1']).toMatchObject({
      status: 'rejected',
      reason: 'invalid',
      undoneAt: null,
      answeredVia: null,
      answerId: null,
      supersededBy: null,
    })
    expect(Object.keys(out.items)).toEqual([])
    for (const f of ['reason', 'message', 'appliedAt', 'undo'] as const) {
      const bad = addMeeting({ [f]: f === 'appliedAt' ? T0 : f === 'undo' ? { created: true, afterHash: 'h' } : 'x' })
      expect(run(dataWith({ inbox: [bad] })).data.inbox['xa-1'].reason).toBe('invalid')
    }
  })

  it('updatedAt が createdAt と違う依頼は invalid', () => {
    const out = run(dataWith({ inbox: [addMeeting({ updatedAt: T0 })] })).data
    expect(out.inbox['xa-1']).toMatchObject({ status: 'rejected', reason: 'invalid' })
  })

  it('v が整数でない・1 より小さい依頼は invalid。1 より新しい版の依頼は触らずに残す（掃除もしない）', () => {
    for (const v of [0, 1.5, '1', null]) {
      const out = run(dataWith({ inbox: [addMeeting({ v: v as never })] })).data
      expect(out.inbox['xa-1']).toMatchObject({ status: 'rejected', reason: 'invalid' })
    }
    const newer = addMeeting({ v: 2 })
    expect(run(dataWith({ inbox: [newer] })).data.inbox['xa-1']).toBe(newer)
    const done = { ...newer, status: 'applied' as const, appliedAt: T0 }
    expect(cleanupInbox(dataWith({ inbox: [done] }), ctx({ now: T0 + 400 * DAY })).data.inbox['xa-1']).toBe(done)
    // 断った古い形の依頼は、ほかと同じに 90日で消す
    const rejected = run(dataWith({ inbox: [addMeeting({ v: 0 })] })).data
    expect(cleanupInbox(rejected, ctx({ now: T0 + INBOX_KEEP_MS })).data.inbox).toEqual({})
  })

  it('［元に戻す］は、この依頼で移したゴミ箱の件だけを戻す。足した物を戻すのは Claude が足した記録だけ', () => {
    // 作者が消した MIM のメモの件を指す、作られた時から applied の記録
    const mine = trashItem(dataWith({ items: [mkItem({ id: 'i1', title: '作者が消した' })] }), 'i1')
    const forged = mkInbox({
      id: 'xe-forged',
      op: 'trash',
      table: 'items',
      targetId: 'i1',
      status: 'applied',
      appliedAt: T0,
      undo: { trashEntryId: mine.result },
    })
    const d1 = { ...mine.data, inbox: { [forged.id]: forged } }
    expect(canUndo(d1, forged)).toEqual({ ok: false, message: null })
    expect(() => undoRequest(d1, forged.id, ctx())).toThrow()
    // 作者が作った予定を指す「足した」記録
    const userItem = mkItem({ id: 'i2', by: 'user' })
    const forgedAdd = mkInbox({
      id: 'xa-forged',
      op: 'add',
      table: 'items',
      targetId: 'i2',
      status: 'applied',
      appliedAt: T0,
      undo: { created: true, afterHash: revOf(userItem) },
    })
    const d2 = dataWith({ items: [userItem], inbox: [forgedAdd] })
    expect(canUndo(d2, forgedAdd)).toEqual({ ok: false, message: null })
  })

  it('依頼で直した予定にも、日付と時刻の並びの直し（書き戻す3つ）を重ねて書く（形3）', () => {
    // 2台の同期で start > due になった予定の件名を直す
    const broken = mkItem({ id: 'i1', start: '2026-11-15', due: '2026-11-12' })
    const out = run(dataWith({ items: [broken], inbox: [edit('xe-1', broken, { title: '研修（変更）' })] })).data
    expect(out.inbox['xe-1'].status).toBe('applied')
    expect(out.items.i1).toMatchObject({ title: '研修（変更）', start: '2026-11-15', due: '2026-11-15' })
  })
})

describe('日付の確かめ', () => {
  it('テストの今は 2026-11-10（火）', () => {
    expect(addDaysYmd('2026-11-10', 0)).toBe('2026-11-10')
  })
})
