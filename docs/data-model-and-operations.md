# 静的データと運用

## データ配置

利用者向けアプリのデータはすべて `public/data/` に置きます。Vite は `public/` の内容をビルド出力へコピーします。

```text
public/data/
├── calendar_rules.json
├── news.json
├── timetables/
│   ├── timetable_weekday.json
│   ├── timetable_holiday.json
│   ├── timetable_closed.json
│   ├── timetable_special.json
│   └── timetable_*.json
└── _examples/
    ├── timetable_vacation_SEASON_weekday.json
    ├── timetable_vacation_SEASON_holiday.json
    ├── timetable_event_YYYYMMDD.json
    └── timetable_sample.json
```

`_examples/` は新しいダイヤを作るためのテンプレートであり、アプリは読みません。`validate:data` の検証対象でもありません。ただし `public/` 配下なので、ビルド成果物にはコピーされます。

## `calendar_rules.json`

```json
{
  "default_rules": {
    "0": "timetable_holiday",
    "1": "timetable_weekday"
  },
  "overrides": {
    "YYYY-MM-DD": "timetable_event_YYYYMMDD"
  }
}
```

- `default_rules` は曜日を表す文字列キー `"0"` から `"6"` をすべて持ちます。`0` は日曜、`6` は土曜です。
- `overrides` は空でも必須です。特定日の値は曜日規則より優先されます。
- override のキーは実在する `YYYY-MM-DD`、値は `public/data/timetables/<ID>.json` に対応する ID でなければなりません。
- アプリは端末から祝日 API を参照しません。休日・授業日の例外はこのファイルで表します。

## 時刻表 JSON

各ファイルは `src/types/timetable.d.ts` の `Timetable` に対応します。

```json
{
  "id": "timetable_weekday",
  "name": "通常の授業日ダイヤ",
  "routes": {
    "station_to_campus": {
      "origin": "松永発",
      "destination": "大学行き",
      "bus_stop_name": "松永 バス乗り場",
      "bus_stop_coords": { "lat": 34.0, "lng": 133.0 },
      "schedule": [{ "departure": "08:00", "note": "" }]
    },
    "campus_to_station": {
      "origin": "大学発",
      "destination": "松永行き",
      "bus_stop_name": "大学 バス乗り場",
      "bus_stop_coords": { "lat": 34.0, "lng": 133.0 },
      "schedule": [{ "departure": "08:10", "note": "" }]
    }
  }
}
```

必須事項は次のとおりです。

- `id` はファイル名から `.json` を除いた値と一致させる。
- 2 路線 `station_to_campus` と `campus_to_station` を必ず持つ。
- `origin`、`destination`、`bus_stop_name` は空でない文字列、座標は数値とする。
- `departure` は 24 時間表記の `HH:mm`（`00:00` から `23:59`）、`note` は文字列とする。
- 発車時刻は昇順に並べる。同時刻は警告ですが、逆順は検証エラーです。
- `bus_stop_coords` と `schedule` の各要素は、既存の JSON 整形スタイルに合わせて 1 行で保つ。Bot が触るファイルで整形を一括変更すると、Bot の自動コミットが全行差分になり、いつ何時が変わったのかを履歴から追えなくなります。

## ダイヤ種別と命名規約

UI のダイヤ種別は時刻表 ID の部分文字列から判定します。判定順序を変えると表示が変わります。

| ID の条件 | UI 上の種別 |
|---|---|
| `closed` を含む | 全便運休日 |
| `special` を含む | 特別ダイヤ |
| `event` を含む | イベント日ダイヤ |
| `vacation` と `holiday` を含む | 長期休暇ダイヤ（休日） |
| `vacation` と `weekday` を含む | 長期休暇ダイヤ（平日） |
| `vacation` を含む | 長期休暇ダイヤ |
| `holiday` を含む | 休業日ダイヤ |
| 上記以外 | 授業日ダイヤ |

`vacation_*_holiday` には `holiday` も含まれるため、`vacation` を `holiday` より先に評価することが必須です。

### 空の `schedule` を使う二つの状態

`timetable_closed.json` と `timetable_special.json` は両路線の `schedule` を空配列にします。それ以外の時刻表を空にしてはいけません。

| ID | 表示 | 使う場面 |
|---|---|---|
| `timetable_closed` | 「本日の運行はありません」と翌日始発 | 両路線とも全便運休 |
| `timetable_special` | 時刻を表示せず大学公式ページへ誘導 | 片方向だけの情報、但し書き付きなど、既定 JSON で安全に表現できない日 |

両者とも空配列ですが、描画では `special` を先に判定します。特別ダイヤを全便運休日として扱う変更は誤案内になります。

## `news.json`

お知らせは配列です。各項目は以下を持ちます。

| フィールド | 要件 |
|---|---|
| `id` | 重複しない数値 |
| `tag` | `important` / `info` / `change` / `event` のいずれか |
| `tagLabel`、`date`、`title`、`preview`、`body` | 空でない文字列 |
| `unread` | boolean |

通常は新しい項目を配列の先頭に追加します。`body` は HTML として描画されるため、信頼できる内容だけを入れてください。外部入力を直接入れる運用には対応していません。

## 更新手順

### 通常のダイヤ改正

1. 対象の時刻表 JSON を更新する。新規の場合は `_examples/` から構造をコピーする。
2. `id` とファイル名を一致させ、両方向の時刻・乗り場・座標を確認する。
3. 特定日なら `calendar_rules.json` の `overrides` に実在日と時刻表 ID を追加する。曜日規則を変える場合は `default_rules` を更新する。
4. `npm run validate:data` を実行する。
5. 実装や配信の仕組みにも影響する場合は、関連する `docs/` を更新する。

### 全便運休・特別ダイヤ

- 全便運休は `overrides` に `timetable_closed` を指定します。
- 時刻を確定できない、または片方向だけの情報で安全に表現できないときは `timetable_special` を指定します。
- 「推測で既存便を補う」ことはしません。読める日だけ別の通常時刻表を作り、個別 override を設定する方法を優先します。

### Bot が関与するデータ

Bot は `timetable_weekday`、`timetable_holiday`、所定の `timetable_vacation_*_{weekday,holiday}`、`timetable_event_YYYYMMDD` だけを管理対象にします。`timetable_closed.json`、`timetable_special.json`、`_examples/` は Bot の書込対象ではありません。

Bot が管理した override を人が変更または削除すると、その日付は以後 Bot による再生成を抑止されます。Bot の運用・手動 override の優先順位は [backend-bot.md](backend-bot.md) と Bot 正本を必ず確認してください。

**2026-08-16 以降、Bot の変更は人間のレビューを経ずに `main` へ直接コミットされます。** そのため、これらのファイルを手で編集している最中に Bot の日次実行（07:00 JST）が同じファイルを書き換えることがあります。作業前に最新の `main` を取り込み、コンフリクトしたときは「どちらが新しい掲示に基づくか」で判断してください。手動 override と保護ファイルは Bot が触らないので、恒久的に固定したい内容はそちらに置きます。

## ビルド前検証

`npm run validate:data` は `scripts/validate-data.mjs` を実行し、次を検証します。

- カレンダーの曜日キー、`overrides` の存在、実在日、参照先時刻表の存在
- ファイル名と時刻表 `id` の一致、2 路線の必須項目、座標、`schedule` の形式
- `closed` / `special` だけが空 `schedule` であること
- 時刻形式、昇順、`note` の型
- お知らせの ID、タグ、必須フィールド、`unread` の型

ランタイムの `normalizeTimetable()` は、不正な `departure` を除外して並べ替える最低限の防御です。ビルド前検証ほど全フィールドを保証しないため、静的データの更新時は必ず `validate:data` を通してください。

## 関連文書

- データを読むアプリ側: [architecture.md](architecture.md)
- 更新時の品質確認: [verification.md](verification.md)
- キャッシュと配信: [pwa-and-deployment.md](pwa-and-deployment.md)

## 通知の購読データ（D1）

静的 JSON とは別に、発車前の通知だけが D1 を使います。スキーマの正本は `server/src/schema.sql` で、設計の背景は [backend-push.md](backend-push.md) にあります。

| テーブル | 内容 | 作られる契機 | 消える契機 |
|---|---|---|---|
| `subscriptions` | 端末の push 購読（endpoint と鍵） | 設定画面のトグルをオン | トグルをオフ、または push サービスが 404 / 410 を返したとき |
| `reminders` | 「どの便に何分前」。当日限り | 本日の全時刻表で便を指定 | 日付が変わる、トグルをオフ、端末が失効 |

- 氏名・メールアドレス・学籍番号などの個人情報は扱わず、アカウントもユーザー識別子も持ちません。
- `subscriptions.id` は endpoint の SHA-256 で、再購読時に同じ行を上書きします。`reminders.id` は `subscription_id + date_key + route + departure` から決定的に作り、同じ便を二度指定しても行が増えません。
- 端末の失効（404 / 410）を検知したら、その端末の `reminders` も一緒に削除します。残すと配信のたびに無駄なサブリクエストを使います。
