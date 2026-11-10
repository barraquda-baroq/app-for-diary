# Diary Studio — 個人用のスケジューラー

直感的に、雑に扱えるスケジューラーです。トップの画面にカレンダー（イヤー・マンスリー・ウィークリー・デイリー）と
Routine List・Task List・Favorite List・MIM（most important memo）・Task View がすべて並び、見ている場所でそのまま足す・直す・消し込む使い方をします。
仕事とプライベートは切り替えずに、いつも並べて出します。

- Web アプリ（PWA。React + TypeScript + Vite）。Windows の PC（Chrome・Edge の「アプリとしてインストール」）・Android・iPhone（ホーム画面に追加）で同じように動きます。
- データは端末の中（IndexedDB）に置き、Google アカウントでログインして、Firebase（Cloud Firestore）で自分の端末どうしを同期します。
- 同じ作者の Novel Studio（NS。`app-for-novel`）の土台（PWA・同期・ログイン・起動アニメーション・画面の部品）を写して作っています。

## 今の状態

**段階0（土台）**: 起動アニメーション → ログインの画面 → 空のトップ画面（ヘッダー・カレンダーの操作の列・右の列の3つのリストの空の形・
スマホの積み方と切り替えの列）が出て、外観4つ（端末の設定に合わせる・ホワイト・ダーク・ディープダーク）が切り替わります。
カレンダー・リストの中身・データと同期は、次の段階から作ります（作る順番は [docs/SPEC.md](docs/SPEC.md) の 21.）。

## docs/ の読み方

| ファイル | 中身 | こんな時に読む |
| --- | --- | --- |
| [docs/DEPLOY.md](docs/DEPLOY.md) | 公開の準備と手順（Firebase のプロジェクトを作る・設定値を差し替える・`npm run deploy`・各端末での入れ方・困った時） | 公開する・更新する・端末に入れる時（作者はまずここ） |
| [docs/SPEC.md](docs/SPEC.md) | 仕様書。作るための決まりを1つにまとめた物 | 作る時はここを正とする。冒頭の「このドキュメントについて」→「21. 作る順番」→ 作る所の節、の順に読む |
| [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) | 作者から受け取った要件の原文（書き換えない） | 元の言葉を確かめたい時 |
| [docs/QUESTIONS.md](docs/QUESTIONS.md) | 要件を読んで出した質問 Q1〜Q31 と作者の答え、聞かずに決めたこと D1〜D48、調査の要点 | 決まりの理由を確かめたい時 |
| [docs/CONFIRM.md](docs/CONFIRM.md) | 仕様書 0.1 で作者に確かめた I1〜I7・X1〜X3 と作者の回答 | 0.2 で確定した所の元の言葉を確かめたい時 |
| [docs/CONFIRM-0.2.md](docs/CONFIRM-0.2.md) | 仕様書 0.2 で作者に確かめていること（正本は SPEC.md の 22.） | 作者が答える時 |

食い違った時は、作者の答え（QUESTIONS.md の「回答の記録」・CONFIRM.md の回答）が勝ちます。決め方の順は SPEC.md の冒頭にあります。

## 使い方（開発）

Node.js 24 LTS（22 以上なら動きます）。

```bash
npm ci
npm run dev           # http://localhost:5173 で起動
npm run typecheck     # 型の確かめ
npm test              # 単体テスト（Vitest。scripts/ のテストも）
npm run test:e2e      # E2E テスト（Playwright: PC 1400×900 と Pixel 7。E2E_WEBKIT=1 で iPhone 14 も）
npm run build         # dist/ に本番ビルド（PWA）
npm run format        # Prettier で整形
npm run deploy        # Firebase Hosting とアクセスルールを公開（docs/DEPLOY.md）
```

CI（`.github/workflows/ci.yml`）は、push と pull request のたびに 型の確かめ・整形の確かめ・単体テスト・ビルド・ビルドにテスト用の入口（ログインの印・`window.__ds`）が無いことの確かめ・E2E を動かします。

E2E は、PC とスマホの両方で次を確かめます: `e2e/smoke.spec.ts`（起動アニメーション → ログインの画面 → 空のトップ画面の通し、外観4つの切り替え）、`e2e/launch.spec.ts`（起動アニメーションの出し方・消し方）、`e2e/frame.spec.ts`（ログインの画面・ヘッダー・新しい版の帯・PC の並べ方・スマホの積み方と畳んで始まること）、`e2e/offline.spec.ts`（ビルドした物をオフラインで開いても書体とライセンスの全文が出ること、ビルドした物ではテスト用のログインの印が効かないこと。`npm run build` の後に `E2E_PREVIEW=1` を付けた時だけ）。iPhone 14（WebKit。`E2E_WEBKIT=1`）は、WebKit で通ったのを CI で確かめるまで `launch.spec.ts`・`smoke.spec.ts` だけに絞っています（`playwright.config.ts`）。ログインした状態は、開発サーバーの時だけ効く印（`localStorage` の `diary-studio:test-auth`）で作ります（Firebase を使いません）。Playwright の版と入っているブラウザの版が違う環境では、`PW_CHROMIUM_PATH` にブラウザの場所を入れます。

## 構成

```
src/domain/    純粋な計算（テスト済み）
src/db/        端末の中の保存（Dexie。段階1から）
src/sync/      ログインと同期（Firebase。同期は段階1から）
src/store/     状態（Zustand）と画面から呼ぶ操作
src/ui/        共通の部品（ヘッダー・ダイアログ・メニュー・アイコンなど）
src/features/  各画面（トップ・ログイン・設定ほか）
src/launch/    起動アニメーションと最初の描画の前の外観（launch.js。ビルドの時に index.html へ埋め込む）
scripts/       公開（deploy.mjs）・アイコン（icon-art.mjs・render-icons.mjs）のスクリプト
e2e/           Playwright の E2E テスト
docs/          仕様書・要件・確認の回答・公開の手順書
```

公開先は `https://<Firebase のプロジェクト ID>.web.app` です（プロジェクトを作るまでは、設定値は差し替え用の仮の値。docs/DEPLOY.md の 1）。
