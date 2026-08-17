-- reminders.notify_at の追加（2026-08-18）
--
-- 既に schema.sql を適用済みの D1 を、現在の schema.sql と同じ形へ揃えるための差分。
-- **新規に作るデータベースには不要**（schema.sql に既に含まれている）。
--
--   npx wrangler d1 execute campus-bus-navi --remote --file=migrations/0001_add_notify_at.sql
--
-- なぜ要るか: Cron は以前「当日の未送信を無順序で 2,000 件に切ってから」TypeScript 側で
-- due 判定していた。上限内を未到来の行が占めると、上限外にある本当に送るべき行を読まない。
-- notify_at（= 発車時刻 − lead_minutes）を持たせて SQL 側で絞り込み・並べ替える。
--
-- 適用は人間が行う。実行前に対象データベース名と `--remote` の有無を確認すること。

-- 1. 列を追加する。既存行には既定値 0 を入れておき、次の UPDATE で埋め直す
--    （NOT NULL 制約付きの ALTER TABLE ADD COLUMN には既定値が要る）
ALTER TABLE reminders ADD COLUMN notify_at INTEGER NOT NULL DEFAULT 0;

-- 2. 既存行の notify_at を埋める。
--    date_key（JST の "YYYY-MM-DD"）の 00:00 JST は UTC の 9 時間前なので、
--    julianday(date_key) を epoch 秒へ直してから 9 時間を引き、
--    departure の "HH:mm" と lead_minutes を分単位で足し引きする。
UPDATE reminders
SET notify_at = CAST(
      ((julianday(date_key) - 2440587.5) * 86400.0
        - 9 * 3600
        + CAST(substr(departure, 1, 2) AS INTEGER) * 3600
        + CAST(substr(departure, 4, 2) AS INTEGER) * 60
        - lead_minutes * 60) * 1000
    AS INTEGER)
WHERE notify_at = 0;

-- 3. 索引を張り直す（date_key, sent_at, notify_at）
DROP INDEX IF EXISTS idx_reminders_pending;
CREATE INDEX IF NOT EXISTS idx_reminders_pending ON reminders (date_key, sent_at, notify_at);
