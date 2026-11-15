// 3つのリスト（Routine List・Task List・Favorite List）の並びと名前（docs/SPEC.md の 3.5・3.6・13.2・14.2・15.1）。
// 右の列（L）・縦に積んだ所（S・M）・切り替えの列が同じ並びと名前を使う
import type { ListKey } from '../../store/uiStore'

/** 並びは上から Routine → Task → Favorite（Q21・X1） */
export const LIST_ORDER: readonly ListKey[] = ['routine', 'task', 'favorite']

export interface ListInfo {
  /** 見出しの英語の名前（等幅。3.6） */
  en: string
  /** 切り替えの列の名前（3.5） */
  short: string
  /** 見出しの下の小さな日本語（3.6） */
  ja: string
  /** 入力欄のプレースホルダ（13.2・14.2・15.1） */
  placeholder: string
  /** 入力欄の読み上げの名前 */
  inputLabel: string
}

export const LIST_INFO: Record<ListKey, ListInfo> = {
  routine: { en: 'Routine List', short: 'Routine', ja: 'ルーチン', placeholder: 'ルーチンを足す…', inputLabel: 'ルーチンを足す' },
  task: { en: 'Task List', short: 'Task', ja: 'タスク', placeholder: 'タスクを入れる…', inputLabel: 'タスクを入れる' },
  favorite: {
    en: 'Favorite List',
    short: 'Favorite',
    ja: 'やりたいこと',
    placeholder: '気になったことを入れる…',
    inputLabel: 'やりたいことを入れる',
  },
}

/** 畳む・開くの動き（src/styles.css の --dur-fold と同じ 180ms。4.9） */
export const FOLD_MS = 180
