// 3つのリストの入力欄の見た目（docs/SPEC.md の 3.6・12.1・13.2・14.2・15.1・4.7・4.11）。動きは common/useListInput.ts。
// - 入力欄（Task List・Favorite List は1行から自動で高さが伸びる欄。6行ほどの高さまで伸び、その後は欄の中でスクロールする。
//   common/useGrowField。Routine List は1行の欄）の右の端の中に［足す］（✓。読み上げ「足す」）を
//   重ねる。幅 34px、高さは1行目の枠の内側（L のマウスの端末 34px、S・M と指の端末 38px）。伸びた欄でも1行目の右に置く（D15）。
//   欄の右の 34px には打った字が掛からない。字がある間は --text の濃い✓、空・空白だけの間は淡く aria-disabled
// - 欄の高さと字は L のマウスの端末 36px・15px、S・M と指の端末 40px・16px（iOS が拡大しない。.input）
// - above は欄の上の段（Routine List の［日｜週｜月｜四半期｜年］と［指定］。D3・■35）、below は欄の下（Task List のチップ）
// data-testid は list-{リスト}-input（欄）・list-{リスト}-add（［足す］）
import { useCallback, type ReactNode } from 'react'
import { CheckIcon } from '../../../ui/icons'
import { LIST_INFO } from '../listInfo'
import { listTestIds } from './testIds'
import { useGrowField } from './useGrowField'
import type { ListInputApi } from './useListInput'
import './lists.css'

export interface ListInputProps {
  input: ListInputApi
  /** 欄の上の段（Routine List の種類の切り替えと［指定］） */
  above?: ReactNode
  /** 欄の下（Task List のチップ） */
  below?: ReactNode
}

export function ListInput({ input, above, below }: ListInputProps) {
  const { list } = input
  const info = LIST_INFO[list]
  const multiline = list !== 'routine'
  const grow = useGrowField(input.draft.text)
  const { ref, ...field } = input.fieldProps
  const areaRef = useCallback(
    (el: HTMLTextAreaElement | null) => {
      grow(el)
      ref(el)
    },
    [grow, ref],
  )
  const common = {
    ...field,
    className: 'input list-input',
    placeholder: info.placeholder,
    'aria-label': info.inputLabel,
    autoComplete: 'off',
    enterKeyHint: 'enter' as const,
    'data-testid': listTestIds.input(list),
  }
  return (
    <div className="list-input-box">
      {above ? <div className="list-input-above">{above}</div> : null}
      <div className="list-input-field">
        {multiline ? <textarea {...common} ref={areaRef} rows={1} /> : <input {...common} ref={ref} type="text" />}
        <button
          {...input.addProps}
          type="button"
          className="icon-btn list-input-add"
          aria-label="足す"
          data-testid={listTestIds.add(list)}
        >
          <CheckIcon />
        </button>
      </div>
      {below ? <div className="list-input-below">{below}</div> : null}
    </div>
  )
}
