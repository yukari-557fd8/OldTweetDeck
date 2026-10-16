# 修正ロードマップ(upstream Issue 棚卸し: 2026-10-17 時点)

対象: [dimdenGD/OldTweetDeck](https://github.com/dimdenGD/OldTweetDeck) の open Issue 67 件(2026-10-17 に `gh issue list` で取得)。
本フォークは upstream `main`(8bcb4bb)+ 10 コミット。

分類の基準:

- **コードで直せる**: `src/interception.js` などこのリポジトリの変更で解決できる
- **X 側**: X の API 仕様・運用(凍結、レート制限、検索制限など)が原因で、拡張側では回避困難
- **機能要望**: バグではない追加機能

---

## 0. すでにフォークで対応済み(upstream へ PR 候補)

| Issue | 内容 | フォークのコミット | 備考 |
|---|---|---|---|
| #554 | RTL 言語で `<html dir="rtl">` が残りレイアウト崩壊 | 01b1ed8 | 注入後に `dir=ltr lang=en-US` を固定。そのまま upstream PR にできる |
| #552 | Mentions が表示されない | 0eee9e5 | `mentions.json` の遅延を避け `all.json` から Mentions を組み立て。報告者の症状と一致するか要確認 |
| #550 / #547 / #511 系の一部 | 初回起動でスピナーのまま | 9e4b789 / e6d8e49 | upstream PR #562 として提出済み |
| #514(closed) | 通常ツイートが RT 表示になる | 6a8dad0 | `TweetWithVisibilityResults` の unwrap |
| #499 に近い症状 | 操作後にカラムが最新ポーリング分だけになる | 97693c7 | legacy poller のキャッシュを維持。#499(Hide this tweet で消える)にも効いているか要検証 |
| #488 / #487 の通知側 | 通知カラムの重複・欠落 | a46550b | poller 単位で「配信済み」判定 |

---

## Phase 1: タイムライン取得の信頼性(最優先)

**状態: 実装済み(2026-10-17、未コミット)。** 変更は `src/interception.js`、テストは `tests/home-scroll.test.cjs`(7 件追加)と `tests/mentions-route.test.cjs`(send 時の cursor 選択に合わせて更新)。`node --test tests/*.test.cjs` で 32 件すべて通過。実機確認は未実施(下記「Phase 1 のテスト」参照)。

実装の要点:

- Proxy に `beforeSend` フックを追加(`send()` 冒頭、ヘッダ確定後)。Home / notifications / mentions は `open()` を `beforeSend` まで保留し、`x-act-as-user-id` からユーザー ID を解決してから cursor 付き URL で開く(1-a)。
- Proxy の `get` トラップに `inspectResponse` を追加。legacy が `status` を読む瞬間に一度だけ応答を検査し、GraphQL エラーだけの 200 を 503 に変える(1-d)。
- ページ台帳 `timelinePages`(feed ごとに `{ids, bottom, top}`)を導入。ページ内の全 ID から cursor を引ける。会話モジュールは `keepThreadTogether` で返信の直上に並ぶ sort key(`receiveTime`)を持つ(1-b)。Home / List / User に適用。
- cursor が無い `max_id` 要求はネットワークに出さず 503 で即応答(1-c)。全件フィルタで空になったページは次の cursor に進める。
- `TD.controller.FeedPoller` をラップし `EXHAUSTED_API_THRESHOLD` を 1 に、refresh のたびに `intervalOfPossibility` を全域に戻す(1-d)。
- since ポーリングは 10 分に 1 回 cursor 無しで先頭を取り直す(`TOP_RESYNC_INTERVAL`)。`seenHomeTweets` は上限 2000 の Set(1-e)。List / User の `max_id` 要求が refresh throttle でキャンセルされていた問題も解消。
- 残課題: `Math.random() > 0.6` の 40% キャンセルはそのまま。cursor-top で新着が返らない疑いは実機で要検証(10 分ごとの再同期で緩和はされる)。

対象 Issue: #509, #530, #531, #536, #487, #496, #495 / #517(無駄なリクエストによるレート制限悪化)。
upstream でも「Home の下端でスピナーが出続ける」「数時間前より古いツイートが出ない」という報告が複数ある(#509, #530)。
今回手元で起きた「下端での追加取得が重い」は X 側の一時的な負荷だったが、コードを追った結果、同じ症状を決定的に起こす経路が 3 つある。

### 1-a. 連携(Teams)アカウントの Home で cursor キーのユーザー ID が食い違う

- legacy TweetDeck は `x-act-as-user-id` ヘッダを `open()` の後、jQuery の `beforeSend` で付与する(`files/bundle.js` 4911-4917, 5037-5045)。
- OTD の Proxy は `open()` 時に `modReqHeaders = {}` をリセットしてすぐ `beforeRequest` を呼ぶ(`src/interception.js` 2920-2944)。そのため Home ルートの `beforeRequest`(848 行)ではヘッダが見えず `getCurrentUserId()`(デフォルトアカウント)に落ちる。
- 一方 `afterRequest` が cursor を保存するキーは `beforeSendHeaders`(897 行)で確定した実際のユーザー ID。
- 結果: 連携アカウントの Home では `home-<uid>-<id>` の cursor が**一度も引けない**。max_id 要求は毎回タイムライン先頭を取り直し(852-858 行)、legacy 側で interval 外として全部捨てられ、1 秒間隔で 5 回再試行(`bundle.js` 28503-28506, 29100-29115)した末に何も出ない。
- upstream は `user_timeline.json` だけ URL に `user_id` を足す bundle.js パッチで回避している(`bundle.js` 5269-5280)が、Home / notifications / mentions には無い。

対応:
- Proxy の `send`(2956 行)冒頭にルート用フック(例: `beforeSend(xhr)`)を追加し、ヘッダ確定後にユーザー ID を解決して `modUrl` を組み直す。
  `openHandler` は open を保留し、`beforeSend` で実際に `open()` する(その後の `readyState === 1` 判定と challenge ヘッダ付与はそのまま通る)。
- Home / notifications(1477 行付近)/ mentions(1668 行付近)の cursor 選択と throttle 判定を send 時に移す。

### 1-b. 会話モジュールの親ツイートが列の最下部に居座ると追加取得が止まる

- `home-conversation-*` の親ツイート(数時間〜数日前の古い ID)もそのまま返している。legacy は `sortIndex = receiveTime || id` で並べる(`bundle.js` 37566)ため、親が列の最下部になる。
- 無限スクロール時、legacy は最下部チャープの `id - 1` を `max_id` にし(`calculateUpperBound` / `getUpperBoundForChirp`、`bundle.js` 20180 付近)、取得結果を「最下部より古い」interval でフィルタする。次ページのツイートは親より新しいので**全部捨てられ、空ページとして 5 回再試行**(合計 6 リクエスト)、以後スクロールするたびに繰り返す。

対応:
- モジュール内のツイートに `receiveTime`(= 返信の ID から 1 ずつ引いた 19 桁文字列)を付け、スレッドを返信の直下にまとめる。
- ページ内の**全ツイート ID** に bottom cursor を記録する(現状は `tweets[tweets.length-1]` の 1 件だけ)。top cursor も同様。
- OTD 側のソートも `created_at`(秒精度)ではなく sort key で行う。

### 1-c. cursor 未解決の max_id 要求が「先頭ページの再取得」になる

- 1-a / 1-b を直せば通常は起きないが、起きたときに無駄なリクエスト(レート制限の消費)になる。
- 対応: cursor が無い max_id 要求はネットワークに出さず、`emulateResponse` に `_status` を立ててエラー応答にする(legacy は errback 経路なので再試行も exhausted 判定もしない)。

### 1-d. 10 件未満のページで無限スクロールが永久停止する

- legacy の `EXHAUSTED_API_THRESHOLD = 10`(`bundle.js` 31262, 31581-31584)。1 ページが 10 件未満だと `intervalOfPossibility` が切られ、リロードまでそのカラムの下方向取得が止まる。
- OTD は promoted / 広告 / ミュート / パース失敗を除外して返すので、X が短いページを返したときや GraphQL の 200 + `errors` で `[]` を返したときに該当する。
- 対応: `data.data.home` が無い応答で例外を投げない(今は `TypeError` でスピナーが残る)。エラーは `[]` ではなくエラーステータスで返す。短いページは bottom cursor を 1 回だけ追って補う、または home / list poller の閾値を下げる(`TD.controller.FeedPoller` をラップし、`keepLegacyPollerCache` と同じタイミングで適用)。

### 1-e. 新着ポーリング(since_id)の見直し

対象: #487, #496, #509, #530, #531, #536(Home / User カラムがリロードしないと更新されない)。

- `Math.random() > 0.6` で 35 秒以内のポーリングを 40% キャンセル(882 行)。
- cursor-top 使用時に X が新着を返さないケースの検証(upstream 報告ではデフォルトアカウントだけ更新されず、連携アカウントは更新される。1-a の食い違いで連携側は毎回先頭を取り直しているため、cursor-top 経路の方に問題がある可能性が高い)。
- `seenHomeTweets` が無限に伸びる(配列 `includes` で線形走査)。上限付きに変更。
- User カラム(#536)は `timings.user` と `xhr.storage.cursor` の条件を同じ観点で見直す。

### Phase 1 のテスト

- `tests/timeline-routes.test.cjs` に追加: 全 ID に cursor が載ること、会話モジュールの sort key、send 時のユーザー ID 解決、cursor 無し max_id がネットワークに出ないこと、`data.data.home` 欠落で `[]` を返すこと。
- 実機: 連携アカウントの Home と、会話モジュールを含むページで下端までスクロールして追加取得されること。DevTools の Network で同じ cursor の連続要求が無いこと。

---

## Phase 2: 表示・取りこぼし

| Issue | 原因(確認済み / 推定) | 対応 |
|---|---|---|
| #520 "Twitter for Advertisers" 経由の投稿が Home から消える | `tweet.source` による除外(936-940, 958-962 行)。公式アカウントが広告ツールで投稿すると消える | source 判定を廃止し、`entryId` に `promoted` を含むもの / `promotedMetadata` だけ除外 |
| #520 続き / #435 List では media / card が出ない、動画 unified card | upstream #560 で画像 unified card は対応済み。動画は未対応 | `parseTweetCard` を動画 unified card に拡張 |
| #563 動画が再生できない(2026-10-14) | 最新の報告。X 側の動画 URL / 認証の変更の可能性 | 再現確認 → `video_info.variants` の扱いと再生ウィンドウの実装を確認 |
| #497 長文の「see more」 | `note_tweet` は展開済み(179 行〜)。"Enable tweet autoexpand" との関係 | 設定 OFF 時に省略表示 + 展開リンクを出すか確認 |
| #427 / #387 / #131 ミュート・ブロックが残る | Home(941, 963 行)と List(1135 行)はフィルタ済み。Search / Notifications / 引用 / 会話詳細は未適用 | 共通のフィルタ関数に寄せて全ルートに適用 |
| #496 センシティブ設定のアカウントが Home に出ない | X の HomeLatestTimeline 側の挙動の可能性 | 再現確認。X.com で出て OTD で出ない例の生レスポンスを比較 |

---

## Phase 3: マルチアカウント・状態保存

| Issue | 原因(確認済み / 推定) | 対応 |
|---|---|---|
| #545 Bookmarks が複数アカウントで混ざる | cursor キー `bookmarks-${bn}`(1375 行)と `bookmarkTimes`(832 行)にユーザー ID が無い | ユーザー ID でキーを分ける。`receiveTime` の採番もアカウント単位に |
| #428 アカウント切替でリスト・カラムが消える | `OTDcolumns` / `OTDfeeds` / `OTDsettings` が localStorage にグローバル保存(21-50, 89-111 行) | ログイン中アカウント単位でキーを分けるか、保存時にマージ |
| #197 ミュートリストが消える | 保存先が同じ仕組みの可能性 | 上と同時に確認 |
| #533 / #548 リストメンバーの追加・表示 | GraphQL の `ListAddMember` / `ListMembers` 相当ルートの有無 | ルートを実装または修正 |
| #505 ユーザー検索で "does not exist" | `users/show` 相当のルート | ルートの確認 |

---

## Phase 4: 起動・環境

| Issue | 状況 | 対応 |
|---|---|---|
| #550 / #547 / #511 / #518 / #512 / #498 / #501 ロード中で止まる | 初回起動のハングは 9e4b789 で修正。残りは challenge solver と X の過負荷(今回の事象と同種) | 無限スピナーではなく理由(solver 失敗 / X エラー / レート制限)を画面に出す |
| #537 solver の "header not found" | `solver.html` は `tweetdeck.dimden.dev` にホストされており本リポジトリ外(`src/challenge.js` 14 行) | upstream 依存。自前ホストするなら `solver.html` を取り込む |
| #381 / #338 Win11 でデスクトップ通知がすぐ消える | legacy の `Notification` API | 注入で `requireInteraction` を付与できるか検討 |
| #321 絵文字選択でフォーカス喪失(macOS Firefox) | UI | 低優先度 |
| #106 引用ツイートのリンクが新規タブ | UI | 低優先度 |
| #528 Firefox Nightly / #493 署名 / #521 Win7 | パッケージング・配布 | 本フォークの範囲外 |

---

## 対応しない / できないもの

- **X 側の仕様・運用**: #551(Teams からの投稿で凍結)、#529(X Pro が Premium+ 限定)、#522(検索演算子の制限。upstream 作者も X 側と判断)、#506(DM は新 Chat に移行。upstream 作者が「修正不可能」と明言)、#492 / #469 系(アカウント制限)、#462 / #510 / #259(Teams 招待。X の delegate 挙動)、#517 / #495(レート制限。Phase 1 で無駄なリクエストを減らして緩和はできる)
- **議論・質問**: #519, #503, #516, #508
- **機能要望(後回し)**: #542 自動翻訳(外部実装あり: kik0220/OldTweetDeck-fork の auto-translation ブランチ)、#535 ブックマークオプション、#534 アップロード上限、#233 検索カラム手動リロード、#231 For you カラム、#221 通知音、#212 fxtwitter、#211 スマートリプライ、#204 ショートカット、#148 Firefox 署名、#102 スタンドアロンアプリ、#18 Safari

---

## 進め方

- Phase ごとに PR を分け、`tests/` に `node:test` のケースを足す。実行は `node --test tests/*.test.cjs`。
- 実機確認は `x.com/i/tweetdeck` で、Teams 連携アカウントの Home と会話モジュールを含むページを使う。
- upstream へは #554(RTL)、#562(起動ハング、提出済み)、#552(Mentions)の順で PR を出す。
