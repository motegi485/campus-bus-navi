-- 発車リマインダーのデータ。
--
--   npx wrangler d1 execute campus-bus-navi --remote --file=src/schema.sql
--
-- 二層構造になっている:
--   subscriptions … 端末そのもの。設定画面のトグル（通知の根幹の許可）で作られ、消される
--   reminders     … 「どの便に何分前」。ホーム画面の時刻表で指定する。**当日限り**
--
-- 分けている理由は、1 台の端末が同じ日に複数の便を指定できるため。端末を主キーに
-- した 1 テーブル構成では 1 件しか持てない。
--
-- アカウントもユーザー識別子も持たない。学内配布ポスターの「登録不要」と衝突しない。

CREATE TABLE IF NOT EXISTS subscriptions (
  -- endpoint の SHA-256（16 進）。再購読で自然に上書きされ、重複が構造的に生まれない
  id          TEXT PRIMARY KEY,
  endpoint    TEXT NOT NULL,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  created_at  INTEGER NOT NULL   -- epoch ミリ秒
);

CREATE TABLE IF NOT EXISTS reminders (
  -- subscription_id + date_key + route + departure から決定的に作る。
  -- 同じ便を二度指定しても行が増えない
  id              TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL,
  -- 対象日（"YYYY-MM-DD" / JST）。当日限りなので、この日を過ぎた行は掃除する
  date_key        TEXT NOT NULL,
  route           TEXT NOT NULL,     -- 'campus_to_station' | 'station_to_campus'
  departure       TEXT NOT NULL,     -- "HH:mm"
  lead_minutes    INTEGER NOT NULL,  -- 5 | 10 | 15 | 20
  -- 送信を始めてよい瞬間（= 発車時刻 − lead_minutes）の epoch ミリ秒。
  -- 登録時に計算して持つ。これが無いと Cron が「無順序で N 件に切ってから
  -- TypeScript で due 判定」になり、上限内を未到来の行が占めたときに
  -- 上限外の本当に送るべき行を読まない（飢餓）
  notify_at       INTEGER NOT NULL,
  -- 送信済みなら epoch ミリ秒。二重送信を防ぐ番人
  sent_at         INTEGER,
  FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE CASCADE
);

-- Cron は毎分「今日ぶんで未送信、かつ送信の窓
-- （[notify_at, notify_at + lead_minutes × 60000)）の中にある行」を notify_at 順に引く。
-- 全行スキャンを避けて D1 の行読み取り（無料枠 500 万行/日）を節約しつつ、
-- 1 実行あたりの上限に当たっても「最も早く送るべき行」から処理できる
CREATE INDEX IF NOT EXISTS idx_reminders_pending ON reminders (date_key, sent_at, notify_at);
-- 端末の解除時に、その端末のリマインドをまとめて消すため
CREATE INDEX IF NOT EXISTS idx_reminders_subscription ON reminders (subscription_id);
