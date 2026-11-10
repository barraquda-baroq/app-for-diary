# 手順3 設定値を貼り替えて公開する

プロジェクトの「設定値」を DS に入れて、PC からアプリを公開します。

- かかる時間: 約15分
- 使う物: PC のブラウザと PowerShell（Mac ならターミナル。コマンドは同じです）
- 一番かんたんな進め方: 設定値を Claude の会話に貼ってもらえれば、DS への書き込みは Claude がします（下の B）。あなたが PC で打つのは、決まったコマンドだけです。

## A. 設定値をコピーする（ブラウザ）

1. Firebase コンソールで diary-studio のプロジェクトを開き、左上の「プロジェクトの概要」（家のアイコン）を押す。

2. まん中の「アプリを追加」→「</>」（ウェブ）のアイコンを押す。
   見当たらない時は、左上の歯車 →「プロジェクトの設定」→「全般」のいちばん下の「マイアプリ」→「</>」。

3. 「アプリのニックネーム」に「Diary Studio」と入れる。
   「このアプリの Firebase Hosting も設定します」にはチェックを入れない。「アプリを登録」を押す。

4. 「Firebase SDK の追加」に、次のような設定値が出ます（「npm を使用」のままで見る）。

   ```
   const firebaseConfig = {
     apiKey: "AIza……",
     authDomain: "diary-studio-xxxx.firebaseapp.com",
     projectId: "diary-studio-xxxx",
     storageBucket: "diary-studio-xxxx.firebasestorage.app",
     messagingSenderId: "123456789012",
     appId: "1:123456789012:web:……"
   };
   ```

5. 「const firebaseConfig = {」から「};」までをコピーして、「コンソールに進む」を押す。
   後でもう一度見る時は、歯車 →「プロジェクトの設定」→「全般」→「マイアプリ」の「SDK の設定と構成」で「構成」を選びます。

この設定値は秘密ではありません。公開したアプリの中にそのまま入り、誰でも見られる物です。データは、持ち主の本人だけが読み書きできる決まりで守っています。

## B. 設定値を Claude に渡す

1. A でコピーした設定値を、DS を作っている Claude の会話にそのまま貼る。

2. 「DS の Firebase の設定をこれに差し替えて」と頼む。

3. Claude が DS の2つのファイル（src/sync/firebaseConfig.ts と .firebaserc）を書き換えてリポジトリに入れ、「入れました」と答えます。それを待ってから C へ。

## C. PC で公開する（PowerShell）

PowerShell を開いて、コマンドを1行ずつ打って Enter を押します。

### 初めての時だけ: DS を PC に取ってくる

NS の公開で Node.js と Git を入れてあれば、そのまま使えます（PowerShell で node -v と打って v22 以上なら OK）。

```
git clone https://github.com/barraquda-baroq/app-for-diary.git
cd app-for-diary
git checkout claude/dreamy-davinci-mq4yxh
npm ci
```

- 3行目は、まだ main に取り込んでいない今の版を使うための行です。
- npm ci は数分かかります。

### 2回目から（設定値を入れてもらった後など）

```
cd app-for-diary
git pull
npm ci
```

### 設定値が入ったかを確かめる

```
node scripts/deploy.mjs --check
```

「公開先: https://diary-studio-xxxx.web.app」と自分のプロジェクト ID で出れば OK です。「✗」の行が出たら、その画面を Claude に見せてください（この確かめでは何も公開しません）。

### Firebase にログインする

```
npx firebase login
```

- 質問が出たら、n で Enter（どちらでもかまいません）。ほかの質問もそのまま Enter。
- ブラウザが開くので、手順1でプロジェクトを作った Google アカウントを選び、「許可」を押す。
- 「Success! Logged in as …」と出れば完了です。NS の公開で同じアカウントでログインしてあれば「Already logged in as …」と出ます（そのままで OK）。

### 公開する

```
npm run deploy
```

- 型の確かめ → ビルド → 公開を続けて行います（数分かかります）。
- 最後に「公開しました: https://diary-studio-xxxx.web.app」と出れば完了です。

## うまくいかない時

- 「このシステムではスクリプトの実行が無効になっているため…」と出た: PowerShell で
  Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
  を打って、Y で Enter。PowerShell を閉じて開き直してから、もう一度。
- 「公開を始める前に止めました」と出た: 設定値がまだ入っていないか、食い違っています。画面を Claude に見せてください。
- 「403」「does not have permission」と出た: プロジェクトを作ったのと別の Google アカウントでログインしています。
  npx firebase logout を打ってから、npx firebase login でやり直す。
- 「database (default) does not exist」と出た: 手順2の B（Firestore を作る）がまだか、作った直後です。数分待ってからもう一度。
- 「Hosting の site が見つからない」と出た: 手順2の C（Hosting を始める）がまだです。
- ほかの表示で止まった時は、その画面を Claude に見せてください。

## 終わったら

手順4へ進んでください。
