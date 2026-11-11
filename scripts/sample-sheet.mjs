// 段階2の見本のページを作る（docs/SPEC.md の 21.・22.、docs/STAGE2-LOOKS.md）。
//   node scripts/sample-sheet.mjs   （npm run samples の最後の段。先に E2E_SAMPLES=1 npx playwright test --project=samples で撮る）
// e2e/artifacts/samples/ の絵と控え（parts/*.json。e2e/samples/samples.spec.ts が書く）と、問いの文（docs/STAGE2-LOOKS.md の
// 「### ■ 番号」の節）を読み、同じ所に2つ書く:
//   index.html  手元のブラウザで開く物（文書の頭まで付けた物）
//   page.html   作者だけが見られる（非公開の）見本のページとして、絵と一緒に送る物（頭は送る先が付ける。中身は index.html と同じ）
// 絵は同じフォルダーの JPEG をそのまま指す（倍率 2 で撮った物を、半分の大きさで出す）。リポジトリには入れない
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const APPEARANCES = ['white', 'dark', 'deep-dark']
export const APPEARANCE_NAMES = { white: 'ホワイト', dark: 'ダーク', 'deep-dark': 'ディープダーク' }
const SIZE_NAMES = { L: 'PC 1400×900', S: 'スマホ 390×844' }

/** 画面の一覧の並び（撮った物の id で分ける） */
const GROUPS = [
  { title: 'マンスリー', ids: ['month', 'month-off'] },
  { title: 'ウィークリー', ids: ['week', 'week-dense', 'palette'] },
  { title: 'デイリー', ids: ['day', 'day-busy'] },
  { title: '詳細と登録', ids: ['detail-work', 'detail-private', 'register'] },
]

/** 問いごとに見せる絵。shot は画面の一覧の絵（3つの外観）、crop は案ごとの切り抜き（letter を付けた時はその案だけ） */
const QUESTION_PICTURES = {
  1: [{ shot: 'palette-L' }, { crop: 'picker', question: 2, letter: 'A' }],
  2: [{ crop: 'palette-work' }, { crop: 'picker' }],
  3: [{ crop: 'week-top' }, { crop: 'day-areas' }, { crop: 'detail' }],
  4: [{ crop: 'timeline' }],
  5: [{ crop: 'month-top' }],
  6: [{ crop: 'toolbar' }, { crop: 'today-month' }, { crop: 'today-week' }, { crop: 'register' }],
  7: [{ shot: 'register-L' }, { shot: 'register-S' }],
  8: [{ shot: 'detail-work-L' }, { shot: 'detail-work-S' }, { shot: 'detail-private-S' }],
}

/** この幅（CSS の px）より広い切り抜きは、外観を横に並べずに、外観ごと・案ごとに縦に積む（横に並べると字が小さくなりすぎる） */
const WIDE_CROP = 700

export function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** JPEG の幅と高さ（ピクセル）。SOF の印を探して読む */
export function jpegSize(buf) {
  let i = 2
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) {
      i++
      continue
    }
    const marker = buf[i + 1]
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0xff) {
      i += marker === 0xff ? 1 : 2
      continue
    }
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) }
    }
    i += 2 + buf.readUInt16BE(i + 2)
  }
  throw new Error('JPEG の大きさが読めません')
}

/**
 * docs/STAGE2-LOOKS.md から、問い（「### ■ 番号 題」と、その下の「- 見出し: 文」）と、
 * 「## 見本に写っているが、こちらで直す所」「## お知らせ」の箇条を読む
 */
export function parseLooksDoc(md) {
  const questions = []
  const notes = { fixes: [], notices: [] }
  let current = null
  let list = null
  for (const line of md.split('\n')) {
    const q = /^### ■(\d+) (.+)$/.exec(line)
    if (q) {
      current = { number: Number(q[1]), title: q[2].trim(), fields: {} }
      questions.push(current)
      list = null
      continue
    }
    if (/^##? /.test(line)) {
      current = null
      list = line.startsWith('## 見本に写っているが') ? notes.fixes : line.startsWith('## お知らせ') ? notes.notices : null
      continue
    }
    const item = /^- (.+)$/.exec(line)
    if (!item) continue
    if (current) {
      const field = /^([^:：]+)[:：]\s*(.+)$/.exec(item[1])
      if (field) current.fields[field[1].trim()] = field[2].trim()
    } else if (list) {
      list.push(item[1].trim())
    }
  }
  return { questions, notes }
}

/** 控えの絵の名前から、外観を外した名前（例 month-L-white → month-L、q2-picker-A-dark → q2-picker-A） */
function baseName(part) {
  return part.file.replace(/\.jpg$/, '').slice(0, -(part.appearance.length + 1))
}

const byAppearance = (a, b) => APPEARANCES.indexOf(a.appearance) - APPEARANCES.indexOf(b.appearance)

function img(part, sizes, alt) {
  const size = sizes[part.file]
  const w = size ? Math.round(size.width / 2) : null
  const h = size ? Math.round(size.height / 2) : null
  const dims = size ? ` width="${w}" height="${h}"` : ''
  return (
    `<button type="button" class="zoom"${w ? ` style="max-width: ${w}px"` : ''} data-src="${escapeHtml(part.file)}" data-w="${w ?? ''}" data-cap="${escapeHtml(alt)}">` +
    `<img src="${escapeHtml(part.file)}" alt="${escapeHtml(alt)}"${dims} loading="lazy" decoding="async"></button>`
  )
}

function shotBlock(key, shots, sizes, headingLevel = 3) {
  const list = shots.filter((p) => baseName(p) === key).sort(byAppearance)
  if (!list.length) return ''
  const first = list[0]
  const tag = `h${headingLevel}`
  const figures = list
    .map((p) => {
      const alt = `${p.title}・${SIZE_NAMES[p.size]}・${APPEARANCE_NAMES[p.appearance]}`
      return `<figure data-ap="${p.appearance}">${img(p, sizes, alt)}<figcaption>${APPEARANCE_NAMES[p.appearance]}</figcaption></figure>`
    })
    .join('')
  return (
    `<article class="shot" data-size="${first.size}">` +
    `<${tag}>${escapeHtml(first.title)} <span class="size">${SIZE_NAMES[first.size]}</span></${tag}>` +
    `<div class="trio">${figures}</div></article>`
  )
}

function cropBlock(question, cropId, letter, crops, sizes, optionNames, nowLetter) {
  const list = crops.filter((p) => p.question === question && p.id === cropId && (letter == null || p.letter === letter))
  if (!list.length) return ''
  const first = list[0]
  const width = sizes[first.file] ? sizes[first.file].width / 2 : 0
  const columns = [...new Set(list.map((p) => p.appearance))].sort((a, b) => APPEARANCES.indexOf(a) - APPEARANCES.indexOf(b))
  const cols = columns
    .map((ap) => {
      const inCol = list.filter((p) => p.appearance === ap).sort((a, b) => a.letter.localeCompare(b.letter))
      const reference = inCol.every((p) => p.reference)
      const figures = inCol
        .map((p) => {
          const showLetter = letter == null
          const isNow = p.option === 'now'
          const name = optionNames[p.letter] ?? p.label
          const alt = `${p.title}・${showLetter ? `${p.letter} ${name}・` : ''}${APPEARANCE_NAMES[p.appearance]}`
          const head = showLetter
            ? `<figcaption><span class="letter">${escapeHtml(p.letter)}</span><span class="opt-name">${escapeHtml(name)}</span>${
                isNow && p.letter === nowLetter ? '<span class="now">今の決め方</span>' : ''
              }</figcaption>`
            : ''
          return `<figure class="opt">${head}${img(p, sizes, alt)}</figure>`
        })
        .join('')
      const apName = `${APPEARANCE_NAMES[ap]}${reference ? '（見比べ用。今の色だけ）' : ''}`
      return `<div class="col" data-ap="${ap}"><p class="ap">${escapeHtml(apName)}</p>${figures}</div>`
    })
    .join('')
  const wide = width > WIDE_CROP ? ' wide' : ''
  return `<div class="crop${wide}"><h4>${escapeHtml(first.title)}</h4><div class="cols">${cols}</div></div>`
}

/** 「A 今の色 ／ B …」から、案の字ごとの名前 */
function optionNamesOf(choice) {
  const names = {}
  if (!choice) return names
  for (const piece of choice.replace(/（.*?）/g, '').split('／')) {
    const m = /^\s*([A-C])\s+(.+?)\s*$/.exec(piece)
    if (m) names[m[1]] = m[2]
  }
  return names
}

/** 今の決め方の字（「B（今の濃さ）。」→ B） */
function nowLetterOf(text) {
  const m = /^([A-C])（/.exec(text ?? '')
  return m ? m[1] : null
}

const FIELD_ORDER = ['見る所', '聞きたいこと', '選ぶ物', '今の決め方', '答えが来るまで']

/** 見本のページの中身（頭を付けない形）と、手元で開く文書を作る */
export function buildSheet({ parts, sizes, doc }) {
  const { questions, notes } = parseLooksDoc(doc)
  const shots = parts.filter((p) => p.kind === 'shot').sort((a, b) => a.order - b.order || byAppearance(a, b))
  const crops = parts.filter((p) => p.kind === 'crop').sort((a, b) => a.order - b.order || byAppearance(a, b))
  const shotKeys = [...new Set(shots.map(baseName))]

  const groups = GROUPS.map((g) => {
    const keys = shotKeys.filter((k) => g.ids.includes(shots.find((p) => baseName(p) === k).id))
    if (!keys.length) return ''
    return `<section class="group"><h3 class="group-title">${g.title}</h3>${keys.map((k) => shotBlock(k, shots, sizes, 4)).join('')}</section>`
  }).join('')

  const questionSections = questions
    .map((q) => {
      const optionNames = optionNamesOf(q.fields['選ぶ物'])
      const nowLetter = nowLetterOf(q.fields['今の決め方'])
      const rows = FIELD_ORDER.filter((f) => q.fields[f])
        .map((f) => `<dt>${f}</dt><dd${f === '今の決め方' ? ' class="current"' : ''}>${escapeHtml(q.fields[f])}</dd>`)
        .join('')
      const pictures = (QUESTION_PICTURES[q.number] ?? [])
        .map((pic) =>
          pic.shot
            ? shotBlock(pic.shot, shots, sizes, 4)
            : cropBlock(pic.question ?? q.number, pic.crop, pic.letter ?? null, crops, sizes, optionNames, nowLetter),
        )
        .join('')
      return (
        `<section class="question" id="q${q.number}">` +
        `<h2><span class="qmark">■${q.number}</span> ${escapeHtml(q.title)}</h2>` +
        `<dl class="fields">${rows}</dl>${pictures}</section>`
      )
    })
    .join('')

  const toc = [
    '<a href="#screens">画面</a>',
    ...questions.map((q) => `<a href="#q${q.number}">■${q.number} ${escapeHtml(q.title.replace(/（.*?）/g, ''))}</a>`),
    '<a href="#notes">直す所・お知らせ</a>',
  ].join('')

  const bullets = (items) => `<ul>${items.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}</ul>`

  const head = `<title>Diary Studio 段階2の見本</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto+Mono:wght@400;500&display=swap">
<style>${CSS}</style>`

  const body = `<div class="page" id="page" data-show="all">
<header class="intro">
<p class="eyebrow">Diary Studio · 段階2 カレンダー</p>
<h1>見本の画面</h1>
<p class="lead">作り物の予定で撮った画面です。今日は <b>2026年11月10日（火）9:00</b> としています。開発の機械で撮ったので、字の形は iPhone などの実機と少し違います。絵を押すと大きく出ます。</p>
<p class="lead">答え方: 番号ごとに「このまま」か、選ぶ物（A・B・C）で答えてください（例「1 このまま、2 B、3 このまま…」）。全部そのままでよければ「それで進めて」の一言で大丈夫です。気になる所は一言で書いてください。</p>
<nav class="toc" aria-label="目次">${toc}</nav>
</header>
<div class="bar" role="group" aria-label="外観で絞る">
<span class="bar-label">外観</span>
<button type="button" data-show="all" aria-pressed="true">すべて</button>
${APPEARANCES.map((a) => `<button type="button" data-show="${a}" aria-pressed="false">${APPEARANCE_NAMES[a]}</button>`).join('\n')}
</div>
<main>
<section class="screens" id="screens"><h2>画面</h2>${groups}</section>
${questionSections}
<section class="notes" id="notes">
<h2>見本に写っているが、こちらで直す所</h2><p class="small">答えは要りません。</p>${bullets(notes.fixes)}
<h2>お知らせ</h2><p class="small">答えは要りません。</p>${bullets(notes.notices)}
</section>
</main>
</div>
<div class="lb" id="lb" hidden role="dialog" aria-modal="true" aria-labelledby="lb-cap">
<div class="lb-bar"><span class="lb-cap" id="lb-cap"></span><button type="button" class="lb-size" id="lb-size" aria-pressed="false">実寸</button><button type="button" class="lb-close" id="lb-close" aria-label="閉じる">✕</button></div>
<div class="lb-scroll" id="lb-scroll"><img class="lb-img" id="lb-img" alt=""></div>
</div>
<script>${SCRIPT}</script>`

  const page = `${head}\n${body}\n`
  const index = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${head}
</head>
<body>
${body}
</body>
</html>
`
  return { page, index, questions, notes }
}

// 見本のページの見た目。DS の外観（グレーの地に、紺に寄せた差し色）に合わせ、絵が主役になるよう面と線は控えめにする。
// 並び: 細い縦の列（最大 1180px）。上に目次、外観の絞り込みの帯（上に留まる）、画面の一覧、問いの節、直す所・お知らせ
const CSS = `
:root {
  --bg: #f3f4f6; --surface: #ffffff; --ink: #1f2329; --muted: #5a606a; --line: #dcdfe4;
  --accent: #2c4c86; --accent-soft: #e5ebf5; --shade: rgba(16, 20, 28, 0.95);
  --font: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic UI", Meiryo, sans-serif;
  --mono: "Roboto Mono", ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #0f1114; --surface: #171a1f; --ink: #e4e6e9; --muted: #9ba2ac; --line: #2b3038;
    --accent: #93b2e6; --accent-soft: #1b2638; --shade: rgba(4, 6, 9, 0.96); color-scheme: dark;
  }
}
:root[data-theme="dark"] {
  --bg: #0f1114; --surface: #171a1f; --ink: #e4e6e9; --muted: #9ba2ac; --line: #2b3038;
  --accent: #93b2e6; --accent-soft: #1b2638; --shade: rgba(4, 6, 9, 0.96); color-scheme: dark;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.7 var(--font); }
body::before { content: ""; position: fixed; inset: 0 0 auto; height: env(safe-area-inset-top, 0px); z-index: 10; background: var(--bg); }
.page { max-width: 1180px; margin: 0 auto; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); padding-block: 24px 64px; }
h1, h2, h3, h4 { text-wrap: balance; margin: 0; line-height: 1.35; }
h1 { font-size: 30px; font-weight: 700; letter-spacing: 0.02em; }
h2 { font-size: 21px; font-weight: 700; }
h3 { font-size: 17px; font-weight: 600; }
h4 { font-size: 15px; font-weight: 600; }
.eyebrow { font: 500 12px/1.4 var(--mono); letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); margin: 0 0 6px; }
.intro { display: grid; gap: 10px; margin-bottom: 18px; }
.lead { margin: 0; max-width: 46em; }
.small { margin: 0; color: var(--muted); font-size: 13px; }
.toc { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 13px; margin-top: 4px; }
.toc a { color: var(--accent); text-decoration: none; }
.toc a:hover, .toc a:focus-visible { text-decoration: underline; }
.bar { position: sticky; top: env(safe-area-inset-top, 0px); z-index: 5; display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
  padding-block: 10px; margin-bottom: 8px; background: var(--bg); border-bottom: 1px solid var(--line); }
.bar-label { font: 500 12px/1 var(--mono); color: var(--muted); letter-spacing: 0.06em; margin-right: 4px; }
.bar button { font: inherit; font-size: 13px; color: var(--ink); background: var(--surface); border: 1px solid var(--line); border-radius: 999px;
  padding: 4px 12px; cursor: pointer; min-height: 32px; }
.bar button[aria-pressed="true"] { background: var(--accent); border-color: var(--accent); color: var(--surface); }
button:focus-visible, a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
main { display: grid; gap: 48px; }
.screens, .question, .notes { display: grid; gap: 18px; min-width: 0; scroll-margin-top: 64px; }
.group { display: grid; gap: 22px; }
.group-title { font-size: 13px; font-weight: 600; color: var(--muted); letter-spacing: 0.06em; padding-top: 6px; border-top: 1px solid var(--line); }
.shot { display: grid; gap: 8px; min-width: 0; }
.size { font: 400 12px/1 var(--mono); color: var(--muted); margin-left: 6px; }
.trio { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(min(100%, 320px), 1fr)); }
.shot[data-size="S"] .trio { grid-template-columns: repeat(auto-fill, minmax(min(100%, 150px), 240px)); }
figure { margin: 0; display: grid; gap: 4px; min-width: 0; align-content: start; }
figcaption { font-size: 12px; color: var(--muted); display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.zoom { display: block; padding: 0; margin: 0; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; background: var(--surface);
  cursor: zoom-in; width: 100%; line-height: 0; }
.zoom img { width: 100%; height: auto; display: block; }
.qmark { font-family: var(--mono); color: var(--accent); }
.fields { display: grid; grid-template-columns: max-content 1fr; gap: 6px 14px; margin: 0; max-width: 52em; }
.fields dt { font-size: 13px; color: var(--muted); padding-top: 2px; }
.fields dd { margin: 0; min-width: 0; }
.fields dd.current { font-weight: 600; }
.crop { display: grid; gap: 8px; min-width: 0; }
.cols { display: grid; gap: 14px 16px; grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr)); }
.crop.wide .cols { grid-template-columns: 1fr; }
.col { display: grid; gap: 10px; align-content: start; min-width: 0; }
.ap { margin: 0; font-size: 12px; font-weight: 600; color: var(--muted); letter-spacing: 0.04em; }
.letter { font: 500 12px/1 var(--mono); display: inline-grid; place-items: center; width: 20px; height: 20px; border-radius: 4px;
  background: var(--ink); color: var(--surface); }
.opt-name { color: var(--ink); }
.now { font-size: 11px; color: var(--accent); background: var(--accent-soft); border-radius: 999px; padding: 1px 8px; }
.notes ul { margin: 0; padding-left: 1.2em; display: grid; gap: 6px; max-width: 52em; }
.notes h2 + .small { margin-top: -12px; }
.page[data-show="white"] [data-ap]:not([data-ap="white"]),
.page[data-show="dark"] [data-ap]:not([data-ap="dark"]),
.page[data-show="deep-dark"] [data-ap]:not([data-ap="deep-dark"]) { display: none; }
.page:not([data-show="all"]) .shot[data-size="S"] .trio { grid-template-columns: minmax(0, 390px); }
.lb { position: fixed; inset: 0; z-index: 20; background: var(--shade); display: grid; grid-template-rows: auto 1fr; }
.lb[hidden] { display: none; }
.lb-bar { display: flex; align-items: center; gap: 8px; color: #f2f3f5;
  padding: calc(env(safe-area-inset-top, 0px) + 8px) max(16px, env(safe-area-inset-right, 0px)) 8px max(16px, env(safe-area-inset-left, 0px)); }
.lb-cap { flex: 1; min-width: 0; font-size: 13px; }
.lb-bar button { font: inherit; font-size: 13px; color: #f2f3f5; background: transparent; border: 1px solid rgba(255,255,255,0.4); border-radius: 999px;
  padding: 4px 12px; min-height: 34px; cursor: pointer; }
.lb-bar button[aria-pressed="true"] { background: #f2f3f5; color: #1f2329; }
.lb-scroll { overflow: auto; overscroll-behavior: contain; padding: 0 max(16px, env(safe-area-inset-right, 0px)) calc(env(safe-area-inset-bottom, 0px) + 16px) max(16px, env(safe-area-inset-left, 0px)); }
.lb-img { display: block; margin: 0 auto; max-width: 100%; height: auto; border-radius: 4px; }
.lb.actual .lb-img { max-width: none; }
@media (max-width: 560px) {
  h1 { font-size: 25px; }
  .bar-label { display: none; }
  .bar button { padding: 4px 10px; }
  .fields { grid-template-columns: 1fr; gap: 2px; }
  .fields dd { margin-bottom: 8px; }
}
@media (prefers-reduced-motion: no-preference) { html { scroll-behavior: smooth; } }
`

// 外観で絞る（見る人のブラウザだけに覚える）・絵を押すと大きく出す（［実寸］で倍率 1 の大きさ。Esc・✕・地を押すと閉じる）
const SCRIPT = `
(function () {
  var page = document.getElementById('page');
  var KEY = 'ds-samples-show';
  var buttons = document.querySelectorAll('.bar button');
  function show(value) {
    page.setAttribute('data-show', value);
    buttons.forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-show') === value)); });
  }
  try { var saved = localStorage.getItem(KEY); if (saved && document.querySelector('.bar button[data-show="' + saved + '"]')) show(saved); } catch (e) {}
  buttons.forEach(function (b) {
    b.addEventListener('click', function () {
      var value = b.getAttribute('data-show');
      show(value);
      try { localStorage.setItem(KEY, value); } catch (e) {}
    });
  });

  var lb = document.getElementById('lb');
  var lbImg = document.getElementById('lb-img');
  var lbCap = document.getElementById('lb-cap');
  var lbSize = document.getElementById('lb-size');
  var lbClose = document.getElementById('lb-close');
  var lbScroll = document.getElementById('lb-scroll');
  var opener = null;
  function setActual(on, w) {
    lb.classList.toggle('actual', on);
    lbSize.setAttribute('aria-pressed', String(on));
    lbImg.style.width = on && w ? w + 'px' : '';
  }
  function open(btn) {
    opener = btn;
    lbImg.src = btn.getAttribute('data-src');
    lbImg.alt = btn.getAttribute('data-cap');
    lbImg.setAttribute('data-w', btn.getAttribute('data-w') || '');
    lbCap.textContent = btn.getAttribute('data-cap');
    setActual(false);
    lb.hidden = false;
    document.documentElement.style.overflow = 'hidden';
    lbScroll.scrollTop = 0;
    lbScroll.scrollLeft = 0;
    lbClose.focus();
  }
  function close() {
    lb.hidden = true;
    lbImg.removeAttribute('src');
    document.documentElement.style.overflow = '';
    if (opener) opener.focus();
  }
  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('.zoom');
    if (btn) open(btn);
  });
  lbClose.addEventListener('click', close);
  lbSize.addEventListener('click', function () {
    setActual(lbSize.getAttribute('aria-pressed') !== 'true', lbImg.getAttribute('data-w'));
  });
  lbScroll.addEventListener('click', function (e) { if (e.target === lbScroll) close(); });
  document.addEventListener('keydown', function (e) {
    if (lb.hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    if (e.key === 'Tab') {
      var items = [lbSize, lbClose];
      var i = items.indexOf(document.activeElement);
      e.preventDefault();
      items[(i + (e.shiftKey ? items.length - 1 : 1)) % items.length].focus();
    }
  });
})();
`

/** e2e/artifacts/samples/ を読んで書く */
export function writeSheet(dir, docPath) {
  const partsDir = `${dir}/parts`
  if (!existsSync(partsDir))
    throw new Error(`${partsDir} がありません。先に E2E_SAMPLES=1 npx playwright test --project=samples で撮ってください`)
  const parts = readdirSync(partsDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(`${partsDir}/${f}`, 'utf8')))
    .filter((p) => existsSync(`${dir}/${p.file}`))
  const sizes = Object.fromEntries(parts.map((p) => [p.file, jpegSize(readFileSync(`${dir}/${p.file}`))]))
  const missingOrder = parts.filter((p) => typeof p.order !== 'number')
  if (missingOrder.length) throw new Error(`撮り直してください（並びの順の無い控え: ${missingOrder[0].file} など）`)
  const { page, index, questions } = buildSheet({ parts, sizes, doc: readFileSync(docPath, 'utf8') })
  writeFileSync(`${dir}/page.html`, page)
  writeFileSync(`${dir}/index.html`, index)
  return { count: parts.length, questions: questions.length }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = new URL('..', import.meta.url)
  const dir = fileURLToPath(new URL('e2e/artifacts/samples', root))
  const { count, questions } = writeSheet(dir, fileURLToPath(new URL('docs/STAGE2-LOOKS.md', root)))
  console.log(`見本のページを書きました: ${dir}/index.html（絵 ${count} 枚・問い ${questions}）`)
}
