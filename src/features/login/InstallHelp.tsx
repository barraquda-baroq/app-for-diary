// 「ホーム画面に追加（アプリとして使う）」の手順（docs/SPEC.md の 2.5・2.7・D44）。NS の src/features/appSettings/InstallHelp.tsx から。
// ログインの画面の［追加の手順］で小さな画面に出す。設定の「ホーム画面に追加」（段階5。docs/SPEC.md の 18.1）でも使えるよう、
// 枠（カード）の有無を選べる。ブラウザがインストールを提案してきたら（Chrome・Edge）、［インストール］のボタンを出す
import { useEffect, useId, useMemo, useState } from 'react'
import { notify } from '../../store/uiStore'
import { useMediaQuery } from '../../ui/hooks'
import { CheckIcon, DownloadIcon } from '../../ui/icons'
import { currentPlatform, type Platform } from './platform'

/** Chrome / Edge 等が発行する beforeinstallprompt（標準の型定義にはない） */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export const INSTALL_GUIDES: readonly { platform: Platform; title: string; steps: readonly string[] }[] = [
  // iPhone は Chrome を基準にする（作者の指示「iOS では Chrome 基準でいい」）。Safari でも同じ「共有 → ホーム画面に追加」で置けるので、
  // 「Chrome（または Safari）」の形で並べて書く。Chrome で置けるのは iOS 16.4 以降（docs/DEPLOY.md の 2 の iPhone（Chrome））
  {
    platform: 'ios',
    title: 'iPhone・iPad（Chrome または Safari）',
    steps: [
      'Chrome（または Safari）で開き、アドレスバーの右の共有のボタン（□に↑）をタップ（見当たらない時は「…」→「共有」）',
      '一覧から「ホーム画面に追加」を選び、「追加」をタップ（「Web アプリとして開く」のスイッチが出たら、オンのまま）',
      'ホーム画面にできた Diary Studio のアイコンから開いて、ログインする',
    ],
  },
  {
    platform: 'android',
    title: 'Android（Chrome）',
    steps: ['右上のメニュー（⋮）をタップ', '「アプリをインストール」または「ホーム画面に追加」を選ぶ'],
  },
  {
    platform: 'desktop',
    title: 'パソコン（Chrome・Edge）',
    steps: [
      'アドレスバーの右端に出るインストールのアイコンをクリック',
      'または、メニューから「アプリをインストール」（Edge は「アプリ」→「このサイトをアプリとしてインストール」）',
    ],
  },
]

function useStandalone(): boolean {
  const displayStandalone = useMediaQuery('(display-mode: standalone)')
  const iosStandalone =
    typeof navigator !== 'undefined' && (navigator as Navigator & { standalone?: boolean }).standalone === true
  return displayStandalone || iosStandalone
}

export function InstallHelp({ framed = true }: { framed?: boolean }) {
  const id = useId()
  const standalone = useStandalone()
  const platform = useMemo(currentPlatform, [])
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [installed, setInstalled] = useState(false)

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault()
      setPrompt(e as BeforeInstallPromptEvent)
    }
    const onInstalled = () => {
      setPrompt(null)
      setInstalled(true)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const install = async () => {
    if (!prompt) return
    try {
      await prompt.prompt()
      const choice = await prompt.userChoice
      if (choice.outcome === 'accepted') notify('インストールしました')
    } catch {
      /* ブラウザが表示を拒否した */
    }
    // 同じイベントは一度しか使えない
    setPrompt(null)
  }

  // 今の端末の案内を先頭に
  const guides = [...INSTALL_GUIDES].sort((a, b) => Number(b.platform === platform) - Number(a.platform === platform))

  const body = (
    <>
      {standalone || installed ? (
        <p className="install-status" data-testid="install-status">
          <CheckIcon />
          {standalone ? 'いまアプリとして開いています。' : 'インストールしました。ホーム画面やアプリの一覧から開けます。'}
        </p>
      ) : null}

      {prompt ? (
        <div className="install-cta">
          <button type="button" className="btn btn-primary" onClick={() => void install()} data-testid="install-button">
            <DownloadIcon />
            インストール
          </button>
          <span className="small muted">このブラウザでは、ボタンからそのままインストールできます。</span>
        </div>
      ) : null}

      <ul className="install-guides">
        {guides.map((g) => (
          <li
            key={g.platform}
            className={`install-guide${g.platform === platform ? ' is-current' : ''}`}
            data-testid={`install-guide-${g.platform}`}
          >
            <div className="install-guide-head">
              <strong>{g.title}</strong>
              {g.platform === platform ? <span className="badge badge-accent">お使いの端末</span> : null}
            </div>
            <ol className="install-guide-steps">
              {g.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          </li>
        ))}
      </ul>

      <p className="install-note">
        データはその端末の中に保存し、ログインすると自分のほかの端末と同期します。iPhone・iPad では、Chrome（または
        Safari）のタブとホーム画面のアプリでデータが別々になるので、ホーム画面のアプリから開いてログインしてください。
      </p>
    </>
  )

  if (!framed) {
    return (
      <div className="install-help" data-testid="install-help">
        <p className="install-lead">
          ホーム画面やデスクトップに追加すると、アプリのように全画面で開けて、一度開いた後は電波が無くても使えます。
        </p>
        {body}
      </div>
    )
  }
  return (
    <section className="card install-help is-framed" aria-labelledby={`${id}-title`} data-testid="install-help">
      <div className="install-head">
        <h2 id={`${id}-title`}>ホーム画面に追加（アプリとして使う）</h2>
        <p className="install-lead">
          ホーム画面やデスクトップに追加すると、アプリのように全画面で開けて、一度開いた後は電波が無くても使えます。
        </p>
      </div>
      {body}
    </section>
  )
}
