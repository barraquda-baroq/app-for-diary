// 段階2の見本の画面で撮る物の一覧（docs/SPEC.md の 21.・22.。作者に色と見た目を決めてもらう Q1〜Q6）。
// 撮るのは e2e/samples/samples.spec.ts（E2E_SAMPLES=1 の時だけの samples の端末。npm run samples）。データは作り物の
// e2e/fixtures/demoData.ts だけを使い、今は 2026年11月10日（火）9:00。どれも本物の行き先を開いて撮る。
// - SHOTS: 3つの外観（ホワイト・ダーク・ディープダーク）で撮る画面（16 × 3 = 48 枚）。L は 1400×900、S は 390×844（どちらも倍率 2）
// - CROPS: 問いごとに、案（e2e/samples/variants.json）を差し込んで撮り直す所の切り抜き（A・B・C を並べて見比べる）
// 探す所は data-testid（src/features/calendar/common/testIds.ts）だけを使う（画面の CSS のクラスには頼らない）
import type { Locator, Page } from '@playwright/test'
import { testIds } from '../../src/features/calendar/common/testIds'
import { LABEL_KEYS } from '../../src/domain/labels'
import { DEMO_IDS, DEMO_PAIR_KEYS, DEMO_TODAY, DEMO_WEEKS, paletteId, pairId } from '../fixtures/demoData'

export type Appearance = 'white' | 'dark' | 'deep-dark'
export const APPEARANCES: readonly Appearance[] = ['white', 'dark', 'deep-dark']
export const APPEARANCE_NAMES: Record<Appearance, string> = { white: 'ホワイト', dark: 'ダーク', 'deep-dark': 'ディープダーク' }

/** 幅（L = PC、S = スマホ。iPhone の大きさ） */
export type Size = 'L' | 'S'
export const VIEWPORTS: Record<Size, { width: number; height: number }> = {
  L: { width: 1400, height: 900 },
  S: { width: 390, height: 844 },
}

export interface Shot {
  /** 画面の名前（ファイルの名前にもする） */
  id: string
  size: Size
  /** 同じ画面の写し分け（S のウィークリーの上と木〜土など） */
  part?: string
  /** 見本のページの見出し */
  title: string
  /** 開く行き先（# の後ろ） */
  hash: string
  /** その画面の中身ができた印（これが出てから撮る。中身のできていない仮の画面では出ない） */
  ready: (page: Page) => Locator
  /** 撮る前の操作（休みを付ける状態・詳細を開く・スクロールなど） */
  prepare?: (page: Page) => Promise<void>
}

const week = DEMO_WEEKS.main
const month = `/month/${DEMO_TODAY.slice(0, 7)}`

/** 要素を、そのスクロールの中のいちばん上に出す（scrollIntoView はページもスクロールするので、ページは上に戻す） */
async function scrollToTop(target: Locator): Promise<void> {
  await target.evaluate((e) => {
    e.scrollIntoView({ block: 'start', inline: 'nearest' })
    window.scrollTo(0, 0)
  })
}

/**
 * 書き換えられる件名の欄（入力欄。登録・詳細の画面の中身ができた印）。中身ができる前の仮の詳細の画面にも item-title はあるが、
 * 字を出すだけの段落なので、これでは見つからない（仮の画面を見本として撮らない）
 */
export const editableTitle = (page: Page) => page.getByTestId(testIds.itemTitle).and(page.locator('input, textarea'))

/** 詳細を開く（ウィークリーの始点のカードを押す）。欄が出るまで待つ */
const openDetail = (id: string) => async (page: Page) => {
  await page.getByTestId(testIds.weekStart(id)).click()
  await page.getByTestId(testIds.itemSheet).waitFor()
  await editableTitle(page).waitFor()
}

/**
 * 登録の画面を開き、プライベート・ラベル rose-l にして、件名を入れて1語を選ぶ（選んだ文字の地 --selection が見える）。
 * どの欄もいつも出ている（「詳しく」の畳む所は無い。docs/SPEC.md の 12.2）
 */
async function openRegister(page: Page): Promise<void> {
  await page.getByTestId(testIds.calAdd).click()
  await page.getByTestId(testIds.itemSheet).waitFor()
  await page.getByTestId(testIds.itemKind('private')).click()
  await page.getByTestId(testIds.itemLabel('rose-l')).click()
  const title = page.getByTestId(testIds.itemTitle)
  await title.fill('友だちと映画を見に行く')
  await title.evaluate((e) => {
    const input = e as HTMLInputElement
    input.focus()
    const at = input.value.indexOf('映画')
    input.setSelectionRange(at, at + 2)
  })
}

export const SHOTS: readonly Shot[] = [
  { id: 'month', size: 'L', title: 'マンスリー', hash: month, ready: (p) => p.getByTestId(testIds.monthCell(DEMO_TODAY)) },
  { id: 'month', size: 'S', title: 'マンスリー', hash: month, ready: (p) => p.getByTestId(testIds.monthCell(DEMO_TODAY)) },
  {
    id: 'month-off',
    size: 'L',
    title: 'マンスリー（休みを付ける状態）',
    hash: month,
    ready: (p) => p.getByTestId(testIds.monthCell(DEMO_TODAY)),
    prepare: async (page) => {
      await page.getByTestId(testIds.calOff).click()
      await page.getByTestId(testIds.offBanner).waitFor()
    },
  },
  { id: 'week', size: 'L', title: 'ウィークリー', hash: `/week/${week}`, ready: (p) => p.getByTestId(testIds.weekCol(week)) },
  {
    id: 'week',
    size: 'S',
    part: 'top',
    title: 'ウィークリー（上）',
    hash: `/week/${week}`,
    ready: (p) => p.getByTestId(testIds.weekHead(week)),
  },
  {
    id: 'week',
    size: 'S',
    part: 'thu-sat',
    title: 'ウィークリー（木〜土）',
    hash: `/week/${week}`,
    ready: (p) => p.getByTestId(testIds.weekHead(week)),
    prepare: (page) => scrollToTop(page.getByTestId(testIds.weekHead('2026-11-12'))),
  },
  {
    id: 'week-dense',
    size: 'S',
    title: 'ウィークリー（複数日の予定が多い週）',
    hash: `/week/${DEMO_WEEKS.dense}`,
    ready: (p) => p.getByTestId(testIds.weekHead(DEMO_WEEKS.dense)),
  },
  {
    id: 'palette',
    size: 'L',
    title: 'ラベルの24色（ウィークリー）',
    hash: `/week/${DEMO_WEEKS.palette}`,
    ready: (p) => p.getByTestId(testIds.weekCard(paletteId('work', 'rose-l'))),
  },
  { id: 'day', size: 'L', title: 'デイリー（今日）', hash: `/day/${DEMO_TODAY}`, ready: (p) => p.getByTestId(testIds.dayNow) },
  { id: 'day', size: 'S', title: 'デイリー（今日）', hash: `/day/${DEMO_TODAY}`, ready: (p) => p.getByTestId(testIds.dayNow) },
  {
    id: 'day-busy',
    size: 'L',
    title: 'デイリー（重なりの多い日）',
    hash: '/day/2026-11-13',
    ready: (p) => p.getByTestId(testIds.dayMore),
  },
  {
    id: 'detail-work',
    size: 'L',
    title: '詳細（仕事・ラベルあり）',
    hash: `/week/${week}`,
    ready: (p) => p.getByTestId(testIds.weekStart(DEMO_IDS.materials)),
    prepare: openDetail(DEMO_IDS.materials),
  },
  {
    id: 'detail-work',
    size: 'S',
    title: '詳細（仕事・ラベルあり）',
    hash: `/week/${week}`,
    ready: (p) => p.getByTestId(testIds.weekStart(DEMO_IDS.materials)),
    prepare: openDetail(DEMO_IDS.materials),
  },
  {
    id: 'detail-private',
    size: 'S',
    title: '詳細（プライベート・ラベルあり）',
    hash: `/week/${week}`,
    ready: (p) => p.getByTestId(testIds.weekStart(DEMO_IDS.trip)),
    prepare: openDetail(DEMO_IDS.trip),
  },
  {
    id: 'register',
    size: 'L',
    title: '登録（プライベート・ラベルを選んだ所）',
    hash: `/week/${week}`,
    ready: (p) => p.getByTestId(testIds.weekCol(week)),
    prepare: openRegister,
  },
  {
    id: 'register',
    size: 'S',
    title: '登録（プライベート・ラベルを選んだ所）',
    hash: `/week/${week}`,
    ready: (p) => p.getByTestId(testIds.weekHead(week)),
    prepare: openRegister,
  },
]

/** 撮った絵のファイルの名前（拡張子なし） */
export const shotName = (s: Pick<Shot, 'id' | 'size' | 'part'>, appearance: Appearance) =>
  `${s.id}-${s.size}${s.part ? `-${s.part}` : ''}-${appearance}`

// ---------- 問いごとの切り抜き ----------

/** 画面の座標の四角 */
export interface Box {
  x: number
  y: number
  width: number
  height: number
}

export interface Crop {
  /** 問いの番号（QUESTIONS-FOR-AUTHOR の 2〜6。e2e/samples/variants.json の questions） */
  question: 2 | 3 | 4 | 5 | 6
  id: string
  title: string
  /** どの画面の状態で切り抜くか（SHOTS の id・size・part） */
  shot: { id: string; size: Size; part?: string }
  /** 切り抜く四角（見えている要素の箱を合わせた物） */
  area: (page: Page) => Promise<Box>
}

/** 見えている要素の箱を合わせた四角（pad だけ広げ、画面の中に収める。見えない要素は飛ばす） */
export async function unionBox(page: Page, targets: Locator[], pad = 8): Promise<Box> {
  const boxes: Box[] = []
  for (const t of targets) {
    for (const el of await t.all()) {
      const b = await el.boundingBox()
      if (b && b.width > 0 && b.height > 0) boxes.push(b)
    }
  }
  if (!boxes.length) throw new Error('切り抜く所が見つかりません')
  const vp = page.viewportSize() ?? VIEWPORTS.L
  const x0 = Math.max(0, Math.min(...boxes.map((b) => b.x)) - pad)
  const y0 = Math.max(0, Math.min(...boxes.map((b) => b.y)) - pad)
  const x1 = Math.min(vp.width, Math.max(...boxes.map((b) => b.x + b.width)) + pad)
  const y1 = Math.min(vp.height, Math.max(...boxes.map((b) => b.y + b.height)) + pad)
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

const ids = (page: Page, list: readonly string[]) => list.map((id) => page.getByTestId(id))

/** マンスリーの曜日の行の高さの上限（Q5 の切り抜きで、マス目の上に入れる高さ） */
const WEEKDAY_ROW_MAX = 64

/** 2026年11月の from 日〜to 日の日付（'YYYY-MM-DD'）の並び */
const novDays = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => `2026-11-${String(from + i).padStart(2, '0')}`)

export const CROPS: readonly Crop[] = [
  // Q2 色合いの間隔: 色の見本の週の仕事の段（24色と、土曜の桜と牡丹の組）と、ラベルを選ぶ所
  {
    question: 2,
    id: 'palette-work',
    title: 'ウィークリーの仕事の段（24色）',
    shot: { id: 'palette', size: 'L' },
    area: (page) =>
      unionBox(page, [
        ...ids(
          page,
          novDays(15, 21).map((d) => testIds.weekHead(d)),
        ),
        ...ids(
          page,
          [...LABEL_KEYS, 'none' as const].map((k) => testIds.weekCard(paletteId('work', k))),
        ),
        ...ids(
          page,
          DEMO_PAIR_KEYS.map((k) => testIds.weekCard(pairId('work', k))),
        ),
      ]),
  },
  {
    question: 2,
    id: 'picker',
    title: 'ラベルを選ぶ所',
    shot: { id: 'register', size: 'L' },
    area: (page) =>
      unionBox(
        page,
        ids(
          page,
          [...LABEL_KEYS, 'none' as const].map((k) => testIds.itemLabel(k)),
        ),
        12,
      ),
  },
  // Q3 区分の地の濃さ: ウィークリーの上半分・デイリーの左・詳細の画面
  {
    question: 3,
    id: 'week-top',
    title: 'ウィークリー（上半分）',
    shot: { id: 'week', size: 'L' },
    area: async (page) => {
      const b = await unionBox(page, [page.getByTestId(testIds.view('week'))], 0)
      return { ...b, height: Math.round(b.height / 2) }
    },
  },
  {
    question: 3,
    id: 'day-areas',
    title: 'デイリーの左（仕事・プライベートの区切り）',
    shot: { id: 'day', size: 'L' },
    area: (page) => unionBox(page, ids(page, [testIds.dayArea('work'), testIds.dayArea('private')]), 4),
  },
  {
    question: 3,
    id: 'detail',
    title: '詳細の画面の地',
    shot: { id: 'detail-work', size: 'L' },
    area: (page) => unionBox(page, [page.getByTestId(testIds.itemSheet)], 4),
  },
  // Q4 件名の帯の形: デイリーのタイムスケジュールの 9:00（今の時刻の線）〜17:00（面談の終わり）
  {
    question: 4,
    id: 'timeline',
    title: 'タイムスケジュール（件名の帯）',
    shot: { id: 'day', size: 'L' },
    area: async (page) => {
      const events = await unionBox(
        page,
        ids(page, [
          testIds.dayNow,
          ...[DEMO_IDS.weekly, DEMO_IDS.meeting, DEMO_IDS.review, DEMO_IDS.interview].map((id) => testIds.dayEvent(id)),
        ]),
        24,
      )
      const tl = await unionBox(page, [page.getByTestId(testIds.dayTimeline)], 0)
      return { x: tl.x, y: events.y, width: tl.width, height: events.height }
    },
  },
  // Q5 土日祝の色: マンスリーの曜日の行と初めの2週
  {
    question: 5,
    id: 'month-top',
    title: 'マンスリー（曜日の行と初めの2週）',
    shot: { id: 'month', size: 'L' },
    area: async (page) => {
      const cells = await unionBox(
        page,
        ids(
          page,
          novDays(1, 14).map((d) => testIds.monthCell(d)),
        ),
        0,
      )
      // 曜日の行（マス目の上）も入れる。曜日の行には data-testid が無いので、カレンダーの中身の箱（calendar-body）の上の端から
      // （曜日の行の高さを決め打ちにすると、行が高い時に曜日の字が切れる）。中身の箱の上に別の物があっても、マス目の上 64px まで
      const body = await unionBox(page, [page.getByTestId(testIds.calendarBody)], 0)
      const top = Math.max(body.y, cells.y - WEEKDAY_ROW_MAX)
      return { ...cells, y: top, height: cells.y + cells.height - top }
    },
  },
  // Q6 グレーの差し色: 操作の列（［月］・［休み］を押した状態・［＋ 登録］）と休みの帯、今日の印、選んだ文字と押した区分
  {
    question: 6,
    id: 'toolbar',
    title: '操作の列（［月］・［休み］・［＋ 登録］）',
    shot: { id: 'month-off', size: 'L' },
    area: (page) => unionBox(page, ids(page, [testIds.calendarToolbar, testIds.offBanner]), 4),
  },
  {
    question: 6,
    id: 'today-month',
    title: 'マンスリーの今日の印',
    shot: { id: 'month', size: 'L' },
    area: (page) =>
      unionBox(
        page,
        ids(
          page,
          novDays(9, 11).map((d) => testIds.monthCell(d)),
        ),
        0,
      ),
  },
  {
    question: 6,
    id: 'today-week',
    title: 'ウィークリーの今日の札',
    shot: { id: 'week', size: 'L' },
    area: (page) =>
      unionBox(
        page,
        ids(
          page,
          novDays(9, 11).map((d) => testIds.weekHead(d)),
        ),
        0,
      ),
  },
  {
    question: 6,
    id: 'register',
    // 主なボタン（--primary）は、操作の列の［＋ 登録］（ふつうのボタン）ではなく、登録の画面の［登録］
    title: '登録の画面（選んだ文字・押した区分・［登録］）',
    shot: { id: 'register', size: 'L' },
    area: (page) =>
      unionBox(
        page,
        ids(page, [testIds.itemTitle, testIds.itemKind('work'), testIds.itemKind('private'), testIds.itemRegister]),
        12,
      ),
  },
]

/** 切り抜いた絵のファイルの名前（拡張子なし。letter は案の A・B・C） */
export const cropName = (c: Pick<Crop, 'question' | 'id'>, letter: string, appearance: Appearance) =>
  `q${c.question}-${c.id}-${letter}-${appearance}`

/** 切り抜きの状態を作る撮る物 */
export function shotOf(c: Crop): Shot {
  const s = SHOTS.find((x) => x.id === c.shot.id && x.size === c.shot.size && x.part === c.shot.part)
  if (!s) throw new Error(`撮る物 ${c.shot.id} ${c.shot.size} がありません`)
  return s
}
