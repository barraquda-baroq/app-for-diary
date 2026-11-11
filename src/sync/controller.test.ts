// 同期の司令塔（docs/SPEC.md の 2.5・18.4・19.5）: データの画面を出してよいか（持ち主だと確かめたアカウントだけ）、クラウドと揃って
// いるか（受け取り箱を当ててよいか）、同期の表示に入る状態
import { afterEach, describe, expect, it } from 'vitest'
import { useToasts } from '../store/uiStore'
import { DATA_MODEL } from './appVersion'
import { canShowData, cloudSettled, onTabMessage, resetSyncForTests, trashPurgeTime, useSync } from './controller'
import { useSyncView } from './syncView'

afterEach(() => resetSyncForTests())

const signedIn = { auth: 'signedIn' as const, accountMismatch: null }

describe('データの画面を出してよいか（2.5）', () => {
  it('この端末で持ち主だと確かめたアカウントの時だけ', () => {
    expect(canShowData({ ...signedIn, owner: 'ok', ownerSeen: true })).toBe(true)
    // まだ確かめていない・記録が無い（確かめていない）・ほかのアカウント
    expect(canShowData({ ...signedIn, owner: 'checking', ownerSeen: false })).toBe(false)
    expect(canShowData({ ...signedIn, owner: 'missing', ownerSeen: false })).toBe(false)
    expect(canShowData({ ...signedIn, owner: 'mismatch', ownerSeen: true })).toBe(false)
    // 前に確かめたアカウントで、記録が消えた時はデータを出し、同期だけを止める
    expect(canShowData({ ...signedIn, owner: 'missing', ownerSeen: true })).toBe(true)
    // 前に別のアカウントで使っていた時の確かめの間は出さない
    expect(canShowData({ ...signedIn, owner: 'ok', ownerSeen: true, accountMismatch: { previousEmail: 'a' } })).toBe(false)
    expect(canShowData({ auth: 'signedOut', owner: 'ok', ownerSeen: true, accountMismatch: null })).toBe(false)
  })
})

describe('クラウドと揃っているか（19.5。受け取り箱を当てる時）', () => {
  const status = { phase: 'synced' as const, pending: 0, lastSyncedAt: 1, error: null }
  it('同期を受け持ち、送信待ちが無く、新しい版のデータも無く、別のアカウントの確かめも済んでいる時だけ', () => {
    expect(cloudSettled({ leader: true, status, accountMismatch: null })).toBe(true)
    expect(cloudSettled({ leader: false, status, accountMismatch: null })).toBe(false)
    expect(cloudSettled({ leader: true, status: { ...status, pending: 1 }, accountMismatch: null })).toBe(false)
    expect(cloudSettled({ leader: true, status: { ...status, phase: 'downloading' }, accountMismatch: null })).toBe(false)
    expect(
      cloudSettled({ leader: true, status: { ...status, outdated: { model: 2, appVersion: '0.2' } }, accountMismatch: null }),
    ).toBe(false)
  })
})

describe('同期の表示に入る状態（18.4）', () => {
  it('持ち主だと確かめた後だけ出す', () => {
    useSync.setState({ auth: 'signedIn', owner: 'checking', ownerSeen: false, status: null })
    expect(useSyncView.getState().view).toBeNull()
    useSync.setState({
      owner: 'ok',
      ownerSeen: true,
      status: { phase: 'downloading', pending: 0, lastSyncedAt: null, error: null },
    })
    expect(useSyncView.getState().view).toEqual({ kind: 'downloading' })
    useSync.setState({ owner: 'missing', status: null })
    expect(useSyncView.getState().view).toEqual({ kind: 'error', reason: '持ち主の記録がまだありません' })
    useSync.setState({ auth: 'signedOut' })
    expect(useSyncView.getState().view).toBeNull()
  })
})

describe('同期を受け持つ画面の受け渡し（データの形の版）', () => {
  const status = { phase: 'synced' as const, pending: 0, lastSyncedAt: 1, error: null }
  it('自分より新しいデータの形の版の画面の知らせが来たら、受け持ちをやめて読み込み直しを促す', () => {
    useSync.setState({ auth: 'signedIn', leader: true, status })
    onTabMessage({ request: true, model: DATA_MODEL })
    expect(useSync.getState().leader).toBe(true)
    onTabMessage({ request: true, model: DATA_MODEL + 1 })
    expect(useSync.getState().leader).toBe(false)
    expect(
      useToasts
        .getState()
        .toasts.map((t) => t.message)
        .join(),
    ).toContain('読み込み直してください')
  })
  it('同じ版・古い版の画面の知らせでは譲らない。受け持たない画面は、届いた状態を出す', () => {
    useSync.setState({ auth: 'signedIn', leader: false, status: null })
    onTabMessage({ status, model: DATA_MODEL - 1 })
    expect(useSync.getState().status).toEqual(status)
  })
})

describe('ゴミ箱の期限切れを決める時刻（6.15）', () => {
  const now = Date.UTC(2026, 10, 10)
  const yearAhead = now + 365 * 24 * 60 * 60 * 1000
  it('ログインしている時は、端末の時計とサーバーの時刻の見積もりの早い方（時計が進んだ端末がゴミ箱を空にしない）', () => {
    expect(trashPurgeTime('signedIn', now, yearAhead)).toBe(now)
    expect(trashPurgeTime('signedIn', now + 5000, now)).toBe(now)
  })
  it('見積もりがまだ無い・ログインの状態が分かる前・ログインしていない間は消さない', () => {
    expect(trashPurgeTime('signedIn', null, now)).toBeNull()
    expect(trashPurgeTime('idle', now, now)).toBeNull()
    expect(trashPurgeTime('checking', now, now)).toBeNull()
    expect(trashPurgeTime('signedOut', null, now)).toBeNull()
    expect(trashPurgeTime('signedOut', now, now)).toBeNull()
  })
})
