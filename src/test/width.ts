// テスト用（docs/SPEC.md の 2.2 の src/test/*）: jsdom には matchMedia が無いので、画面の幅を決めて (min-width: …px)・(max-width: …px) の問い合わせに答える物を置く
// （幅の区分 S・M・L は src/ui/hooks.ts の useWidthClass が matchMedia で決める。docs/SPEC.md の 3.2）

export function setTestWidth(width: number): void {
  window.matchMedia = ((query: string) => {
    const min = /min-width:\s*(\d+)px/.exec(query)
    const max = /max-width:\s*(\d+)px/.exec(query)
    const matches = Boolean(min || max) && (!min || width >= Number(min[1])) && (!max || width <= Number(max[1]))
    return {
      matches,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    } as MediaQueryList
  }) as typeof window.matchMedia
}

/** 幅の区分ごとの代表の幅（L: PC、M: タブレットの縦、S: スマホ） */
export const TEST_WIDTHS = { L: 1400, M: 700, S: 412 } as const
