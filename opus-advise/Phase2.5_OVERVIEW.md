# Phase 2.5 — 全体概要 & タスクインデックス

> **作成日**: 2026-03-19
> **目的**: Phase 2.5 の作業を Claude に渡すためのインデックスファイル
> **対象リポジトリ**: `/Users/szk/Desktop/APP/slackSFA`

---

## フェーズの目標

Phase 2.5 は **「品質・セキュリティの底上げと本番準備」** がテーマ。
新機能追加よりも、既存コードの堅牢化を最優先とする。

---

## タスク一覧（実行推奨順）

| # | タスクファイル | 内容 | 優先度 | 依存 |
|---|-------------|------|--------|------|
| 1 | `TASK_01_RLS_SESSION_FIX.md` | RLS セッション管理の脆弱性修正 | 🔴 最優先 | なし |
| 2 | `TASK_02_CLEANUP_DEPS.md` | 未使用依存パッケージ & AI モデル方針の統一 | 🟡 高 | なし |
| 3 | `TASK_03_DROP_LEADS.md` | leads テーブル完全廃止 & API 統一 | 🟡 高 | TASK_01 |
| 4 | `TASK_04_TEST_FOUNDATION.md` | テスト基盤構築（vitest + supertest） | 🟡 高 | TASK_01, 03 |
| 5 | `TASK_05_TERRAFORM.md` | Terraform IaC 初版作成 | 🟢 中 | なし |
| 6 | `TASK_06_ENRICHMENT.md` | URL → AI 自動補完（accounts エンリッチメント） | 🟢 中 | なし |
| 7 | `TASK_07_BLOCK_KIT_VIEWS.md` | Slack Block Kit Views & Slash Commands | 🟢 中 | TASK_03 |
| 8 | `TASK_08_DEAL_COACHING.md` | 商談クロージング AI コーチ（達成率 + ネクストアクション提案） | 🟡 高 | TASK_03 |

---

## 共通ルール

### コード変更のルール
1. **直接コードを書き換えてよい** — 各タスクファイルの指示に従ってコードを変更する
2. **マイグレーションファイルは追番で作成** — 次は `008_` から
3. **既存のテストが壊れないこと** を確認する（`npm test` / Playwright）
4. **TypeScript の strict モードに準拠** する

### ファイルパス規約
- API ソースコード: `/Users/szk/Desktop/APP/slackSFA/api/src/`
- Web ソースコード: `/Users/szk/Desktop/APP/slackSFA/web/src/`
- マイグレーション: `/Users/szk/Desktop/APP/slackSFA/api/src/db/migrations/`
- インフラ: `/Users/szk/Desktop/APP/slackSFA/infra/terraform/`
- テスト: `/Users/szk/Desktop/APP/slackSFA/tests/`

### 技術スタック
- **API**: Node.js + TypeScript + Express + Slack Bolt SDK
- **DB**: PostgreSQL 15（Cloud SQL）、RLS でマルチテナント
- **AI**: Anthropic Claude（Haiku: NLU/分析、Sonnet: 下書き生成）
- **Web**: Vite + Vue 3 SPA
- **インフラ**: GCP（Cloud Run, Cloud SQL, Secret Manager, IAP）
- **CI/CD**: GitHub Actions + Cloud Build
