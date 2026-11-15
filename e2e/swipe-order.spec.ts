// 端からのフリック（ブラウザの「戻る」「進む」の身振り）の後に、アプリが履歴を書く・動かす順番の E2E のうち、Android の物（docs/SPEC.md の
// 3.1・■27・12.2。src/history/appHistory.ts）。前の作りでは iPhone の身振りの popstate の後の順番もここで確かめていたが、iPhone・iPad は
// ブラウザの履歴を1つのままにする形にした（src/history/singleEntryHistory.ts。22. の ■31〜■33）ので、そちらは e2e/edge-flick.spec.ts
// （ブラウザの履歴が増えない・積む・戻る・進むを呼ばない）へ移した。ここでは popstate と、アプリが呼んだ history の物（積む・置き換える・
// 動く）を順に控えて、Android の「戻る」の後に今の履歴を同じ物で置き換えない（前の作りの iPhone が払いの後にしていた置き換え。今はどの
// 端末もしない）ことを確かめる。「戻る」は page.goBack で、その popstate だけ hasUAVisualTransition を true にする
// （PopStateEvent.prototype を差し替える）。今は 2026年11月10日（火）9:00（e2e/helpers.ts の E2E_NOW）
import { expect, test, type Page } from '@playwright/test'
import { collectDiagnosticsOnFailure, historySettled, openCalendar } from './helpers'

collectDiagnosticsOnFailure()

const DAY = '/day/2026-11-10'

/** 控えた物の1つ: popstate か、アプリが呼んだ history の物 */
interface Entry {
  ev: 'pop' | 'pushState' | 'replaceState' | 'go' | 'back' | 'forward'
  /** pop: 払い（hasUAVisualTransition が true）の popstate か */
  ua?: boolean
  /** pop: 着いた履歴の state（JSON）。pushState・replaceState: 書く state（JSON） */
  state?: string
  /** pushState・replaceState: 書く URL（渡さない時は null。今のまま） */
  url?: string | null
  /** go の数 */
  delta?: number
  /** pushState・replaceState: 書く履歴の印（back・fwd。無ければ null） */
  mark?: string | null
  /** popstate を送っている途中に呼んだ（window.event が popstate） */
  inPop?: boolean
  /** popstate を送ってから次の処理（setTimeout 0）までの間に呼んだ（popstate の後のマイクロタスクも） */
  inPopTask?: boolean
  /** 呼んだ時に画面に出ていた物（sheet・quick・page（カレンダーでない画面）・toast・launch（起動アニメーション）。無ければ空） */
  over?: string
}

/** 開く前に、popstate とアプリが呼んだ history の物を順に控える物と、払いの popstate の印を入れる */
async function recordOrder(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __order: unknown[]; __ua?: boolean }
    const log: unknown[] = []
    w.__order = log
    // 払いの popstate（テストが __ua を立ててから最初に来た物）だけ true
    const swipes = new WeakSet<Event>()
    Object.defineProperty(PopStateEvent.prototype, 'hasUAVisualTransition', {
      configurable: true,
      get(this: Event) {
        return swipes.has(this)
      },
    })
    const shown = (selector: string) =>
      [...document.querySelectorAll(selector)].some(
        (el) => getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0,
      )
    const over = () =>
      [
        shown('.modal-backdrop, [role="dialog"]') && 'sheet',
        shown('.cp-quick') && 'quick',
        !shown('[data-testid^="view-"]') && 'page',
        shown('.toast') && 'toast',
        document.getElementById('ds-launch') !== null && 'launch',
      ]
        .filter(Boolean)
        .join('+')
    let popTask = 0
    // window の捕まえる段で、アプリの聞き手より先に聞く
    window.addEventListener(
      'popstate',
      (e) => {
        const ua = w.__ua === true
        if (ua) {
          swipes.add(e)
          w.__ua = false
        }
        popTask++
        // popstate の後の最初の処理で終わり（アプリが popstate の中で置く setTimeout 0 より先に置く）
        setTimeout(() => popTask--, 0)
        log.push({ ev: 'pop', ua, state: JSON.stringify(history.state) })
      },
      { capture: true },
    )
    // 失敗した時の控え（e2e/helpers.ts）も history の物を包むので、その外側を包む
    const target = history as unknown as Record<string, (...args: unknown[]) => unknown>
    for (const op of ['pushState', 'replaceState', 'go', 'back', 'forward']) {
      const original = target[op].bind(history)
      Object.defineProperty(history, op, {
        configurable: true,
        value: (...args: unknown[]) => {
          const writes = op.endsWith('State')
          const data = args[0] as { ds?: { mark?: string } } | null
          log.push({
            ev: op,
            state: writes ? JSON.stringify(args[0]) : undefined,
            url: writes ? ((args[2] as string | undefined) ?? null) : undefined,
            delta: op === 'go' ? args[0] : undefined,
            mark: writes ? (data?.ds?.mark ?? null) : undefined,
            inPop: (window as unknown as { event?: Event }).event?.type === 'popstate',
            inPopTask: popTask > 0,
            over: over(),
          })
          return original(...args)
        },
      })
    }
  })
}

const orderOf = (page: Page) => page.evaluate(() => (window as unknown as { __order: Entry[] }).__order.slice())

/**
 * 端からのフリック（左の端から = back・右の端から = forward）: 次の popstate を払いの物にして「戻る」「進む」をし、アプリの履歴が
 * 落ち着くまで待つ（historySettled）
 */
async function flick(page: Page, dir: 'back' | 'forward') {
  await page.evaluate(() => {
    ;(window as unknown as { __ua?: boolean }).__ua = true
  })
  if (dir === 'back') await page.goBack()
  else await page.goForward()
  // 払いの印は、その「戻る」「進む」の popstate が受け取る（来るまで待つ）
  await expect.poll(() => page.evaluate(() => (window as unknown as { __ua?: boolean }).__ua)).toBe(false)
  await historySettled(page)
}

/** 払い（hasUAVisualTransition が true の popstate）ごとに、その後（次の払いまで）にアプリが呼んだ history の物 */
function bySwipe(log: Entry[]): { pop: Entry; ops: Entry[] }[] {
  const out: { pop: Entry; ops: Entry[] }[] = []
  for (const e of log) {
    if (e.ev === 'pop' && e.ua) out.push({ pop: e, ops: [] })
    else if (e.ev !== 'pop') out.at(-1)?.ops.push(e)
  }
  return out
}

const countByTitle = (page: Page, title: string) =>
  page.evaluate((t) => Object.values(window.__ds.getData().items).filter((i) => i.title === t).length, title)

test.describe('Android の戻る（Pixel 7）', { tag: ['@s'] }, () => {
  test('書きかけの登録の画面の「戻る」は、今までどおり「書きかけを捨てますか？」と聞く（■27 は iPhone の端からのフリックだけ）。払いの置き換えはしない', async ({
    page,
  }) => {
    await recordOrder(page)
    await openCalendar(page, DAY)
    const sheet = page.getByTestId('item-sheet')
    await page.getByTestId('cal-add').tap()
    await expect(sheet).toBeVisible()
    await page.getByTestId('item-title').fill('書きかけの予定')
    await historySettled(page)
    const start = (await orderOf(page)).length
    await flick(page, 'back')
    await expect(page.getByTestId('item-discard')).toBeVisible()
    await page.getByTestId('item-discard-keep').tap()
    await expect(sheet).toBeVisible()
    await expect(page.getByTestId('item-title')).toHaveValue('書きかけの予定')
    const swipes = bySwipe((await orderOf(page)).slice(start))
    expect(swipes).toHaveLength(1)
    expect(swipes[0].ops.filter((o) => o.ev === 'replaceState' && o.url === null)).toEqual([])
    expect(await countByTitle(page, '書きかけの予定')).toBe(0)
  })
})
