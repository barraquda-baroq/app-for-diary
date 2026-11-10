// 外観（最初の描画の前）と起動アニメーション「グリッチ」。NS（Novel Studio）の src/launch/launch.js を写し、名前・印を DS に直して、
// iPhone / Android のアプリ（Capacitor）の部分を外し、絵（日記帳が開いて暦が灯る）と色（外観ごとの青）と時間を DS の物にした
// （docs/SPEC.md の 5.）。
//
// index.html の data-inline="src/launch/launch.js" の script に、開発サーバーでもビルドでもこのファイルをそのまま埋め込む
// （vite.config.ts の inlineLaunchScript。ビルドでは縮める）。アプリの本体（src/main.tsx）の読み込みを待たずに、読み込みを1つも
// 増やさずに、最初の描画の前に動く。埋め込むので import は使えない。iPhone（Safari 16）でも動くよう var と function だけで書く。
//
// - 外観: 設定（localStorage の diary-studio:prefs）から ホワイト／ダーク／ディープダーク を決め、<html data-theme> と
//   ブラウザの枠の色にする。起動後は src/ui/Layout.tsx の PrefsEffect が同じ規則で反映する
// - 起動アニメーション: 画面いっぱいの重なり（<html> の直下。<body> はまだ無い）を置き、地の色だけをその場で出す。絵は HTML を
//   読み終えた後、ふだんは Worker（OffscreenCanvas。別のスレッド）が canvas に描く（アプリの起動と取り合わない）。Worker を使えない
//   時はページの中で描く（下ごしらえは最初の描画の時）。出すのは、ウインドウ・タブを開いた最初の1回（再読み込みでは出さない）。
//   設定の「起動アニメーション」をオフにすると出さない。テスト（navigator.webdriver）では、localStorage の diary-studio:launch を
//   'force' にするか URL に launch=1 を付けた時だけ出す（e2e/launch.spec.ts）
// - 消える時: アニメーションが終わり（約2.27秒）、アプリが最初の画面を出せた（src/main.tsx が DiaryStudioLaunch.appReady() を呼ぶ）
//   の両方がそろったら、0.25秒で消える。押す・キーを押すとすぐ消える（押した時は、離すまで見えない重なりが残って押す操作の
//   続きを受け止めるので、下のアプリは押されない）。アプリが知らせてこなくても5秒で消える。
//   端末の「視差効果を減らす」では動かさず、最後の絵（ロゴ）を描いてから0.5秒ほど出して消える
//
// 仕様は docs/SPEC.md の「起動アニメーション」。単体テストは src/launch/launch.test.ts
;(function (window, document) {
  'use strict'

  var PREFS_KEY = 'diary-studio:prefs'
  /** 'force' にすると、テスト（navigator.webdriver）でも起動アニメーションを出す */
  var FORCE_KEY = 'diary-studio:launch'
  /** このウインドウ・タブで一度出した印（sessionStorage。再読み込みでは出さない） */
  var SESSION_KEY = 'diary-studio:launched'

  // ================================================================ 外観

  /** ブラウザの枠（アドレスバー・ステータスバー）の色。src/store/uiStore.ts の THEME_COLORS と同じ（変える時は両方そろえる） */
  var THEME_COLORS = { white: '#ffffff', dark: '#17181b', 'deep-dark': '#0e0f11' }

  /** localStorage など（使えない環境では null。触っただけで例外になるブラウザがある） */
  function storageOf(name) {
    try {
      return window[name] || null
    } catch (e) {
      return null
    }
  }

  function getItem(storage, key) {
    try {
      return storage ? storage.getItem(key) : null
    } catch (e) {
      return null
    }
  }

  function setItem(storage, key, value) {
    try {
      if (storage) storage.setItem(key, value)
    } catch (e) {
      /* 覚えられなくても動作は続ける */
    }
  }

  /** 端末ごとの表示の設定（src/store/uiStore.ts の Prefs）。読めなければ空 */
  function readPrefs(storage) {
    try {
      var prefs = JSON.parse(getItem(storage, PREFS_KEY) || '{}')
      return prefs && typeof prefs === 'object' ? prefs : {}
    } catch (e) {
      return {}
    }
  }

  function mediaMatches(query) {
    try {
      return !!(window.matchMedia && window.matchMedia(query).matches)
    } catch (e) {
      return false
    }
  }

  /**
   * 設定の外観（prefs.appearance）から実際の外観（'white' | 'dark' | 'deep-dark'）を決める。
   * 「端末の設定に合わせる」（system）と分からない値は、端末がダークならダーク、そうでなければホワイト（src/store/uiStore.ts の
   * resolveAppearance と同じ）
   */
  function resolveAppearance(prefs, systemDark) {
    var mode = prefs && typeof prefs.appearance === 'string' ? prefs.appearance : 'system'
    if (!Object.prototype.hasOwnProperty.call(THEME_COLORS, mode)) mode = systemDark ? 'dark' : 'white'
    return mode
  }

  /** 外観を <html data-theme> とブラウザの枠の色にする */
  function applyAppearance(appearance) {
    document.documentElement.setAttribute('data-theme', appearance)
    var meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', THEME_COLORS[appearance])
  }

  // ================================================================ 出すかどうか

  /** 外観 → アニメーションの色の組（ホワイトは白地に青、ダークは黒地に明るい青、ディープダークは黒地に暗い青。docs/SPEC.md の 5.4） */
  var ANIMATION_THEMES = { white: 'light', dark: 'dark', 'deep-dark': 'deep' }

  function animationTheme(appearance) {
    return ANIMATION_THEMES[appearance] || 'dark'
  }

  /**
   * 起動アニメーションを出すか。戻り値は 'none'（出さない）・'play'（動かす）・'still'（動かさずに最後の絵だけ）。
   *   enabled: 設定の「起動アニメーション」（既定オン）
   *   webdriver: テスト（Playwright など）。forced でなければ出さない
   *   forced: localStorage の diary-studio:launch が 'force'、または URL に launch=1
   *   shownInSession: このウインドウ・タブではもう出した（再読み込み）
   *   hidden: 見えていないタブ（裏で開いたタブ・ブラウザが先読みしているページ）。見えないまま終わるので出さない
   *     （そのタブが見えた時に出したことにして、後の再読み込みでも出さない。markWhenVisible）
   *   reducedMotion: 端末の「視差効果を減らす」（prefers-reduced-motion）
   */
  function decide(env) {
    if (!env.enabled) return 'none'
    if (env.webdriver && !env.forced) return 'none'
    if (env.shownInSession || env.hidden) return 'none'
    return env.reducedMotion ? 'still' : 'play'
  }

  function isForced(local) {
    if (getItem(local, FORCE_KEY) === 'force') return true
    try {
      return /[?&]launch=1(&|$)/.test(window.location.search)
    } catch (e) {
      return false
    }
  }

  // ================================================================ 消すまでの流れ

  var TIMING = {
    /** 動かさない時（視差効果を減らす）に、最後の絵を出しておく時間（最後の絵を描いてから stillMs） */
    stillMs: 500,
    /** アプリが知らせてこない時も、これより長くは出さない（出し始めてから） */
    capMs: 5000,
    /** 消える時のフェード */
    fadeMs: 250,
  }

  /**
   * いつ消すかを決める（画面には触らない。時計と、消す・取り除く処理を受け取る）。
   * アニメーションの終わり（animationEnded）とアプリの知らせ（appReady）の両方がそろったら消し始める（onFadeOut）。
   * 押した・キーを押した（skip）時と、出し始めてから capMs たった時は、そろっていなくても消し始める。
   * 消し始めてから fadeMs たったら取り除く（onRemove）。
   * 動かさない時（still）は、最後の絵を描いた（stillShown）時から stillMs たったら、アニメーションの終わりとする
   * （描く準備・Worker の立ち上がりに時間がかかっても、ロゴを stillMs は出す）。
   *   o: { still, setTimeout, clearTimeout, onFadeOut(reason), onRemove(), timing }
   *   reason: 'done'（両方そろった）・'skip'・'cap'
   */
  function createController(o) {
    var timing = o.timing || TIMING
    var state = 'idle'
    var ended = false
    var ready = false
    var shown = false
    var timers = []

    function later(fn, ms) {
      timers.push(o.setTimeout(fn, ms))
    }

    function fadeOut(reason) {
      if (state !== 'playing') return
      state = 'fading'
      for (var i = 0; i < timers.length; i++) o.clearTimeout(timers[i])
      timers = []
      o.onFadeOut(reason)
      o.setTimeout(function () {
        state = 'removed'
        o.onRemove()
      }, timing.fadeMs)
    }

    function check() {
      if (ended && ready) fadeOut('done')
    }

    var controller = {
      start: function () {
        if (state !== 'idle') return
        state = 'playing'
        later(function () {
          fadeOut('cap')
        }, timing.capMs)
        check()
      },
      /** アニメーションが終わった（動かさない時は、最後の絵を描いてから stillMs たった） */
      animationEnded: function () {
        ended = true
        if (state === 'playing') check()
      },
      /** 最後の絵を描いた（動かさない時は、ここから最後の絵を stillMs 出して、アニメーションの終わりとする） */
      stillShown: function () {
        if (!o.still || state !== 'playing' || shown) return
        shown = true
        later(controller.animationEnded, timing.stillMs)
      },
      /** アプリが最初の画面を出せた */
      appReady: function () {
        ready = true
        if (state === 'playing') check()
      },
      /** 押した・キーを押した */
      skip: function () {
        fadeOut('skip')
      },
      /** 'idle' → 'playing' → 'fading' → 'removed' */
      state: function () {
        return state
      },
    }
    return controller
  }

  // ================================================================ アニメーション「グリッチ」

  /**
   * 描く部品。CRT が温まるように数本の青いレーザーが明滅し、色ずれと共に点で描いた閉じた日記帳が現れる。表紙が背を軸に開いて
   * 見開きになると、右のページに月の暦のマス目が点で灯り、左のページに「日々を、記す。」が灯る。見開きが一本の線に潰れて上下に
   * 開くと点の「Diary Studio」が現れ、最後に走査線が一度だけ通り抜ける（docs/SPEC.md の 5.3〜5.7）。
   * ページの中でも Worker（別のスレッド。OffscreenCanvas）でも動かすので、この関数の外にあるものは使わない
   * （Worker にはこの関数を文字列にして渡す）。
   *   env.canvas(w, h): 下ごしらえ用の canvas を作る
   *   env.requestFrame(cb)・env.cancelFrame(id): 次の描画（requestAnimationFrame）
   */
  function glitchRenderer(env) {
    // 全体の長さ（秒）。走査線が通り終わってから、NS と同じ 0.13秒の余韻
    var DURATION = 2.27

    // 色の組（外観ごとの青。docs/SPEC.md の 5.4）。blend: 光の重ね方（暗い地は足し合わせて光らせる）、glow: 光の強さ、
    // flicker: ちらつきの強さ。ダークの logo はアイコンの青（scripts/icon-art.mjs の BLUE）と同じ
    var PALETTES = {
      light: {
        bg: '#fbfcfe',
        laser: '#2f6fd9',
        core: '#1d4fb8',
        logo: '#25539a',
        hot: '#2f6fd9',
        splitA: '#ff4f8b',
        splitB: '#13b5c9',
        blend: 'source-over',
        glow: 0.85,
        flicker: 1,
        vignette: 'rgba(0,10,40,0.03)',
        scanline: 'rgba(0,0,0,0.016)',
      },
      dark: {
        bg: '#050607',
        laser: '#5cc0ff',
        core: '#c2e3ff',
        logo: '#5cc0ff',
        hot: '#eef7ff',
        splitA: '#ff2b6e',
        splitB: '#2bffd2',
        blend: 'lighter',
        glow: 1,
        flicker: 1,
        vignette: 'rgba(0,0,0,0.6)',
        scanline: 'rgba(0,0,0,0.24)',
      },
      deep: {
        bg: '#000000',
        laser: '#3d74c4',
        core: '#4f80c4',
        logo: '#3d74c4',
        hot: '#8fb6e6',
        splitA: '#5c1430',
        splitB: '#0e4a50',
        blend: 'lighter',
        glow: 0.45,
        flicker: 0.35,
        vignette: 'rgba(0,0,0,0.5)',
        scanline: 'rgba(0,0,0,0.24)',
      },
    }

    // 点の字（液晶の 5×7。1 が点く）。アイコンの「DS」も同じ字（scripts/icon-art.mjs）
    var GLYPHS = {
      D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
      i: ['00100', '00000', '01100', '00100', '00100', '00100', '01110'],
      a: ['00000', '00000', '01110', '00001', '01111', '10001', '01111'],
      r: ['00000', '00000', '10110', '11001', '10000', '10000', '10000'],
      y: ['00000', '00000', '10001', '10001', '01111', '00001', '01110'],
      S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
      t: ['01000', '01000', '11100', '01000', '01000', '01001', '00110'],
      u: ['00000', '00000', '10001', '10001', '10001', '10011', '01101'],
      d: ['00001', '00001', '01101', '10011', '10001', '10001', '01111'],
      o: ['00000', '00000', '01110', '10001', '10001', '10001', '01110'],
    }

    // 温まる間のレーザー（NS のまま）。6つずつ: 始まり（秒）・長さ（秒）・向き（0 横・1 縦）・位置（画面の割合）・流れ（終わりまでに
    // 動く割合）・出方（0 点滅、1 前へ伸びる、-1 後ろから伸びる、2 中央から両側へ）
    // prettier-ignore
    var WARMUP = [
      0, 0.13, 0, 0.48, 0, 2,
      0.07, 0.08, 1, 0.71, -0.04, 0,
      0.1, 0.11, 0, 0.29, 0.05, 1,
      0.16, 0.07, 1, 0.21, 0.05, 0,
      0.2, 0.13, 1, 0.57, 0, -1,
      0.26, 0.08, 0, 0.67, -0.04, 0,
      0.3, 0.08, 0, 0.4, 0.03, -1,
      0.33, 0.07, 1, 0.37, -0.03, 0,
    ]

    // 流れ（秒。docs/SPEC.md の 5.3）
    var T_BOOK = 0.4 // 閉じた日記帳が色ずれと共に現れる（NS の T_SNAP と同じ時刻）
    var T_OPEN0 = 0.62 // 表紙が開き始める（8コマ）
    var FRAME = 0.03 // 開く絵の1コマの長さ
    var T_SPREAD = 0.86 // 見開き（= T_OPEN0 + 8コマ）
    var T_GRID = 0.9 // 右のページの曜日の行が灯る。続いて週の行が上から1行ずつ
    var GRID_STEP = 0.05
    var T_TEXT = 0.95 // 「日々を、記す。」が1字ずつ灯り始める
    var TEXT_STEP = 0.05
    var HOT = 0.06 // 灯ったばかりの点・字が hot の色でいる間
    var T_COLLAPSE = 1.42 // 見開きが一本の線に潰れ始める（ここから後の間隔は NS と同じ）
    var T_LINE = 1.55 // 一本の線
    var T_OPEN = 1.61 // 線が上下に開き始める
    var T_OPENED = 1.76 // 開き終わり、ロゴだけになる
    var T_SCAN0 = 1.82 // 走査線が通り始める
    var T_SCAN1 = 2.14 // 通り終わる

    // ---- 日記の点の絵（docs/SPEC.md の 5.5）。'#' 明るい点・'+' 淡い点・'.' 消えている点・' ' 点を置かない所。
    // 見開きは 33列×20行（左のページ 0〜15列、背 16列、右のページ 17〜32列）。閉じた日記帳は見開きの 16〜32列に重ねる
    var BOOK_COLS = 33
    var BOOK_ROWS = 20
    var SPINE = 16
    /** 右のページの暦の点の列と行（3行目が曜日、6〜14行目の1行おきが週） */
    var CAL_COLS = [18, 20, 22, 24, 26, 28, 30]
    var CAL_ROWS = [3, 6, 8, 10, 12, 14]
    /** 閉じた日記帳（17列×20行。0列が背、1〜16列が表紙。題の札は 4〜9列×4〜8行、留めのゴムは 12列） */
    // prettier-ignore
    var CLOSED = [
      '#################',
      '##++++++++++#+++#',
      '##++++++++++#+++#',
      '##++++++++++#+++#',
      '##++######++#+++#',
      '##++#....#++#+++#',
      '##++#....#++#+++#',
      '##++#....#++#+++#',
      '##++######++#+++#',
      '##++++++++++#+++#',
      '##++++++++++#+++#',
      '##++++++++++#+++#',
      '##++++++++++#+++#',
      '##++++++++++#+++#',
      '##++++++++++#+++#',
      '##++++++++++#+++#',
      '##++++++++++#+++#',
      '##++++++++++#+++#',
      '##++++++++++#+++#',
      '#################',
    ]
    /** 表紙が開く8コマ: コマ1〜4 は表紙の幅、コマ5〜8 は背から左へ開く左のページの幅 */
    var COVER_W = [16, 11, 6, 2]
    var LEAF_W = [2, 6, 11, 16]

    /** 暦の点なら初めの形（曜日は '.'、週は '+'）、そうでなければ '' */
    function calendarAt(r, c) {
      if (CAL_COLS.indexOf(c) < 0) return ''
      if (r === CAL_ROWS[0]) return '.'
      return CAL_ROWS.indexOf(r) > 0 ? '+' : ''
    }

    /** 見開きの r 行 c 列（外の枠と背は '#'、ページの中は '.'、右のページに暦の点） */
    function spreadAt(r, c) {
      if (r === 0 || r === BOOK_ROWS - 1 || c === 0 || c === BOOK_COLS - 1 || c === SPINE) return '#'
      return calendarAt(r, c) || '.'
    }

    /** 表紙が開くコマ f（0〜7。0 は閉じた日記帳、7 は見開き）の、見開きに重ねた 33列×20行の絵 */
    function openingFrame(f) {
      var rows = []
      for (var r = 0; r < BOOK_ROWS; r++) {
        var edge = r === 0 || r === BOOK_ROWS - 1
        var s = ''
        for (var c = 0; c < BOOK_COLS; c++) {
          var w = f < 4 ? COVER_W[f] : LEAF_W[f - 4]
          // 背は回る軸。どのコマでも動かさない
          if (c === SPINE) s += '#'
          else if (c < SPINE) {
            // 表紙の裏（左のページ）が背から左へ w 列
            if (f < 4 || c < SPINE - w) s += ' '
            else s += edge || c === SPINE - w ? '#' : '.'
          } else if (f === 0) s += CLOSED[r].charAt(c - SPINE)
          else if (f < 4 && c <= SPINE + w) s += edge || c === SPINE + 1 || c === SPINE + w ? '#' : '+'
          else s += spreadAt(r, c) // 表紙に隠れていない右のページ
        }
        rows.push(s)
      }
      return rows
    }

    var SPREAD = []
    var FRAMES = []
    ;(function () {
      for (var r = 0; r < BOOK_ROWS; r++) {
        var s = ''
        for (var c = 0; c < BOOK_COLS; c++) s += spreadAt(r, c)
        SPREAD.push(s)
      }
      for (var f = 0; f < 8; f++) FRAMES.push(openingFrame(f))
    })()

    /** grid の各点を fn(点, 行, 列) の点に置き換えた絵 */
    function mapGrid(grid, fn) {
      var out = []
      for (var r = 0; r < grid.length; r++) {
        var s = ''
        for (var c = 0; c < grid[r].length; c++) s += fn(grid[r].charAt(c), r, c)
        out.push(s)
      }
      return out
    }

    /**
     * 日記の点の間隔（実ピクセルの整数）。見開き（33列×20行）が、横長の画面は安全な幅の 62%・縦長の画面は 88%、
     * 高さは安全な高さの半分に収まる大きさ（docs/SPEC.md の 5.5）
     */
    function bookPitch(safeW, safeH, dpr) {
      var A = safeW < safeH ? 0.88 : 0.62
      return Math.max(2, Math.round(Math.min((safeW * A) / BOOK_COLS, (safeH * 0.5) / BOOK_ROWS) * dpr))
    }

    /** 「日々を、記す。」の字の大きさ（CSS ピクセル。p は日記の点の間隔）。7字が左のページ（15p）に収まる（docs/SPEC.md の 5.6） */
    function textSize(p) {
      return Math.min(Math.max(1.6 * p, 16), (15 * p) / 7.4)
    }

    // ---- 点の「Diary Studio」: 37列×18行の点の並び（Diary が上、Studio が下。docs/SPEC.md の 5.7）
    var LOGO_COLS = 37
    var LOGO_ROWS = 18

    /** ロゴの点（1 が点く。行ごとに LOGO_COLS 個） */
    function logoLit() {
      var lit = new Uint8Array(LOGO_COLS * LOGO_ROWS)
      function putText(text, col0, row0) {
        for (var q = 0; q < text.length; q++) {
          var glyph = GLYPHS[text.charAt(q)]
          for (var r = 0; r < 7; r++) {
            for (var b = 0; b < 5; b++) if (glyph[r].charAt(b) === '1') lit[(row0 + r) * LOGO_COLS + col0 + q * 6 + b] = 1
          }
        }
      }
      putText('Diary', 4, 1)
      putText('Studio', 1, 10)
      return lit
    }

    /** 決まった並びの乱数（同じ n には同じ値。0〜1） */
    function hash(n) {
      var s = Math.sin(n * 127.1 + 311.7) * 43758.5453
      return s - Math.floor(s)
    }

    /** '#rrggbb' → 'rgba(r,g,b,a)' */
    function rgba(hex, a) {
      var n = parseInt(hex.slice(1), 16)
      return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')'
    }

    function clamp01(v) {
      return v < 0 ? 0 : v > 1 ? 1 : v
    }

    /**
     * cv（canvas か OffscreenCanvas。大きさはここで決める）に描く。最初の絵は呼んだその場で描く。
     *   size: { width, height, dpr, safe }。width・height は画面全体の大きさ（CSS ピクセル）、dpr は画素の細かさ。
     *     safe: { top, right, bottom, left }（ノッチ・ホームバーの分）。絵はそれを除いた所の中央に置く（線と背景は画面いっぱい）
     *   theme: 'light' | 'dark' | 'deep'
     *   opts.still: 動かさずに最後の絵だけ描く。opts.at: その秒の絵だけ描く（確かめ用）
     *   opts.onEnd(): 動かした時に、最後まで描いたら呼ぶ
     * 戻り値: { stop()（止める）, dispose()（止めて、作った canvas の中身を手放す）, drawAt(t) }
     */
    function start(cv, size, theme, opts) {
      opts = opts || {}
      var pal = PALETTES[theme] || PALETTES.dark
      var light = pal.blend !== 'lighter'
      var G = pal.glow
      var FK = pal.flicker
      var made = []
      var i

      function canvas(w, h) {
        var c = env.canvas(w, h)
        made.push(c)
        return c
      }

      // ---- 大きさ（CSS ピクセル）。W・H は画面全体。絵は安全な領域（safe）の中央に置く
      var W = size.width
      var H = size.height
      var dpr = size.dpr
      var safe = size.safe || {}
      var safeL = safe.left || 0
      var safeT = safe.top || 0
      var safeW = Math.max(1, W - safeL - (safe.right || 0))
      var safeH = Math.max(1, H - safeT - (safe.bottom || 0))

      cv.width = Math.round(W * dpr)
      cv.height = Math.round(H * dpr)
      made.push(cv)
      var ctx = cv.getContext('2d', { alpha: false })
      if (!ctx) throw new Error('canvas を使えません')
      var CW = cv.width
      var CH = cv.height
      // 線の太さなどの倍率と、絵の中心
      var k = Math.max(0.8, Math.min(1.7, Math.min(safeW, safeH * 0.46) / 250))
      var cx = safeL + safeW / 2
      var cy = safeT + safeH * 0.48

      /** 光の粒（中心が明るく外へ消える丸。64px の絵を伸ばして使う） */
      function glowSprite(color) {
        var s = canvas(64, 64)
        var g = s.getContext('2d')
        var r = g.createRadialGradient(32, 32, 0, 32, 32, 32)
        r.addColorStop(0, rgba(color, 1))
        r.addColorStop(0.22, rgba(color, 0.45))
        r.addColorStop(1, rgba(color, 0))
        g.fillStyle = r
        g.fillRect(0, 0, 64, 64)
        return s
      }
      var spark = glowSprite(pal.laser)
      var sprites = {}
      function sprite(color) {
        return sprites[color] || (sprites[color] = glowSprite(color))
      }

      /** 今のパスをレーザーとして描く（太く淡い光 → 細めの光 → 芯） */
      function laser(alpha, width, color, coreColor) {
        if (alpha <= 0) return
        ctx.strokeStyle = color
        ctx.globalAlpha = Math.min(1, alpha * 0.1 * G)
        ctx.lineWidth = 8 * k * width
        ctx.stroke()
        ctx.globalAlpha = Math.min(1, alpha * 0.3 * G)
        ctx.lineWidth = 3 * k * width
        ctx.stroke()
        if (coreColor) {
          ctx.strokeStyle = coreColor
          ctx.globalAlpha = Math.min(1, alpha)
          ctx.lineWidth = 1.1 * Math.min(k, 1.25) * width
          ctx.stroke()
        }
      }

      // ---- 点の「Diary Studio」
      var lit = logoLit()
      var dots = []
      for (i = 0; i < lit.length; i++) if (lit[i]) dots.push(i % LOGO_COLS, (i / LOGO_COLS) | 0)

      // 点の間隔（実ピクセルの整数にして、点がにじまないようにする）、点の大きさ、ロゴの大きさと位置
      var pd = Math.max(2, Math.round(Math.min((safeW * 0.76) / LOGO_COLS, (safeH * 0.26) / LOGO_ROWS) * dpr))
      var p = pd / dpr
      var qd = Math.max(1, Math.round(pd * 0.78))
      var lw = LOGO_COLS * p
      var lh = LOGO_ROWS * p
      var pad = Math.ceil(3 * p)
      var LW = Math.round(lw * dpr) + 2 * pad * dpr
      var LH = Math.round(lh * dpr) + 2 * pad * dpr
      var lx = Math.round((cx - lw / 2 - pad) * dpr) / dpr
      var ly = Math.round((cy - lh / 2 - pad) * dpr) / dpr

      /** ロゴを1枚の絵にしておく（color の点。glowAlpha: 点の周りの光、offAlpha: 消えている点の濃さ、coreColor: 点の芯） */
      function logoImage(color, glowAlpha, offAlpha, coreColor) {
        var cn = canvas(LW, LH)
        var g = cn.getContext('2d')
        var o = pad * dpr + ((pd - qd) >> 1)
        var j
        if (glowAlpha) {
          var S = glowSprite(color)
          var rr = pd * 2.3
          g.globalCompositeOperation = light ? 'source-over' : 'lighter'
          g.globalAlpha = glowAlpha
          for (j = 0; j < dots.length; j += 2) {
            var X = o + dots[j] * pd + qd / 2
            var Y = o + dots[j + 1] * pd + qd / 2
            g.drawImage(S, X - rr, Y - rr, 2 * rr, 2 * rr)
          }
        }
        g.globalCompositeOperation = 'source-over'
        g.fillStyle = color
        if (offAlpha) {
          g.globalAlpha = offAlpha
          for (j = 0; j < lit.length; j++)
            if (!lit[j]) g.fillRect(o + (j % LOGO_COLS) * pd, o + ((j / LOGO_COLS) | 0) * pd, qd, qd)
        }
        g.globalAlpha = 1
        for (j = 0; j < dots.length; j += 2) g.fillRect(o + dots[j] * pd, o + dots[j + 1] * pd, qd, qd)
        if (coreColor) {
          g.fillStyle = coreColor
          var e = Math.max(1, Math.round(qd * 0.3))
          for (j = 0; j < dots.length; j += 2) g.fillRect(o + dots[j] * pd + e, o + dots[j + 1] * pd + e, qd - 2 * e, qd - 2 * e)
        }
        return cn
      }
      var logoRest = logoImage(pal.logo, light ? 0.07 : 0.16 * G, light ? 0.035 : 0.065, 0)
      var logoHot = logoImage(pal.hot, light ? 0.1 : 0.3 * G, 0, light ? 0 : pal.hot)
      var logoA = logoImage(pal.splitA, 0, 0, 0)
      var logoB = logoImage(pal.splitB, 0, 0, 0)

      /** ロゴの y1〜y2 の帯だけを、横に dx ずらして描く */
      function drawLogo(img, alpha, dx, y1, y2) {
        if (alpha <= 0) return
        var s0 = Math.max(0, Math.round((y1 - ly) * dpr))
        var s1 = Math.min(LH, Math.round((y2 - ly) * dpr))
        if (s1 <= s0) return
        ctx.globalAlpha = Math.min(1, alpha)
        ctx.drawImage(img, 0, s0, LW, s1 - s0, lx + dx, ly + s0 / dpr, LW / dpr, (s1 - s0) / dpr)
      }

      // ---- 日記（点の絵）。点の間隔 bp（CSS ピクセル）・bpd（実ピクセルの整数）、点の大きさ bqd（ロゴの点と同じ形）。
      // 見開きの中心を絵の中心（cx・cy）に置く
      var bpd = bookPitch(safeW, safeH, dpr)
      var bp = bpd / dpr
      var bqd = Math.max(1, Math.round(bpd * 0.78))
      var gridW = BOOK_COLS * bp
      var bx0 = Math.round((cx - gridW / 2) * dpr) / dpr
      var by0 = Math.round((cy - (BOOK_ROWS * bp) / 2) * dpr) / dpr
      // 絵の周りの余白（点の光の分。光は点の真ん中から 2.3 間隔なので、点の外へ 1.8 間隔ほど。実ピクセルの整数）。
      // Safari は canvas の大きさの合計に上限があるので、ロゴ（3 間隔）より詰める
      var bpadD = 2 * bpd
      var bpad = bpadD / dpr
      var glowRest = light ? 0.07 : 0.16 * G

      /**
       * 日記の点の絵（grid: 見開きに重ねた行の並び）を1枚の絵にしておく。大きさは点を置く所（' ' 以外）だけ。
       * color の点。glowAlpha: '#' の周りの光、faint: '+' の濃さ、off: '.' の濃さ、coreColor: '#' の芯（光の付け方は logoImage と同じ）
       * 戻り値: { img, x, y, w, h（描く所。CSS ピクセル）, r0（いちばん上の行）, o（左上の点の位置。実ピクセル） }
       */
      function bookImage(grid, color, glowAlpha, faint, off, coreColor) {
        var r0 = -1
        var r1 = 0
        var c0 = BOOK_COLS
        var c1 = 0
        var r, c, ch
        for (r = 0; r < grid.length; r++)
          for (c = 0; c < grid[r].length; c++)
            if (grid[r].charAt(c) !== ' ') {
              if (r0 < 0) r0 = r
              r1 = r
              if (c < c0) c0 = c
              if (c > c1) c1 = c
            }
        var cn = canvas((c1 - c0 + 1) * bpd + 2 * bpadD, (r1 - r0 + 1) * bpd + 2 * bpadD)
        var g = cn.getContext('2d')
        var o = bpadD + ((bpd - bqd) >> 1)
        if (glowAlpha) {
          var S = sprite(color)
          var rr = bpd * 2.3
          g.globalCompositeOperation = light ? 'source-over' : 'lighter'
          g.globalAlpha = glowAlpha
          for (r = r0; r <= r1; r++)
            for (c = c0; c <= c1; c++)
              if (grid[r].charAt(c) === '#')
                g.drawImage(S, o + (c - c0) * bpd + bqd / 2 - rr, o + (r - r0) * bpd + bqd / 2 - rr, 2 * rr, 2 * rr)
        }
        g.globalCompositeOperation = 'source-over'
        g.fillStyle = color
        var kinds = ['.', off, '+', faint, '#', 1]
        for (var q = 0; q < kinds.length; q += 2) {
          if (!kinds[q + 1]) continue
          g.globalAlpha = kinds[q + 1]
          for (r = r0; r <= r1; r++)
            for (c = c0; c <= c1; c++)
              if (grid[r].charAt(c) === kinds[q]) g.fillRect(o + (c - c0) * bpd, o + (r - r0) * bpd, bqd, bqd)
        }
        if (coreColor) {
          g.globalAlpha = 1
          g.fillStyle = coreColor
          var e = Math.max(1, Math.round(bqd * 0.3))
          for (r = r0; r <= r1; r++)
            for (c = c0; c <= c1; c++) {
              ch = grid[r].charAt(c)
              if (ch === '#') g.fillRect(o + (c - c0) * bpd + e, o + (r - r0) * bpd + e, bqd - 2 * e, bqd - 2 * e)
            }
        }
        return { img: cn, x: bx0 + c0 * bp - bpad, y: by0 + r0 * bp - bpad, w: cn.width / dpr, h: cn.height / dpr, r0: r0, o: o }
      }

      // 開く8コマのうちコマ1〜7（コマ1 が閉じた日記帳）。コマ8 は見開き
      var frameImgs = []
      for (i = 0; i < 7; i++) frameImgs[i] = bookImage(FRAMES[i], pal.logo, glowRest, 0.28, 0.06, 0)
      // 見開き。暦の点は別の絵にして、行ごとに 淡い（初めの形）→ 灯ったばかり（hot）→ 灯った（'#'）にする
      var spreadImg = bookImage(
        mapGrid(SPREAD, function (ch, r, c) {
          return calendarAt(r, c) ? ' ' : ch
        }),
        pal.logo,
        glowRest,
        0.28,
        0.06,
        0,
      )
      // 淡い形は1枚の絵にして行ごとの帯で描き、灯った点と灯ったばかりの点は、光が帯で切れないよう行ごとの絵にする
      /** 暦の点だけの絵（row: CAL_ROWS の何番目の行を '#' にするか。-1 は全部の行を初めの形で） */
      var calendarOnly = function (row) {
        return mapGrid(SPREAD, function (ch, r, c) {
          if (!calendarAt(r, c)) return ' '
          return row < 0 ? ch : r === CAL_ROWS[row] ? '#' : ' '
        })
      }
      var calFaint = bookImage(calendarOnly(-1), pal.logo, 0, 0.28, 0.06, 0)
      var calLit = []
      var calHot = []
      for (i = 0; i < CAL_ROWS.length; i++) {
        calLit[i] = bookImage(calendarOnly(i), pal.logo, glowRest, 0, 0, 0)
        calHot[i] = bookImage(calendarOnly(i), pal.hot, light ? 0.1 : 0.3 * G, 0, 0, light ? 0 : pal.hot)
      }
      // 淡い形の行の帯の境目（実ピクセル。隣り合う行の点の真ん中）
      var calEdges = [0]
      for (i = 1; i < CAL_ROWS.length; i++)
        calEdges.push(calFaint.o + Math.round(((CAL_ROWS[i - 1] + CAL_ROWS[i]) / 2 - calFaint.r0) * bpd + bqd / 2))
      calEdges.push(calFaint.img.height)
      // 色ずれ（現れる時の閉じた日記帳と、潰れる時の見開き。明るい点だけの形）
      var splitGrid = mapGrid(SPREAD, function (ch, r, c) {
        return calendarAt(r, c) || ch === '#' ? '#' : ' '
      })
      var closedA = bookImage(FRAMES[0], pal.splitA, 0, 0.28, 0, 0)
      var closedB = bookImage(FRAMES[0], pal.splitB, 0, 0.28, 0, 0)
      var spreadA = bookImage(splitGrid, pal.splitA, 0, 0, 0, 0)
      var spreadB = bookImage(splitGrid, pal.splitB, 0, 0, 0, 0)

      // ---- 走査線と周辺減光（先に1枚の絵にしておく。走査線の間隔だけ縦に長く、ずらして流す）
      var per = Math.max(2, Math.round(3 * dpr))
      var overlay = canvas(CW, CH + per)
      var og = overlay.getContext('2d')
      og.fillStyle = pal.scanline
      for (i = 0; i < CH + per; i += per) og.fillRect(0, i, CW, Math.max(1, Math.round(dpr)))
      var vignette = og.createRadialGradient(cx * dpr, cy * dpr + per, H * 0.2 * dpr, cx * dpr, cy * dpr + per, H * 0.78 * dpr)
      vignette.addColorStop(0, 'rgba(0,0,0,0)')
      vignette.addColorStop(1, pal.vignette)
      og.fillStyle = vignette
      og.fillRect(0, 0, CW, CH + per)
      // 最後に通り抜ける走査線の帯
      var bar = canvas(2, 64)
      var bg = bar.getContext('2d')
      var barGradient = bg.createLinearGradient(0, 0, 0, 64)
      barGradient.addColorStop(0, rgba(pal.laser, 0))
      barGradient.addColorStop(0.85, rgba(pal.laser, 1))
      barGradient.addColorStop(1, rgba(pal.laser, 0))
      bg.fillStyle = barGradient
      bg.fillRect(0, 0, 2, 64)

      // ---- 「日々を、記す。」（左のページの 1〜15列の真ん中・8〜11行の高さに横書き。毎回は字を組まず、先に1字ずつ絵にしておく。
      // 1字ずつ灯す時に光が字の境で切れないよう、字ごとに分ける）
      var fs = textSize(bp)
      var FONT =
        '600 ' +
        Math.round(fs * 10) / 10 +
        'px "Hiragino Mincho ProN","Yu Mincho","YuMincho","Noto Serif JP","Noto Serif CJK JP","MS Mincho",serif'
      var TEXT = '日々を、記す。'
      var tm = Math.ceil(fs * 0.6)
      var TW = 7 * fs + 2 * tm
      var TH = 1.4 * fs + 2 * tm
      var tx = Math.round((bx0 + 8 * bp + bqd / dpr / 2 - TW / 2) * dpr) / dpr
      var ty = Math.round((by0 + 9.5 * bp + bqd / dpr / 2 - TH / 2) * dpr) / dpr
      function charImage(ch, color) {
        var cn = canvas(Math.ceil((fs + 2 * tm) * dpr), Math.ceil(TH * dpr))
        var g = cn.getContext('2d')
        g.scale(dpr, dpr)
        g.font = FONT
        g.textAlign = 'center'
        g.textBaseline = 'middle'
        g.fillStyle = color
        g.shadowColor = pal.laser
        g.shadowBlur = (light ? 4 : 10) * k * dpr * G
        g.fillText(ch, tm + fs / 2, tm + 0.7 * fs)
        return cn
      }
      var textCore = []
      var textHot = []
      for (i = 0; i < TEXT.length; i++) {
        textCore[i] = charImage(TEXT.charAt(i), pal.core)
        textHot[i] = charImage(TEXT.charAt(i), pal.hot)
      }
      /** j 字目を描く */
      function drawChar(img, alpha, j) {
        if (alpha <= 0) return
        ctx.globalAlpha = Math.min(1, alpha)
        ctx.drawImage(img, Math.round((tx + j * fs) * dpr) / dpr, ty, img.width / dpr, img.height / dpr)
      }

      // ---- 1枚の絵
      var GDX = 0 // グリッチの帯の横ずれ
      function baseTransform() {
        ctx.setTransform(dpr, 0, 0, dpr, dpr * GDX, 0)
      }

      // 日記の縮み（横・縦。絵の中心から）と、色ずれの横のずれ
      var SX = 1
      var SY = 1
      var OX = 0
      function bookTransform() {
        ctx.setTransform(dpr * SX, 0, 0, dpr * SY, dpr * (cx * (1 - SX) + OX + GDX), dpr * cy * (1 - SY))
      }

      /** 日記の絵 b の s0〜s1 の帯（実ピクセル。省くと全部）を描く。alpha が 1 を超える分は、暗い外観では重ねて明るくする */
      function drawBook(b, alpha, s0, s1) {
        if (alpha <= 0) return
        if (s0 == null) {
          s0 = 0
          s1 = b.img.height
        }
        if (s1 <= s0) return
        var y = b.y + s0 / dpr
        var h = (s1 - s0) / dpr
        ctx.globalAlpha = Math.min(1, alpha)
        ctx.drawImage(b.img, 0, s0, b.img.width, s1 - s0, b.x, y, b.w, h)
        if (!light && alpha > 1) {
          ctx.globalAlpha = Math.min(1, alpha - 1)
          ctx.drawImage(b.img, 0, s0, b.img.width, s1 - s0, b.x, y, b.w, h)
        }
      }

      function scene(t) {
        ctx.globalCompositeOperation = pal.blend
        var u = 0
        var e, a, j

        // 1. 温まる: レーザーが数本明滅する
        for (j = 0; j < WARMUP.length; j += 6) {
          var start = WARMUP[j]
          var length = WARMUP[j + 1]
          if (t < start || t > start + length) continue
          u = (t - start) / length
          var vertical = WARMUP[j + 2]
          var pos = WARMUP[j + 3] + WARMUP[j + 4] * u
          var mode = WARMUP[j + 5]
          var L = vertical ? H : W
          var a0 = 0
          var a1 = L
          var f = clamp01(u / 0.6)
          f = 1 - (1 - f) * (1 - f) * (1 - f)
          if (mode === 1) a1 = L * f
          else if (mode === -1) a0 = L * (1 - f)
          else if (mode === 2) {
            a0 = L * (0.5 - 0.5 * f)
            a1 = L * (0.5 + 0.5 * f)
          }
          a = (1 - u * u) * (hash(Math.floor(t * 90) + j) > 0.55 ? 1 - 0.65 * FK : 1)
          ctx.beginPath()
          if (vertical) {
            ctx.moveTo(pos * W, a0)
            ctx.lineTo(pos * W, a1)
          } else {
            ctx.moveTo(a0, pos * H)
            ctx.lineTo(a1, pos * H)
          }
          laser(a, 1.15, pal.laser, pal.core)
          if (mode === 2) {
            ctx.globalAlpha = a * 0.5 * G
            ctx.drawImage(spark, a0 - 12 * k, pos * H - 12 * k, a1 - a0 + 24 * k, 24 * k)
          }
          if (mode === 1 || mode === -1) {
            var head = mode === 1 ? a1 : a0
            var hr = 10 * k
            ctx.globalAlpha = a * G
            ctx.drawImage(spark, (vertical ? pos * W : head) - hr, (vertical ? head : pos * H) - hr, 2 * hr, 2 * hr)
          }
        }

        // 2. 閉じた日記帳が現れる → 表紙が開いて見開きになり、暦のマス目と「日々を、記す。」が灯る → 一本の線に潰れる
        if (t >= T_BOOK && t < T_LINE) {
          SX = SY = 1
          OX = 0
          var sa = 1
          var d = 0
          var ta = 1
          if (t < T_BOOK + 0.1) sa = hash(Math.floor(t * 60) * 3.1) > 0.3 ? 1.2 : 0.25
          else sa = 0.92 + 0.08 * hash(Math.floor(t * 30))
          // 現れる時の色ずれ（0.06秒）
          if (t < T_BOOK + 0.06) {
            u = (t - T_BOOK) / 0.06
            d = 5 * k * (1 - u) * (0.5 + hash(Math.floor(t * 45))) * (0.4 + 0.6 * FK)
          }
          // 潰れる（NS と同じ。縦に潰しながら横はロゴの幅にそろえる）
          if (t >= T_COLLAPSE) {
            e = clamp01((t - T_COLLAPSE) / (T_LINE - T_COLLAPSE))
            e = e * e * e
            SY = 1 - 0.995 * e
            SX = 1 + e * (lw / gridW - 1)
            sa *= light ? 1 - 0.4 * e : 1 + 0.5 * e
            d = light ? 0 : 2 * k * e * FK
            ta = 1 - clamp01((t - T_COLLAPSE) / (T_LINE - T_COLLAPSE - 0.03))
          }
          // 開く8コマのどれか（0 = 閉じた日記帳 … 7 = 見開き）
          var fr = t < T_OPEN0 ? 0 : Math.min(7, Math.floor((t - T_OPEN0) / FRAME + 1e-6))
          if (d > 0.2 && (fr === 0 || fr === 7)) {
            OX = -d
            bookTransform()
            drawBook(fr === 0 ? closedA : spreadA, 0.6 * sa)
            OX = d
            bookTransform()
            drawBook(fr === 0 ? closedB : spreadB, 0.6 * sa)
            OX = 0
          }
          bookTransform()
          if (fr < 7) drawBook(frameImgs[fr], sa)
          else {
            drawBook(spreadImg, sa)
            // 曜日の行、続いて週の行が上から灯る（灯ってから HOT の間は hot の色、その後は '#'）
            for (j = 0; j < CAL_ROWS.length; j++) {
              u = t - (T_GRID + j * GRID_STEP)
              if (u < -1e-6) drawBook(calFaint, sa, calEdges[j], calEdges[j + 1])
              else drawBook(u < HOT ? calHot[j] : calLit[j], sa)
            }
            // 「日々を、記す。」が1字ずつ、ちらつきながら灯る
            if (t >= T_TEXT) {
              var n = Math.min(7, Math.floor((t - T_TEXT) / TEXT_STEP + 1e-6) + 1)
              var jh = n - 1
              var ca = clamp01(sa) * ta
              var fresh = t - T_TEXT - jh * TEXT_STEP < HOT
              for (j = 0; j < n; j++) {
                if (j === jh && fresh) {
                  // 灯ったばかりの字は明るく、ちらつく
                  var fl = ca * (hash(Math.floor(t * 90) + jh * 7.3) > 0.4 ? 1 : 0.3)
                  drawChar(textCore[j], fl, j)
                  drawChar(textHot[j], fl, j)
                } else drawChar(textCore[j], ca, j)
              }
            }
          }
          baseTransform()
        }

        // 3. 一本の線が上下に開いて、ロゴが現れる
        if (t >= T_LINE - 0.01 && t < T_OPENED) {
          var hw = lw / 2 + 2 * k
          var hf
          if (t < T_OPEN) {
            hf = 0
            a = 1.3
          } else {
            u = clamp01((t - T_OPEN) / (T_OPENED - T_OPEN))
            hf = (lh / 2 + p) * (1 - (1 - u) * (1 - u) * (1 - u))
            a = 1.2 * (1 - clamp01((u - 0.55) / 0.45))
          }
          if (hf > 0) {
            if (u < 1) {
              e = (1 - u) * (1 - u)
              drawLogo(logoA, e * 0.8, -4 * k * e, cy - hf, cy + hf)
              drawLogo(logoB, e * 0.8, 4 * k * e, cy - hf, cy + hf)
            }
            drawLogo(logoRest, 1, 0, cy - hf, cy + hf)
          }
          ctx.beginPath()
          ctx.moveTo(cx - hw, cy - hf)
          ctx.lineTo(cx + hw, cy - hf)
          if (hf > 0) {
            ctx.moveTo(cx - hw, cy + hf)
            ctx.lineTo(cx + hw, cy + hf)
          }
          laser(a, t < T_OPEN ? 1.5 : 1, pal.laser, pal.core)
          if (t < T_OPEN + 0.04) {
            ctx.globalAlpha = (light ? 0.25 : 0.55) * G * (t < T_OPEN ? 1 : 1 - (t - T_OPEN) / 0.04)
            ctx.drawImage(spark, cx - hw * 1.25, cy - 14 * k, hw * 2.5, 28 * k)
          }
        }

        // 4. ロゴ。最後に走査線が一度だけ通り抜ける
        if (t >= T_OPENED) {
          drawLogo(logoRest, 1, 0, ly, ly + LH / dpr)
          if (t >= T_SCAN0 && t < T_SCAN1) {
            u = (t - T_SCAN0) / (T_SCAN1 - T_SCAN0)
            u = u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u)
            var bh = H * 0.11
            var yb = -bh + (H + 2 * bh) * u
            var am = FK < 1 ? 0.6 : 1
            ctx.globalAlpha = (light ? 0.07 : 0.09) * am
            ctx.drawImage(bar, 0, yb - bh, W, bh)
            ctx.globalAlpha = (light ? 0.25 : 0.3) * am
            ctx.fillStyle = pal.laser
            ctx.fillRect(0, yb - 1 * k, W, 1 * k)
            ctx.globalCompositeOperation = light ? 'source-over' : 'lighter'
            drawLogo(logoHot, 0.45 * am, 0, yb - bh, yb - bh * 0.4)
            drawLogo(logoHot, am, 0, yb - bh * 0.4, yb + 1)
          }
        }
      }

      function fillBackground(t, y, h) {
        ctx.globalCompositeOperation = 'source-over'
        ctx.globalAlpha = 1
        ctx.fillStyle = pal.bg
        ctx.fillRect(0, y, W, h)
        // 温まり始めのちらつき
        if (t < 0.16) {
          ctx.fillStyle = rgba(pal.laser, (light ? 0.03 : 0.05) * G * (1 - t / 0.16) * (hash(Math.floor(t * 60)) > 0.4 ? 1 : 0.4))
          ctx.fillRect(0, y, W, h)
        }
      }

      /** t 秒の絵を描く */
      function draw(t) {
        GDX = 0
        baseTransform()
        fillBackground(t, 0, H)
        scene(t)
        // グリッチ: 横の帯をいくつか、横にずらして描き直す（信号の乱れ）。日記が現れる時・潰れる 0.1秒前・ロゴが開き終わる時
        var ga =
          t >= T_BOOK && t < T_BOOK + 0.1
            ? 10
            : t >= T_COLLAPSE - 0.1 && t < T_COLLAPSE - 0.07
              ? 6
              : t >= T_OPENED - 0.04 && t < T_OPENED + 0.03
                ? 7
                : 0
        if (ga && (FK > 0.5 || hash(Math.floor(t * 40)) > 0.5)) {
          ga *= k * (0.4 + 0.6 * FK)
          var seed = Math.floor(t * 40)
          for (var j = 0; j < 3; j++) {
            var sliceY = hash(seed + j * 1.7) * H
            var sliceH = (0.012 + 0.05 * hash(seed + j * 2.3)) * H
            GDX = 0
            baseTransform()
            ctx.save()
            ctx.beginPath()
            ctx.rect(0, sliceY, W, sliceH)
            ctx.clip()
            fillBackground(t, sliceY, sliceH)
            GDX = (hash(seed + j * 3.1) - 0.5) * 2 * ga
            baseTransform()
            scene(t)
            ctx.restore()
          }
          GDX = 0
        }
        // 走査線と周辺減光（日記が現れるまでは流れる。最後は薄くなる）
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        ctx.globalCompositeOperation = 'source-over'
        ctx.globalAlpha = 1 - (light ? 0.6 : 0.3) * clamp01((t - T_SCAN1) / (DURATION - T_SCAN1))
        ctx.drawImage(overlay, 0, (t < T_BOOK ? Math.floor(t * 140 * dpr) % per : 0) - per)
      }

      // ---- 動かす（時刻は最初のフレームから数える）
      var startTs = -1
      var raf = 0
      var stopped = false
      function frame(ts) {
        raf = 0
        if (stopped) return
        if (startTs < 0) startTs = ts
        var t = (ts - startTs) / 1000
        if (t >= DURATION) {
          draw(DURATION)
          stopped = true
          if (opts.onEnd) opts.onEnd()
          return
        }
        draw(t)
        raf = env.requestFrame(frame)
      }

      if (typeof opts.at === 'number') {
        draw(opts.at)
        stopped = true
      } else if (opts.still) {
        draw(DURATION)
        stopped = true
      } else {
        draw(0)
        raf = env.requestFrame(frame)
      }

      var player = {
        /** 動きを止める（今の絵のまま） */
        stop: function () {
          stopped = true
          if (raf) env.cancelFrame(raf)
          raf = 0
        },
        /** 止めて、作った canvas の中身を手放す（Safari は canvas の大きさの合計に上限がある） */
        dispose: function () {
          player.stop()
          for (var j = 0; j < made.length; j++) made[j].width = made[j].height = 0
          made = []
        },
        /** t 秒の絵を描く（テスト・確かめ用） */
        drawAt: function (t) {
          draw(t)
        },
      }
      return player
    }

    return {
      start: start,
      DURATION: DURATION,
      PALETTES: PALETTES,
      // 以下は単体テスト（src/launch/launch.test.ts）と確かめ用
      TIMES: {
        T_BOOK: T_BOOK,
        T_OPEN0: T_OPEN0,
        T_SPREAD: T_SPREAD,
        T_GRID: T_GRID,
        T_TEXT: T_TEXT,
        T_COLLAPSE: T_COLLAPSE,
        T_LINE: T_LINE,
        T_OPEN: T_OPEN,
        T_OPENED: T_OPENED,
        T_SCAN0: T_SCAN0,
        T_SCAN1: T_SCAN1,
        FRAME: FRAME,
        GRID_STEP: GRID_STEP,
        TEXT_STEP: TEXT_STEP,
        HOT: HOT,
      },
      GLYPHS: GLYPHS,
      BOOK: { CLOSED: CLOSED, SPREAD: SPREAD, FRAMES: FRAMES, CAL_COLS: CAL_COLS, CAL_ROWS: CAL_ROWS },
      bookPitch: bookPitch,
      textSize: textSize,
      logoLit: logoLit,
    }
  }

  /** ページの中で描く時の描く部品 */
  var renderer = glitchRenderer({
    canvas: function (w, h) {
      var c = document.createElement('canvas')
      c.width = w
      c.height = h
      return c
    },
    requestFrame: function (cb) {
      return window.requestAnimationFrame(cb)
    },
    cancelFrame: function (id) {
      window.cancelAnimationFrame(id)
    },
  })
  var DURATION = renderer.DURATION
  var PALETTES = renderer.PALETTES

  /** stage の大きさ（CSS ピクセル）と画素の細かさ */
  function stageSize(stage, safe) {
    return {
      width: stage.clientWidth || 240,
      height: stage.clientHeight || 520,
      dpr: Math.min(window.devicePixelRatio || 1, 3),
      safe: safe || {},
    }
  }

  /** stage いっぱいの canvas を作る */
  function stageCanvas(stage) {
    var cv = document.createElement('canvas')
    cv.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;display:block'
    stage.appendChild(cv)
    return cv
  }

  /**
   * ページの中で描く（stage の中に canvas を作る）。Worker を使えない時と、テスト・確かめ用。
   * opts は start と同じ（opts.safe も）。戻り値は start と同じ
   */
  function play(stage, theme, opts) {
    opts = opts || {}
    return renderer.start(stageCanvas(stage), stageSize(stage, opts.safe), theme, opts)
  }

  /** Worker の中で動かす部分（これも文字列にして渡す。外にあるものは使わない） */
  function workerMain(scope, makeRenderer) {
    var r = makeRenderer({
      canvas: function (w, h) {
        return new scope.OffscreenCanvas(w, h)
      },
      requestFrame: function (cb) {
        if (scope.requestAnimationFrame) return scope.requestAnimationFrame(cb)
        return scope.setTimeout(function () {
          cb(scope.performance.now())
        }, 16)
      },
      cancelFrame: function (id) {
        if (scope.cancelAnimationFrame) scope.cancelAnimationFrame(id)
        else scope.clearTimeout(id)
      },
    })
    var player = null
    scope.onmessage = function (e) {
      var d = e.data || {}
      if (d.type === 'start') {
        player = r.start(d.canvas, d.size, d.theme, {
          still: d.still,
          at: d.at,
          onEnd: function () {
            scope.postMessage({ type: 'end' })
          },
        })
        scope.postMessage({ type: 'started' })
      } else if (d.type === 'stop' && player) {
        player.stop()
      }
    }
  }

  /** Worker のスクリプト（ファイルを増やさないよう、上の2つの関数から作る） */
  function workerSource() {
    return '(' + workerMain + ')(self,' + glitchRenderer + ')'
  }

  /**
   * Worker（別のスレッド）で描く。アプリの起動（JavaScript の読み込み・最初の描画）と取り合わず、アプリが重い処理をしている間も
   * 止まらない。OffscreenCanvas に描けない・Worker を作れない時は null（ページの中で描く）。
   * opts.onStarted(): 最初の絵を描いた。opts.onEnd(): 最後まで描いた。opts.onError(): Worker で描けなかった（canvas は取り除いてある）
   */
  function playInWorker(stage, theme, opts) {
    if (typeof window.Worker !== 'function' || typeof window.OffscreenCanvas !== 'function' || typeof window.Blob !== 'function')
      return null
    if (!window.URL || typeof window.URL.createObjectURL !== 'function') return null
    var cv = stageCanvas(stage)
    if (typeof cv.transferControlToOffscreen !== 'function') {
      stage.removeChild(cv)
      return null
    }
    var url = null
    var worker = null
    try {
      url = window.URL.createObjectURL(new window.Blob([workerSource()], { type: 'text/javascript' }))
      worker = new window.Worker(url)
      var offscreen = cv.transferControlToOffscreen()
      worker.postMessage(
        { type: 'start', canvas: offscreen, size: stageSize(stage, opts.safe), theme: theme, still: !!opts.still, at: opts.at },
        [offscreen],
      )
    } catch (e) {
      if (worker) worker.terminate()
      if (url) window.URL.revokeObjectURL(url)
      if (cv.parentNode) cv.parentNode.removeChild(cv)
      return null
    }
    var done = false
    function release() {
      if (done) return
      done = true
      worker.terminate()
      window.URL.revokeObjectURL(url)
      if (cv.parentNode) cv.parentNode.removeChild(cv)
    }
    worker.onmessage = function (e) {
      if (!e.data) return
      if (e.data.type === 'started' && opts.onStarted) opts.onStarted()
      if (e.data.type === 'end' && opts.onEnd) opts.onEnd()
    }
    worker.onerror = function () {
      release()
      if (opts.onError) opts.onError()
    }
    return {
      worker: worker,
      stop: function () {
        if (!done) worker.postMessage({ type: 'stop' })
      },
      dispose: release,
    }
  }

  // ================================================================ 起動

  var current = null

  /** 重なりの要素の、ノッチ・ホームバーの分の余白（CSS ピクセル） */
  function safeInsets(el) {
    try {
      var cs = window.getComputedStyle(el)
      return {
        top: parseFloat(cs.paddingTop) || 0,
        right: parseFloat(cs.paddingRight) || 0,
        bottom: parseFloat(cs.paddingBottom) || 0,
        left: parseFloat(cs.paddingLeft) || 0,
      }
    } catch (e) {
      return {}
    }
  }

  var SKIP_EVENTS = ['pointerdown', 'click', 'keydown']
  /**
   * 重なりを押した後に続く出来事（離す・クリック・長押しのメニュー）。重なりの上で起きたものは、ここで止めてアプリに渡さない。
   * 指で押した時のクリックは、指を離した後に、その時に指の下にある所へ送られる。重なりが先に押せなくなっていると、
   * 消えかけた重なりの下のアプリのボタン（設定・作品・アイデアの「済み」など）が押されてしまう
   */
  var PRESS_EVENTS = ['pointerup', 'pointercancel', 'touchend', 'mousedown', 'mouseup', 'click', 'contextmenu']
  /** 押した指・マウスを離してから、重なりを押せなくする（下のアプリを押せるようにする）まで */
  var RELEASE_MS = 100
  /** 押したままでも、これより長くは重なりを残さない（消え始めてから） */
  var HOLD_CAP_MS = 3000

  /** canvas に描ける（描けなければ起動アニメーションを出さない） */
  function canvasAvailable() {
    try {
      var c = document.createElement('canvas')
      c.width = c.height = 1
      return !!c.getContext('2d')
    } catch (e) {
      return false
    }
  }

  /**
   * 見えていないタブ（裏で開いたタブ・ブラウザの先読み）で開いた時: そのタブが見えた時に、出したことにする
   * （出さずに開いたタブを、後で再読み込み・「新しい版にする」で読み込み直した時に出さない）
   */
  function markWhenVisible(session) {
    function onChange() {
      if (document.visibilityState === 'hidden') return
      document.removeEventListener('visibilitychange', onChange)
      document.removeEventListener('prerenderingchange', onChange)
      setItem(session, SESSION_KEY, '1')
    }
    document.addEventListener('visibilitychange', onChange)
    document.addEventListener('prerenderingchange', onChange)
  }

  /** 起動アニメーションを出す（外観は決めてある） */
  function launch(prefs, appearance, local, session) {
    var env = {
      enabled: prefs.launchAnimation !== false,
      webdriver: window.navigator.webdriver === true,
      forced: isForced(local),
      shownInSession: getItem(session, SESSION_KEY) === '1',
      hidden: document.visibilityState === 'hidden',
      reducedMotion: mediaMatches('(prefers-reduced-motion: reduce)'),
    }
    var mode = decide(env)
    if (mode === 'none') {
      // 見えていないから出さなかった時だけ、見えた時に印を付ける（設定でオフ・テストで出さなかった時は付けない）
      if (env.hidden && !env.shownInSession) {
        env.hidden = false
        if (decide(env) !== 'none') markWhenVisible(session)
      }
      return
    }
    if (!canvasAvailable()) return
    setItem(session, SESSION_KEY, '1')

    var theme = animationTheme(appearance)
    var el = document.createElement('div')
    el.id = 'ds-launch'
    el.setAttribute('data-testid', 'launch-overlay')
    el.setAttribute('data-launch-theme', theme)
    el.setAttribute('data-launch-mode', mode)
    // 読み上げには出さず、フォーカスできるものも置かない（アプリの操作の邪魔をしない）
    el.setAttribute('aria-hidden', 'true')
    el.style.cssText =
      'position:fixed;top:0;right:0;bottom:0;left:0;z-index:2147483647;overflow:hidden;box-sizing:border-box;margin:0;' +
      'padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px);' +
      'background:' +
      PALETTES[theme].bg +
      ';opacity:1;transition:opacity ' +
      TIMING.fadeMs +
      'ms ease-out;touch-action:none;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent'
    // <body> はまだ無いので <html> の直下に置く（アプリの画面は <body> の中なので、重なりの下になる）
    document.documentElement.appendChild(el)

    var player = null
    // 重なりを押している間（押してから、離して RELEASE_MS たつまで）は、消え始めても重なりを押せるまま・取り除かずに残し、
    // その押す操作の続き（離す・クリック・長押し）を重なりが受けて止める
    var holding = false
    var removeLater = false
    var holdTimer = 0
    function inOverlay(target) {
      return target === el || (!!target && typeof target.nodeType === 'number' && el.contains(target))
    }
    function onInput(e) {
      if (e && e.type === 'pointerdown' && inOverlay(e.target)) holding = true
      if (current) current.controller.skip()
    }
    function onPress(e) {
      // 指を離した（touchend）のを止めると、そのタップのクリックは作られない
      if (inOverlay(e.target)) {
        if (e.cancelable) e.preventDefault()
        e.stopPropagation()
      }
      if (holding && (e.type === 'pointerup' || e.type === 'pointercancel' || e.type === 'touchend')) {
        window.clearTimeout(holdTimer)
        holdTimer = window.setTimeout(endHold, RELEASE_MS)
      }
    }
    function endHold() {
      window.clearTimeout(holdTimer)
      holding = false
      el.style.pointerEvents = 'none'
      if (removeLater) removeNow()
    }
    function removeNow() {
      for (var i = 0; i < PRESS_EVENTS.length; i++) window.removeEventListener(PRESS_EVENTS[i], onPress, true)
      if (el.parentNode) el.parentNode.removeChild(el)
      if (player) player.dispose()
      player = null
      current = null
    }
    function unlisten() {
      for (var i = 0; i < SKIP_EVENTS.length; i++) window.removeEventListener(SKIP_EVENTS[i], onInput, true)
    }

    var controller = createController({
      still: mode === 'still',
      setTimeout: function (fn, ms) {
        return window.setTimeout(fn, ms)
      },
      clearTimeout: function (id) {
        window.clearTimeout(id)
      },
      onFadeOut: function (reason) {
        unlisten()
        if (player) player.stop()
        el.setAttribute('data-launch-end', reason)
        // 押している間は押せるまま（離した後で押せなくする）。それ以外は、消え始めたらすぐ下のアプリを押せる
        if (holding) holdTimer = window.setTimeout(endHold, HOLD_CAP_MS)
        else el.style.pointerEvents = 'none'
        el.style.opacity = '0'
      },
      onRemove: function () {
        if (holding) removeLater = true
        else removeNow()
      },
    })
    current = { controller: controller, element: el }

    var opts = {
      still: mode === 'still',
      safe: safeInsets(el),
      // 最初の絵を描いた（動かさない時は、ここからロゴを0.5秒出す）
      onStarted: function () {
        controller.stillShown()
      },
      onEnd: function () {
        controller.animationEnded()
      },
      // Worker で描けなかった時は、ページの中で描き直す
      onError: function () {
        player = null
        playInPage()
      },
    }
    // ページの中で描く（Worker を使えない時）。下ごしらえ（数十ミリ秒）は最初の描画の時にして、HTML を読むのを止めない。
    // それまでは重なりの地の色だけ（アニメーションの最初の絵とほぼ同じ）
    function playInPage() {
      el.setAttribute('data-launch-renderer', 'page')
      window.requestAnimationFrame(function () {
        if (controller.state() !== 'playing') return
        try {
          player = play(el, theme, opts)
          controller.stillShown()
        } catch (e) {
          if (window.console) window.console.warn('起動アニメーションを描けませんでした', e)
          controller.skip()
        }
      })
    }
    // ふだんは Worker（別のスレッド）で描き、アプリの起動と取り合わない。Worker を作るのは HTML を読み終えた後
    // （アプリの JavaScript を読み込んでいる間の空き時間）。それまでは重なりの地の色だけ
    window.setTimeout(function () {
      if (controller.state() !== 'playing') return
      player = playInWorker(el, theme, opts)
      if (player) el.setAttribute('data-launch-renderer', 'worker')
      else playInPage()
    }, 0)
    for (var i = 0; i < SKIP_EVENTS.length; i++) window.addEventListener(SKIP_EVENTS[i], onInput, true)
    for (var j = 0; j < PRESS_EVENTS.length; j++)
      window.addEventListener(PRESS_EVENTS[j], onPress, { capture: true, passive: false })
    controller.start()
  }

  /** 外観を決め、起動アニメーションを出す（index.html から一度だけ呼ぶ）。戻り値は外観 */
  function boot() {
    var appearance = 'white'
    var local = storageOf('localStorage')
    var prefs = readPrefs(local)
    try {
      appearance = resolveAppearance(prefs, mediaMatches('(prefers-color-scheme: dark)'))
      applyAppearance(appearance)
    } catch (e) {
      /* 外観はアプリ（PrefsEffect）があとで反映する */
    }
    try {
      if (!current) launch(prefs, appearance, local, storageOf('sessionStorage'))
    } catch (e) {
      if (window.console) window.console.warn('起動アニメーションを出せませんでした', e)
    }
    return appearance
  }

  window.DiaryStudioLaunch = {
    boot: boot,
    /** アプリが最初の画面を出せた（src/main.tsx。起動アニメーションを出していなければ何もしない） */
    appReady: function () {
      if (current) current.controller.appReady()
    },
    /** 起動アニメーションを出している（消えている途中も含む） */
    active: function () {
      return !!current
    },
    // 以下は単体テスト（src/launch/launch.test.ts）と確かめ用
    resolveAppearance: resolveAppearance,
    animationTheme: animationTheme,
    decide: decide,
    createController: createController,
    play: play,
    playInWorker: playInWorker,
    workerSource: workerSource,
    TIMING: TIMING,
    DURATION: DURATION,
    PALETTES: PALETTES,
    TIMES: renderer.TIMES,
    GLYPHS: renderer.GLYPHS,
    BOOK: renderer.BOOK,
    bookPitch: renderer.bookPitch,
    textSize: renderer.textSize,
    logoLit: renderer.logoLit,
  }
})(window, document)
