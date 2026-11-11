// 掴み方の決まり（docs/SPEC.md の 7.10・7.11・4.9・D25）。画面にも dnd-kit にも頼らない純粋な関数だけを置く（purity.test.ts）。
// - マウスは押したまま 5px を超えて動かすと掴む（それより小さい動きで離せばクリック＝詳細。CALENDAR-158）
// - 指・ペンは 0.4秒押し続けると掴む（その間 8px 以内。8px を超えて動くとふつうのスクロールになり、掴まない。CALENDAR-159・160）
// 掴める物は dnd-kit の PointerSensor がこの値で掴む（index の SENSORS）。ロック中の物は dnd-kit に渡さず（掴めない）、同じ決まりで
// 「掴もうとした」かだけをこの reducer（gesture）で決める: 掴もうとした時に揺らし、押し終わるまでカーソルを not-allowed にする
// （CALENDAR-150・153・D25。知らせの文は出さない。CALENDAR-151）。距離は dnd-kit と同じく「超えたか」で比べる（ちょうど 5px は
// まだクリック）

/** マウスで掴むまでの距離（px。これを超えて動かすと掴む） */
export const MOUSE_GRAB_PX = 5
/** 指・ペンで掴むまで押し続ける時間（ms） */
export const TOUCH_HOLD_MS = 400
/** 指・ペンで押し続ける間に動いてよい距離（px。これを超えるとスクロール） */
export const TOUCH_SLOP_PX = 8

/** 押した物の種類（pointerType。知らない値は指と同じに扱う） */
export type PointerKind = 'mouse' | 'touch' | 'pen'

export function pointerKind(pointerType: string): PointerKind {
  return pointerType === 'mouse' ? 'mouse' : pointerType === 'pen' ? 'pen' : 'touch'
}

/** 掴み方: マウスは距離、指・ペンは長押し（dnd-kit の PointerActivationConstraints の Distance・Delay に渡す値） */
export type Activation = { kind: 'distance'; px: number } | { kind: 'hold'; ms: number; slopPx: number }

export function activationOf(pointerType: string): Activation {
  return pointerKind(pointerType) === 'mouse'
    ? { kind: 'distance', px: MOUSE_GRAB_PX }
    : { kind: 'hold', ms: TOUCH_HOLD_MS, slopPx: TOUCH_SLOP_PX }
}

/** 押した所から dx・dy 動いた時、limit px を超えたか（dnd-kit の exceedsDistance と同じ比べ方） */
export function exceeds(dx: number, dy: number, limit: number): boolean {
  return Math.hypot(dx, dy) > limit
}

/**
 * 押している物の様子:
 * - idle: 押していない（見ていない）
 * - pressed: 押したが、まだ掴もうとしていない（押した所 x・y）
 * - attempting: 掴もうとした（ロック中なら揺れた後。離すまでこのまま）
 */
export type GestureState =
  | { phase: 'idle' }
  | { phase: 'pressed'; pointerId: number; pointer: PointerKind; x: number; y: number }
  | { phase: 'attempting'; pointerId: number; pointer: PointerKind }

/**
 * 入ってくる出来事: down・move・up・cancel は pointer の出来事、hold は押してから TOUCH_HOLD_MS たった（指・ペンの時に、押した側が
 * タイマーで送る）
 */
export type GestureInput =
  | { type: 'down'; pointerId: number; pointerType: string; x: number; y: number; button: number; isPrimary: boolean }
  | { type: 'move'; pointerId: number; x: number; y: number }
  | { type: 'hold' }
  | { type: 'up'; pointerId: number }
  | { type: 'cancel'; pointerId: number }

/** する事: attempt = 掴もうとした（揺らす・カーソルを not-allowed に）、release = 掴もうとした後に離した（カーソルを戻す） */
export type GestureEffect = 'attempt' | 'release' | null

export interface GestureStep {
  state: GestureState
  effect: GestureEffect
}

export const IDLE: GestureState = { phase: 'idle' }

const stay = (state: GestureState): GestureStep => ({ state, effect: null })

/** 押している物の様子を1つ進める */
export function gesture(state: GestureState, input: GestureInput): GestureStep {
  switch (input.type) {
    case 'down': {
      // 2本目の指・押している間のほかの押し方・マウスの左以外は見ない（dnd-kit の PointerSensor と同じ）
      if (state.phase !== 'idle' || !input.isPrimary) return stay(state)
      const pointer = pointerKind(input.pointerType)
      if (pointer === 'mouse' && input.button !== 0) return stay(state)
      return stay({ phase: 'pressed', pointerId: input.pointerId, pointer, x: input.x, y: input.y })
    }
    case 'move': {
      if (state.phase !== 'pressed' || input.pointerId !== state.pointerId) return stay(state)
      const dx = input.x - state.x
      const dy = input.y - state.y
      if (state.pointer === 'mouse') {
        return exceeds(dx, dy, MOUSE_GRAB_PX)
          ? { state: { phase: 'attempting', pointerId: state.pointerId, pointer: state.pointer }, effect: 'attempt' }
          : stay(state)
      }
      // 指・ペン: 長押しの前に大きく動いたらスクロール（見るのをやめる）
      return exceeds(dx, dy, TOUCH_SLOP_PX) ? stay(IDLE) : stay(state)
    }
    case 'hold':
      if (state.phase !== 'pressed' || state.pointer === 'mouse') return stay(state)
      return { state: { phase: 'attempting', pointerId: state.pointerId, pointer: state.pointer }, effect: 'attempt' }
    case 'up':
    case 'cancel':
      if (state.phase === 'idle' || input.pointerId !== state.pointerId) return stay(state)
      return { state: IDLE, effect: state.phase === 'attempting' ? 'release' : null }
  }
}
