# システム詳細ドキュメント

このディレクトリは、開発者、運用引継ぎ担当者、AI エージェントが `campus-bus-navi` を正確に理解し、変更の影響を判断するための文書群です。利用者向けの説明はリポジトリ直下の [README.md](../README.md) を参照してください。

## 読み始める順序

| 作業 | 先に読む文書 |
|---|---|
| 全体像を把握する | [architecture.md](architecture.md) |
| 時刻表、カレンダー、お知らせを更新する | [data-model-and-operations.md](data-model-and-operations.md) |
| PWA、キャッシュ、Cloudflare Pages を変更する | [pwa-and-deployment.md](pwa-and-deployment.md) |
| 実装を始める、品質確認をする | [development-guide.md](development-guide.md)、[verification.md](verification.md) |
| 意図を持つ安全設計や UI の前提を変える | [design-decisions.md](design-decisions.md) |
| 時刻表自動取り込み Bot を扱う | [backend-bot.md](backend-bot.md) と Bot 正本 |

## 文書一覧

- [architecture.md](architecture.md) — フロントエンドの責務、状態、データフロー、主要コンポーネント
- [data-model-and-operations.md](data-model-and-operations.md) — 静的 JSON の形式、命名、更新運用、検証不変条件
- [pwa-and-deployment.md](pwa-and-deployment.md) — サービスワーカー、キャッシュ、更新、Cloudflare Pages 配信
- [development-guide.md](development-guide.md) — 開発環境、コマンド、変更別チェックリスト
- [design-decisions.md](design-decisions.md) — 誤表示を防ぐ設計判断、モバイル・アクセシビリティ上の注意点
- [backend-bot.md](backend-bot.md) — Bot の構成、安全境界、運用への入口
- [verification.md](verification.md) — 検証範囲、品質ゲート、未検証状態の扱い

## 正本と確認の原則

この文書群は、現在の実装を読んで作成・更新する案内です。記載と実装が食い違う場合は、次の順で扱います。

1. 現在の実行時挙動は、ソースコード、`public/data/`、設定ファイル、検証器で確認する。
2. Bot の要件・安全境界は [BACKEND_REQUIREMENTS.md](../bot/fixtures/_planning/BACKEND_REQUIREMENTS.md) が正本である。実装と要件が食い違う場合は、意図を推測して片方に合わせず、根拠を示して修正方針を確認する。
3. 日々の Bot の状態と次の人間作業は [HANDOFF.md](../bot/fixtures/_planning/HANDOFF.md) を読む。ただし GitHub の有効化状態、Secrets、権限、実行結果は外部状態なので GitHub UI で再確認する。
4. この `docs/` は、上記の実装・正本に到達するための設計・運用ガイドである。README は利用者向けの表面情報であり、実装仕様の正本ではない。

## 文書を更新するタイミング

- 実装、静的データ、設定、配信、外部連携、検証方法を変更したら、同じ変更内で該当文書を更新する。
- Bot の要件、ワークフロー、Runbook に影響する変更では、`backend-bot.md` と必要に応じて Bot 正本・引継ぎ文書も更新する。
- デプロイ済み、実機確認済み、GitHub 設定済みなどの状態は、確認日・確認方法を伴わない限り「現在の事実」として書かない。
- 新しいドキュメントを追加したら、この索引と `AGENTS.md` / `CLAUDE.md` の導線も見直す。

