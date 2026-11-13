// 端末ごとの表示の設定（docs/SPEC.md の 4.2・6.13）とお知らせ。NS の src/store/uiStore.test.ts から
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PREFS, migratePrefs, PREFS_KEY, PREFS_VERSION, resolveAppearance } from './uiStore'

describe('表示の設定の読み直し（migratePrefs）', () => {
  it('初めは「端末の設定に合わせる」・起動アニメーションはオン・マンスリー・リストは開く・「済み n件」は畳む', () => {
    expect(DEFAULT_PREFS).toEqual({
      appearance: 'system',
      launchAnimation: true,
      lastMode: 'month',
      routineAddCycle: 'daily',
      collapsed: {
        routine: false,
        task: false,
        favorite: false,
        routineGroups: { daily: false, weekly: false, monthly: false, quarterly: false, yearly: false },
        routineDone: { daily: true, weekly: true, monthly: true, quarterly: true, yearly: true },
        taskDone: true,
        favoriteDone: true,
      },
    })
    expect(PREFS_KEY).toBe('diary-studio:prefs')
  })

  it('保存した設定はそのまま読む（保存形式の版 v は設定の値に含めない）', () => {
    const prefs = migratePrefs({
      v: PREFS_VERSION,
      appearance: 'deep-dark',
      launchAnimation: false,
      lastMode: 'week',
      routineAddCycle: 'quarterly',
      collapsed: { task: true, routineGroups: { weekly: true }, routineDone: { yearly: false }, favoriteDone: false },
    })
    expect(prefs.appearance).toBe('deep-dark')
    expect(prefs.launchAnimation).toBe(false)
    expect(prefs.lastMode).toBe('week')
    expect(prefs.routineAddCycle).toBe('quarterly')
    expect(prefs.collapsed.task).toBe(true)
    expect(prefs.collapsed.routine).toBe(false)
    expect(prefs.collapsed.routineGroups).toEqual({ daily: false, weekly: true, monthly: false, quarterly: false, yearly: false })
    expect(prefs.collapsed.routineDone.yearly).toBe(false)
    expect(prefs.collapsed.routineDone.daily).toBe(true)
    expect(prefs.collapsed.favoriteDone).toBe(false)
    expect(prefs.collapsed.taskDone).toBe(true)
    expect(prefs).not.toHaveProperty('v')
  })

  it('外観は4つのどれか。NS の項目名（theme）・NS 1.x の light は読まない', () => {
    for (const a of ['system', 'white', 'dark', 'deep-dark'] as const) expect(migratePrefs({ appearance: a }).appearance).toBe(a)
    expect(migratePrefs({ appearance: 'light' }).appearance).toBe('system')
    expect(migratePrefs({ theme: 'dark' }).appearance).toBe('system')
  })

  it('知らない値・型の違う値・壊れたデータは既定値にする', () => {
    expect(
      migratePrefs({
        appearance: 'sepia',
        launchAnimation: 'off',
        lastMode: 'quarter',
        routineAddCycle: 'hourly',
        collapsed: { routine: 'yes', routineGroups: [true], routineDone: null },
        extra: 1,
      }),
    ).toEqual(DEFAULT_PREFS)
    expect(migratePrefs(null)).toEqual(DEFAULT_PREFS)
    expect(migratePrefs('dark')).toEqual(DEFAULT_PREFS)
    expect(migratePrefs([1, 2])).toEqual(DEFAULT_PREFS)
  })
})

describe('外観の決定（resolveAppearance）', () => {
  it('「端末の設定に合わせる」は端末がダークならダーク、そうでなければホワイト', () => {
    expect(resolveAppearance('system', true)).toBe('dark')
    expect(resolveAppearance('system', false)).toBe('white')
  })

  it('選んだ外観は端末の設定によらずそのまま', () => {
    for (const systemDark of [true, false]) {
      expect(resolveAppearance('white', systemDark)).toBe('white')
      expect(resolveAppearance('dark', systemDark)).toBe('dark')
      expect(resolveAppearance('deep-dark', systemDark)).toBe('deep-dark')
    }
  })
})

describe('起動時の読み込みと保存', () => {
  afterEach(() => {
    localStorage.clear()
    vi.resetModules()
  })

  it('保存した設定を読み込み、変えると版つきで書く（起動アニメーションの launch.js が読む appearance・launchAnimation も入る）', async () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ v: 1, appearance: 'dark', lastMode: 'day' }))
    vi.resetModules()
    const { usePrefs } = await import('./uiStore')
    expect(usePrefs.getState().appearance).toBe('dark')
    expect(usePrefs.getState().lastMode).toBe('day')

    usePrefs.getState().setPrefs({ appearance: 'deep-dark', launchAnimation: false })
    usePrefs.getState().setCollapsed({ favorite: true })
    const stored = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Record<string, unknown>
    expect(stored).toMatchObject({ v: PREFS_VERSION, appearance: 'deep-dark', launchAnimation: false, lastMode: 'day' })
    expect(stored.collapsed).toMatchObject({ favorite: true, routine: false })
    expect(stored).not.toHaveProperty('setPrefs')

    vi.resetModules()
    const again = await import('./uiStore')
    expect(again.usePrefs.getState().appearance).toBe('deep-dark')
    expect(again.usePrefs.getState().collapsed.favorite).toBe(true)
  })

  it('使わなくなった「詳しく」の開閉（detailsOpen）は読まず、次に保存した時に消える（直さずに捨てる。6.13）', async () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ v: 1, lastMode: 'week', detailsOpen: true }))
    expect(migratePrefs({ v: 1, lastMode: 'week', detailsOpen: true })).not.toHaveProperty('detailsOpen')
    vi.resetModules()
    const { usePrefs } = await import('./uiStore')
    expect(usePrefs.getState().lastMode).toBe('week')
    expect(usePrefs.getState()).not.toHaveProperty('detailsOpen')
    usePrefs.getState().setPrefs({ lastMode: 'day' })
    const stored = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Record<string, unknown>
    expect(stored).toMatchObject({ v: PREFS_VERSION, lastMode: 'day' })
    expect(stored).not.toHaveProperty('detailsOpen')
  })

  it('保存内容が壊れていても既定値で起動する', async () => {
    localStorage.setItem(PREFS_KEY, '{not json')
    vi.resetModules()
    const { usePrefs } = await import('./uiStore')
    expect(usePrefs.getState().appearance).toBe('system')
    expect(usePrefs.getState().launchAnimation).toBe(true)
  })
})

describe('S・M の縦に積んだリスト（useStackedLists）', () => {
  afterEach(() => {
    localStorage.clear()
    vi.resetModules()
  })

  it('アプリを開くたびに3つとも畳んで始まり、開いた状態は端末に覚えない（L の右の列の collapsed とは別）', async () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ v: 1, collapsed: { routine: false, task: false, favorite: false } }))
    vi.resetModules()
    const first = await import('./uiStore')
    expect(first.useStackedLists.getState().collapsed).toEqual({ routine: true, task: true, favorite: true })
    first.useStackedLists.getState().setCollapsed('task', false)
    expect(first.useStackedLists.getState().collapsed).toEqual({ routine: true, task: false, favorite: true })
    expect(first.usePrefs.getState().collapsed.task).toBe(false)
    const stored = localStorage.getItem(PREFS_KEY) ?? ''

    // 開き直すと、また3つとも畳んで始まる（端末の設定は変わらない）
    vi.resetModules()
    const again = await import('./uiStore')
    expect(again.useStackedLists.getState().collapsed).toEqual({ routine: true, task: true, favorite: true })
    expect(localStorage.getItem(PREFS_KEY)).toBe(stored)
  })
})

describe('お知らせ（トースト）', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.resetModules()
  })

  it('ふつうは4秒、ボタン付き・エラーは6秒で消える。3つまで重ねる', async () => {
    vi.useFakeTimers()
    vi.resetModules()
    const { notify, notifyError, useToasts } = await import('./uiStore')
    notify('ふつう')
    notify('ボタン付き', { label: '元に戻す', run: () => {} })
    notifyError('エラー')
    expect(useToasts.getState().toasts.map((t) => t.message)).toEqual(['ふつう', 'ボタン付き', 'エラー'])
    vi.advanceTimersByTime(4000)
    expect(useToasts.getState().toasts.map((t) => t.message)).toEqual(['ボタン付き', 'エラー'])
    vi.advanceTimersByTime(2000)
    expect(useToasts.getState().toasts).toEqual([])

    for (const m of ['1', '2', '3', '4']) notify(m)
    expect(useToasts.getState().toasts.map((t) => t.message)).toEqual(['2', '3', '4'])
  })

  it('［OK］まで出すお知らせ（notifyUntilOk）: 時間では消えない。同じ置き場所の物は置き換え、ほかのお知らせとは重ねる（■26）', async () => {
    vi.useFakeTimers()
    vi.resetModules()
    const { notify, notifyUntilOk, useToasts } = await import('./uiStore')
    const first = notifyUntilOk('元に戻しました：ひとつめ', { slot: 'undo' })
    notify('ふつう')
    expect(useToasts.getState().toasts.map((t) => [t.message, t.untilOk ?? false])).toEqual([
      ['元に戻しました：ひとつめ', true],
      ['ふつう', false],
    ])
    vi.advanceTimersByTime(60_000)
    expect(useToasts.getState().toasts.map((t) => t.message)).toEqual(['元に戻しました：ひとつめ'])
    // 同じ置き場所（slot）の次の物は、前の物を置き換える（重ねない）。エラーの形でも同じ置き場所
    const second = notifyUntilOk('ほかの所で直されたので戻せません', { kind: 'error', slot: 'undo' })
    expect(second).not.toBe(first)
    expect(useToasts.getState().toasts.map((t) => [t.kind, t.message, t.untilOk])).toEqual([
      ['error', 'ほかの所で直されたので戻せません', true],
    ])
    vi.advanceTimersByTime(60_000)
    expect(useToasts.getState().toasts).toHaveLength(1)
    // ［OK］（dismiss）で消える
    useToasts.getState().dismiss(second)
    expect(useToasts.getState().toasts).toEqual([])
  })
})

describe('操作の失敗の知らせ（attempt・attemptAsync）', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('attemptAsync: 成功した時は結果を返し、お知らせは出さない', async () => {
    const { attemptAsync, useToasts } = await import('./uiStore')
    useToasts.setState({ toasts: [] })
    expect(await attemptAsync(async () => 'entry-1')).toBe('entry-1')
    expect(useToasts.getState().toasts).toEqual([])
  })

  it('attemptAsync: Promise の失敗も受けて、undefined を返し、エラーのお知らせにする（attempt は Promise の失敗を受けない）', async () => {
    const { attempt, attemptAsync, useToasts } = await import('./uiStore')
    const { DomainError } = await import('../domain/types')
    useToasts.setState({ toasts: [] })
    expect(await attemptAsync(() => Promise.reject(new DomainError('ゴミ箱に見つかりません')))).toBeUndefined()
    expect(useToasts.getState().toasts.map((t) => [t.kind, t.message])).toEqual([['error', 'ゴミ箱に見つかりません']])

    // 思いがけない失敗はコンソールにも残す
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(
      await attemptAsync(async () => {
        throw new Error('保存できませんでした')
      }),
    ).toBeUndefined()
    expect(logged).toHaveBeenCalledTimes(1)
    expect(useToasts.getState().toasts.at(-1)?.message).toBe('保存できませんでした')

    // attempt は投げた例外を受ける（同じ知らせ方）
    expect(
      attempt(() => {
        throw new DomainError('できません')
      }),
    ).toBeUndefined()
    expect(useToasts.getState().toasts.at(-1)?.message).toBe('できません')
  })
})

describe('カレンダーの画面の状態（useCalendarUi）', () => {
  it('初めは見ている日なし・休みを付けていない・目立たせる所なし', async () => {
    const { initialCalendarUi, useCalendarUi } = await import('./uiStore')
    useCalendarUi.setState(initialCalendarUi())
    const s = useCalendarUi.getState()
    expect(s.viewed).toBeNull()
    expect(s.offMode).toBe(false)
    expect(s.flash).toBeNull()
    expect(typeof s.lastInteraction).toBe('number')
  })

  it('見ている日・休みを付ける状態・押した時刻を覚える（端末には保存しない）', async () => {
    const { initialCalendarUi, useCalendarUi, PREFS_KEY } = await import('./uiStore')
    localStorage.removeItem(PREFS_KEY)
    useCalendarUi.setState(initialCalendarUi())
    const s = useCalendarUi.getState()
    s.setViewed('2026-11-10')
    s.setOffMode(true)
    s.touch(1_000)
    expect(useCalendarUi.getState()).toMatchObject({ viewed: '2026-11-10', offMode: true, lastInteraction: 1_000 })
    expect(localStorage.getItem(PREFS_KEY)).toBeNull()
  })

  it('目立たせる: キーを1つ以上まとめて渡し、同じ所でも毎回 seq が変わる。目立たせ終えたらその seq の物だけ消す', async () => {
    const { flashMatches, initialCalendarUi, useCalendarUi } = await import('./uiStore')
    useCalendarUi.setState(initialCalendarUi())
    const ui = () => useCalendarUi.getState()
    ui().flashTarget('item:a')
    const first = ui().flash!
    expect(first).toMatchObject({ key: 'item:a', keys: ['item:a'] })
    ui().flashTarget('item:a')
    const second = ui().flash!
    expect(second.seq).toBeGreaterThan(first.seq)
    // 古い seq を消しても、新しく目立たせた物は残る
    ui().clearFlash(first.seq)
    expect(ui().flash).toBe(second)
    ui().clearFlash(second.seq)
    expect(ui().flash).toBeNull()

    // マンスリーの数字から来た時は、区切りと予定を一緒に
    ui().flashTarget('day-area:work', 'day-events:work')
    expect(ui().flash?.key).toBe('day-area:work')
    expect(flashMatches(ui().flash, 'day-area:work')).toBe(true)
    expect(flashMatches(ui().flash, 'day-events:work')).toBe(true)
    expect(flashMatches(ui().flash, 'day-area:private')).toBe(false)
    expect(flashMatches(null, 'day-area:work')).toBe(false)
    // キーが無ければ何もしない
    const before = ui().flash
    ui().flashTarget()
    expect(ui().flash).toBe(before)
    ui().flashInPlace()
    expect(ui().flash).toBe(before)
  })

  it('目立たせるだけ（flashInPlace。ドラッグで落とした時）: 目立たせられる側は動かさない（scroll: false）。ふつうは true', async () => {
    const { initialCalendarUi, useCalendarUi } = await import('./uiStore')
    useCalendarUi.setState(initialCalendarUi())
    const ui = () => useCalendarUi.getState()
    ui().flashTarget('item:a')
    const first = ui().flash!
    expect(first).toMatchObject({ key: 'item:a', keys: ['item:a'], scroll: true })
    ui().flashInPlace('item:a')
    expect(ui().flash).toMatchObject({ key: 'item:a', keys: ['item:a'], scroll: false })
    expect(ui().flash!.seq).toBeGreaterThan(first.seq)
  })
})
