// ヘッダーの同期の表示（docs/SPEC.md の 18.4）。NS の src/ui/SyncIndicator.tsx から。
// 状態は同期の司令塔（src/sync/controller.ts）が src/sync/syncView.ts の useSyncView に入れる（ログインしていない・持ち主だと確かめて
// いない間は何も出さない）。L・M はアイコンと短い字で、押すと設定の「同期」へ。S はアイコンだけで、押すと小さな窓（PopupMenu）に
// 詳しい字と［今すぐ同期］を出す。
import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { syncNow } from '../sync/controller'
import { OWNER_MISSING_MESSAGE, OWNER_MISSING_REASON, useSyncView, type SyncView } from '../sync/syncView'
import { useWidthClass } from './hooks'
import { CloudIcon, CloudOffIcon } from './icons'
import { PopupMenu } from './PopupMenu'
import './sync.css'

export { useSyncView, type SyncView }

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

/** S の小窓と設定の「同期」に出す詳しい字（持ち主の記録が無い時は手順書の場所も。18.4） */
export function syncDetail(view: SyncView): string {
  if (view.kind === 'error' && view.reason === OWNER_MISSING_REASON) return OWNER_MISSING_MESSAGE
  return syncBadge(view).label
}

export function SyncIndicator() {
  const view = useSyncView((s) => s.view)
  const width = useWidthClass()
  const navigate = useNavigate()
  const button = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  if (!view) return null
  const badge = syncBadge(view)
  const icon = badge.off ? <CloudOffIcon /> : <CloudIcon />
  const style = view.kind === 'sending' ? { opacity: 0.6 } : undefined
  if (width === 'S') {
    return (
      <>
        <button
          ref={button}
          type="button"
          className={`sync-indicator ${badge.tone}`}
          title={badge.label}
          aria-label={`同期: ${badge.label}`}
          aria-haspopup="menu"
          aria-expanded={open}
          data-testid="sync-indicator"
          data-tone={badge.tone}
          style={style}
          onClick={() => setOpen(true)}
        >
          {icon}
        </button>
        {open && button.current ? (
          <PopupMenu
            label="同期"
            placement={{ anchor: button.current }}
            onClose={() => setOpen(false)}
            testId="sync-popup"
            items={[
              { label: syncDetail(view), onSelect: () => navigate('/settings#sync'), testId: 'sync-popup-detail' },
              { label: '今すぐ同期', onSelect: () => void syncNow(), testId: 'sync-now-popup' },
            ]}
          />
        ) : null}
      </>
    )
  }
  return (
    <Link
      to="/settings#sync"
      className={`sync-indicator ${badge.tone}`}
      title={badge.label}
      aria-label={`同期: ${badge.label}`}
      data-testid="sync-indicator"
      data-tone={badge.tone}
      style={style}
    >
      {icon}
      <span>{badge.label}</span>
    </Link>
  )
}
