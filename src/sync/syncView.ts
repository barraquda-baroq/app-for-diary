// ヘッダーの同期の表示の状態（docs/SPEC.md の 18.4 の表の8つ）。同期の司令塔（src/sync/controller.ts）が入れ、
// src/ui/SyncIndicator.tsx と設定の「同期」が読む（画面の部品に頼らない小さなファイルに分けている）。
import { create } from 'zustand'
import { quotaResumeAt } from '../domain/dates'
import type { SyncStatus } from './engine'

/** 同期の状態（18.4 の表の8つ） */
export type SyncView =
  | { kind: 'synced' }
  | { kind: 'sending' }
  | { kind: 'pending'; count: number }
  | { kind: 'downloading' }
  | { kind: 'offline' }
  /** 今日の無料枠を使い切った。resumeAt は戻る時刻（端末の時刻で「17:00」。2.8） */
  | { kind: 'quota'; resumeAt: string }
  | { kind: 'outdated' }
  | { kind: 'error'; reason: string }

/** 今の同期の状態（null は出さない。ログインしていない・まだ同期を始めていない） */
export const useSyncView = create<{ view: SyncView | null }>(() => ({ view: null }))

/** 持ち主の確かめ（2.5 の 3。形1） */
export type OwnerState = 'unknown' | 'checking' | 'ok' | 'missing' | 'mismatch'

/** 持ち主の記録がまだ無い時の言葉（ログインの画面・S の小窓・設定の「同期」。2.5・18.4・形1） */
export const OWNER_MISSING_MESSAGE = '持ち主の記録がまだありません（docs/manual/5-owner-record.md）'
/** ほかのアカウントの記録の時の言葉（2.5・18.4） */
export const OWNER_MISMATCH_MESSAGE = 'このアカウントは Diary Studio の持ち主ではありません'

/** 「同期できません（…）」の短い理由 */
export const OWNER_MISSING_REASON = '持ち主の記録がまだありません'

function shortReason(s: SyncStatus): string {
  switch (s.errorCode) {
    case 'owner-missing':
      return OWNER_MISSING_REASON
    case 'owner-mismatch':
      return 'このアカウントは持ち主ではありません'
    case 'permission-denied':
      return 'アクセスが拒否されました'
    case 'unauthenticated':
      return 'ログインし直してください'
    default:
      return s.error ?? '不明なエラー'
  }
}

/** 同期のエンジンの状態と持ち主の確かめから、ヘッダーの表示を決める（18.4） */
export function syncViewOf(s: { status: SyncStatus | null; owner: OwnerState }, now = Date.now()): SyncView | null {
  if (s.owner === 'missing') return { kind: 'error', reason: OWNER_MISSING_REASON }
  const st = s.status
  if (!st) return null
  if (st.outdated) return { kind: 'outdated' }
  if (st.phase === 'offline') return { kind: 'offline' }
  if (st.phase === 'error') {
    if (st.errorCode === 'quota') return { kind: 'quota', resumeAt: quotaResumeAt(now) }
    return { kind: 'error', reason: shortReason(st) }
  }
  if (st.phase === 'starting' || st.phase === 'downloading') return { kind: 'downloading' }
  if (st.phase === 'uploading') return { kind: 'sending' }
  if (st.pending > 0) return { kind: 'pending', count: st.pending }
  return { kind: 'synced' }
}
