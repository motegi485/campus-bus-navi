# campus-bus-navi バックエンド — 開発引き継ぎ一式（HANDOFF）

このフォルダの中身さえ揃っていれば、バックエンドBot（時刻表自動取り込み）の開発に着手できます。
**正本は `BACKEND_REQUIREMENTS.md`（v1.3）**。仕様で迷ったら常にこれを参照。

---

## 同梱ファイルと配置先

| ファイル | 役割 | リポジトリ配置先 |
|---|---|---|
| `BACKEND_REQUIREMENTS.md` | **要件定義書（実装の正本）**。Claude Code に読み込ませる | 任意（例: `docs/` か `bot/REQUIREMENTS.md`） |
| `page_snapshot.html` | 大学ページの凍結スナップショット（イベント含む3リンク版）。抽出・分類テスト用 | `bot/fixtures/page_snapshot.html` |
| `timetable_weekday.json` | 正解データ（通常・授業日）。本番データと一致確認済み | `bot/fixtures/expected/timetable_weekday.json` |
| `timetable_holiday.json` | 正解データ（通常・休業日）。本番データと一致確認済み | `bot/fixtures/expected/timetable_holiday.json` |
| `timetable_event_20260614.json` | 正解データ（イベント・簿記検定）※歴史的 | `bot/fixtures/expected/timetable_event_20260614.json` |
| `timetable_event_20260620.json` | 正解データ（イベント・オープンキャンパス）※歴史的 | `bot/fixtures/expected/timetable_event_20260620.json` |
| `intermediate_regular.json` | OCR中間構造の正解（通常）→ `regular.json` にリネーム | `bot/fixtures/intermediate/regular.json` |
| `intermediate_event_20260614.json` | OCR中間構造の正解（簿記）→ `event_20260614.json` にリネーム | `bot/fixtures/intermediate/event_20260614.json` |
| `intermediate_event_20260620.json` | OCR中間構造の正解（OC）→ `event_20260620.json` にリネーム | `bot/fixtures/intermediate/event_20260620.json` |
| `R8スクールバス時刻表.jpg` | 元画像（通常ダイヤ）。出所保全（provenance）用 | `bot/fixtures/images/` |
| `0614_簿記-724x1024.jpg` | 元画像（簿記）。provenance 用 | `bot/fixtures/images/` |
| `0620_オープンキャンパス-724x1024.jpg` | 元画像（OC）。provenance 用 | `bot/fixtures/images/` |

> リネーム: `intermediate_*.json` は配置時に接頭辞を外す（`intermediate/regular.json` 等）。
> 中身は変更しないこと。

---

## このフォルダに「入っていない」もの（理由つき）

- **`BACKEND_DESIGN.md`（旧設計ドラフト）**: 内容は要件定義書 v1.3 に統合・上書き済み。旧ドラフトには
  既に訂正した誤り（`@google/generative-ai`／temperature 0／2カテゴリ／旧パス）が残るため、
  混乱回避のため**意図的に同梱しません**。
- **Claude Code が自動生成するフィクスチャ**: `bot/fixtures/holidays_sample.csv`（Shift_JIS）、
  `bot/fixtures/calendar_rules_live.json`（HEAD からコピー）、`bot/holidays.json`（内閣府CSV取得）は
  Claude Code 側で生成する（要件定義書 §16.2 C-5/C-6）。人間が用意する必要なし。
- **Bot のソースコード一式**: これから Claude Code が実装する（要件定義書 §7・§8）。

---

## 画像が「見る用」でしかない理由

Claude Code は画像を閲覧できない。よってテストは**画像そのものではなく、画像から起こした
JSONフィクスチャ（expected/ と intermediate/）**に対して走る。同梱の元画像3枚は、ライブの
大学ページから削除された後でも正解データの出所を辿れるようにする **provenance（監査用）** であり、
テストでは使用しない。

## page_snapshot.html を「あえて古い版」にしている理由

ライブのページからイベント画像は既に削除されている（イベント終了後に消える運用）。だが
extractLinks / classify のテストは「regular と event を正しく見分けられるか」を検証する必要がある。
ライブを取り直すとイベントが無くなりテストの前提が崩れるため、**イベントを含む3リンクの歴史的
スナップショットを固定**して使う。実環境の受け入れ基準（要件定義書 §12.3）は別途「通常ダイヤのみ」の
現状に合わせてある。

---

## 着手の最短経路（詳細は要件定義書 §17）

1. （人間）`bot/fixtures/` に上記ファイルを配置（expected×4 / intermediate×3 / page_snapshot.html / images×3）。
2. （人間）Google AI Studio で `GEMINI_API_KEY` を発行（§16.3 H-1）。
3. （Claude Code）Phase 0：`bot/` 雛形＋抽出・分類・祝日・state・**ドライラン**＋テスト。
4. （Claude Code）Phase 1：OCR・組立・検証・calendar・PR本文＋テスト。
5. （人間）GitHub に `GEMINI_API_KEY` 登録＋「Allow GitHub Actions to create and approve pull requests」を有効化（§16.3 H-2/H-3、**忘れると初回PR作成が失敗**）。
6. 初回 workflow 実行 → PR を人間がレビュー＆マージ → デプロイ確認。

ローカル（Windows 11 / PowerShell）ドライラン例:
```powershell
cd bot
npm install
$env:DRY_RUN="1"
npx tsx src/index.ts
```
