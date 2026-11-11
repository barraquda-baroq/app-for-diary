// 段階2の見本の画面（e2e/samples/）と、カレンダーの E2E が使う作り物の予定（docs/SPEC.md の 21.・22.）。
// 今日は 2026年11月10日（火）9:00 日本時間（docs/SPEC.md の例の日。e2e/helpers.ts の E2E_NOW と同じ）。
// 個人の情報は入れない: 人の名前・メールアドレス・本当の場所は使わず、依頼者は部署の言葉（「総務」「営業部」）だけ。
// id・作った時刻・並び（order）は決めた値にして、何度作っても同じデータになる（seedData(page, demoData()) で置く。
// window.__ds.replaceAllData を通るので、画面には直した後の物（6.12）が出る）。ほかの担当の E2E は読むだけで使ってよい（直さない）。
//
// 中身（見本の画面ごとに見せたい物。docs/SPEC.md の 7.〜12.）:
// - 11月は5行（11/1 が日曜）。祝日は 11/3 文化の日・11/23 勤労感謝の日。休みは 11/11・11/14・11/23（祝日でもある）と、
//   隣の月の 12/2（休みの地の上の淡い数字。確かめ A7）
// - いつもの週 11/8〜11/14: 前の週から続く物（受けた表示・日曜に終わる●）、時刻のある複数日、3本目のレーン、土曜の「＞」、
//   土曜に始まる物の縮み、時刻のある予定・開始時刻だけ・重なり・ロック・完了・〆（Task List 生まれ）・Claude が足した物、
//   次の日にまたぐ夜の予定（翌日の「‹ 」）、URL の入ったメモ、長い件名
// - 11/13 は時刻の重なる仕事の予定が5件（L は4列＋「+1」、S は3列＋「+2」）と、休みをまたぐ旅行
// - 色の見本の週 11/15〜11/21: 仕事・プライベートのそれぞれに、24色のラベルを既定の呼び名の件名で1件ずつ（各日の上が淡・下が濃）と、
//   ラベルなしを1件。土曜には、色合いの間がいちばん狭い桜と牡丹を隣に並べた組も（FRAME-190）。11/19 は仕事 12件・
//   プライベート 10件にして、S のマンスリーで「12/10」を出す
// - 混んだ週 11/22〜11/28: 重なる複数日の仕事が5件（S のレールは3本まで、4本目からは「● 件名」の行）、月をまたぐ物
import type { AppData, Item, ItemKind, LabelName, OffDay } from '../../src/domain/types'
import { LABEL_DEFAULT_NAMES, LABEL_KEYS, type LabelKey } from '../../src/domain/labels'

/** 見本の今日と今（日本時間） */
export const DEMO_TODAY = '2026-11-10'
export const DEMO_NOW = '2026-11-10T09:00:00+09:00'

/** 見本の週（日曜） */
export const DEMO_WEEKS = { main: '2026-11-08', palette: '2026-11-15', dense: '2026-11-22' } as const

/** 休みの日（11/23 は祝日でもある。12/2 は 11月のマンスリーの隣の月の日） */
export const DEMO_OFF_DAYS = ['2026-11-11', '2026-11-14', '2026-11-23', '2026-12-02'] as const

/** ラベルの呼び名（設定で付けた名前の見本。どれも一般の言葉） */
export const DEMO_LABEL_NAMES: Partial<Record<LabelKey, string>> = { 'sky-l': '社内', 'blue-d': 'お客さま', 'peony-l': '家族' }

/** 見本の画面で開く・探す予定の id */
export const DEMO_IDS = {
  // ----- いつもの週の仕事 -----
  intake: 'demo-w-intake', // 申請の受付（11/4〜11/8・完了。日曜に終わる●が受けた表示の中に）
  training: 'demo-w-training', // 研修（11/5〜11/10。受けた表示・ラベルなしの線の色）
  materials: 'demo-w-materials', // 資料づくり（11/9 10:00〜11/12 18:00。時刻のある複数日。詳細の見本）
  expo: 'demo-w-expo', // 展示会の手配（11/10〜11/13。3本目のレーン）
  tripPrep: 'demo-w-trip-prep', // 出張の準備（11/12〜11/17。土曜の「＞」）
  stock: 'demo-w-stock', // 棚卸し（11/14〜11/16。土曜に始まって縮む）
  weekly: 'demo-w-weekly', // 定例ミーティング（11/10 10:00〜11:30）
  meeting: 'demo-w-meeting', // 打ち合わせ（11/10 13:00。開始時刻だけ）
  review: 'demo-w-review', // レビュー（11/10 15:00〜16:00・ロック。面談と重なる）
  interview: 'demo-w-interview', // 面談（11/10 15:30〜17:00）
  expenses: 'demo-w-expenses', // 経費の精算（11/10・完了）
  mail: 'demo-w-mail', // メールの返信（11/10）
  quote: 'demo-w-quote', // 見積もりの提出（Task List 生まれ・締め切り 11/11・〆・依頼者 営業部）
  claude: 'demo-w-claude', // 打ち合わせの候補日を返す（11/11・Claude が足した）
  longWork: 'demo-w-long', // 長い件名（11/12）
  // ----- 11/13 の重なり（5件） -----
  busy: ['demo-w-busy-1', 'demo-w-busy-2', 'demo-w-busy-3', 'demo-w-busy-4', 'demo-w-busy-5'],
  // ----- いつもの週のプライベート -----
  tidy: 'demo-p-tidy', // 家の片付け（11/7〜11/9。受けた表示。桜の隣に牡丹）
  trip: 'demo-p-trip', // 旅行（11/13〜11/15。休みをまたぐ。詳細の見本）
  dinner: 'demo-p-dinner', // 夕食（11/10 19:00〜21:00。タイムスケジュールのハイライト）
  nightBus: 'demo-p-night-bus', // 夜行バス（11/11 22:00〜11/12 02:00。翌日の「‹ 」）
  gym: 'demo-p-gym', // ジム（11/12 7:00〜8:00・ロック）
  salon: 'demo-p-salon', // 美容院（11/10・完了）
  book: 'demo-p-book', // 本を返す（11/10。メモに URL）
  cards: 'demo-p-cards', // 年賀状の準備（Task List 生まれ・締め切り 11/14・〆）
  longPrivate: 'demo-p-long', // 長い件名（11/13 10:00〜11:30）
  // ----- 混んだ週 -----
  dense: ['demo-w-plan', 'demo-w-estimate', 'demo-w-contract', 'demo-w-delivery', 'demo-w-invoice'],
  monthEnd: 'demo-w-month-end', // 月末の締め（11/26〜12/1。週と月をまたぐ）
} as const

/** 色の見本の週のカードの id（区分・ラベルのキー。ラベルなしは 'none'） */
export const paletteId = (kind: ItemKind, key: LabelKey | 'none') => `demo-${kind === 'work' ? 'w' : 'p'}-pal-${key}`

/**
 * 色合いの間がいちばん狭い桜（10°）と牡丹（350°）を隣に並べる組（色の見本の週の土曜。FRAME-190・PLAN §6.2 の「桜の隣に牡丹」）。
 * 24色の並び（4.6 の番号の順）では両端に離れるので、別に並べて見比べられるようにする
 */
export const DEMO_PAIR_KEYS: readonly LabelKey[] = ['rose-l', 'peony-l', 'rose-d', 'peony-d']
/** 桜と牡丹を並べた組のカードの id */
export const pairId = (kind: ItemKind, key: LabelKey) => `demo-${kind === 'work' ? 'w' : 'p'}-pair-${key}`

/** 作った時刻の始まり（10/1 9:00。完了にした日がいちばん早い 10/14 の予定よりも前。1件ごとに1分ずつ進め、並び（order）も同じ値にする） */
const CREATED_FROM = Date.parse('2026-10-01T09:00:00+09:00')
/** 見本の今（ミリ秒） */
const NOW_MS = Date.parse(DEMO_NOW)

interface Spec {
  id: string
  kind: ItemKind
  title: string
  /** calendar 生まれは開始日、list 生まれは開始日（無ければ null） */
  start: string | null
  due?: string | null
  startTime?: string | null
  endTime?: string | null
  origin?: Item['origin']
  label?: LabelKey | null
  /** 完了にした日（完了の物だけ） */
  doneOn?: string
  locked?: boolean
  requester?: string
  memo?: string
  listed?: boolean
  connector?: { via: string }
}

/** 1件の予定を、データの形（6.2）のすべての項目をそろえて作る */
function makeItem(spec: Spec, index: number): Item {
  const created = CREATED_FROM + index * 60_000
  const origin = spec.origin ?? 'calendar'
  const doneAt = spec.doneOn ? Math.min(NOW_MS - 60 * 60_000, Date.parse(`${spec.doneOn}T18:00:00+09:00`)) : null
  return {
    id: spec.id,
    v: 1,
    kind: spec.kind,
    title: spec.title,
    origin,
    start: spec.start,
    due: spec.due ?? null,
    startTime: spec.startTime ?? null,
    endTime: spec.endTime ?? null,
    listed: spec.listed ?? origin === 'list',
    done: Boolean(spec.doneOn),
    doneAt,
    doneOn: spec.doneOn ?? null,
    locked: spec.locked ?? false,
    label: spec.label ?? null,
    requester: spec.requester ?? '',
    memo: spec.memo ?? '',
    order: created,
    by: spec.connector ? 'connector' : 'user',
    ai: spec.connector ? 'claude' : null,
    via: spec.connector?.via ?? null,
    createdAt: created,
    // 完了にした物は、完了にした時に直した（作った時刻のままにしない）
    updatedAt: doneAt ?? created,
  }
}

/** いつもの週（11/8〜11/14）と、その前後・マンスリーで見せる物 */
function mainSpecs(): Spec[] {
  const I = DEMO_IDS
  return [
    // ----- 仕事 -----
    {
      id: I.intake,
      kind: 'work',
      title: '申請の受付',
      start: '2026-11-04',
      due: '2026-11-08',
      label: 'apricot-l',
      doneOn: '2026-11-08',
    },
    { id: I.training, kind: 'work', title: '研修', start: '2026-11-05', due: '2026-11-10' },
    {
      id: I.materials,
      kind: 'work',
      title: '資料づくり',
      start: '2026-11-09',
      due: '2026-11-12',
      startTime: '10:00',
      endTime: '18:00',
      label: 'sky-l',
      requester: '総務',
      memo: '表紙と目次を先に決める。\n図は前回の物を使い回してよい。',
    },
    { id: I.expo, kind: 'work', title: '展示会の手配', start: '2026-11-10', due: '2026-11-13', label: 'wisteria-l' },
    { id: I.tripPrep, kind: 'work', title: '出張の準備', start: '2026-11-12', due: '2026-11-17', label: 'blue-d' },
    { id: I.stock, kind: 'work', title: '棚卸し', start: '2026-11-14', due: '2026-11-16', label: 'mint-l' },
    {
      id: I.weekly,
      kind: 'work',
      title: '定例ミーティング',
      start: DEMO_TODAY,
      startTime: '10:00',
      endTime: '11:30',
      label: 'sky-d',
    },
    { id: I.meeting, kind: 'work', title: '打ち合わせ', start: DEMO_TODAY, startTime: '13:00' },
    {
      id: I.review,
      kind: 'work',
      title: 'レビュー',
      start: DEMO_TODAY,
      startTime: '15:00',
      endTime: '16:00',
      label: 'teal-l',
      locked: true,
    },
    { id: I.interview, kind: 'work', title: '面談', start: DEMO_TODAY, startTime: '15:30', endTime: '17:00' },
    { id: I.expenses, kind: 'work', title: '経費の精算', start: DEMO_TODAY, doneOn: DEMO_TODAY },
    { id: I.mail, kind: 'work', title: 'メールの返信', start: DEMO_TODAY },
    {
      id: I.quote,
      kind: 'work',
      title: '見積もりの提出',
      origin: 'list',
      start: null,
      due: '2026-11-11',
      label: 'blue-l',
      requester: '営業部',
    },
    {
      id: I.claude,
      kind: 'work',
      title: '打ち合わせの候補日を返す',
      start: '2026-11-11',
      connector: { via: 'メール: 打ち合わせの候補日について' },
    },
    {
      id: I.longWork,
      kind: 'work',
      title: '来年度の予算案についての部内の打ち合わせと、配る資料の読み合わせ',
      start: '2026-11-12',
    },
    // 11/13 の重なり: どれも 15:00〜15:30 に重なるので、L は4列と「+1」、S は3列と「+2」
    ...(
      [
        ['電話', '14:00', 'coral-d'],
        ['来客', '14:00', 'lemon-l'],
        ['見積もりの確認', '14:15', null],
        ['資料の送付', '14:30', 'violet-l'],
        ['社内の確認', '14:45', 'sky-l'],
      ] as const
    ).map(
      ([title, startTime, label], i): Spec => ({
        id: I.busy[i],
        kind: 'work',
        title,
        start: '2026-11-13',
        startTime,
        endTime: '15:30',
        label,
      }),
    ),
    // ----- プライベート -----
    { id: I.tidy, kind: 'private', title: '家の片付け', start: '2026-11-07', due: '2026-11-09', label: 'rose-l' },
    {
      id: I.trip,
      kind: 'private',
      title: '旅行',
      start: '2026-11-13',
      due: '2026-11-15',
      label: 'peony-l',
      memo: '切符は前の日までに受け取る。',
    },
    { id: I.dinner, kind: 'private', title: '夕食', start: DEMO_TODAY, startTime: '19:00', endTime: '21:00', label: 'apricot-d' },
    {
      id: I.nightBus,
      kind: 'private',
      title: '夜行バス',
      start: '2026-11-11',
      due: '2026-11-12',
      startTime: '22:00',
      endTime: '02:00',
      label: 'sky-l',
    },
    {
      id: I.gym,
      kind: 'private',
      title: 'ジム',
      start: '2026-11-12',
      startTime: '07:00',
      endTime: '08:00',
      label: 'mint-d',
      locked: true,
    },
    { id: I.salon, kind: 'private', title: '美容院', start: DEMO_TODAY, doneOn: DEMO_TODAY },
    {
      id: I.book,
      kind: 'private',
      title: '本を返す',
      start: DEMO_TODAY,
      memo: '返す前に、予約の一覧を見ておく。\nhttps://example.com/library/return',
    },
    { id: I.cards, kind: 'private', title: '年賀状の準備', origin: 'list', start: null, due: '2026-11-14' },
    {
      id: I.longPrivate,
      kind: 'private',
      title: '冬物の衣類の入れ替えと、使わなくなった家電の引き取りの申し込み',
      start: '2026-11-13',
      startTime: '10:00',
      endTime: '11:30',
    },
    // ----- マンスリー・イヤーで見せる物（いつもの週の外） -----
    // 11/2 は全部完了（何も書かない日）、11/3 は祝日の予定、11/23 は祝日で休みの日の予定
    { id: 'demo-w-month-start', kind: 'work', title: '月初めの確認', start: '2026-11-02', doneOn: '2026-11-02' },
    { id: 'demo-w-holiday-duty', kind: 'work', title: '祝日の当番', start: '2026-11-03' },
    { id: 'demo-p-garden', kind: 'private', title: '庭の手入れ', start: '2026-11-23' },
    { id: 'demo-w-checkup', kind: 'work', title: '健康診断', start: '2026-10-14', doneOn: '2026-10-14' },
    { id: 'demo-p-concert', kind: 'private', title: '演奏会', start: '2026-10-24', startTime: '18:30', endTime: '20:30' },
    { id: 'demo-w-year-end', kind: 'work', title: '年末の挨拶状', start: '2026-12-10', label: 'lemon-d' },
    { id: 'demo-p-cleaning', kind: 'private', title: '大掃除', start: '2026-12-27', due: '2026-12-29', label: 'lime-l' },
  ]
}

/**
 * 色の見本の週（11/15〜11/21）: 区分ごとに24色を1件ずつ（各日に淡2つ・濃2つ。上が淡）、土曜にラベルなしと、桜と牡丹を隣に並べた組
 * （桜・淡 → 牡丹・淡 → 桜・濃 → 牡丹・濃）。11/19 は件数を増やす
 */
function paletteSpecs(): Spec[] {
  const days = ['2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20']
  const out: Spec[] = []
  for (const kind of ['work', 'private'] as const) {
    days.forEach((date, d) => {
      const hues = LABEL_KEYS.slice(d * 2, d * 2 + 2)
      const keys = [...hues, ...hues.map((k) => k.replace(/-l$/, '-d') as LabelKey)]
      for (const key of keys)
        out.push({ id: paletteId(kind, key), kind, title: LABEL_DEFAULT_NAMES[key], start: date, label: key })
    })
    out.push({ id: paletteId(kind, 'none'), kind, title: 'ラベルなし', start: '2026-11-21' })
    for (const key of DEMO_PAIR_KEYS)
      out.push({ id: pairId(kind, key), kind, title: LABEL_DEFAULT_NAMES[key], start: '2026-11-21', label: key })
  }
  // 11/19: 仕事 4 + 8 = 12件、プライベート 4 + 6 = 10件（S のマンスリーの「12/10」）
  const moreWork = [
    '伝票の整理',
    '備品の発注',
    '議事録の清書',
    '週報の作成',
    '名刺の整理',
    '書類の回覧',
    '予定の調整',
    '問い合わせの返信',
  ]
  const morePrivate = ['洗濯', '買い物', '植物の水やり', '掃除', '料理の下ごしらえ', '手紙の返事']
  moreWork.forEach((title, i) => out.push({ id: `demo-w-more-${i + 1}`, kind: 'work', title, start: '2026-11-19' }))
  morePrivate.forEach((title, i) => out.push({ id: `demo-p-more-${i + 1}`, kind: 'private', title, start: '2026-11-19' }))
  return out
}

/** 混んだ週（11/22〜11/28）: 重なる複数日の仕事が5件（レーン 0〜4）と、週と月をまたぐ物 */
function denseSpecs(): Spec[] {
  const [plan, estimate, contract, delivery, invoice] = DEMO_IDS.dense
  return [
    { id: plan, kind: 'work', title: '企画書', start: '2026-11-22', due: '2026-11-25', label: 'blue-l' },
    { id: estimate, kind: 'work', title: '見積もり', start: '2026-11-22', due: '2026-11-24', label: 'coral-l' },
    { id: contract, kind: 'work', title: '契約の確認', start: '2026-11-23', due: '2026-11-27', label: 'teal-d' },
    { id: delivery, kind: 'work', title: '納品の準備', start: '2026-11-23', due: '2026-11-26', label: 'apricot-d' },
    { id: invoice, kind: 'work', title: '請求', start: '2026-11-24', due: '2026-11-27' },
    { id: DEMO_IDS.monthEnd, kind: 'work', title: '月末の締め', start: '2026-11-26', due: '2026-12-01', label: 'violet-d' },
    { id: 'demo-p-shopping', kind: 'private', title: '買い出し', start: '2026-11-28', label: 'lemon-l' },
  ]
}

/** 休み・ラベルの呼び名の記録の共通の項目（手で付けた物） */
const byUser = { by: 'user', ai: null, via: null } as const

/**
 * 見本のデータ（呼ぶたびに新しい物を作る）。seedData(page, demoData()) で端末の中のデータを丸ごと置き換える
 * （ほかの表は空になる）
 */
export function demoData(): Pick<AppData, 'items' | 'offDays' | 'labelNames'> {
  const specs = [...mainSpecs(), ...paletteSpecs(), ...denseSpecs()]
  const items: Record<string, Item> = {}
  specs.forEach((s, i) => {
    if (items[s.id]) throw new Error(`見本の予定の id が重なっています: ${s.id}`)
    items[s.id] = makeItem(s, i)
  })
  const offDays: Record<string, OffDay> = {}
  DEMO_OFF_DAYS.forEach((date, i) => {
    offDays[date] = { id: date, date, off: true, updatedAt: CREATED_FROM + i * 60_000, ...byUser }
  })
  const labelNames: Record<string, LabelName> = {}
  Object.entries(DEMO_LABEL_NAMES).forEach(([key, name], i) => {
    labelNames[key] = { id: key, name: name as string, updatedAt: CREATED_FROM + i * 60_000, ...byUser }
  })
  return { items, offDays, labelNames }
}
