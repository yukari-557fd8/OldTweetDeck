# 修正ロードマップ(upstream Issue 棚卸し: 2026-10-17 時点)

対象: [dimdenGD/OldTweetDeck](https://github.com/dimdenGD/OldTweetDeck) の open Issue 67 件(2026-10-17 に `gh issue list` で取得)。67 件すべてを下のいずれかの節に分類している。
本フォークは upstream `main`(8bcb4bb)+ 17 コミット(582c857 時点)。

行番号は 92f0be5 時点の `src/interception.js`(Phase 1 の 1-a〜1-e だけは修正前の 97693c7 時点)。Phase 2〜4(f8dc681 / 31dc3bc / 582c857)で変更したため、現在のファイルとは一致しない。`files/bundle.js`・`src/challenge.js`・`src/injection.js` は変更していないので行番号はそのまま使える。

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
- Phase 1 から Phase 4 までの実機確認は 2026-10-17 に問題なし。
- 残りは Phase 5(起動・環境)と upstream への PR。
- upstream へは #554(RTL)、#552(Mentions)、Phase 1(92f0be5 / bfcbdd3)の順で PR を出す。起動ハングの修正は limex 氏の #562 が未マージで close されているので、出すならクレジット付きで出し直す。
