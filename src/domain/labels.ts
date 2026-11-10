// ラベルの24色の並びと呼び名（docs/SPEC.md の 4.6・6.6・19.4）。データにはキーだけを持ち、色の値は外観ごとに src/styles.css で決める。
// 呼び名の照らし方は NS の src/claude/refs.ts の refKey の考え方（NFKC・空白をそろえる）に、大文字と小文字をそろえるのを足した物。
import type { AppData } from './types'

/** 24色のキー（並びは固定: 上の行に淡の12色、下の行に濃の12色を色合いの順に。4.6） */
export const LABEL_KEYS = [
  'rose-l',
  'coral-l',
  'apricot-l',
  'lemon-l',
  'lime-l',
  'mint-l',
  'teal-l',
  'sky-l',
  'blue-l',
  'wisteria-l',
  'violet-l',
  'peony-l',
  'rose-d',
  'coral-d',
  'apricot-d',
  'lemon-d',
  'lime-d',
  'mint-d',
  'teal-d',
  'sky-d',
  'blue-d',
  'wisteria-d',
  'violet-d',
  'peony-d',
] as const

export type LabelKey = (typeof LABEL_KEYS)[number]

/** 既定の呼び名（付けていない色のツールチップと読み上げにだけ使う。4.6） */
export const LABEL_DEFAULT_NAMES: Record<LabelKey, string> = {
  'rose-l': '桜・淡',
  'coral-l': '珊瑚・淡',
  'apricot-l': '杏・淡',
  'lemon-l': '菜の花・淡',
  'lime-l': '若葉・淡',
  'mint-l': 'ミント・淡',
  'teal-l': '青磁・淡',
  'sky-l': '空・淡',
  'blue-l': '瑠璃・淡',
  'wisteria-l': '藤・淡',
  'violet-l': '菫・淡',
  'peony-l': '牡丹・淡',
  'rose-d': '桜・濃',
  'coral-d': '珊瑚・濃',
  'apricot-d': '杏・濃',
  'lemon-d': '菜の花・濃',
  'lime-d': '若葉・濃',
  'mint-d': 'ミント・濃',
  'teal-d': '青磁・濃',
  'sky-d': '空・濃',
  'blue-d': '瑠璃・濃',
  'wisteria-d': '藤・濃',
  'violet-d': '菫・濃',
  'peony-d': '牡丹・濃',
}

export function isLabelKey(v: unknown): v is LabelKey {
  return typeof v === 'string' && (LABEL_KEYS as readonly string[]).includes(v)
}

/** 名前で指す時に比べる形（NFKC で全角と半角をそろえ、続く空白を1つにして前後を落とし、英字を小文字に） */
export function labelMatchKey(s: string): string {
  return s.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * ラベルの書き方（キーか、設定で付けた呼び名）からキーを引く（19.4 の足す依頼の label）。全角と半角・大文字と小文字は同じとみなす。
 * 同じ呼び名の色がいくつもある時は、24色の並びで先の物。見つからなければ null
 */
export function labelKeyOf(text: string, labelNames: AppData['labelNames']): LabelKey | null {
  const key = labelMatchKey(text)
  if (!key) return null
  if (isLabelKey(key)) return key
  for (const k of LABEL_KEYS) {
    const name = labelNames[k]?.name
    if (typeof name === 'string' && name.trim() && labelMatchKey(name) === key) return k
  }
  return null
}

/** 色の呼び名（付けた名前。無ければ既定の呼び名） */
export function labelDisplayName(key: LabelKey, labelNames: AppData['labelNames']): string {
  const name = labelNames[key]?.name
  return typeof name === 'string' && name.trim() ? name.trim() : LABEL_DEFAULT_NAMES[key]
}
