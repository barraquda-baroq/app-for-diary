// 前に別のアカウントで使っていた端末（docs/SPEC.md の 2.5 の 4.）: 持ち主の記録を別のアカウントに移した後、そのアカウントでログインしても、
// 確かめる前にデータの画面を一瞬も出さない（初めてのログインでも、確かめの画面で［ログアウト］した後のログインでも）。
// Firebase・Firestore・同期のエンジンは仮の物（持ち主の確かめは ok を返す。エンジンは作らない）、保存先とストアは本物
import { afterEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ onUser: null as null | ((u: unknown) => void), checks: 0, engines: 0 }))

vi.mock('./firebase', () => ({
  usingEmulator: false,
  firebase: () => ({ app: {}, auth: { currentUser: null } }),
  completeRedirect: async () => {},
  describeAuthError: () => null,
  watchUser: (fn: (u: unknown) => void) => {
    h.onUser = fn
    return () => {}
  },
  signOutUser: async () => {},
  signInWithGoogle: async () => {},
  signInForTest: async () => {},
}))
vi.mock('./firestore', () => ({ firestore: () => ({}) }))
vi.mock('./engine', () => ({
  checkOwner: async () => {
    h.checks += 1
    return 'ok'
  },
  readConnectorPerms: async () => null,
  createSyncEngine: () => {
    h.engines += 1
    throw new Error('確かめる前にエンジンを作らない')
  },
}))

import { createPersistence, type Persistence } from '../db/persistence'
import { initStore, resetStoreForTests } from '../store/appStore'
import { canShowData, initSync, resetSyncForTests, useSync } from './controller'

let p: Persistence | null = null

afterEach(() => {
  resetSyncForTests()
  resetStoreForTests()
  p?.close()
  p = null
})

const settle = () => new Promise((r) => setTimeout(r, 100))

/** ログインした時の、データの画面を出してよいかの移り変わり */
async function signInAs(uid: string, email: string): Promise<boolean[]> {
  const seen: boolean[] = []
  const off = useSync.subscribe((s) => seen.push(canShowData(s)))
  h.onUser!({ uid, displayName: '', email })
  await settle()
  off()
  return seen
}

describe('前に別のアカウントで使っていた端末（2.5 の 4.）', () => {
  it('確かめの文を出す前に、データの画面を出さない（初めてのログインと、［ログアウト］した後のログイン）', async () => {
    p = createPersistence(`account-${Math.random().toString(36).slice(2)}`)
    await p.setMeta('uid', 'uid-a')
    await p.setMeta('email', 'a@example.com')
    await initStore(p)
    await initSync()
    // 初めてのログイン（ネットで持ち主を確かめる）
    const first = await signInAs('uid-b', 'b@example.com')
    expect(h.checks).toBe(1)
    expect(useSync.getState().accountMismatch).toEqual({ previousEmail: 'a@example.com' })
    expect(first).not.toContain(true)
    // 確かめの画面で［ログアウト］して、もう一度ログイン（この端末で持ち主だと確かめたアカウント。ネットでは確かめない）
    h.onUser!(null)
    await settle()
    const again = await signInAs('uid-b', 'b@example.com')
    expect(h.checks).toBe(1)
    expect(useSync.getState().accountMismatch).toEqual({ previousEmail: 'a@example.com' })
    expect(again).not.toContain(true)
    expect(h.engines).toBe(0)
  })
})
