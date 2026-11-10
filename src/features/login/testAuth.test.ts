// テストの時だけ効く「ログインした状態」の印（localStorage の diary-studio:test-auth。docs/SPEC.md の 2.10）。
// 公開するビルド（import.meta.env.DEV が false）で効かないことは、処理の頭の import.meta.env.DEV の確かめで決まる
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  initSync: vi.fn(async () => {}),
  fakeSignInForTest: vi.fn(),
  auth: 'signedOut' as string,
}))

vi.mock('../../sync/controller', () => ({
  initSync: mocks.initSync,
  fakeSignInForTest: mocks.fakeSignInForTest,
  useSync: { getState: () => ({ auth: mocks.auth }) },
}))

const { resetTestAuthForTests, startTestAuth, TEST_AUTH_KEY, testAuthRequested } = await import('./testAuth')

beforeEach(() => {
  localStorage.clear()
  resetTestAuthForTests()
  mocks.initSync.mockClear()
  mocks.fakeSignInForTest.mockClear()
  mocks.auth = 'signedOut'
})

afterEach(() => localStorage.clear())

describe('testAuth', () => {
  it('印の名前は diary-studio:test-auth', () => {
    expect(TEST_AUTH_KEY).toBe('diary-studio:test-auth')
  })

  it('印が無ければ何もしない（ログインの状態はふだんどおり Firebase で確かめる）', () => {
    expect(testAuthRequested()).toBe(false)
    expect(startTestAuth()).toBeNull()
    expect(mocks.initSync).not.toHaveBeenCalled()
    expect(mocks.fakeSignInForTest).not.toHaveBeenCalled()
  })

  it('印があれば、起動時のログインの確かめを終えてから、ログインした状態にする（1回だけ）', async () => {
    localStorage.setItem(TEST_AUTH_KEY, '1')
    expect(testAuthRequested()).toBe(true)
    const first = startTestAuth()
    expect(startTestAuth()).toBe(first)
    await first
    expect(mocks.initSync).toHaveBeenCalledTimes(1)
    expect(mocks.fakeSignInForTest).toHaveBeenCalledTimes(1)
  })

  it('もうログインしていれば（エミュレーターなど）、そのまま', async () => {
    localStorage.setItem(TEST_AUTH_KEY, '1')
    mocks.auth = 'signedIn'
    await startTestAuth()
    expect(mocks.fakeSignInForTest).not.toHaveBeenCalled()
  })
})
