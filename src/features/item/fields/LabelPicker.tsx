// ラベルの色を選ぶ所（docs/SPEC.md の 4.6・6.6・12.2 の 5。D35・AMB-ITEMS-01）。左に「なし」、上の行に淡の12色、下の行に濃の12色を
// 色合いの順（src/domain/labels.ts の LABEL_KEYS）に、丸 28px で 12×2 に並べる（S は丸 24px で、「なし」を別の行に。CSS）。
// 色の値は外観ごとの CSS 変数（--label-{キー}）で、丸に付けた data-label から引く。選び替えると、画面の上の辺の帯もその場で替わる
// （包む ItemSheet の data-label）。
// 呼び名: 付けた呼び名（6.6。同期する）は、選んでいる色（乗せた・フォーカスした色があればその色）の物を欄の名前の横の1行に出す。
// 呼び名を付けていない色は、既定の呼び名（「空・淡」など）をツールチップ（title）と読み上げ（aria-label）にだけ使い、画面の字には
// 出さない（ITEMS-021・022・FRAME-191・192・D12）。各色の下に呼び名を並べるのは設定の「ラベルの色」（段階5）だけ
import { useState } from 'react'
import { LABEL_KEYS, labelDisplayName, type LabelKey } from '../../../domain/labels'
import type { AppData } from '../../../domain/types'
import { CheckIcon } from '../../../ui/icons'
import { cls } from '../../calendar/common/parts/itemLook'
import { testIds } from '../../calendar/common/testIds'

export interface LabelPickerProps {
  value: LabelKey | null
  labelNames: AppData['labelNames']
  onChange: (label: LabelKey | null) => void
  /** 欄の名前（「ラベルの色」）の要素の id */
  labelId: string
}

/** 付けた呼び名（無い・空なら null。既定の呼び名は返さない） */
export function customLabelName(key: LabelKey, labelNames: AppData['labelNames']): string | null {
  const name = labelNames[key]?.name
  return typeof name === 'string' && name.trim() ? name.trim() : null
}

export function LabelPicker({ value, labelNames, onChange, labelId }: LabelPickerProps) {
  /** 乗せている・フォーカスしている色（呼び名の1行に、選んでいる色の代わりに出す） */
  const [hovered, setHovered] = useState<LabelKey | null>(null)
  const shown = hovered ?? value
  const name = shown ? customLabelName(shown, labelNames) : null
  const pick = (key: LabelKey | null) => {
    if (key !== value) onChange(key)
  }
  return (
    <div className="it-field">
      <div className="it-field-label it-label-head">
        <span id={labelId}>ラベルの色</span>
        {/* 付けた呼び名だけを出す（読み上げは各色の aria-label で伝わるので、ここは読み上げない） */}
        <span className="it-label-name" aria-hidden="true">
          {name ?? ''}
        </span>
      </div>
      <div className="it-labels" role="group" aria-labelledby={labelId}>
        <button
          type="button"
          className="it-label-none"
          aria-pressed={value === null}
          onClick={() => pick(null)}
          data-testid={testIds.itemLabel('none')}
        >
          なし
        </button>
        <div className="it-swatches" onPointerLeave={() => setHovered(null)}>
          {LABEL_KEYS.map((key) => {
            const display = labelDisplayName(key, labelNames)
            const selected = value === key
            return (
              <button
                key={key}
                type="button"
                className={cls('it-swatch', selected && 'is-selected')}
                data-label={key}
                aria-pressed={selected}
                aria-label={display}
                title={display}
                onClick={() => pick(key)}
                onPointerEnter={() => setHovered(key)}
                onFocus={() => setHovered(key)}
                onBlur={() => setHovered(null)}
                data-testid={testIds.itemLabel(key)}
              >
                {selected ? <CheckIcon /> : null}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
