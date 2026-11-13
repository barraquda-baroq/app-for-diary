// iPhone の端からのフリックの記録（docs/SPEC.md の 3.1・18.1 の「開発」）。うまくいかなかった払いの後に、作者が設定の［記録をコピー］で
// 送れるようにする（iPhone が途中で戻したのか、アプリの側で何かしたのかを分ける）。設定で「端からのフリックの記録を取る」を入れた時
// だけ控え、新しい物から SWIPE_LOG_MAX 件だけ残す（ページを読み込み直すと消える）。控えるのは、時刻・種類・番号や位置だけ（予定の中身は
// 控えない）。何を控えるかは呼ぶ所が決める（src/history/appHistory.ts の popstate・履歴を書く・動く・指、src/ui/useSwipe.ts の払い、
// めくる動き、すばやく足すの閉じ方）
const STORAGE_KEY = 'diary-studio:swipe-log'

/** 残す件数 */
export const SWIPE_LOG_MAX = 300

interface Entry {
  /** 時刻（performance.now のミリ秒） */
  at: number
  kind: string
  data?: Record<string, unknown>
}

/** 控えた物（古い順。SWIPE_LOG_MAX 件を超えたら古い物から捨てる） */
const entries: Entry[] = []
/** 控えるか（最初に使う時に localStorage から読む） */
let enabled: boolean | null = null

function now(): number {
  try {
    return performance.now()
  } catch {
    return Date.now()
  }
}

/** 記録を取っているか */
export function swipeLogEnabled(): boolean {
  if (enabled === null) {
    try {
      enabled = localStorage.getItem(STORAGE_KEY) === '1'
    } catch {
      enabled = false
    }
  }
  return enabled
}

/** 記録を取る・やめる（端末に覚える。やめた時は控えた物も消す） */
export function setSwipeLogEnabled(on: boolean): void {
  enabled = on
  try {
    if (on) localStorage.setItem(STORAGE_KEY, '1')
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // 覚えられない（このページの間だけ）
  }
  if (!on) entries.length = 0
}

/** 1つ控える（記録を取っていなければ何もしない） */
export function swipeLog(kind: string, data?: Record<string, unknown>): void {
  if (!swipeLogEnabled()) return
  entries.push(data === undefined ? { at: now(), kind } : { at: now(), kind, data })
  if (entries.length > SWIPE_LOG_MAX) entries.splice(0, entries.length - SWIPE_LOG_MAX)
}

/** 控えた物を、1行に1つ（時刻のミリ秒・種類・中身の JSON）の字にする */
export function swipeLogText(): string {
  return entries.map((e) => `${Math.round(e.at)} ${e.kind}${e.data === undefined ? '' : ` ${JSON.stringify(e.data)}`}`).join('\n')
}

/** 控えた物を消す */
export function clearSwipeLog(): void {
  entries.length = 0
}
