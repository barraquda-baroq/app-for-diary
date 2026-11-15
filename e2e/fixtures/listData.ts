// 段階3の3つのリスト（Task List・Routine List・Favorite List。docs/SPEC.md の 13.〜15.）の E2E と見本の画面（e2e/samples/）が使う
// 作り物のデータ。個人の情報は入れない: 人の名前・メールアドレス・本当の場所は使わず、依頼者は部署の言葉（「営業部」「総務」）だけ、
// リンクは https://example.com/ だけ。中身は家の用事・仕事のよくある用事。
// 今日は既定で 2026年11月10日（火）（e2e/helpers.ts の E2E_NOW と同じ日）。日付はどれも今日から数えるので、別の今日を渡せば同じ形の
// データになる（今日の 9:00 日本時間を「今」として、済んだ時刻・作った時刻を決める）。id・作った時刻・並び（order）は決めた値にして、
// 何度作っても同じデータになる（seedData(page, listData()) で置く。window.__ds.replaceAllData を通るので、画面には直した後の物（6.12）が
// 出る）。カレンダーの見本（demoData）と一緒に置く時は表ごとに混ぜる（items は両方の物を1つの表に）。
//
// 中身（見本の画面ごとに見せたい物。PLAN の 6.1）:
// - Task List: ② 締め切り日だけ（明日・依頼者 営業部）、③ 開始日と締め切り日（今日〜3日後・依頼者 総務）、① 日付なし、④ 開始日だけ
//   （プライベート）、期限切れ（昨日）、今日が締め切り、済み2件（2日前は出る・8日前は 168時間を過ぎて出ない）、カレンダー生まれで
//   Task List にも出した物（プライベート・2日後の 10:00〜11:00）
// - Routine List: 毎日2件（1件は今日チェックして済み）、毎週2件（月・木の指定・指定なし）、毎月1件（25日）、四半期は空、毎年1件（3/15）
// - Favorite List: 1行だけ、2行以上の並び、リンクの入った物、3行を超えて「続き」の出る物、済み1件
import { addDaysYmd, monthOf } from '../../src/domain/dates'
import type { AppData, Favorite, Item, ItemKind, Routine, RoutineCheck, RoutineCycle } from '../../src/domain/types'

/** 既定の今日（e2e/helpers.ts の E2E_NOW の日） */
export const LIST_TODAY = '2026-11-10'

/** 見本の画面・E2E で開く・探す記録の id */
export const LIST_IDS = {
  // ----- Task List -----
  quoteReply: 'list-t-quote-reply', // 見積もりの返事（② 締め切り日 明日・営業部）
  roomBooking: 'list-t-room-booking', // 会議室の予約を見直す（③ 今日〜3日後・総務）
  printDocs: 'list-t-print-docs', // 資料を印刷する（① 日付なし）
  libraryBooks: 'list-t-library-books', // 図書館の本を返す（④ 開始日 2日後だけ・プライベート）
  invoiceCheck: 'list-t-invoice-check', // 請求書の確認（② 締め切り日 昨日・期限切れ）
  tonerOrder: 'list-t-toner-order', // トナーを頼む（② 締め切り日 今日）
  shelfTidy: 'list-t-shelf-tidy', // 備品の棚を片付ける（① 2日前に済み。出る）
  oldPapers: 'list-t-old-papers', // 古い書類を捨てる（① 8日前に済み。168時間を過ぎて出ない）
  dentist: 'list-t-dentist', // 歯医者（カレンダー生まれ・Task List にも出す・プライベート・2日後 10:00〜11:00）
  // ----- Routine List -----
  waterPlants: 'list-r-water-plants', // 植物に水をやる（毎日・今日チェックして済み）
  stretch: 'list-r-stretch', // ストレッチ（毎日）
  garbage: 'list-r-garbage', // ゴミ出し（毎週 月・木）
  weekReview: 'list-r-week-review', // 週の振り返り（毎週・指定なし）
  rentCheck: 'list-r-rent-check', // 家賃の確認（毎月 25日）
  taxPapers: 'list-r-tax-papers', // 確定申告の書類（毎年 3/15）
  // ----- Favorite List -----
  bakery: 'list-f-bakery', // 近所のパン屋に行ってみる（1行だけ）
  recipes: 'list-f-recipes', // 週末に作りたい料理（2行以上の並び）
  article: 'list-f-article', // 気になる記事（https://example.com/ のリンク）
  trips: 'list-f-trips', // 旅行で行きたい所（3行を超えて「続き」）
  notebook: 'list-f-notebook', // 新しいノートを買う（済み）
} as const

const byUser = { by: 'user', ai: null, via: null } as const

/** 日本時間のその日のその時刻（ミリ秒） */
const at = (date: string, time: string) => Date.parse(`${date}T${time}:00+09:00`)

interface TaskSpec {
  id: string
  title: string
  kind?: ItemKind
  origin?: Item['origin']
  start?: string | null
  due?: string | null
  startTime?: string | null
  endTime?: string | null
  requester?: string
  /** 済ませた日（済みの物だけ。その日の 18:00 に済ませた） */
  doneOn?: string
}

interface RoutineSpec {
  id: string
  title: string
  cycle: RoutineCycle
  weekdays?: number[]
  monthDay?: number | null
  yearMonth?: number | null
  yearDay?: number | null
}

/**
 * リストの見本のデータ（呼ぶたびに新しい物を作る）。today は今日（'YYYY-MM-DD'。既定は 2026-11-10）。
 * seedData(page, listData()) で端末の中のデータを丸ごと置き換える（ほかの表は空になる）
 */
export function listData(today: string = LIST_TODAY): Pick<AppData, 'items' | 'routines' | 'routineChecks' | 'favorites'> {
  const day = (n: number) => addDaysYmd(today, n)
  const I = LIST_IDS
  // 作った時刻は 30日前の 9:00 から1件ごとに1分ずつ（並びの order も同じ値。Task List の並びは作った順で決まる所がある。13.4）
  const createdFrom = at(day(-30), '09:00')

  const tasks: TaskSpec[] = [
    { id: I.quoteReply, title: '見積もりの返事', due: day(1), requester: '営業部' },
    { id: I.roomBooking, title: '会議室の予約を見直す', start: day(0), due: day(3), requester: '総務' },
    { id: I.printDocs, title: '資料を印刷する' },
    { id: I.libraryBooks, title: '図書館の本を返す', kind: 'private', start: day(2) },
    { id: I.invoiceCheck, title: '請求書の確認', due: day(-1) },
    { id: I.tonerOrder, title: 'トナーを頼む', due: day(0) },
    { id: I.shelfTidy, title: '備品の棚を片付ける', doneOn: day(-2) },
    { id: I.oldPapers, title: '古い書類を捨てる', doneOn: day(-8) },
    {
      id: I.dentist,
      title: '歯医者',
      kind: 'private',
      origin: 'calendar',
      start: day(2),
      startTime: '10:00',
      endTime: '11:00',
    },
  ]
  const items: Record<string, Item> = {}
  tasks.forEach((t, i) => {
    const created = createdFrom + i * 60_000
    const doneAt = t.doneOn ? at(t.doneOn, '18:00') : null
    items[t.id] = {
      id: t.id,
      v: 1,
      kind: t.kind ?? 'work',
      title: t.title,
      origin: t.origin ?? 'list',
      start: t.start ?? null,
      due: t.due ?? null,
      startTime: t.startTime ?? null,
      endTime: t.endTime ?? null,
      // Task List 生まれも、カレンダー生まれで Task List に出した物も listed（6.3）
      listed: true,
      done: Boolean(t.doneOn),
      doneAt,
      doneOn: t.doneOn ?? null,
      locked: false,
      label: null,
      requester: t.requester ?? '',
      memo: '',
      order: created,
      ...byUser,
      createdAt: created,
      updatedAt: doneAt ?? created,
    }
  })

  const routineSpecs: RoutineSpec[] = [
    { id: I.waterPlants, title: '植物に水をやる', cycle: 'daily' },
    { id: I.stretch, title: 'ストレッチ', cycle: 'daily' },
    { id: I.garbage, title: 'ゴミ出し', cycle: 'weekly', weekdays: [1, 4] },
    { id: I.weekReview, title: '週の振り返り', cycle: 'weekly' },
    { id: I.rentCheck, title: '家賃の確認', cycle: 'monthly', monthDay: 25 },
    // 四半期は空のかたまり（名前と＋だけを淡く出す。D26）
    { id: I.taxPapers, title: '確定申告の書類', cycle: 'yearly', yearMonth: 3, yearDay: 15 },
  ]
  const routines: Record<string, Routine> = {}
  const perCycle = new Map<RoutineCycle, number>()
  routineSpecs.forEach((r, i) => {
    const created = createdFrom + (tasks.length + i) * 60_000
    // 並び（order）は種類の中で 0 から
    const order = perCycle.get(r.cycle) ?? 0
    perCycle.set(r.cycle, order + 1)
    routines[r.id] = {
      id: r.id,
      v: 1,
      title: r.title,
      cycle: r.cycle,
      weekdays: r.weekdays ?? [],
      monthDay: r.monthDay ?? null,
      yearMonth: r.yearMonth ?? null,
      yearDay: r.yearDay ?? null,
      order,
      ...byUser,
      createdAt: created,
      updatedAt: created,
    }
  })
  // 植物に水をやる は今日の 8:00 にチェックした（毎日のルーチンは今日の間だけ済み。14.3）
  const check: RoutineCheck = {
    id: `${I.waterPlants}:${monthOf(today)}`,
    routineId: I.waterPlants,
    month: monthOf(today),
    dates: [today],
    updatedAt: at(today, '08:00'),
    ...byUser,
  }
  const routineChecks: Record<string, RoutineCheck> = { [check.id]: check }

  // 上から並ぶ順（order の小さい順。新しく足した物ほど上）
  const favoriteSpecs: Array<{ id: string; text: string; doneOn?: string }> = [
    { id: I.bakery, text: '近所のパン屋に行ってみる' },
    { id: I.recipes, text: '週末に作りたい料理\nカレー\n親子丼\nポトフ' },
    { id: I.article, text: '気になる記事\nhttps://example.com/article' },
    {
      id: I.trips,
      text: '旅行で行きたい所\n海の見える公園\n古い町並みの残る通り\n山の上の展望台\n湖のほとりのカフェ\n星のよく見える高原',
    },
    { id: I.notebook, text: '新しいノートを買う', doneOn: day(-1) },
  ]
  const favorites: Record<string, Favorite> = {}
  favoriteSpecs.forEach((f, i) => {
    // 上の物ほど新しく足した（作った時刻が後）
    const created = createdFrom + (tasks.length + routineSpecs.length + favoriteSpecs.length - i) * 60_000
    const doneAt = f.doneOn ? at(f.doneOn, '18:00') : null
    favorites[f.id] = {
      id: f.id,
      v: 1,
      text: f.text,
      done: Boolean(f.doneOn),
      doneAt,
      order: i - favoriteSpecs.length,
      ...byUser,
      createdAt: created,
      updatedAt: doneAt ?? created,
    }
  })

  return { items, routines, routineChecks, favorites }
}
