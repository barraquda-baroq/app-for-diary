// 区分の切り替え［かばん 仕事｜家 プライベート］（docs/SPEC.md の 12.2 の 2・4.10。NS の .segmented）。選び替えると、画面の地の色も
// その場で替わる（包む ItemSheet の data-kind。12.2・12.3・4.3）。今の区分をもう一度押しても何もしない（知らない区分の記録が
// 仕事として出ている時に［仕事］を押しても書かない。ITEMS-039）
import { ITEM_KINDS, type ItemKind } from '../../../domain/types'
import { ITEM_KIND_LABELS } from '../../../domain/trash'
import { KindIcon } from '../../../ui/icons'
import { testIds } from '../../calendar/common/testIds'

export interface KindSwitchProps {
  value: ItemKind
  onChange: (kind: ItemKind) => void
  /** 欄の名前（「区分」）の要素の id */
  labelledBy: string
}

export function KindSwitch({ value, onChange, labelledBy }: KindSwitchProps) {
  return (
    <div className="segmented it-kind" role="group" aria-labelledby={labelledBy}>
      {ITEM_KINDS.map((kind) => (
        <button
          key={kind}
          type="button"
          aria-pressed={value === kind}
          onClick={() => {
            if (kind !== value) onChange(kind)
          }}
          data-testid={testIds.itemKind(kind)}
        >
          <KindIcon kind={kind} />
          {ITEM_KIND_LABELS[kind]}
        </button>
      ))}
    </div>
  )
}
