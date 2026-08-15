-- 発車リマインダーの購読。
--
--   npx wrangler d1 execute campus-bus-navi --file=src/schema.sql          (ローカル)
--   npx wrangler d1 execute campus-bus-navi --remote --file=src/schema.sql (本番)
--
-- アカウントもユーザー識別子も持たない。保持するのは push サービスのエンドポイントと
-- 通知の条件だけで、学内配布ポスターの「登録不要」というコピーと衝突しない。

CREATE TABLE IF NOT EXISTS subscriptions (
  -- endpoint の SHA-256（16 進）。同じ端末が再購読したとき自然に上書きされ、
  -- 重複行が構造的に生まれない。endpoint 自体は長いので主キーには使わない
  id            TEXT PRIMARY KEY,
  endpoint      TEXT NOT NULL,
  p256dh        TEXT NOT NULL,
  auth          TEXT NOT NULL,

  route         TEXT NOT NULL,     -- 'campus_to_station' | 'station_to_campus'
  mode          TEXT NOT NULL,     -- 'last_bus' | 'fixed_time'
  departure     TEXT,              -- mode='fixed_time' のとき "HH:mm"
  lead_minutes  INTEGER NOT NULL,  -- 5 | 10 | 15 | 20
  days_mask     INTEGER NOT NULL,  -- 曜日ビットマスク（日=1 … 土=64）

  created_at    INTEGER NOT NULL,  -- epoch ミリ秒
  -- 最後に送信した日（"YYYY-MM-DD" / JST）。Cron が同じ分に二度走っても
  -- 二重送信しないための番人
  last_sent_on  TEXT
);

-- Cron は毎分「今日まだ送っていない購読」だけを引く。全行スキャンを避けて
-- D1 の行読み取り（無料枠 500 万行/日）を節約する
CREATE INDEX IF NOT EXISTS idx_subscriptions_pending ON subscriptions (last_sent_on);
