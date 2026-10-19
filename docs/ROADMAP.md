# 修正ロードマップ(upstream Issue 棚卸し: 2026-10-17 時点)

対象: [dimdenGD/OldTweetDeck](https://github.com/dimdenGD/OldTweetDeck) の open Issue 67 件(2026-10-17 に `gh issue list` で取得)。67 件すべてを下のいずれかの節に分類している。
本フォークは upstream `main`(8bcb4bb)+ 29 コミット(8d58466 時点)。

行番号は 92f0be5 時点の `src/interception.js`(Phase 1 の 1-a〜1-e だけは修正前の 97693c7 時点)。Phase 2〜8(f8dc681 / 31dc3bc / 582c857 / ce8b80e / 4d26629 / 017d2a7 / 6522d2c / a7c4cc5 / 8d58466)で変更したため、現在のファイルとは一致しない。`files/bundle.js`・`src/challenge.js`・`src/injection.js` の行番号はそのまま使える(`src/injection.js` は変更なし。`files/bundle.js` は Phase 5 で 3 行、Phase 8 で 20 行を同一行内で書き換えただけで行数は変わらず、`src/challenge.js` の変更は 92 行より後)。

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
| #509 / #530 / #531 / #536 ほか | Home の下端で追加取得が止まる、連携アカウントで cursor が引けない | 92f0be5 / bfcbdd3 | Phase 1。実機確認は問題なし(2026-10-17)。通知・Mentions は Phase 2 で対応済み。実機確認も問題なし |
| #550 / #547 / #511 系の一部 | 初回起動でスピナーのまま | 9e4b789 / e6d8e49 | limex 氏の upstream PR #562 を取り込んだもの。#562 は 2026-10-12 に作者自身が未マージで close している |
| #514(closed) | 通常ツイートが RT 表示になる | 6a8dad0 | `TweetWithVisibilityResults` の unwrap |
| #499 に近い症状 | 操作後にカラムが最新ポーリング分だけになる | 97693c7 | legacy poller のキャッシュを維持。#499(Hide this tweet で消える)にも効いているか要検証 |
| #488 / #487 の通知側 | 通知カラムの重複・欠落 | a46550b | poller 単位で「配信済み」判定。#488 の「自分や無関係な相手のいいねが出る」症状はこの修正の対象外で未検証。#487 の「更新されない」は Phase 2。実機確認は問題なし(2026-10-17) |
| #507 / #549 / #487 | 通知・Mentions に新着が届かない、「Loading…」のまま | f8dc681 | Phase 2。実機確認は問題なし(2026-10-17) |
| #520 / #435 / #563 / #497 / #427 / #387 / #131 / #496 | 広告ツール経由の投稿の欠落、動画カード、長文の see more、ミュート・ブロックの漏れ | 31dc3bc | Phase 3。実機確認は問題なし(2026-10-17)。#563 と #496 はコード変更なし |
| #545 / #428 / #197 / #533 / #548 / #505 | ブックマークの混在、アカウント別のデッキ保存、リストメンバー、ユーザー検索 | 582c857 | Phase 4。実機確認は問題なし(2026-10-17) |
| #550 / #547 / #511 / #518 / #512 / #498 / #501 / #381 / #338 / #106 | 起動・カラムの読み込みが終わらず理由も出ない、デスクトップ通知がすぐ消える、`x.com` のリンクが新規タブ | ce8b80e | Phase 5。実機確認は問題なし(2026-10-17) |
| (フォークで確認) | 通知カラムと Mentions カラムの更新がずれる、Home の更新間隔がばらつく、フォローのまとめ通知で古いフォロワーが上にあふれる | 4d26629 / 017d2a7 / 6522d2c | Phase 6。5 分間の HAR で間隔と 429 が出ないことは確認(2026-10-18)。2 カラムに同時に出ることの目視と、フォロー通知の実機確認は未了 |
| (フォークで確認) | Better TweetDeck を併用すると、Home などで認証済みのアカウントのバッジが消え、相互フォローバッジが通知・Mentions にしか出ない | a7c4cc5 | Phase 7。相互の行で認証バッジが隠れるのは BTD の仕様で、BTD のカスタム CSS で対処(2026-10-18 に確認) |
| (機能要望) | カラム設定「Tweet authors」に、相互フォローの相手だけを表示する選択肢が無い | 8d58466 | Phase 8。legacy が `followed_by` を捨てていたので `TwitterUser` に持たせ、「verified users」と同じ作りで「mutual follows」を追加。検索・イベントカラムには出さない。実機確認は未了 |

---

## Phase 1: タイムライン取得の信頼性(完了)

**状態: 完了。実機確認も問題なし(2026-10-17)。** タイムライン取得は 92f0be5、会話モジュールの古いツイートを時系列の位置に残す変更は bfcbdd3。変更は `src/interception.js`、テストは `tests/home-scroll.test.cjs` と `tests/mentions-route.test.cjs`(send 時の cursor 選択に合わせて更新)。

実装の要点:

- Proxy に `beforeSend` フックを追加(`send()` 冒頭、ヘッダ確定後)。Home / notifications / mentions は `open()` を `beforeSend` まで保留し、`x-act-as-user-id` からユーザー ID を解決してから cursor 付き URL で開く(1-a)。
- Proxy の `get` トラップに `inspectResponse` を追加。legacy が `status` を読む瞬間に一度だけ応答を検査し、GraphQL エラーだけの 200 を 503 に変える(1-d)。
- ページ台帳 `timelinePages`(feed ごとに `{ids, bottom, top}`)を導入。ページ内の全 ID から cursor を引ける。会話モジュールは最新のツイート(返信)を残し、それより古いツイートはページの範囲内(新着取得では前回より新しいもの)だけを自身の ID の位置に残す(`threadTweetsInRange`、1-b)。Home / List / User に適用。92f0be5 では `receiveTime` で返信の直上に並べていたが、古いツイートが時系列を外れて表示されるため変更した。
- cursor が無い `max_id` 要求はネットワークに出さず 503 で即応答(1-c)。全件フィルタで空になったページは次の cursor に進める。
- `TD.controller.FeedPoller` をラップし `EXHAUSTED_API_THRESHOLD` を 1 に、refresh のたびに `intervalOfPossibility` を全域に戻す(1-d)。
- since ポーリングは 10 分に 1 回 cursor 無しで先頭を取り直す(`TOP_RESYNC_INTERVAL`)。`seenHomeTweets` は上限 2000 の Set(1-e)。List / User の `max_id` 要求が refresh throttle でキャンセルされていた問題も解消。
- 残課題は無い。`Math.random() > 0.6` の 40% キャンセル(1096 行)は意図的に残しており、実機で問題は出ていない。通知・Mentions の cursor-top は Phase 2 で外し、実機確認も問題なし(2026-10-17)。

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

- 自動テスト(済み): `tests/home-scroll.test.cjs` に 8 件。連携アカウントの cursor を send 時に解決すること、会話モジュールの古いツイートの扱い(ページ内と新着取得)と全 ID からの cursor 引き当て、全件フィルタで空のページは次へ進むこと、GraphQL エラーだけの 200 を失敗(503)として返すこと、since ポーリングの cursor と 10 分ごとの再同期、FeedPoller が短いページで止まらないこと、List の同等処理と未知の bound での即時失敗。`tests/mentions-route.test.cjs` は send 時の cursor 選択に合わせて更新。
- 実機(2026-10-17、問題なし): Home で古い元ツイートが時系列を外れないこと。連携アカウントの Home、会話モジュールを含むページの下端までの追加取得、同じ cursor の連続要求が無いこと、cursor-top の新着取得。

---

## Phase 2: 通知・Mentions の取得(完了)

**状態: 完了。実機確認も問題なし(2026-10-17)。** 対象 Issue: #507, #549, #487(通知側)。
Phase 1 の副作用を先に潰すために扱った。変更は f8dc681(`src/interception.js`)。自動テストは `tests/notifications-route.test.cjs` と `tests/mentions-route.test.cjs`。API エラーとレート制限の理由を画面に出すのは Phase 5 のまま。

### 2-a. cursor-top 付きの新着取得で、未読の通知が返らない疑い(#507, #487)

- 報告: #507「リプライなどの通知が数時間届かず、x.com を開いた瞬間にまとめて届く」。#487 のコメントに「モバイルで既読にするまで OTD に出ず、既読にした直後に出る」「一部の通知カラムは更新され、一部はされない」。
- 新着取得(since_id)は前回の応答の cursor-top を付けて `all.json` を取る(通知 1684-1689 行、Mentions 1893-1898 行)。Home の `TOP_RESYNC_INTERVAL`(752-764 行)に当たる cursor なしの取り直しは、通知・Mentions には無い。
- upstream(8bcb4bb)は open 時点で cursor を選ぶので、連携アカウントの要求にはログインアカウントの cursor が付いていた。X がそれを無効として先頭ページを返していたとすれば、「ログインアカウントの列だけ止まり、連携アカウントの列は更新される」という #487 の報告と合う。
- 見立て(報告どうしの一致による推定): `all.json` は cursor-top 付きだと未読の新着を返さず、公式クライアントで既読になると返すようになる。
- フォークへの影響: 92f0be5 で連携アカウントも自分の cursor-top を使うようになった。見立てが正しければ、連携アカウントの通知・Mentions も止まる。
- 実機(2026-10-17、問題なし): ログインアカウントと連携アカウントの両方で、通知と Mentions に新着が届く。

対応(実装済み):
- 通知・Mentions の since 取得は、保存済みの cursor-top を使わず、毎回 cursor なしで `all.json` の先頭を取り直す。Home の 10 分間隔では未読が届くまで待ちが残るため。1 ページ 20 件なので、ポーリングの間に 20 件を超えると取りこぼしうる。
- 重複は、通知は `notificationDeliveryFilter` が legacy の poller の `chirpIndex` で落とし、Mentions は legacy がツイート id で落とす。

### 2-b. 新着取得の応答で cursor-bottom を上書きしている

- 通知(1849-1856 行)・Mentions(1955-1962 行)とも、応答に cursor-bottom があればアカウントごとの 1 キーに無条件で保存する。
- 新着取得の応答にも cursor-bottom が含まれる場合、次の下スクロールは新着の直下から取り直しになる。全部重複で 0 件になり、legacy が exhausted と判定して下方向の取得が止まる(閾値を 1 にしても 0 件では止まる。interactions は `nonExhaustibleFeedTypes` に入っていない)。
- #507 のコメント「1 週間より古い通知が出ない」と関係している可能性がある。
- 対応(実装済み): cursor-bottom は初回と max_id 要求の応答からだけ保存する。since 取得の応答では上書きしない。ページ台帳は使っていない。

### 2-c. 通知カラムが「Loading…」のまま(#549)

- legacy は初回取得(backfill、`files/bundle.js` 28632)が成功すれば、0 件でも「No recent Tweets」に置き換える(`mergeAndRenderChirps`、29136)。「Loading…」が残るのは、要求がエラーで返ったときか、応答が返ってこないときだけ。パース失敗は `processActions`(43187)の try/catch で 0 件扱いになり、この症状にはならない。
- upstream の `interception.js` は 2026-03-18 から 09-16 まで変更が無い。8 月に出始めたのは、X 側の変化か、外部にホストされた solver / Patreon 版スクリプトの変化による。
- 原因の候補:
  1. 一部のアカウントで `all.json` 自体がエラーを返す(X 側の移行など)。未確認。
  2. 429(レート制限)。`all.json` の枠は x.com のタブと共有で、フォークでは Mentions も同じ枠を使う(0eee9e5)。
  3. challenge solver の失敗。`send()` の中で例外を投げ直す(3219-3227 行)ため XHR が送信も完了もされず、legacy の ajax にはタイムアウトが無いので永久に「Loading…」になる。ただしこの場合は全カラムに出るはず。
- 確定に必要な情報: 影響を受けた利用者の `all.json` のステータスと応答本文、コンソールのエラー。
- 対応: 3 は実装済み。`solveChallenge` が失敗したらリクエストを送らず、`failWithoutRequest` と同じく 503 で完了させる。1・2 の理由を画面に出すのは Phase 5。

### 2-d. 1 件の不正な通知でページ全体が空になる

- mention / reply / quote は、作者 `go.users[tweet.user_id_str]` があるか確かめずに渡している(通知 1776 行、Mentions 1934 行)。作者が `globalObjects.users` に無いと legacy の `TwitterActionMention.fromRESTData`(`bundle.js` 41613)が失敗し、`processActions` の try/catch がページ全体を 0 件にする。
- 対応(実装済み): `notificationTweet` で、作者または対象ツイートが無いエントリを飛ばす。引用先のツイートか作者が無いときは、その引用だけ外してエントリは残す。通知と Mentions の両方。いいね・RT の対象ツイートも同じ。

### Phase 2 のテスト

- 自動テスト(済み): since 取得が cursor を付けないこと、その応答で cursor-bottom を上書きしないこと、作者の無いエントリを飛ばし引用先が欠けてもページを空にしないこと、solver 失敗時に 503 で返しネットワークに送らないこと。`node --test tests/*.test.cjs` は 38 件通過。
- 実機(2026-10-17、問題なし): ログインアカウントと連携アカウントの両方で、通知カラムと Mentions カラムに新着が届くこと。下方向のスクロールが since 取得のあとでも続くこと。solver 失敗時に「Loading…」のまま止まらないこと。

---

## Phase 3: 表示・取りこぼし(完了)

**状態: 完了。実機確認も問題なし(2026-10-17)。** 変更は 31dc3bc(`src/interception.js`)。`node --test tests/*.test.cjs` は 45 件通過。

| Issue | 原因(確認済み / 推定) | 対応 |
|---|---|---|
| #520 "Twitter for Advertisers" 経由の投稿が Home から消える | `tweet.source` による除外。公式アカウントが広告ツールで投稿すると消える | 実装済み。source 判定は廃止。`entryId` に `promoted` を含むものか `promotedMetadata` があるものだけ除外 |
| #520 続き / #435 動画 unified card | 画像 unified card は summary card に変換済み。動画は TweetDeck が再生できない unified card のまま | 実装済み。動画と animated_gif は `extended_entities.media` のネイティブ動画にする。mp4 の variant が無いカードはそのまま |
| #563 動画が再生できない(2026-10-14) | 再生ウィンドウは `video_info.variants` の `video/mp4` のうち最高ビットレートを使う(`bundle.js` の `chooseVideoVariant`)。`bundle.js` は変えていない | 実機確認は問題なし(2026-10-17) |
| #497 長文の「see more」 | 長文は常に全文へ置き換えていた。TweetDeck は末尾が「…」のときだけ Expand tweet を出す | 実装済み。`OTDenableAutoExpand` が OFF のときは省略のまま。ON のときと、Expand が叩く `statuses/show` は全文 |
| #427 / #387 / #131 ミュート・ブロックが残る | Home と List だけが著者を落としていた | 実装済み。`tweetHidden` を Home / List / Search / 通知 / Mentions / 会話詳細に適用。RT の元著者も落とす。ミュートした人の引用は引用部分だけ外す。ユーザーカラムとブックマークは対象外 |
| #496 センシティブ設定のアカウントが Home に出ない | OTD に `possibly_sensitive` で落とす処理は無い。コメントの「Home が更新されない」は Phase 1 の症状と重なる | 実機確認は問題なし(2026-10-17) |

---

## Phase 4: マルチアカウント・状態保存(完了)

**状態: 完了。実機確認も問題なし(2026-10-17)。** 変更は 582c857(`src/interception.js`)。自動テストは `tests/bookmarks-route.test.cjs`、`tests/account-routes.test.cjs`、`tests/startup.test.cjs` に計 8 件追加。`node --test tests/*.test.cjs` は 53 件通過。

| Issue | 原因(確認済み / 推定) | 対応 |
|---|---|---|
| #545 Bookmarks が複数アカウントで混ざる | cursor と `bookmarkTimes` がツイート ID だけで、連携アカウントの `x-act-as-user-id` を見ていなかった | 実装済み。キーは `bookmarks-${userId}-${id}` と `${userId}:${id}`。下方向の cursor はヘッダが付いてから付ける |
| #428 アカウント切替でリスト・カラムが消える | `OTDcolumns` / `OTDfeeds` / `OTDsettings` / `OTDcolumnIds` がログインをまたいで一つ | 実装済み。ログインアカウント(`verifiedUser`)ごとに `OTDsettings:${id}` などへ保存する。Teams のカラムは分割しない。古いグローバルキーは、最初に開いたログインへ一度だけ移す |
| #197 ミュートリストが消える | 報告はキーワードミュート。設定の `global_filter` に入り、デッキと同じ保存先 | 実装済み。#428 のアカウント別設定に含まれる。アカウントのミュート ID(`mutes/users/ids.json`)は設定画面が x.com 側と案内しており、今回の対象外 |
| #533 / #548 リストメンバーの追加・表示 | `lists/members.json` と `lists/members/create.json` を GraphQL に変換していなかった | 実装済み。表示は `ListMembers`(`yQ_0-CTekcCY2oFRTskpSw`)。追加は `ListAddMember`、削除は `ListRemoveMember`、複数追加は `create_all.json`。query id は 2026-10 時点の x.com クライアント。メンバー画面は先頭 100 件だけ読む |
| #505 ユーザー検索で "does not exist" | `users/show.json` が廃止済み REST のまま | 実装済み。`screen_name` は `UserByScreenName`、`user_id` は `UserByRestId`。見つからないときは code 34 のエラーのまま |

### Phase 4 のテスト

- 自動テスト(済み): ブックマークの cursor と `receiveTime` がアカウントをまたがないこと。旧デッキが検証済みログインへ一度だけ移り、別ログインの保存がそれを上書きしないこと。`users/show` の変換と、いないユーザーが code 34 のままであること。リストメンバーの変換と、追加が user id を送ること。
- 実機(2026-10-17、問題なし): 二つのログインでカラムとキーワードミュートがそれぞれ残ること。ブックマークカラムがアカウントごとに並ぶこと。リストのメンバー表示と一人の追加。いるユーザーの検索が「does not exist」にならないこと。

---

## Phase 5: 起動・環境(完了)

**状態: 完了。実機確認も問題なし(2026-10-17)。** 変更は ce8b80e(`src/interception.js`・`src/challenge.js`・`files/bundle.js`)。`node --test tests/*.test.cjs` は 65 件通過。

| Issue | 原因(確認済み / 推定) | 対応 |
|---|---|---|
| #550 / #547 / #511 / #518 / #512 / #498 / #501 ロード中で止まる | 初回起動のハングの一つは 9e4b789(limex 氏の #562)で修正済み。残りの一つは、jQuery 2.1.4 の xhr transport がハンドラを外してから `responseText` を読むこと(`files/vendor.js` 2796 行)。ルートの `afterRequest` がそこで例外を投げると(429 の平文や HTML のエラーページを `JSON.parse` する verify_credentials など)、要求が完了しないまま残り、起動はスピナー、カラムは「Loading…」のままになる。失敗しても legacy は理由を出さない(401 / 403 は空のログイン画面、それ以外は "Error initializing TweetDeck") | 実装済み。`afterRequest` の例外は捕まえて JSON でない本文を返し、jQuery に parse error として失敗させる。起動とカラムの要求について失敗の理由(レート制限と解除時刻 / X のエラー / solver 失敗 / 読めない応答 / 401・403 / 通信)を記録し、起動前はログイン画面の文言に、起動後はトーストに出す(同じ理由とカラム種別で 5 分に 1 回、レート制限は解除時刻まで。401・403 と通信エラーはトーストにしない)。スピナーが 30 秒残ったら、失敗の理由か応答待ちの要求を Reload リンクと一緒にスピナーの下に出す。solver の iframe が読み込まれないときも 30 秒で失敗させる(`src/challenge.js`)。Phase 2-c の 1・2(#549 の「Loading…」)も同じトーストで扱う |
| #537 solver の "header not found" | ホスト版の `solver.html?4` は 2026-10-17 時点で header regex を使っておらず、このエラーは出ない(初期化の失敗は "Module ID not found" / "Default export not found") | 変更なし。solver が失敗したときは、上の仕組みでトーストかログイン画面に理由が出る |
| #381 / #338 Win11 でデスクトップ通知がすぐ消える | legacy が表示の 5 秒後に `close()` している(`TD.controller.notifications`、`files/bundle.js` 32239-32242 行)。Windows ではアクションセンターからも消える | 実装済み。`window.Notification` を差し替え、legacy の `onshow`(閉じるタイマーだけ)を無視する。表示時間は OS の設定に従う |
| #106 引用ツイートのリンクが新規タブ | `TD.util` の permalink 判定が `twitter.com` だけ(`files/bundle.js` 974 行)。いまの X は `x.com` の URL を返すので、ツイートへのリンクも外部リンク扱いになる。2023 年の報告と同じ原因かは未確認 | 実装済み。`x.com` と `www.` / `mobile.` も同じ扱いにする。`home` / `explore` / `i` など x.com のアプリのパスはユーザー名と見なさない。`/i/status/<id>` はツイートとして開く |
| #321 絵文字選択でフォーカス喪失(macOS Firefox) | UI。手元の環境で再現できない | 未対応(低優先度) |
| #528 Firefox Nightly / #493 署名 / #521 Win7 | パッケージング・配布 | 本フォークの範囲外 |

### Phase 5 のテスト

- 自動テスト(済み): `tests/failure-notices.test.cjs` に 7 件。読めない 429 でも要求が完了しログイン画面にレート制限と解除時刻が出ること、読めない 200 が parse error で失敗すること、起動後のトーストが理由とカラム種別ごとに 1 回であること、solver 失敗の理由がトーストに出ること、自前で返した失敗(cursor 無しなど)は理由に数えず GraphQL のエラーページは X のメッセージを出すこと、応答待ちの要求名と Reload がスピナーの下に出てログイン画面に替わったら止まること。`tests/desktop-notifications.test.cjs`(legacy の閉じるタイマーが付かない)、`tests/challenge.test.cjs`(iframe が読み込まれないときの失敗と、読み込まれたあとの 20 秒)、`tests/twitter-links.test.cjs`(`x.com` の permalink)。
- 実機(2026-10-17、問題なし): 通常の起動とカラムの読み込みに変化が無いこと(トーストが出ないこと)。デスクトップ通知が 5 秒で消えず OS の設定どおりに残ること。ツイート本文の `x.com/.../status/...` のリンクがカラム内で開き、`x.com/<ユーザー>` がプロフィールで開くこと。レート制限や X のエラーは狙って起こせないので、出たときに文言を確かめる。

---

## Phase 6: 通知・Mentions・Home の取得間隔とフォローのまとめ通知(実装済み)

**状態: 実装済み(4d26629 / 017d2a7 / 6522d2c)。** 2026-10-18 に 5 分間の HAR(4d26629 の時点)で、取得間隔と 429 が出ないことを確認した。通知カラムと Mentions カラムに同じ通知が同時に出ることの目視と、フォローのまとめ通知(6-d)の実機確認は未了。変更は `src/interception.js`。`node --test tests/*.test.cjs` は 81 件通過。

発端は、通知カラムと Mentions カラムを並べると片方が先に更新されること(2026-10-18)。あわせて、Home と通知を優先し、ブックマークは後回しにする方針で取得間隔を見直した。その後、フォローのまとめ通知の不具合(6-d)が見つかった。upstream の Issue には対応するものが無い。

### 6-a. 通知と Mentions の更新がずれる

- 両カラムとも `all.json` の先頭ページを読むが、legacy のタイマーが別々で、開始時刻も間隔も違っていた。
- 通知: legacy が `about_me.json` を feed type なしで要求する(`files/bundle.js` 43755 の `getInteractionsTimeline`)ため、レート制限ヘッダを読まない。既定の 45 秒を decider の `faster_notifications` が 15 秒に縮めた、固定の 15 秒だった。
- Mentions: ヘッダから間隔を計算する(下限 10 秒)。0eee9e5 で枠を 2 分の 1 に見せていたため、時間枠の後半ほど遅くなり、実際の残りが 22 回を切るとリセットまで止まった。
- 対応(4d26629): 同じアカウントの先頭ページの取得を 1 本にまとめる。取得中と取得後 5 秒以内の先頭ページ要求にはその応答を渡し、取得できたらもう一方の種別をすぐ更新してタイマーをリセットする。ヘッダの半減は削除した。

### 6-b. 取得間隔

| カラム | 変更前 | 変更後 | 15 分あたり(HAR の実測) |
|---|---|---|---|
| Home | legacy は約 5 秒ごと。35 秒以内の新着取得の 40% をランダムに捨てていた(upstream ed5432c) | 捨てない。下限 4 秒 | 約 225 回(枠 500) |
| 通知・Mentions | 固定 15 秒 / 下限 10 秒 | 通知もヘッダを読む。下限 7 秒 | 約 128 回(枠 180) |
| ブックマーク | 下限 4 秒(枠を 5 分の 1 に見せる処理はそのまま) | 下限 60 秒 | — |

- 下限は localStorage で秒単位に上書きできる: `OTDhomeRefreshSeconds` / `OTDnotificationsRefreshSeconds`(通知と Mentions)/ `OTDbookmarksRefreshSeconds`。
- legacy のスケジューラは 1 秒ごとに判定するので、実際の間隔は下限〜下限 + 1 秒。
- `faster_notifications` は、通知がヘッダを読むようになった後は「枠を使い切っても 15 秒ごとに取りに行き 429 を受け続ける」効果しか残らないため、decider で無効にした(017d2a7)。

### 6-c. 調査結果(2026-10-18 の HAR)

- `NotificationsTimeline`(GraphQL、`EUX2EwvgT4f9F7sC4A59Eg`)の「All」は、`all.json` と同じ 20 件を返す(`entryId`・`sortIndex` まで一致)。「Mentions」(`timeline_type: "Mentions"`)は cursor なしの先頭ページが約 4 時間遅れ、cursor-top 付きの取得で追いついた(`mentions.json` と同じ症状)。
- レート制限は `NotificationsTimeline` が 1500 回 / 15 分で x.com と共有、`all.json` は 180 回 / 15 分で x.com は使っていない。新着の速さは変わらないので、移行は見送った。`all.json` が廃止されたときの切り替え先にはできる。通知の形(`TimelineNotification` の `template.from_users` / `target_objects`、`TimelineTweet` の `tweet_results`)は既存の `legacyUserFromGraph` / `safeParseTweet` で変換できる。引用通知の形は未確認。
- x.com のフォロー中タブは、放置中にホームを取得しない(3 分半で 0 回)。ピリオドキーでは約 1 秒間隔で取得し、すべて 200。通知は未読数(`ViewerBadgeCounts`)を 30 秒ごとに見るだけ。
- `HomeLatestTimeline` の枠は GET と POST で別。OTD(GET、`cWF3cqWadLlIXA6KJWhcew`)と x.com の GET(`NmDBT3APtNxDpMqIEauu7A`)は同じ枠を使っているとみられる(推測)。
- 残課題: Home のクエリ ID が x.com の現行(`NmDBT3APtNxDpMqIEauu7A`、POST 併用)と違う。古い ID が廃止されると Home が 400 / 404 になる。

### 6-d. フォローのまとめ通知で古いフォロワーが上にあふれる

- 症状(2026-10-18): X で「○○さんと他9人にフォローされました」と出ているまとめに新しいフォロワーが加わると、OTD の通知カラムの一番上に、そのまとめの全員が並ぶ。いいね・RT など他の通知は一つずつ届いていた。
- 原因: X はまとめの ID を変えずに最新の人を先頭に入れ、まとめの時刻を最新の動作に移す。一人ひとりの時刻は返らない。HAR では、いいねのまとめ(ID の末尾 `6ihFJo`)が 16:50 の 2 人から、18:41:50 に 3 人目が先頭に入った形で戻ってきた。フォローのまとめは数時間分にわたり先頭ページから沈むので、次のフォローで先頭に戻ったとき、OTD はまだ渡していない全員を新しい時刻で渡していた。
- 対応(6522d2c): 新着取得(since_id)では、まとめに前回から加わった人だけを渡し、今回初めて見たまとめなら先頭の 1 人だけを渡す。起動時の読み込みと下スクロールでは今までどおり全員を渡し、並び順は X のリスト順(新しい順)に合わせた。判定はまとめの状態ごとに保存し、通知カラムが複数あっても同じ結果を渡す。
- いいね・RT は対象外: 投稿が反応を集めているあいだはまとめが先頭ページに残るので起きにくい。また、初めて見たまとめを先頭の 1 人に絞ると、同じ投稿に同時に来たいいねを取りこぼす。
- 残る制約: 初めて見たまとめに取得の間(7 秒)で 2 人以上加わると、2 人目以降は出ない。OTD を開く前からまとめにいた人は、そのまとめが起動時の先頭ページに無ければ OTD には出ない(X のまとめに残る)。

### Phase 6 のテスト

- 自動テスト(済み): `tests/shared-top-page.test.cjs` に 6 件。取得中と 5 秒以内の先頭ページ要求が応答を共有すること、取得後にもう一方の種別が更新されタイマーがリセットされること、失敗した応答は共有しないこと、スクロールと別アカウントは共有しないこと、XHR Proxy 経由でも共有した応答を legacy が読めること。`tests/polling-floors.test.cjs` に 5 件。下限の値と localStorage での上書き、通知の要求に feed type が付くこと、legacy の読み込み前に呼ばれても後で一度だけ適用されること、`faster_notifications` が無効なこと。`tests/home-scroll.test.cjs` に 1 件。Home の新着取得が 20 回続けて捨てられないこと(変更前のコードでは失敗する)。`tests/mentions-route.test.cjs` のヘッダ半減のテストは置き換えた。`tests/notifications-route.test.cjs` に 4 件(6-d)。先頭ページに戻ってきたフォローのまとめからは新しい 1 人だけが出ること、前に見たまとめからは増えた人が全員出ること、通知カラムが 2 つあっても両方に届くこと、いいねのまとめは今までどおり全員が出ること。フォローの 3 件は変更前のコードでは失敗し、いいねの 1 件は変更前でも通る。
- 実機(2026-10-18): 通知カラムと Mentions カラムを置いて 5 分。Home は 4.0 秒ごと、`all.json` は 7.0 秒ごとに 1 本で、Mentions からの要求は 0 本、すべて 200。ブックマークカラムが無かったため 60 秒の下限は未確認。両カラムに同時に出ることの目視も未了。6-d は、先頭ページから沈んだフォローのまとめに新しいフォロワーが加わったときにしか起きないため、次にその状況になったときに確かめる。

---

## Phase 7: Better TweetDeck との互換(実装済み)

**状態: 実装済み(a7c4cc5)。実機確認も済み(2026-10-18)。** 変更は `src/interception.js`。`node --test tests/*.test.cjs` は 89 件通過。

発端は、README で案内している dimdenGD 版 Better TweetDeck(4.11.3)を併用すると、相互フォローバッジが通知と Mentions にしか出ず、認証済みのアカウントのバッジが消えること(2026-10-18)。BTD のソース(dimdenGD/BetterTweetDeck)と BTD の設定、5 分間の HAR で調べた。upstream の Issue には対応するものが無い。

### 7-a. 調査結果

- フォークの変更で、BTD の読み込みや TweetDeck 内部への差し込みが壊れる箇所は無い。両方が手を入れる次の箇所は両立する: x.com リンクの判定(Phase 5)と BTD の t.co 除去、取得間隔の下限(Phase 6)と BTD のカスタム時刻(30 秒周期の時刻更新タスクを止める)、`window.Notification` の差し替え(Phase 5)、各ルートの URL の組み立てと BTD が `include_entities` 付きの要求に足す ext 系の引数、postMessage。
- 残課題(未対応):
  - **Re-draft で長文の後半が消える**: Phase 3(31dc3bc)から、長文は `OTDenableAutoExpand` が `"1"` でない限り省略のまま。「Expand tweet」も表示だけを書き換え、chirp の `text` は省略のまま(`files/bundle.js` 55 行)。BTD の Re-draft は `chirp.text` から作成欄を作り、すぐに元の投稿を削除するので、280 字を超える自分の投稿では後半が失われる。upstream は常に全文にしていたので、フォークで起きるようになった。回避策は `localStorage.OTDenableAutoExpand = '1'`。修正案は、自分のアカウントの投稿だけ常に全文にすること。
  - **返信制限(conversation control)が効いているか未確認**: BTD は投稿のあとに、旧形式の `POST https://api.x.com/graphql/` で ConversationControlChange(`hb1elGcj6769uT8qVYqtjw`)を送る。OTD にこれを扱うルートは無く、そのまま X に届く。失敗しても BTD は何も表示しないので、制限したつもりの投稿が全員返信可のまま公開されうる。
  - **BTD が起動しないことがある(コードからの推定)**: BTD は document_idle に設定付きのスクリプトを `<head>` に入れる。OTD が文書を差し替える前に入ると要素ごと消え、BTD は何も出さずに起動しない(リロードで直る)。また BTD の対象は `https://x.com/i/tweetdeck` だけで、`?` 付きの URL では読み込まれない。
  - BTD の Advanced Mute Engine のフィルタは TweetDeck の設定に入るので、Phase 4 以降はキーワードミュートと同じくログインアカウントごとに保存される。

### 7-b. 相互フォローバッジが通知と Mentions にしか出ない

- 原因: BTD は `user.following` が true の人にだけ `friendships/show.json` を呼び、相互ならアイコンにバッジを付ける。X は GraphQL のユーザーで following / followed_by を `legacy` から `relationship_perspectives` に移した(HAR の Home に出てくる 129 人すべてがこの形で、`legacy.following` を持つ人は 0)。OTD は `legacy` をそのまま v1.1 のユーザーにしていたので、Home・リスト・検索などでは常に「フォローしていない」扱いだった。通知・Mentions の `all.json` のユーザーには `following` があり、そちらでは動いていた。同じ原因で、TweetDeck のツイートのメニューもフォロー中の相手に「Follow @…」と出していた。
- 対応(a7c4cc5): GraphQL のユーザーに `relationship_perspectives` から `following` / `followed_by` を付ける(`legacy` にすでにあればそのまま)。ツイートの作者、RT・引用の作者、`users/show`、ユーザー検索が対象。
- BTD の `friendships/show` は起動時に約 50 回増える(HAR の Home で 34 人分)。通知・Mentions の 19 回と合わせても、枠 800 回 / 15 分の 1 割程度。BTD は応答待ちの要求をまとめないので、同じ人の行が複数あると重複する。

### 7-c. 認証済みのアカウントのバッジが消える

- 原因: X は `verified` を立てず、チェックマークは `is_blue_verified` と `verification.verified_type`(Business / Government)で表す。OTD は GraphQL のユーザーで Blue を `verified` にしていた。BTD はこれを TweetDeck 標準のバッジとして扱い、「アイコンの上にバッジを表示」がオンだとカラム内では CSS で隠す。BTD 自身のバッジは `ext_is_blue_verified` / `ext_verified_type` から描くが、この欄は `all.json` のユーザーにしか無い。そのため BTD の「認証バッジ」(アイコン上の認証バッジ)がオフだと、Home などでは認証済みの人にバッジが一つも出なかった(HAR の Home で、ツイートの作者 116 人中 48 人)。
- Blue なしの Business アカウント(HAR で 1 人)は、`is_blue_verified` だけを見ていたため BTD が無くてもバッジが出ていなかった。
- 対応(a7c4cc5): GraphQL のユーザーに `ext_is_blue_verified` / `ext_verified_type` を付ける。`verified` は、BTD が動いているとき(`<body>` の `data-btd-ready`)は X の値のまま(現在は全員 false)にして BTD に描かせ、BTD が無いときは Blue・Business・Government のどれでも立てる。通知・Mentions のユーザーにも同じ規則を当てる(BTD が無いとき、通知でも Blue の人に標準のバッジが付く)。HAR の Home では、BTD があるときに BTD が描くバッジが 0 から 49(Blue 46、Business 3)になり、標準のバッジとの二重表示は無い。
- 副作用: BTD が動いているときは、カラムフィルタの「認証済みユーザーのみ」(`IS_FROM_VERIFIED`)が Blue の人を認証済みと見なさない(通知カラムでは以前から同じ)。
- 相互の行では、BTD の仕様で認証バッジが隠れる。BTD はアイコンの上にバッジを付けた行で、名前の横の自分のバッジを隠す。相互の判定は `friendships/show` の応答後なので、バッジは一度出てから消える。フォークでは扱わず、BTD の設定のカスタム CSS で残す(2026-10-18 に動作を確認):

```css
.btd-loaded[btd-badges-top-avatar='true'] .btd-badge.btd-mutual-badge .sprite.verified-badge {
    display: inline-block;
}
```

### Phase 7 のテスト

- 自動テスト(済み): `tests/user-state.test.cjs` に 8 件。following / followed_by が付くこと(RT と引用の作者も)、BTD が無いとき Blue・Business・Government が `verified` になること、BTD があるとき BTD が各チェックマークを一度だけ描くこと、X 自身の `verified` は BTD の有無にかかわらず残ること、`users/show` とユーザー検索も同じであること、`legacy` にすでにある following は残ること、通知・Mentions のユーザーが同じ規則に従うこと。8 件中 6 件は変更前のコードでは失敗する。
- 実機(2026-10-18): 認証バッジと相互フォローバッジが出ること、カスタム CSS で相互の行にも認証バッジが残ることを確認。

---

## Phase 8: カラムフィルタ「相互フォロー」(実装済み)

**状態: 実装済み(8d58466)。実機確認は未了。** 変更は `files/bundle.js`(20 行を同一行内で書き換え。行数は 76373 のまま)と `tests/mutual-follows.test.cjs`(新規)、`tests/user-state.test.cjs`(1 件追加)。`node --test tests/*.test.cjs` は 97 件通過。

発端は、Home カラムを相互フォローの相手だけに絞りたいという要望(フォーク独自。upstream の Issue には対応するものが無い)。カラム設定「Tweet authors」(`TD.vo.UserFilter`、`files/bundle.js` 30314-30426)でクライアント側に効くのは「specific user」(`TD.vo.Filter.SENDER`)と「verified users」(`TD.vo.Filter.IS_FROM_VERIFIED`)だけで、「users I follow」は通知・Mentions・Followers 限定のサーバ側フラグ(`filters=following`)のため、フォークのルートでは何もしない。Phase 7(a7c4cc5)で GraphQL のユーザーに `following` / `followed_by` を付けたのでデータは Home にも届いていたが、legacy の `TwitterUser.fromJSONObject`(40667-40726)は `following` しか読まず(40699)、`followed_by` を捨てていた。

### 8-a. 仕組み

- `TwitterUser` に `followedBy`(40699。GraphQL 形式の 40764 も)と `isMutualFollow()`(40801)を足した。`Boolean(following && followedBy)` で常に boolean。
- `TD.vo.UserFilter.FROM_MUTUAL = "mutual"`(30321)。`setFrom` の from_name クリア(30326)、`getSummaryText` の「by mutual follows」(30387)、`getFilters` での `IS_FROM_MUTUAL` 生成(30423)。`getQueryString`(30345-30358)は変えない: 検索演算子が無い。
- `TD.vo.Filter.IS_FROM_MUTUAL = "mutual"`(29744)。コンストラクタでは verified と同じ `exact = !0, filterTarget = "parent"`(29722): 通知の「いいね」などでは対象のツイートではなく行動した人を見る(`_getFilterTarget` 29829)。`pass` は `e.isFromMutualUser()` を `_testBoolean` に渡す(29789)。
- チャープ側: `ChirpBase.isFromMutualUser` は false(37465)。`TwitterStatus.isFromMutualUser`(38410)は RT した人(`this.user`)か元の作者(`getMainTweet().user`)のどちらかが相互、または自分(`isMe()`。カラムのアカウント基準)。`TwitterAction.isFromMutualUser`(41422)は `getCreator()` を見る。
- `_testBoolean`(29846-29852)は boolean 以外を渡すとフィルタを素通りさせる(lodash `isBoolean`)。そのため判定は厳密な boolean を返し、`relationship_perspectives` の無いユーザー(`followed_by` が undefined)は「相互でない」として隠れる。
- 引用ツイート: `TwitterStatus.passFilters`(38217-38222)はカラムのフィルタを引用先にも当てるため、verified と同じままだと相互の人が非相互の人を引用した投稿が隠れる。引用先には `IS_FROM_MUTUAL` だけ当てない(38220)。ミュートと他のカラムフィルタは従来どおり引用先にも効く。「specific user」「verified users」の挙動は変えていない。
- ヘッダの「Filtering by」アイコンは `hasActiveUserFilters`(29626)に `"mutual"` を足して出す(`getQueryString()` が空のため)。
- 選択肢は `getTweetsFromOptions`(60424-60456)に第 3 引数 `withMutualFollows` で足し(60420 / 60424 / 60454 / 60566)、`attachColumnFilters`(14691)で `withMutualFollows: !t`(`t` = 検索またはイベントカラム)として渡す。検索・イベントカラムでは `updateSearchFeedFilter`(29568-29580)がクエリ文字列の変化しか保存せず、`loadFilters`(29522-29526)が読む `model.getFilters()` も設定されないので、出しても選択が戻るだけになる。Home だけにするなら、2826 に `canFilterByUsersIFollow` と同じ形で `col_timeline` / `col_home` を見る関数を足し、14691 をそれに差し替える。
- 選択を変えると `loadFilters` がフィルタ id の違いを検知して `reloadTweets()`(カラムを空にして再取得)するので、表示中のカラムにも即反映される。保存は `filters.user.from_type` としてそのまま `OTDcolumns:<loginId>` に入る(`src/interception.js` の emulate ルートは変更なし)。
- Better TweetDeck の Advanced Mute Engine は `TD.vo.Filter.prototype.pass` を包んで元を `_pass` に退避し、AME 以外の種類は元に任せるので併用できる。BTD の相互判定(`friendships/show`)とは独立。

### 8-b. 判定の選び方(代替案)

- RT: RT した人か元の作者のどちらか(「specific user」の `getSenders` と同じ考え方)。verified と同じく元の作者だけにするなら 38410 の `e.isMe()` と `e.isMutualFollow()` の項を外す。RT した人だけにするなら `t` 側の項を外す。
- 自分の投稿: `isMe()` で通す(X は自分に `following: false` を返す)。隠すなら `isMe()` の項を外す。
- follow 状態が不明な人: 隠す。通すと `_testBoolean` の素通りと区別が付かなくなる。

### 8-c. 残課題

- 「users I follow」(`FROM_FOLLOWING`)はフォークでは無効のまま。同じ作りで `following` を見るクライアント側フィルタに置き換えられる。
- `followedBy` はアプリ内のフォロー・解除では更新されない(`follow()` / `unfollow()` は `following` だけ変える)。相手側の変化は再取得まで反映されない。
- 実機確認(下記)が未了。

### Phase 8 のテスト

- 自動テスト(済み): `tests/mutual-follows.test.cjs` に 7 件。定数・`pass` の分岐・要約文・ヘッダ判定・`followedBy` の読み込み・フォームの配線が bundle.js にあること、`isMutualFollow()` が両方 true のときだけ true で常に boolean であること、ツイートは作者か RT した人が相互なら通り自分の投稿も通ること、通知は行動した人で判定し他のチャープは通らないこと、`pass` が true を通し false を落とし boolean 以外を素通りさせること(厳密な boolean が必要な理由)、引用先には `IS_FROM_MUTUAL` だけ当てないこと、bundle.js の行数が 76373 のままであること。`tests/user-state.test.cjs` に 1 件: `relationship_perspectives` の無いユーザーは `following` / `followed_by` が undefined のまま(= 隠れる側)。
- 実機(未了): `localStorage.OTDalwaysUseLocalFiles = '1'` で、Home の Tweet authors に「mutual follows」が出ること(verified users の次)、選ぶと相互の人・自分・相互が絡む RT だけになり、要約が「by mutual follows」になりヘッダに Filtering by のアイコンが出ること、相互の人が非相互の人を引用した投稿が残ること、リロード後も残ること(`OTDcolumns` の `filters.user.from_type`)、通知・Mentions・リストでも効き検索カラムには出ないこと、BTD 併用時に相互バッジと結果が一致すること。

---

## 対応しない / できないもの

- **X 側の仕様・運用**: #551(Teams からの投稿で凍結)、#529(X Pro が Premium+ 限定)、#522(検索演算子の制限。upstream 作者も X 側と判断)、#506(DM は新 Chat に移行。upstream 作者が「修正不可能」と明言)、#492(アカウント制限。同系統の #469 は close 済み)、#462 / #510 / #259(Teams 招待。X の delegate 挙動)、#517 / #495(レート制限。Phase 1 で無駄なリクエストを減らして緩和はできる。Phase 6 で通知カラムも残り回数に合わせて減速するようにした)
- **upstream 依存(Patreon 版)**: #515(Patreon 連携後に List がほとんど読み込まれない。報告者・コメント者とも連携ユーザーで、連携前は読み込めていた)
  - `src/injection.js` 168-188 が、Patreon のトークンを付けて `oldtd.org/api/scripts` から追加スクリプトを読み込む。トークンなしで返るのは `auth.js`(連携 UI)だけで、支援者向けの修正はこのリポジトリに無いため、検証も修正もできない。
  - 回避策: 設定の Patreon「Logout」で連携を外すと公開版の List ルートに戻る(レート制限回避は失われる)。
  - フォークでも連携ユーザーにはこのスクリプトが読み込まれ、Phase 1 で直した List ルートを上書きしている可能性がある(相性は不明)。必要なら「追加スクリプトを読み込まない」設定を検討する。#530 の報告者も Patreon 版を使っている。
- **議論・質問**: #519, #503, #516, #508
- **機能要望(後回し)**: #542 自動翻訳(外部実装あり: kik0220/OldTweetDeck-fork の auto-translation ブランチ)、#535 ブックマークオプション、#534 アップロード上限、#233 検索カラム手動リロード、#231 For you カラム、#221 通知音、#212 fxtwitter、#211 スマートリプライ、#204 ショートカット、#148 Firefox 署名、#102 スタンドアロンアプリ、#18 Safari

---

## 進め方

- Phase ごとに PR を分け、`tests/` に `node:test` のケースを足す。実行は `node --test tests/*.test.cjs`。
- Phase 1 から Phase 5 までの実機確認は 2026-10-17 に問題なし。Phase 6 は 2026-10-18 に取得間隔だけ確認し、目視とブックマーク、フォローのまとめ通知(6-d)の確認が残っている。Phase 7 は 2026-10-18 に確認済み。Phase 8(相互フォローのフィルタ)は実機確認が未了。
- 残りは upstream への PR、Phase 5 で未対応の #321、Phase 6 の残課題(Home のクエリ ID)、Phase 7 の残課題(長文の Re-draft、返信制限の確認)、Phase 8 の残課題(「users I follow」のクライアント側への置き換え)。
- upstream へは #554(RTL)、#552(Mentions)、Phase 1(92f0be5 / bfcbdd3)の順で PR を出す。起動ハングの修正は limex 氏の #562 が未マージで close されているので、出すならクレジット付きで出し直す。
