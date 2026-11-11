import 'fake-indexeddb/auto'

// jsdom に無い物を、テストで困らない分だけ置く（scripts/ のテストは Node の環境で動かすので、window が無い）
if (typeof window !== 'undefined') {
  // 画面遷移時のスクロールを無害化する（jsdom は scrollTo を実装していない）
  window.scrollTo = () => {}

  /**
   * ResizeObserver の代わり（段階2のカレンダーの領域の大きさ・useElementSize）。jsdom は大きさを測らないので、自分からは知らせない。
   * テストからは TestResizeObserver.resizeAll(幅, 高さ) で、見ている要素の大きさが変わったことにする
   * （src/test/renderCalendar.tsx の resizeObserved）
   */
  class TestResizeObserver implements ResizeObserver {
    static readonly active = new Set<TestResizeObserver>()
    private readonly targets = new Set<Element>()
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element): void {
      this.targets.add(target)
      TestResizeObserver.active.add(this)
    }
    unobserve(target: Element): void {
      this.targets.delete(target)
    }
    disconnect(): void {
      this.targets.clear()
      TestResizeObserver.active.delete(this)
    }
    /** 見ている要素（target を渡すとその要素だけ）の大きさが変わったことにする */
    static resizeAll(width: number, height: number, target?: Element): void {
      for (const observer of [...TestResizeObserver.active]) {
        const entries = [...observer.targets]
          .filter((t) => !target || t === target)
          .map((t) => {
            const rect = new DOMRect(0, 0, width, height)
            const box = [{ inlineSize: width, blockSize: height }]
            return {
              target: t,
              contentRect: rect,
              borderBoxSize: box,
              contentBoxSize: box,
              devicePixelContentBoxSize: box,
            } as unknown as ResizeObserverEntry
          })
        if (entries.length) observer.callback(entries, observer)
      }
    }
  }
  if (!('ResizeObserver' in window)) {
    Object.defineProperty(window, 'ResizeObserver', { configurable: true, writable: true, value: TestResizeObserver })
  }

  /** PointerEvent の代わり（jsdom に無い。押した物の種類 pointerType で、指とマウスを分ける所のテスト用） */
  if (!('PointerEvent' in window)) {
    class TestPointerEvent extends MouseEvent implements PointerEvent {
      readonly pointerId: number
      readonly pointerType: string
      readonly isPrimary: boolean
      readonly width: number
      readonly height: number
      readonly pressure: number
      readonly tangentialPressure: number
      readonly tiltX: number
      readonly tiltY: number
      readonly twist: number
      readonly altitudeAngle: number
      readonly azimuthAngle: number
      readonly persistentDeviceId: number
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init)
        this.pointerId = init.pointerId ?? 1
        this.pointerType = init.pointerType ?? 'mouse'
        this.isPrimary = init.isPrimary ?? true
        this.width = init.width ?? 1
        this.height = init.height ?? 1
        this.pressure = init.pressure ?? 0
        this.tangentialPressure = init.tangentialPressure ?? 0
        this.tiltX = init.tiltX ?? 0
        this.tiltY = init.tiltY ?? 0
        this.twist = init.twist ?? 0
        this.altitudeAngle = init.altitudeAngle ?? Math.PI / 2
        this.azimuthAngle = init.azimuthAngle ?? 0
        this.persistentDeviceId = 0
      }
      getCoalescedEvents(): PointerEvent[] {
        return []
      }
      getPredictedEvents(): PointerEvent[] {
        return []
      }
    }
    Object.defineProperty(window, 'PointerEvent', { configurable: true, writable: true, value: TestPointerEvent })
  }
}
