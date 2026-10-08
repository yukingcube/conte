# コンテ

音楽に合わせて絵コンテと V コンテを作る Web アプリである。
音源の波形を見ながらカットの長さを決め、コマに直接絵を描き、カットごとの予定も同じ画面で管理する。

公開先: https://yukingcube.github.io/conte/

## 今の版でできること

- Google ログインと、コンテの一覧・作成・削除
- 音源の読み込み（ファイル選択・ドラッグ＆ドロップ）。WAV などは読み込み時に MP3 へ圧縮して保存する
- 波形の表示、再生、再生しながらカットを打つ、切れ目のドラッグ調整
- コマに直接描く（ペン・消しゴム・文字・画像・選択と移動・取り消し）。画像はファイル選択・ドラッグ＆ドロップ・Ctrl+V で貼れる
- 枠の外の余白に描く（再生と書き出しには出ない想定の、編集中だけのメモ）
- 選択中の絵・文字・画像は、道具の並びにあるごみ箱のボタンか Delete キーで消せる
- どのコマからも使われなくなった画像と、差し替えで不要になった音源は、コンテを開いたときに置き場から自動で消す（作ってから1時間以内のものは、取り消しで戻せるように残す）
- カットごとの歌詞・内容・備考・進み具合・締切
- スケジュールの帯（全体の進捗・工程と日付・残り日数）と、カットに沿った予定の段

## 編集データの書き出しと読み込み

- 編集画面の右上にある「書き出す」で、開いているコンテを1つのファイル（拡張子 `.conte`）に保存できる。カット・絵・歌詞・予定に加え、音源と画像も入る。
- コンテ一覧の「読み込む」でそのファイルを選ぶと、新しいコンテとして追加される。既存のコンテは変わらない。
- `.conte` の実体は zip である。中身は `conte.json`（編集データ）、`audio.*`（音源）、`images/`（貼った画像）。
- 入っている音源は、読み込み時に圧縮した後のものである（WAV で読み込んだ場合は MP3 になっている）。

## まだないもの

- 共有リンクと、編集できる人を1人に絞る仕組み
- コメントと赤入れ
- コンテ表、PDF / mp4 の書き出し（編集データの書き出しとは別のもの）
- カットの並べ替え（ドラッグでの入れ替え）

## キー操作

| キー | 動作 |
|---|---|
| スペース | 再生・停止 |
| C | 再生位置にカットの切れ目を入れる |
| ← / → | 前・次のカットへ |
| V / B / E / T | 選択 / ペン / 消しゴム / 文字 |
| Ctrl+Z / Ctrl+Y | 取り消し / やり直し |
| Delete | 選択中の絵・文字・画像を消す |
| Ctrl+V | コピーした画像をコマに貼る |

## 自分のパソコンで動かす

Node.js（22 以上）が必要である。

```
npm install
npm run dev
```

表示された URL（通常は http://localhost:5173）をブラウザで開く。

Supabase の設定（下記）がないときは **お試しモード** で動く。ログインは不要で、データはそのブラウザの中だけに保存される。

## Supabase の設定

### 1. 表と権限を作る

Supabase のダッシュボードで SQL Editor を開き、`supabase/schema.sql` の全文を貼り付けて Run する。
表（projects / cuts / project_members）、行ごとの権限、ファイル置き場（media）が作られる。

### 2. 接続先を書く

プロジェクトの「Connect」または Settings › API Keys にある値を、`.env.production`（公開用）と `.env.local`（自分のパソコン用）に書く。

```
VITE_SUPABASE_URL=https://xxxxxxxx.supabase.co
VITE_SUPABASE_KEY=sb_publishable_xxxxxxxx
```

- 書くのは **publishable key**（`sb_publishable_` で始まる）である。これは公開してよい鍵で、リポジトリに入れてよい。
- **secret key**（`sb_secret_` で始まる）は絶対に書かない。このアプリでは使わない。

### 3. Google ログインを有効にする

1. Google Cloud Console でプロジェクトを作る。
2. Google Auth Platform の「Clients」で OAuth client ID を作る。種類は「Web application」。
3. Authorized JavaScript origins に、アプリを開く場所を入れる（例：`http://localhost:5173` と、公開先の `https://ユーザー名.github.io`）。
4. Authorized redirect URIs に、Supabase の Google プロバイダ設定ページに表示されるコールバック URL を貼る。
5. 作成して Client ID と Client Secret を控える。
6. Supabase の Authentication にある Google プロバイダの設定で Google を有効にし、Client ID と Client Secret を入力する。
7. Supabase の Authentication にある URL の設定で、Site URL に公開先の URL を、Redirect URLs に公開先の URL と `http://localhost:5173/` を入れる。

## 公開する（GitHub Pages）

1. リポジトリの Settings › Pages で、Source を「GitHub Actions」にする。
2. `main` に push すると `.github/workflows/deploy.yml` が動き、`https://ユーザー名.github.io/リポジトリ名/` に公開される。

`.env.production` がまだないうちは、公開先でもお試しモードで動く。

## 無料枠で使うときの注意

- Supabase の無料プランは、1週間まったく使わないとプロジェクトが停止する。停止したら Supabase のダッシュボードから再開する。
- ファイル置き場は 1GB まで。音源は圧縮後で 1 分あたり約 1MB、画像は長辺 1920px に縮めて保存する。

## フォルダの構成

```
src/
  types.ts            データの型（カット・絵・工程など）
  lib/                音源の圧縮・画像の縮小・絵の描画・日時の整形
  store/              保存先との窓口（Supabase 用とお試し用の2つ）
  state/              画面の状態、再生、保存の仕組み、操作のまとめ
  components/         モニター・タイムライン・右の欄・スケジュールの帯
  pages/              ログイン・一覧・編集画面
supabase/schema.sql   Supabase に作る表と権限
```
