// 画面の行き先（HashRouter を使うので静的ホスティングでもそのまま動く。docs/SPEC.md の 3.1）。
// 段階0はトップ・MIM（仮の画面）・ログイン・設定の4つ。カレンダーのモード（#/year/2026 など）は段階2、
// MIM のメモ（#/mim/{id}）・Task View は段階4、ゴミ箱・Claude の操作の記録は段階5で足す

export const paths = {
  /** トップ（カレンダーと右の列。段階2で、開くと前回のモードの今日を含む期間に置き換える） */
  top: () => '/',
  /**
   * MIM（ヘッダーの［MIM］で開く。docs/SPEC.md の 16.1）。L はカレンダーの領域、M は積んだ中のカレンダーの区切りが MIM に替わり、
   * S は全面で開く。段階0は「段階4で作ります」の仮の画面
   */
  mim: () => '/mim',
  /** ログインの画面（ログインしていない時。docs/SPEC.md の 2.5） */
  login: () => '/login',
  /** 設定（別のページ。右の列は出さない。docs/SPEC.md の 18.1） */
  settings: () => '/settings',
}

/** MIM を開いている行き先か（#/mim と、段階4で足す #/mim/{メモの id}） */
export function isMimPath(pathname: string): boolean {
  return pathname === paths.mim() || pathname.startsWith(`${paths.mim()}/`)
}

/** カレンダーを出している行き先か（段階2で #/year/… #/month/… #/week/… #/day/… を足す） */
export function isCalendarPath(pathname: string): boolean {
  return pathname === paths.top()
}
