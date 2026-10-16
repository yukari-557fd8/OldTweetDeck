# 修正ロードマップ(upstream Issue 棚卸し: 2026-10-17 時点)

対象: [dimdenGD/OldTweetDeck](https://github.com/dimdenGD/OldTweetDeck) の open Issue 67 件(2026-10-17 に `gh issue list` で取得)。67 件すべてを下のいずれかの節に分類している。
本フォークは upstream `main`(8bcb4bb)+ 12 コミット(3571653 時点)。

行番号は 92f0be5 時点の `src/interception.js`(Phase 1 の 1-a〜1-e だけは修正前の 97693c7 時点)。`files/bundle.js` は upstream から変更していないので行番号はそのまま使える。

分類の基準:

- **コードで直せる**: `src/interception.js` などこのリポジトリの変更で解決できる
- **X 側**: X の API 仕様・運用(凍結、レート制限、検索制限など)が原因で、拡張側では回避困難
- **upstream 依存**: Patreon 版の非公開スクリプトなど、このリポジトリに無いコードが原因
- **機能要望**: バグではない追加機能

---

## 0. すでにフォークで対応済み(upstream へ PR 候補)

| Issue | 内容 | フォークのコミット | 備考 |
|---|---|---|---|
| #554 | RTL 言語で `<html dir="rtl">` が残りレイアウト崩壊 | 01b1ed8 | 注入後に `dir=ltr lang=en-US` を固定。そのまま upstream PR にできる |
| #552 | Mentions が表示されない | 0eee9e5 | `mentions.json` の遅延を避け `all.json` から Mentions を組み立て。報告者の症状と一致するか要確認 |
| #509 / #530 / #531 / #536 ほか | Home の下端で追加取得が止まる、連携アカウントで cursor が引けない | 92f0be5 | Phase 1。実機確認は未実施。通知・Mentions に副作用の疑いあり(Phase 2-a) |
| #550 / #547 / #511 系の一部 | 初回起動でスピナーのまま | 9e4b789 / e6d8e49 | limex 氏の upstream PR #562 を取り込んだもの。#562 は 2026-10-12 に作者自身が未マージで close している |
| #514(closed) | 通常ツイートが RT 表示になる | 6a8dad0 | `TweetWithVisibilityResults` の unwrap |
| #499 に近い症状 | 操作後にカラムが最新ポーリング分だけになる | 97693c7 | legacy poller のキャッシュを維持。#499(Hide this tweet で消える)にも効いているか要検証 |
| #488 / #487 の通知側 | 通知カラムの重複・欠落 | a46550b | poller 単位で「配信済み」判定。#488 の「自分や無関係な相手のいいねが出る」症状はこの修正の対象外で未検証。#487 の「更新されない」は Phase 2-a |

---

## Phase 1: タイムライン取得の信頼性(完了)

**状態: 完了(2026-10-17、92f0be5)。** 変更は `src/interception.js`、テストは `tests/home-scroll.test.cjs`(7 件追加)と `tests/mentions-route.test.cjs`(send 時の cursor 選択に合わせて更新)。`node --test tests/*.test.cjs` で 32 件すべて通過。

実装の要点:

- Proxy に `beforeSend` フックを追加(`send()` 冒頭、ヘッダ確定後)。Home / notifications / mentions は `open()` を `beforeSend` まで保留し、`x-act-as-user-id` からユーザー ID を解決してから cursor 付き URL で開く(1-a)。
- Proxy の `get` トラップに `inspectResponse` を追加。legacy が `status` を読む瞬間に一度だけ応答を検査し、GraphQL エラーだけの 200 を 503 に変える(1-d)。
- ページ台帳 `timelinePages`(feed ごとに `{ids, bottom, top}`)を導入。ページ内の全 ID から cursor を引ける。会話モジュールは `keepThreadTogether` で返信の直上に並ぶ sort key(`receiveTime`)を持つ(1-b)。Home / List / User に適用。
- cursor が無い `max_id` 要求はネットワークに出さず 503 で即応答(1-c)。全件フィルタで空になったページは次の cursor に進める。
- `TD.controller.FeedPoller` をラップし `EXHAUSTED_API_THRESHOLD` を 1 に、refresh のたびに `intervalOfPossibility` を全域に戻す(1-d)。
- since ポーリングは 10 分に 1 回 cursor 無しで先頭を取り直す(`TOP_RESYNC_INTERVAL`)。`seenHomeTweets` は上限 2000 の Set(1-e)。List / User の `max_id` 要求が refresh throttle でキャンセルされていた問題も解消。
- 残課題:
  - `Math.random() > 0.6` の 40% キャンセルはそのまま(1096 行)。
  - cursor-top で新着が返らない疑いは実機で要検証(Home は 10 分ごとの再同期で緩和はされる)。
  - 実機での確認(下記「Phase 1 のテスト」参照)は未実施。
  - 1-a の修正で、通知・Mentions も連携アカウント自身の cursor-top を使うようになった。cursor-top で新着が返らない疑いが通知で当たっていれば、連携アカウントの通知も止まる(Phase 2-a で対処)。

対象 Issue: #509, #530, #531, #536, #487, #496, #495 / #517(無駄なリクエストによるレート制限悪化)。
upstream でも「Home の下端でスピナーが出続ける」「数時間前より古いツイートが出ない」という報告が複数ある(#509, #530)。
今回手元で起きた「下端での追加取得が重い」は X 側の一時的な負荷だったが、コードを追った結果、同じ症状を決定的に起こす経路が 3 つある。

以下 1-a〜1-e は修正前の分析(行番号は 97693c7 時点)。

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

- 自動テスト(済み): `tests/home-scroll.test.cjs` に 7 件。連携アカウントの cursor を send 時に解決すること、会話モジュールの sort key と全 ID からの cursor 引き当て、全件フィルタで空のページは次へ進むこと、GraphQL エラーだけの 200 を失敗(503)として返すこと、since ポーリングの cursor と 10 分ごとの再同期、FeedPoller が短いページで止まらないこと、List の同等処理と未知の bound での即時失敗。`tests/mentions-route.test.cjs` は send 時の cursor 選択に合わせて更新。
- 実機(未実施): 連携アカウントの Home と、会話モジュールを含むページで下端までスクロールして追加取得されること。DevTools の Network で同じ cursor の連続要求が無いこと。

---

## Phase 2: 通知・Mentions の取得(次の優先)

**状態: 未着手(2026-10-17 に調査のみ)。** 対象 Issue: #507, #549, #487(通知側)。
Phase 1(92f0be5)の副作用の疑いがあるので、表示系より先に扱う。

### 2-a. cursor-top 付きの新着取得で、未読の通知が返らない疑い(#507, #487)

- 報告: #507「リプライなどの通知が数時間届かず、x.com を開いた瞬間にまとめて届く」。#487 のコメントに「モバイルで既読にするまで OTD に出ず、既読にした直後に出る」「一部の通知カラムは更新され、一部はされない」。
- 新着取得(since_id)は前回の応答の cursor-top を付けて `all.json` を取る(通知 1684-1689 行、Mentions 1893-1898 行)。Home の `TOP_RESYNC_INTERVAL`(752-764 行)に当たる cursor なしの取り直しは、通知・Mentions には無い。
- upstream(8bcb4bb)は open 時点で cursor を選ぶので、連携アカウントの要求にはログインアカウントの cursor が付いていた。X がそれを無効として先頭ページを返していたとすれば、「ログインアカウントの列だけ止まり、連携アカウントの列は更新される」という #487 の報告と合う。
- 見立て(確度: 中。報告どうしの一致による推定で、X の挙動は未検証): `all.json` は cursor-top 付きだと未読の新着を返さず、公式クライアントで既読になると返すようになる。
- フォークへの影響: 92f0be5 で連携アカウントも自分の cursor-top を使うようになった。見立てが正しければ、連携アカウントの通知・Mentions も止まる。
- 検証: 新しいリプライが届いた直後に、cursor-top 付きの要求と cursor なしの要求の応答を DevTools の Network で比べる。

対応:
- 通知・Mentions にも cursor なしの取り直しを入れる。重複は `notificationDeliveryFilter`(992-1002 行)が legacy の poller の `chirpIndex` で落とすので安全。
- 通知は即時性が要るので、間隔は Home の 10 分より短くするか、新着取得は常に cursor なしにする(1 ページ 20 件なので、ポーリングの間に 20 件を超えなければ取りこぼさない)。

### 2-b. 新着取得の応答で cursor-bottom を上書きしている(要確認)

- 通知(1849-1856 行)・Mentions(1955-1962 行)とも、応答に cursor-bottom があればアカウントごとの 1 キーに無条件で保存する。
- 新着取得の応答にも cursor-bottom が含まれる場合、次の下スクロールは新着の直下から取り直しになる。全部重複で 0 件になり、legacy が exhausted と判定して下方向の取得が止まる(閾値を 1 にしても 0 件では止まる。interactions は `nonExhaustibleFeedTypes` に入っていない)。
- #507 のコメント「1 週間より古い通知が出ない」と関係している可能性がある。
- 対応: cursor-bottom は初回と max_id 要求の応答からだけ保存する。または Phase 1 のページ台帳(`timelinePages`)を通知にも使う。

### 2-c. 通知カラムが「Loading…」のまま(#549)

- legacy は初回取得(backfill、`files/bundle.js` 28632)が成功すれば、0 件でも「No recent Tweets」に置き換える(`mergeAndRenderChirps`、29136)。「Loading…」が残るのは、要求がエラーで返ったときか、応答が返ってこないときだけ。パース失敗は `processActions`(43187)の try/catch で 0 件扱いになり、この症状にはならない。
- upstream の `interception.js` は 2026-03-18 から 09-16 まで変更が無い。8 月に出始めたのは、X 側の変化か、外部にホストされた solver / Patreon 版スクリプトの変化による。
- 原因の候補:
  1. 一部のアカウントで `all.json` 自体がエラーを返す(X 側の移行など)。未確認。
  2. 429(レート制限)。`all.json` の枠は x.com のタブと共有で、フォークでは Mentions も同じ枠を使う(0eee9e5)。
  3. challenge solver の失敗。`send()` の中で例外を投げ直す(3219-3227 行)ため XHR が送信も完了もされず、legacy の ajax にはタイムアウトが無いので永久に「Loading…」になる。ただしこの場合は全カラムに出るはず。
- 確定に必要な情報: 影響を受けた利用者の `all.json` のステータスと応答本文、コンソールのエラー。
- 対応: 3 は `failWithoutRequest` と同じく 503 で失敗させる。1・2 は理由を画面に出す(Phase 5 の項目と共通)。

### 2-d. 1 件の不正な通知でページ全体が空になる(要確認)

- mention / reply / quote は、作者 `go.users[tweet.user_id_str]` があるか確かめずに渡している(通知 1776 行、Mentions 1934 行)。作者が `globalObjects.users` に無いと legacy の `TwitterActionMention.fromRESTData`(`bundle.js` 41613)が失敗し、`processActions` の try/catch がページ全体を 0 件にする。
- 対応: ルート側で作者・対象ツイートが揃わないエントリを飛ばす。

### Phase 2 のテスト

- `tests/notifications-route.test.cjs` / `tests/mentions-route.test.cjs` に追加: 定期的に cursor なしで取ること、新着取得の応答で cursor-bottom を上書きしないこと、作者の無いエントリを飛ばすこと、solver 失敗時に 503 で返すこと。
- 実機: 2-a の検証(cursor-top 付きと無しの比較)。ログインアカウントと連携アカウントの両方の通知カラム・Mentions カラムで新着が届くこと。

---

## Phase 3: 表示・取りこぼし

| Issue | 原因(確認済み / 推定) | 対応 |
|---|---|---|
| #520 "Twitter for Advertisers" 経由の投稿が Home から消える | `tweet.source` による除外(1153-1155, 1175-1177 行)。公式アカウントが広告ツールで投稿すると消える | source 判定を廃止し、`entryId` に `promoted` を含むもの / `promotedMetadata` だけ除外 |
| #520 続き / #435 List では media / card が出ない、動画 unified card | upstream #560 で画像 unified card は対応済み。動画は未対応 | `parseTweetCard` を動画 unified card に拡張 |
| #563 動画が再生できない(2026-10-14) | 最新の報告。X 側の動画 URL / 認証の変更の可能性 | 再現確認 → `video_info.variants` の扱いと再生ウィンドウの実装を確認 |
| #497 長文の「see more」 | `note_tweet` は展開済み(179 行〜)。"Enable tweet autoexpand" との関係 | 設定 OFF 時に省略表示 + 展開リンクを出すか確認 |
| #427 / #387 / #131 ミュート・ブロックが残る | Home(1158, 1180 行)と List(1344 行)はフィルタ済み。Search / Notifications / 引用 / 会話詳細は未適用 | 共通のフィルタ関数に寄せて全ルートに適用 |
| #496 センシティブ設定のアカウントが Home に出ない | X の HomeLatestTimeline 側の挙動の可能性 | 再現確認。X.com で出て OTD で出ない例の生レスポンスを比較 |

---

## Phase 4: マルチアカウント・状態保存

| Issue | 原因(確認済み / 推定) | 対応 |
|---|---|---|
| #545 Bookmarks が複数アカウントで混ざる | cursor キー `bookmarks-${bn}`(1571-1572, 1659 行)と `bookmarkTimes`(1043, 1574-1575 行)にユーザー ID が無い | ユーザー ID でキーを分ける。`receiveTime` の採番もアカウント単位に |
| #428 アカウント切替でリスト・カラムが消える | `OTDcolumns` / `OTDfeeds` / `OTDsettings` が localStorage にグローバル保存(22-45, 88-115 行) | ログイン中アカウント単位でキーを分けるか、保存時にマージ |
| #197 ミュートリストが消える | 保存先が同じ仕組みの可能性 | 上と同時に確認 |
| #533 / #548 リストメンバーの追加・表示 | GraphQL の `ListAddMember` / `ListMembers` 相当ルートの有無 | ルートを実装または修正 |
| #505 ユーザー検索で "does not exist" | `users/show` 相当のルート | ルートの確認 |

---

## Phase 5: 起動・環境

| Issue | 状況 | 対応 |
|---|---|---|
| #550 / #547 / #511 / #518 / #512 / #498 / #501 ロード中で止まる | 初回起動のハングは 9e4b789(limex 氏の #562)で修正。残りは challenge solver と X の過負荷 | 無限スピナーではなく理由(solver 失敗 / X エラー / レート制限)を画面に出す。#549 の「Loading…」(Phase 2-c)も同じ仕組みで扱う |
| #537 solver の "header not found" | `solver.html` は `tweetdeck.dimden.dev` にホストされており本リポジトリ外(`src/challenge.js` 14 行) | upstream 依存。自前ホストするなら `solver.html` を取り込む |
| #381 / #338 Win11 でデスクトップ通知がすぐ消える | legacy の `Notification` API | 注入で `requireInteraction` を付与できるか検討 |
| #321 絵文字選択でフォーカス喪失(macOS Firefox) | UI | 低優先度 |
| #106 引用ツイートのリンクが新規タブ | UI | 低優先度 |
| #528 Firefox Nightly / #493 署名 / #521 Win7 | パッケージング・配布 | 本フォークの範囲外 |

---

## 対応しない / できないもの

- **X 側の仕様・運用**: #551(Teams からの投稿で凍結)、#529(X Pro が Premium+ 限定)、#522(検索演算子の制限。upstream 作者も X 側と判断)、#506(DM は新 Chat に移行。upstream 作者が「修正不可能」と明言)、#492(アカウント制限。同系統の #469 は close 済み)、#462 / #510 / #259(Teams 招待。X の delegate 挙動)、#517 / #495(レート制限。Phase 1 で無駄なリクエストを減らして緩和はできる)
- **upstream 依存(Patreon 版)**: #515(Patreon 連携後に List がほとんど読み込まれない。報告者・コメント者とも連携ユーザーで、連携前は読み込めていた)
  - `src/injection.js` 168-188 が、Patreon のトークンを付けて `oldtd.org/api/scripts` から追加スクリプトを読み込む。トークンなしで返るのは `auth.js`(連携 UI)だけで、支援者向けの修正はこのリポジトリに無いため、検証も修正もできない。
  - 回避策: 設定の Patreon「Logout」で連携を外すと公開版の List ルートに戻る(レート制限回避は失われる)。
  - フォークでも連携ユーザーにはこのスクリプトが読み込まれ、Phase 1 で直した List ルートを上書きしている可能性がある(相性は不明)。必要なら「追加スクリプトを読み込まない」設定を検討する。#530 の報告者も Patreon 版を使っている。
- **議論・質問**: #519, #503, #516, #508
- **機能要望(後回し)**: #542 自動翻訳(外部実装あり: kik0220/OldTweetDeck-fork の auto-translation ブランチ)、#535 ブックマークオプション、#534 アップロード上限、#233 検索カラム手動リロード、#231 For you カラム、#221 通知音、#212 fxtwitter、#211 スマートリプライ、#204 ショートカット、#148 Firefox 署名、#102 スタンドアロンアプリ、#18 Safari

---

## 進め方

- Phase ごとに PR を分け、`tests/` に `node:test` のケースを足す。実行は `node --test tests/*.test.cjs`。
- 実機確認は `x.com/i/tweetdeck` で、Teams 連携アカウントの Home と会話モジュールを含むページを使う。通知・Mentions はログインアカウントと連携アカウントの両方で確かめる。
- 次の作業は Phase 1 の実機確認と Phase 2-a の検証(同じ実機セッションでできる)。
- upstream へは #554(RTL)、#552(Mentions)の順で PR を出す。起動ハングの修正は limex 氏の #562 が未マージで close されているので、出すならクレジット付きで出し直す。Phase 1(92f0be5)は実機確認と Phase 2-a の結論が出てから。
