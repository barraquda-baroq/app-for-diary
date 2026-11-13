// 開いているすばやく足す（docs/SPEC.md の 12.1）を閉じない押す所の印。すばやく足す（src/features/calendar/common/parts/QuickAdd.tsx）は
// 入力欄の外を押すと字を足して閉じるが、この印の付いた物の上で押した時は外を押したとは扱わない（閉じず、字も足さない）。
// 付けるのは、操作の列の［元に戻す］［やり直す］（7.13）と、［OK］まで出すお知らせの［OK］（3.9・■26）。
// 押してもフォーカスを入力欄に残すのは、印を付けた物の側（mousedown を止める）。お知らせの部品（src/ui/Layout.tsx）からも使うので、
// 画面の部品ではなくここに置く

/** 押しても、開いているすばやく足すを閉じない物に付ける属性の名前 */
export const KEEP_QUICK_ADD = 'data-keep-quick-add'

/** 押す所に広げて渡す、印の属性（{ 'data-keep-quick-add': '' }） */
export const keepQuickAddAttr: Readonly<Record<typeof KEEP_QUICK_ADD, ''>> = { [KEEP_QUICK_ADD]: '' }
