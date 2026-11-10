// ヘッダーの同期の表示（docs/SPEC.md の 18.4）。押すと設定の「同期」へ。NS の src/ui/SyncIndicator.tsx から。
// 段階0の仮: 同期のエンジン（NS の src/sync/engine.ts）と司令塔の同期の部分は段階1で写す。それまでは同期の状態（useSyncView）を
// だれも入れないので、何も出さない。段階1で、同期の司令塔が今の状態を useSyncView に入れる
import { Link } from 'react-router-dom'
import { create } from 'zustand'
import './sync.css'

/** 同期の状態（docs/SPEC.md の 18.4 の表の8つ） */
export type SyncView =
  | { kind: 'synced' }
  | { kind: 'sending' }
  | { kind: 'pending'; count: number }
  | { kind: 'downloading' }
  | { kind: 'offline' }
  /** 今日の無料枠を使い切った。resumeAt は戻る時刻（端末の時刻で「17:00」。docs/SPEC.md の 2.8） */
  | { kind: 'quota'; resumeAt: string }
  | { kind: 'outdated' }
  | { kind: 'error'; reason: string }

/** 今の同期の状態（null は出さない。段階1で同期の司令塔が入れる） */
export const useSyncView = create<{ view: SyncView | null }>(() => ({ view: null }))

export interface SyncBadge {
  /** ok = 揃っている（--text-faint）、busy = 送っている・未送信・受け取り中（--text-muted）、warn = 止まっている（--overdue） */
  tone: 'ok' | 'busy' | 'warn'
  /** 斜線の雲にする */
  off: boolean
  label: string
}

/** 同期の状態を、ヘッダーの短い言葉にする（docs/SPEC.md の 18.4） */
export function syncBadge(view: SyncView): SyncBadge {
  switch (view.kind) {
    case 'synced':
      return { tone: 'ok', off: false, label: '同期済み' }
    case 'sending':
      return { tone: 'busy', off: false, label: '送信中…' }
    case 'pending':
      return { tone: 'busy', off: false, label: `未送信 ${view.count}件` }
    case 'downloading':
      return { tone: 'busy', off: false, label: '受け取り中…' }
    case 'offline':
      return { tone: 'warn', off: true, label: 'オフライン（端末に保存しています）' }
    case 'quota':
      return { tone: 'warn', off: true, label: `今日の無料枠を使い切りました（${view.resumeAt} ごろに戻ります）` }
    case 'outdated':
      return { tone: 'warn', off: true, label: '要更新（アプリを更新してください）' }
    case 'error':
      return { tone: 'warn', off: true, label: `同期できません（${view.reason}）` }
  }
}

export function SyncIndicator() {
  const view = useSyncView((s) => s.view)
  if (!view) return null
  const badge = syncBadge(view)
  return (
    <Link
      to="/settings#sync"
      className={`sync-indicator ${badge.tone}`}
      title={badge.label}
      aria-label={`同期: ${badge.label}`}
      data-testid="sync-indicator"
      data-tone={badge.tone}
      style={view.kind === 'sending' ? { opacity: 0.6 } : undefined}
    >
      <SyncCloudIcon off={badge.off} />
      <span className="hide-mobile">{badge.label}</span>
    </Link>
  )
}

/** 雲（止まっている時は斜線付き）。線のアイコンの CloudIcon・CloudOffIcon（docs/SPEC.md の 4.10）ができたら、そちらに替える */
function SyncCloudIcon({ off }: { off: boolean }) {
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M7 18h10.5a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.4 9.1 4.5 4.5 0 0 0 7 18Z" />
      {off ? <path d="m4 4 16 16" /> : null}
    </svg>
  )
}
