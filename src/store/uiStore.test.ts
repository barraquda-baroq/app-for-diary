// 端末ごとの表示の設定（docs/SPEC.md の 4.2・6.13）とお知らせ。NS の src/store/uiStore.test.ts から
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PREFS, migratePrefs, PREFS_KEY, PREFS_VERSION, resolveAppearance } from './uiStore'

describe('表示の設定の読み直し（migratePrefs）', () => {
  it('初めは「端末の設定に合わせる」・起動アニメーションはオン・マンスリー・リストは開く・「済み n件」は畳む', () => {
    expect(DEFAULT_PREFS).toEqual({
      appearance: 'system',
      launchAnimation: true,
      lastMode: 'month',
      detailsOpen: false,
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
      detailsOpen: true,
      routineAddCycle: 'quarterly',
      collapsed: { task: true, routineGroups: { weekly: true }, routineDone: { yearly: false }, favoriteDone: false },
    })
    expect(prefs.appearance).toBe('deep-dark')
    expect(prefs.launchAnimation).toBe(false)
    expect(prefs.lastMode).toBe('week')
    expect(prefs.detailsOpen).toBe(true)
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
        detailsOpen: 1,
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
})
