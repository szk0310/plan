# SlackSFA プロジェクト HANDOFF
**最終更新：2026年4月19日**

---

## プロジェクト概要

Slack 完全統合型 AI-CRM「SlackSFA」の自社開発。Salesforce の代替として社内で使いながら、将来的に SaaS 外販を目指す。

**核心価値：** CRM の入力は Slack で 30 秒。あとは AI が顧客との関係を温める。

**リポジトリ：** `szk0310/slackSFA`
**本番 API：** `https://slacksfa-api-808596335261.asia-northeast1.run.app`
**本番 Web：** `https://slacksfa-web-808596335261.asia-northeast1.run.app`

---

## Phase 2.5 完了状況（2026年3月20日 完走）

| タスク | 内容 | 状態 |
|:---|:---|:---|
| TASK_01 | RLS セッションリーク修正（withTenant + SET LOCAL） | ✅ |
| TASK_02 | 不要依存削除（Gemini/OpenAI）、vitest 導入 | ✅ |
| TASK_03 | leads テーブル廃止・contacts 統合（lifecycle_stage） | ✅ |
| TASK_04 | テスト基盤（vitest + client/intent-parser/contact.service テスト） | ✅ |
| TASK_05 | Terraform IaC（GCP Cloud Run + Cloud SQL + VPC + Secrets） | ✅ |
| TASK_06 | エンリッチメント（Claude Haiku + NLU 自動トリガー） | ✅ |
| TASK_07 | Slack Block Kit（/crm-list + コンタクト詳細モーダル） | ✅ |
| TASK_08 | 商談コーチング AI（MEDDPICC 8要素評価） | ✅ |

---

## Phase 3 完了状況（2026年3月23日）

### TASK_10：確率エンジン ✅

- センチメント駆動の確率エンジン（sentiment-analyzer + probability-engine）
- 商談ステージ 3値化（open / won / lost）
- 時間減衰ロジック（7日未接触で自動低下、毎朝ブリーフィングに組み込み）
- Slack チャンネル監視（/crm-link + channel_links + バッチ分析）

### TASK_13：AI Flow ビュー ✅

顧客・ナーチャリング・商談の3画面を「件名」をキーにした1画面に統合完了。

**実装内容:**

| ファイル | 内容 |
|:---|:---|
| `api/src/services/flow-subject.ts` | AI（Haiku）による件名自動生成 + 一括バックフィル |
| `api/src/services/probability-engine.ts` | `runDiscardedCleanup()` 追加（廃棄30日後自動削除 + 1日前警告） |
| `api/src/services/contact.service.ts` | コンタクト登録時に `upsertAccount` + `generateFlowSubject` を呼び出す |
| `api/src/slack/commands/crm-list.ts` | `/crm` コマンド追加、`buildFlowBlocks()` 実装 |
| `api/src/slack/views/flow-detail.ts` | AI Flow 詳細モーダル（件名・確率・タイムライン・推奨アクション） |
| `api/src/slack/views/note-modal.ts` | メモ追加モーダル（ナビゲーション付き） |
| `api/src/slack/views/edit-modal.ts` | 顧客編集モーダル（stage: 4値のみ表示） |
| `api/src/routes/api.ts` | `GET /api/flows`、`GET /api/flows/:contactId`、Dashboard 3エンドポイント追加 |
| `api/src/config/crm-labels.ts` | `LIFECYCLE_LABELS` 更新（育成中/商談中/休眠/廃棄） |
| `api/src/index.ts` | `view_flow_detail`、`runDiscardedCleanup`、crm_list_paginate の flow 対応 |
| `web/src/views/FlowList.vue` | AI Flow 一覧（件名・確率・最終活動・ページネーション・ソート） |
| `web/src/views/FlowDetail.vue` | AI Flow 詳細（確率推移グラフ・MEDDPICC レーダー・タイムライン） |
| `web/src/views/Dashboard.vue` | 確率分布・センチメントサマリー・推奨アクション TOP5 追加 |
| `web/src/views/ContactList.vue` | CRUD 削除、基礎情報のみ表示（電話/メール/SlackID/ステージ） |
| `web/src/router/index.ts` | `/flow`、`/flow/:id` 追加。/deals・/nurturing → /flow リダイレクト |
| `web/src/App.vue` | AI Flow ロゴ + 新メニュー（ダッシュボード/AI Flow/顧客/会社/分析） |
| `web/src/lib/api-client.ts` | `FlowItem`・`FlowDetail` 型追加、`flows()`・`flowDetail()` メソッド追加 |

**削除されたファイル:**
- `web/src/views/NurturingList.vue`
- `web/src/views/DealBoard.vue`
- `web/src/views/DealDetail.vue`（グラフは FlowDetail.vue に移植）

### 実行済み DB マイグレーション（Phase 3）

| ファイル | 内容 | ローカル | 本番 |
|:---|:---|:---|:---|
| `009_deal_progress.sql` | win_probability + deal_progress_history テーブル | ✅ | ✅ |
| `010_probability_columns.sql` | deal_probability, win_probability, sentiment 系カラム追加 | ✅ | ✅ |
| `011_channel_links.sql` | channel_links テーブル追加 | ✅ | ✅ |
| `012_flow_subject.sql` | contacts.flow_subject カラム追加 + 暫定バックフィル | ✅ | ✅ |
| `013_discarded_stage.sql` | discarded_at カラム追加、churned → discarded マイグレーション | ✅ | ✅ |
| `014_remove_customer_stage.sql` | customer → active マイグレーション（2件更新） | ✅ | ✅ |
| `015_link_contacts_to_accounts.sql` | contacts.company_name → accounts テーブル生成 + account_id リンク | ✅ | ✅ |
| `016_ai_usage_log.sql` | ai_usage_log + tenant_plans テーブル | ✅ | ✅ |
| `017_pipeline_target.sql` | pipeline target + coaching_items カラム群 | ✅ | ✅ |
| `018_sessions.sql` | sessions テーブル | ✅ | ✅ |

**Migration 015 結果:** 6 accounts 新規作成 → 計 7 accounts。8/11 contacts に account_id 紐付け済み。

**Salesforce 実データ投入（2026-03-27）:** 取引先26件・リード153件・取引先責任者45件・商談236件を本番 DB に投入。

### ライフサイクルステージ（現行）

| DB 値 | 表示ラベル | 説明 |
|:---|:---|:---|
| `prospect` | 育成中 | 見込み客（商談前） |
| `active` | 商談中 | 商談進行中 |
| `inactive` | 休眠 | 一時停止 |
| `discarded` | 廃棄 | `discarded_at` セット。30日後に自動削除 |

---

## 現在の機能一覧

| 機能 | 状態 |
|:---|:---|
| Slack Bot 自然言語 CRM 操作 | ✅ 稼働中 |
| GCP Cloud SQL（PostgreSQL 15）| ✅ 稼働中 |
| マルチテナント設計（RLS + withTenant）| ✅ 修正済み |
| AI 意図解析 NLU（Claude Haiku） | ✅ 稼働中 |
| 音声入力 → STT → CRM 登録 | ✅ 稼働中 |
| Web ダッシュボード（Vue.js） | ✅ AI Flow 対応済み |
| AI ナーチャリング（Phase B 承認 / Phase C 自動送信）| ✅ 稼働中 |
| 3レベル AI キルスイッチ（テナント/コンタクト/ディール） | ✅ 実装済み・migration 024 本番適用済み |
| アカウントエンリッチメント（Claude） | ✅ 稼働中 |
| /crm-list + /crm + /crm-settings スラッシュコマンド | ✅ 稼働中 |
| 商談コーチング AI（MEDDPICC）| ✅ 稼働中 |
| 日次ブリーフィング（毎朝9:00 JST）| ✅ 稼働中 |
| 週次サマリー（月曜8:00 JST）| ✅ 稼働中 |
| AI Flow 統合画面（Web）| ✅ 稼働中 |
| AI Flow 詳細モーダル（Slack）| ✅ 稼働中 |
| センチメント駆動の確率エンジン | ✅ 稼働中 |
| 廃棄コンタクト自動削除（30日）| ✅ 稼働中 |
| コンタクト登録時 AI 件名自動生成 | ✅ 稼働中 |
| AI 利用量管理 + Slack DM クォータ通知 | ✅ 稼働中 |
| ⏳リアクション + 正規表現 NLU ショートカット | ✅ 稼働中 |
| 問いかけ型コーチング（CoachingItem）| ✅ 稼働中 |
| パイプライン充足率ゲージ（Web + 日次ブリーフィング）| ✅ 稼働中 |
| 損切り提案 + 継続確認ボタン（日次ブリーフィング）| ✅ 稼働中 |
| Salesforce CSV/Excel インポート（3ステップ UI）| ✅ 稼働中 |
| 夕方ブリーフィング + コーチング統合（17:00 JST）| ✅ 稼働中 |
| 活動記録後の履歴表示（直近3件 + AI Flow リンク）| ✅ 稼働中 |
| Slack 内パイプライン照会（「商談どう？」）| ✅ 稼働中 |
| fast-intent 12パターン（電話/MTG/訪問等の日常表現）| ✅ 稼働中 |
| /coach スラッシュコマンド（DM コーチング TOP3）| ✅ 稼働中 |
| 会社名 alias マッチング（Haiku 類似候補 + 自動登録）| ✅ 稼働中 |
| Playwright E2E テスト（19/19） | ✅ ローカル通過 |

---

## アーキテクチャ

```
Slack ──→ Bolt SDK ──→ NLU（Claude Haiku）
                     ↓
              intent-parser.ts
                     ↓
           message.ts（executePendingAction）
                     ↓
        各サービス（contact / deal / nurturing / coaching）
                     ↓
           withTenant() ──→ Cloud SQL（RLS）
```

**AI モデル定数：** `api/src/config/ai-models.ts`
```typescript
NLU / DECISION: claude-haiku-4-5-20251001
DRAFT:          claude-sonnet-4-6
ENRICHMENT / COACHING / FLOW_SUBJECT: claude-haiku-4-5-20251001
```

---

## Slack App 設定（手動管理）

| 設定 | 値 |
|:---|:---|
| Slash Commands `/crm-list` | `https://slacksfa-api-.../slack/events/` |
| Slash Commands `/crm` | `https://slacksfa-api-.../slack/events/` |
| Slash Commands `/crm-settings` | `https://slacksfa-api-.../slack/events/` |
| Slash Commands `/coach` | `https://slacksfa-api-.../slack/events/` |
| Interactivity Request URL | `https://slacksfa-api-.../slack/events/` |
| Event Subscriptions | 同上 |

---

## 主要ファイル構成

```
api/src/
├── config/
│   ├── ai-models.ts          ← AIモデル定数（一元管理）
│   ├── ai-cost.ts            ← モデル別トークン単価定数
│   ├── crm-labels.ts         ← ステージラベル（育成中/商談中/休眠/廃棄）
│   └── sentiment-signals.ts  ← センチメントシグナル定義
├── db/
│   ├── client.ts             ← withTenant<T>(), pool
│   ├── migrations/           ← 003〜019
│   └── queries/              ← contacts / deals / accounts / crm_notes
├── services/
│   ├── contact.service.ts    ← コンタクト登録（upsertAccount + generateFlowSubject）
│   ├── flow-subject.ts       ← AI 件名自動生成（Haiku）
│   ├── probability-engine.ts ← 確率エンジン + 時間減衰 + 廃棄クリーンアップ
│   ├── deal-coaching.service.ts ← MEDDPICC + 問いかけ型 + パイプライン充足率 + 損切り + getCoachingQuestions()
│   ├── ai-usage.service.ts   ← AI 利用量ログ + クォータチェック + 通知
│   ├── enrichment.service.ts
│   ├── nurturing.service.ts
│   └── draft-reply.service.ts
├── slack/
│   ├── commands/crm-list.ts  ← /crm-list + /crm コマンド、buildFlowBlocks()
│   ├── commands/crm-settings.ts ← /crm-settings コマンド（利用量・プラン表示）
│   ├── commands/coach.ts     ← /coach コマンド（DM にコーチング質問 TOP3）
│   ├── events/message.ts     ← ⏳リアクション + fastIntentMatch
│   ├── events/voice.ts       ← Promise.all 並列化 + parseIntentWithCorrection
│   ├── nlu/intent-parser.ts  ← NLU + parseIntentWithCorrection（音声統合）
│   ├── nlu/fast-intent.ts    ← 正規表現 NLU ショートカット
│   └── views/
│       ├── flow-detail.ts    ← AI Flow 詳細モーダル
│       ├── detail-card.ts    ← コンタクト詳細（旧）
│       ├── note-modal.ts     ← メモ追加モーダル
│       ├── edit-modal.ts     ← 顧客編集モーダル
│       └── coaching-response-modal.ts ← コーチング問いかけ回答モーダル
└── routes/
    ├── api.ts                ← REST API（/api/flows, /api/dashboard/*, 等）
    └── schemas.ts

web/src/
├── views/
│   ├── FlowList.vue          ← AI Flow 一覧（TASK_13 メイン画面）
│   ├── FlowDetail.vue        ← AI Flow 詳細（確率グラフ + タイムライン）
│   ├── Dashboard.vue         ← KPI + 確率分布 + センチメント + 推奨アクション
│   ├── ContactList.vue       ← 顧客基礎情報（読み取り専用）
│   └── AccountList.vue       ← 会社一覧
├── router/index.ts           ← /flow, /flow/:id ルート
├── lib/api-client.ts         ← FlowItem/FlowDetail 型 + flows()/flowDetail() メソッド
└── App.vue                   ← AI Flow ロゴ + 新メニュー
```

---

### バグ修正・TASK_15・TASK_16 ✅（2026年3月24日）

#### バグ修正（ダミーデータ投入時に発覚）

| バグ | 原因 | 修正 |
|:---|:---|:---|
| `crm_notes_lead_id_fkey` FK 違反 | `message.ts` add_note が contact_id を `lead_id` として渡していた（leads テーブルは Migration 008 で廃止済み） | `noteContactId` にリネームし `contactId` として正しく渡す |
| `deals_stage_check` 制約違反 | `deal.service.ts` + `deals.ts` のデフォルト stage が `'prospecting'`（Migration 010 で `open/won/lost` の 3 値に変更済み） | デフォルト値を `'open'` に修正 |

#### TASK_15：応答速度改善

| ファイル | 内容 |
|:---|:---|
| `api/src/slack/nlu/fast-intent.ts` | 正規表現 NLU ショートカット（search / add_note / delete_contact / show_list / create_contact）|
| `api/src/slack/events/message.ts` | 「🔍 解析中...」→ ⏳ reactions.add/remove に変更、`fastIntentMatch()` で Haiku 呼び出しをスキップ |
| `api/src/slack/events/voice.ts` | Promise.all で `downloadFile` + `getSpeechPhrases` + `getTenant` を並列化、`parseIntentWithCorrection()` に統合 |
| `api/src/slack/nlu/intent-parser.ts` | `parseIntentWithCorrection(rawText, knownNames)` 追加（同音異字補正 + NLU を 1 Haiku 呼び出しに統合） |

**効果：** 正規表現マッチ時は Haiku API 呼び出しゼロ。音声入力は Haiku 呼び出しを 2→1 回に削減。

#### TASK_16：コーチング進化

| ファイル | 内容 |
|:---|:---|
| `api/src/db/migrations/017_pipeline_target.sql` | `tenant_plans` に `monthly_target_yen` + `pipeline_ratio`、`deals` に `competitors` + `differentiators` + `coaching_items`、`deal_progress_history` に `coaching_items` |
| `api/src/services/deal-coaching.service.ts` | `CoachingItem` 型（質問+ヒント形式）、`getPipelineCoverage()`、dailyBriefing に充足率バー + 滞留案件（30日以上未接触）検出、損切り提案ボタン |
| `api/src/slack/views/coaching-response-modal.ts` | 問いかけへの回答モーダル。回答は `crm_notes`（`coaching_response` 種別）に保存し確率再計算をトリガー |
| `api/src/routes/api.ts` | `GET /api/dashboard/pipeline-coverage`、`PUT /api/settings/pipeline-target` 追加 |
| `web/src/views/Dashboard.vue` | パイプライン充足率ゲージ（緑/黄/赤）追加 |
| `web/src/views/Settings.vue` | 月間売上目標・必要パイプライン倍率の編集 UI 追加 |
| `web/src/lib/api-client.ts` | `PipelineCoverage` 型、`pipelineCoverage()`・`updatePipelineTarget()` メソッド追加 |

#### DB マイグレーション（本番適用済み）

| ファイル | 内容 | 本番 |
|:---|:---|:---|
| `017_pipeline_target.sql` | pipeline target + coaching_items カラム群 | ✅ 2026-03-24 |
| `018_sessions.sql` | sessions テーブル | ✅ 2026-03-27 |

### CSV インポート + Slack UX 改善 + バグ修正 ✅（2026年3月27日）

#### Salesforce CSV/Excel インポート

| ファイル | 内容 |
|:---|:---|
| `api/src/services/import.service.ts` | Excel(xlsx) 解析、Salesforce フィールドマッピング、UPSERT 処理 |
| `api/src/routes/import.ts` | `POST /api/import/preview`（ドライラン）/ `execute`（本番書込） |
| `web/src/views/ImportPage.vue` | 3ステップ UI（ファイル選択 → プレビュー → 完了） |

#### バグ修正（実データ投入で発覚）

| バグ | 原因 | 修正 |
|:---|:---|:---|
| FlowDetail 無限ローディング | UNION クエリの型不一致（crm_notes.id=UUID, activity_logs.id=TEXT） | `id::text` キャストで修正 |
| 再評価ボタン表示なし | `primary_contact_id` が NULL | deal.service.ts で last_name+account_id から自動ルックアップ |
| AI 評価 JSON 切り捨て | max_tokens: 1500 が MEDDPICC 9要素 JSON に不足 | 4000 に拡張 |
| Slack bot エラー | sessions テーブル未適用 | Cloud SQL Auth Proxy 経由でマイグレーション適用 |

#### Slack UX 改善

| 改善 | 詳細 |
|:---|:---|
| 活動記録後に履歴表示 | メモ追加後、直近3件の活動記録を Slack に表示 + AI Flow リンク |
| 夕方ブリーフィング | 17:00 JST に商談ごとのコーチング質問をプッシュ通知 |
| 「考え中...」ローディング | ⏳リアクション → 「⏳ 考え中...」メッセージ投稿 → 完了後に削除 |
| パイプライン照会 | 「商談どう？」→ 件数・合計金額・各商談確率を Slack 内で表示 |
| fast-intent 拡充 | 5 → 12パターン（電話/メール/MTG/訪問等の日常表現） |
| NLU max_tokens 削減 | 1024 → 300（Haiku 応答約30%高速化） |
| UI 用語統一 | 「取引先」→ **会社**、「リード/取引先責任者」→ **顧客** |

### /coach コマンド + alias マッチング + RLS 修正 ✅（2026年3月28日）

#### `/coach` スラッシュコマンド

| ファイル | 内容 |
|:---|:---|
| `api/src/slack/commands/coach.ts` | `/coach` ハンドラ（DM に優先度上位3件のコーチング質問を送信） |
| `api/src/services/deal-coaching.service.ts` | `getCoachingQuestions(tenantId)` 共通関数を切り出し。/coach + 夕方ブリーフィング共用 |

**設計:** 全 open 商談を評価 → 優先度ソート → 上位3件を DM。「回答する」ボタンは既存 `coaching-response-modal.ts` を再利用。

#### 会社名 alias マッチング

| ファイル | 内容 |
|:---|:---|
| `api/src/db/migrations/019_account_aliases.sql` | `accounts.aliases TEXT[]` + GIN インデックス追加 |
| `api/src/db/queries/accounts.ts` | `findAccountByNameOrAlias()`, `findSimilarAccount()` (Haiku), `addAccountAlias()` |

**設計:** 初回不一致時のみ Haiku で類似企業候補を提示 → ユーザー確認 → alias に自動追加。次回から即マッチ。

#### RLS / コーチング修正（8コミット）

| 修正 | 詳細 |
|:---|:---|
| RLS セッション修正 | deal-coaching, probability-engine, nurturing で `withTenant` 経由に統一 |
| コーチング質問改善 | `getCoachingQuestions()` 切り出し、priority emoji(🔴🟡🟢)追加 |
| 夕方ブリーフィング | `eveningBriefing()` を `getCoachingQuestions()` ベースにリファクタ |

#### DB マイグレーション

| ファイル | 内容 | 本番 |
|:---|:---|:---|
| `019_account_aliases.sql` | accounts.aliases TEXT[] + GIN index | ✅ 2026-03-28 |

---

### TASK_09：E2E テスト基盤 ✅（2026年3月24日）

Playwright E2E テスト **19/19 all passing**。

| ファイル | 内容 |
|:---|:---|
| `tests/fixtures/seed.sql` | 8アカウント・20コンタクト・12商談・全確率バンド・activity_logs・ai_usage_log 網羅 |
| `tests/helpers/seed.ts` | `seedTestData()` / `cleanSeedData()`（FK 依存順 DELETE） |
| `tests/e2e/api.spec.ts` | REST API 全エンドポイント検証（port 3002） |
| `tests/e2e/deals.spec.ts` | 商談 CRUD + probability-distribution テスト |
| `tests/global-setup.ts` | global setup（DB seed → teardown） |
| `tests/playwright.config.ts` | port 3002、globalSetup 統合 |

**修正済みバグ:**
- `activity_logs` RLS が `current_setting('app.tenant_id')` で missing_ok なしのためクラッシュ → `missing_ok=true` パターンに修正
- `probability-distribution` プロパティ名不一致（`low/medium/high/very_high` → `band_cold_count` 等）
- `sentiment-summary` レスポンス構造変更（配列 → `{positive_count, highlights[]}` オブジェクト）
- Migrations 009〜016 ローカル適用済み

### TASK_14：AI 利用量管理 + Slack DM クォータ通知 ✅（2026年3月24日）

| ファイル | 内容 |
|:---|:---|
| `api/src/db/migrations/016_ai_usage_log.sql` | `ai_usage_log` + `tenant_plans` テーブル |
| `api/src/config/ai-cost.ts` | モデル別トークン単価定数 |
| `api/src/services/ai-usage.service.ts` | `logAiUsage()` / `checkQuotaAlert()` / `isQuotaExceeded()` |
| `api/src/slack/commands/crm-settings.ts` | `/crm-settings` コマンド（利用量・プラン表示） |
| `web/src/views/Settings.vue` | Web 設定画面（利用量ゲージ） |

**設計ポイント:**
- `isQuotaExceeded()` — Free プランのみ上限チェック。Premium は常に `false`
- Lazy monthly reset — `checkQuotaAlert()` が `quota_reset_at <= NOW()` を検知して `notified_80/100` をリセット（cron 不要）
- Slack DM 通知は 80% / 100% それぞれ月1回のみ送信
- 全 AI 関数（NLU / enrichment / flow-subject / draft-reply / coaching / sentiment）に `isQuotaExceeded()` ガード追加

---

## 2026年4月9〜10日 実装内容

### サービス名・ブランディング確定

| 項目 | 内容 |
|:---|:---|
| サービス名 | **クラゲディール** |
| ドメイン | kuragedeal.ai / .com / .jp |
| マスコット | クラゲくん（SVGアイコン: `/Users/szk/Desktop/APP/slackSFA/kurage-icon.svg`） |
| Slack App 表示名 | 「クラゲディール」に変更（Slack管理画面でユーザーが実施） |

Webアプリサイドバー・LP navbarにクラゲアイコン適用済み。Webサイドバー背景色をLPヒーローと同じグラデーション（kurage-900→kurage-700）に統一。

### TASK_17：Slack OAuth完了 ✅

| ファイル | 内容 |
|:---|:---|
| `021_oauth_users.sql` | tenants に bot_token/app_id 追加、users・slack_installations テーブル作成 |
| `routes/oauth.ts` | `/slack/install` → OAuth認証URL、`/slack/oauth_redirect` → token交換 |
| `services/tenant.service.ts` | `saveInstallation()` / `upsertUser()`（ユーザー数上限チェック） |
| `index.ts` | Bolt `authorize` callback でDB from bot_token取得（envフォールバック） |
| `config.ts` | SLACK_CLIENT_ID / SLACK_CLIENT_SECRET / SLACK_STATE_SECRET / API_URL 追加 |

Secret Manager: `slacksfa-slack-client-secret` に追加済み。Slack App ID: `1734688488658.10667814032866`。

### NLU・DBMバグ修正 ✅（4月9日）

| バグ | 修正 |
|:---|:---|
| 「相馬さん」→「誰へのメモか分からない」 | Levenshtein距離によるファジーマッチング実装（距離≤2で「もしかして〇〇さん？」） |
| ContactList→FlowList で同姓別人が混入 | `contact_id` を直接クエリパラメータで渡すよう修正 |
| company_name=null でdeal作成失敗 | 会社名なしの場合「田中さん（個人）」アカウントを自動作成 |

### DBM設計（Deal-Based Management） ✅

- Migration 020: `deals.progress_stage`（approaching/active/stalled）追加
- コンタクト登録時に自動でdeal作成（approaching状態）
- 14日間活動なしで自動stalled検出（`stalled-detection.service.ts`）
- `buildFlowBlocks()` に progress_stage 表示を追加

### TASK_18：Stripe課金連携 ✅（4月10日）

| ファイル | 内容 |
|:---|:---|
| `022_stripe.sql` | tenant_plans に stripe_customer_id / stripe_subscription_id / stripe_subscription_status / current_period_end / max_ai_calls 追加 |
| `services/stripe.service.ts` | createCheckoutSession() / handleWebhookEvent()（3イベント対応） |
| `routes/stripe.ts` | `GET /stripe/checkout?plan=standard\|premium&tenant_id=xxx` / `POST /stripe/webhook` |
| `config.ts` | STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET / STRIPE_PRICE_STANDARD / STRIPE_PRICE_PREMIUM 追加 |
| `index.ts` | raw body parser + stripeRouter 登録 |

**Stripe設定（サンドボックス）:**
- Standard Price ID: `price_1TKKoS24q6Q7K3mH0Uiw2weH`（¥9,800/月）
- Premium Price ID: `price_1TKKq624q6Q7K3mHRlWharxI`（¥29,800/月）
- Secret Manager: `slacksfa-stripe-secret-key` / `slacksfa-stripe-webhook-secret`
- Cloud Run に env vars 追加済み（revision slacksfa-api-00188-9m9）

**プラン制限:**
| プラン | max_users | max_ai_calls/月 |
|:---|:---|:---|
| free | 3 | 100 |
| standard | 10 | 5,000 |
| premium | -1（無制限） | -1（無制限） |

**⚠️ Stripe本番化前に必要な作業（ユーザー側）:**
1. Stripeダッシュボード → **本人確認（KYC）** を完了する
2. **銀行口座登録**（入金先）: 設定 → 支払い先 → 銀行口座を追加
3. **請求書設定**: 設定 → 請求書 → ビジネス情報（会社名・住所・電話番号）入力
4. 本番モードで Standard / Premium Product を再作成（test用とは別）
5. 本番Webhook登録: `https://slacksfa-api-808596335261.asia-northeast1.run.app/stripe/webhook`
   - イベント: `checkout.session.completed` / `customer.subscription.updated` / `customer.subscription.deleted`
6. Secret Manager の `slacksfa-stripe-secret-key` を本番キー（`sk_live_xxx`）に更新

### LP（kuragedeal-lp）更新内容 ✅

| 変更 | 詳細 |
|:---|:---|
| ヒーロー2カラム | 左=コピー、右=クラゲくん（w-64、浮遊アニメーション）|
| oceanカラーパレット | sand/sage/mist/steel/deep（ビーチ写真の海の色）各セクション背景に適用 |
| AIナーチャリングセクション | ヒーローと同グラデーション背景。Slack Connectフロー図解（5ステップ）が目玉 |
| 料金ボタン接続 | Free→`/slack/install`、Standard/Premium→`/stripe/checkout?plan=xxx` |
| 比較表更新 | AIナーチャリング行追加 |

**AIナーチャリングの核心（LPに追加済み・実装待ち）:**
- メール→Slack Connectチャンネル招待→顧客がチャンネル参加（確率UP）→AIがSlackで1on1継続→人間がいつでも介入
- ステップメールとの差別化：全員同一配信ではなく顧客状況を読んだ個別メッセージ

### DB マイグレーション（2026年4月）

| ファイル | 内容 | 本番 |
|:---|:---|:---|
| `020_deal_progress_stage.sql` | deals.progress_stage（approaching/active/stalled） | ✅ 4月9日 |
| `021_oauth_users.sql` | users / slack_installations テーブル | ✅ 4月9日 |
| `022_stripe.sql` | tenant_plans にStripeカラム追加 | ✅ 4月10日 |

---

## Phase 3 残タスク

| タスク | 内容 | 優先度 | 状態 |
|:---|:---|:---|:---|
| /crm 登録 | Slack App 設定で `/crm` スラッシュコマンドを追加（同 URL） | 🟡 高 | ✅ 完了 |
| /crm-settings 登録 | Slack App 設定で `/crm-settings` スラッシュコマンドを追加 | 🟡 中 | ✅ 完了 |
| backfillFlowSubjects | `api/scripts/backfill-flow-subjects.ts` を本番 DB で実行 | 🟡 中 | ✅ 完了（本番 11 contacts） |
| Migration 016 本番適用 | `016_ai_usage_log.sql` を本番 Cloud SQL に適用 | 🟡 高 | ✅ 完了 |
| promote コード削除 | `promoteContactToCustomer` + intent `promote` を削除（customer ステージ廃止済み） | 🟡 中 | ✅ 完了 |
| TASK_15 応答速度改善 | 正規表現ショートカット + ⏳リアクション + 音声 Haiku 統合 | 🟡 高 | ✅ 完了 |
| TASK_16 コーチング進化 | 問いかけ型 + パイプライン充足率 + 損切り提案 | 🟡 高 | ✅ 完了 |

---

## 設計上の重要決定事項

### AI Flow 統合（TASK_13）

- 顧客・ナーチャリング・商談の3画面を廃止し「AI Flow」1画面に統合
- `contacts.flow_subject`（AI 生成件名）をキーに全営業活動を1リストで管理
- センチメント指標は確率に内包。根拠は Slack で聞かれた時のみ回答
- Web は閲覧・分析専用。CRUD は Slack で完結

### ライフサイクルステージ簡素化

- 旧: prospect / active / customer / inactive / churned（6段階）
- 新: prospect(育成中) / active(商談中) / inactive(休眠) / discarded(廃棄)（4段階）
- `discarded` は `discarded_at` タイムスタンプを持ち、30日後に自動削除

### accounts / contacts 二重管理の解消

- Slack 経由で登録されたコンタクトは company_name のみ持ち account_id が NULL だった
- Migration 015 で既存 contacts を accounts テーブルに紐付け（6件新規作成）
- `contact.service.ts` を修正し、今後の登録時は必ず `upsertAccount` を呼ぶ

### Vite ビルド時環境変数

- `VITE_API_BASE_URL` は Docker ARG で Build 時に焼き込む
- `gcloud run deploy --source` は ARG を渡せないため非対応
- Web デプロイは必ず `gcloud builds submit --config web/cloudbuild.yaml` を使う

### Lead/Contact 統合（Phase 2.5 完了）

- `contacts` テーブルに `lifecycle_stage` で統合
- `/api/leads/*` ルートは後方互換のため残存

### RLS セッション管理

- `SET LOCAL` + `BEGIN/COMMIT` トランザクション内でのみテナント分離
- `withTenant<T>(tenantId, fn)` 経由で全 DB 操作

### モバイルファースト方針（2026-03-27 決定）

- **Slack がコア、Web は補助**（閲覧・分析・設定のみ）
- 営業担当の外出先シナリオは Slack アプリで完結
- Web のレスポンシブ対応は最低限（ダッシュボードのゲージ・グラフが崩れない程度）
- 本格的なレスポンシブ対応は SaaS 外販後、ユーザー要望が出てから

### 会社名マッチング方針（2026-03-27 決定）

- `accounts` テーブルに `aliases TEXT[]` を追加
- 検索時に `name` + `ANY(aliases)` で照合
- 初回不一致時のみ Haiku で類似企業候補を提示 → ユーザー確認 → alias に自動追加
- インポート時にも Salesforce の英語名を alias に自動登録

---

## 残課題（次フェーズ）

### 品質安定化フェーズ（2026年3月末〜4月上旬）

**方針:** 新機能追加を凍結し、実データでの全機能テスト + バグ修正に集中。

| タスク | 内容 | 状態 |
|:---|:---|:---|
| テストガード実装 | `test-guard.ts` — TEST_MODE 環境変数でアウトバウンド送信を3名にホワイトリスト制限 | ✅ 完了 |
| RLS 全体監査 | `pool.query` 直接使用を `withTenant` に統一、DEV_TENANT_ID ハードコード除去 | ✅ 完了 |
| Cloud Run 環境変数設定 | TEST_MODE=true + ALLOWED_SLACK_IDS/EMAILS を本番に設定 | ✅ 完了 |
| 社内テスト実施 | 3名（鈴木・いもみ・保田）でテストスクリプト実行 | 🔄 進行中 |
| バグ修正（4/1分） | 下記「4/1 テスト中バグ修正」参照 | ✅ 10件修正・デプロイ済み |
| バグ修正（継続） | テストで発見されたバグの修正 | ⬜ テスト継続中 |
| TEST_MODE 解除 | テスト完了後 TEST_MODE=false に戻す | ⬜ 修正完了後 |

**テスター構成:**
- テスター1: 鈴木（CEO）— コーチング・ブリーフィング・ダッシュボード
- テスター2: いもみ — 顧客登録・検索・メモ・音声入力
- テスター3: 保田 — 商談操作・コーチング回答・Web 画面
- テスター4: 本田 雄介（Slack: `U05R8DEAEPJ` / yusuke.honda@jp.opro.net）— 2026-04-02 追加

**関連ドキュメント:**
- `SONNET_INSTRUCTIONS_TESTGUARD.md` — 黒子への作業指示（テストガード + RLS 監査）
- `TEST_SCRIPTS.md` — テスター別テストスクリプト

### 4/1 テスト中バグ修正・UX改善（10件デプロイ済み）

| 修正 | コミット |
|:---|:---|
| UI用語統一「コンタクト」→「顧客」（NLUプロンプト・モーダル・通知 11箇所） | `1edc1c0` |
| NLUがタスク/ToDo的発言もadd_noteで拾う | `ba399fe` |
| 「やりとり履歴」→「活動メモ」名称統一（Web+Slack） | `9695862` |
| `show_activity` インテント追加（「〇〇の活動メモ見せて」） | `e22e0c8` |
| show_activity 正規表現を非貪欲に修正（`.{1,20}?`） | `d619a41` |
| 削除以外の全操作を確認ボタンなしで即実行 | `f7f5e2f` |
| show_activity で同名コンタクトがいる場合メモがある方を優先 | `6a90358` |
| add_note 応答に紐づけ先の顧客名を表示 | `81aecf9` |
| 同名コンタクトが複数いる場合に選択ボタンで聞く（add_note + show_activity） | `4a229be` |
| 検索結果「リード」→「顧客」+ 電話/メール表示追加 | `41eb1a1` |
| 「処理中...」残留の緩和（delete失敗時にupdate） | `c8f9c2f` |
| 検索クエリに accounts.aliases 対応追加 | `5270504` |

### 4/2 バグ修正・UX改善（デプロイ済み）

| 修正 | コミット |
|:---|:---|
| `findSimilarAccount` の `WHERE tenant_id = $1` 除去（本番テナントID と dev UUID 不一致で alias マッチ0件） | `327234c` |
| NLU文脈追跡: 検索/登録後に「電話番号は？」「メールは？」等をコンテキストから即答 | `4622841` |
| fast-intent `last_name` / `keyword` から「さん・様・くん・ちゃん」を正規化除去 | `d00a764` + `8d0bed3` |
| bypassPermissions: `.claude/settings.local.json` に追加 + VSCode設定 `claudeCode.allowDangerouslySkipPermissions: true` | — |

**TEST_MODE 状況:** Cloud Run に `TEST_MODE` 環境変数は未設定 → `false` = 本番モード稼働中（解除済み）

### 4/2 追加修正（デプロイ済み）

| 修正 | コミット |
|:---|:---|
| インポート `lifecycle_stage: 'customer'` → `'active'`（DB制約エラー解消） | `7dd769a` |
| インポート emailなし時に姓+会社名で重複チェック（leads・contacts両方） | `7dd769a` |

**インポート方針（確認済み）:**
- アプリは案件ベース。同一人物に複数案件はOK（むしろ推奨）
- email重複チェックはコンタクト（人）の重複防止のみ
- 案件（deals）は account_id + 商談名で独立して重複チェック → コンタクト重複チェックとは無関係
- Salesforce CSV 再インポートは現状不要（既存データで問題なし）

### 4/4 NLUセッションコンテキスト⑤〜⑨ 実装完了

前セッション（4/2〜4/3）で①〜④を実装済み。今日は残り5つを完了。

#### NLUコンテキスト全9フィールド（完全実装済み）

| # | フィールド | 型 | 効果 |
|---|-----------|-----|------|
| ① | `lastIntent` | string | 直前の操作を Haiku に伝える（「さっき検索した人に…」） |
| ② | `activeDeal` | {dealId, dealTitle, accountName} | /coach後・商談登録後にフォーカス商談をキープ |
| ③ | `lastSearchResults` | [{id, name, companyName}]×5件 | 「2番目の人に」等の番号指示を解決 |
| ④ | `currentTopic` | {companyName?, contactName?} | 話題フォーカス（省略指示代名詞を補完） |
| ⑤ | `pendingConfirmation` | {intent, summary} | 確認待ち状態をコンテキスト保持 |
| ⑥ | `registrationDraft` | {last_name, company_name, missingField...} | 段階的登録「田中さんを登録」→「会社は？」→「シロ」フロー |
| ⑦ | `coachingContext` | {dealTitle, questions[]} | /coach後、その商談のQ&Aコンテキストを Haiku に注入 |
| ⑧ | `lastError` | {intent, entities, errorMsg, ts} | エラー後「もう一回」で再試行 |
| ⑨ | `sessionOperations` | [{entityId, entityType, entityName, ts}]×10件 | 「さっき登録した人」等の時間的参照を解決 |

**セッション有効期限:** 30分（Redis不使用 / PostgreSQL sessions テーブル）

#### 実装ファイル

| ファイル | 変更内容 |
|:---------|:---------|
| `api/src/slack/events/message.ts` | UserContext に⑤〜⑨追加。registrationDraft処理、lastError再試行パターン、sessionOperations保存（create_contact・create_deal）|
| `api/src/slack/nlu/intent-parser.ts` | NluSessionContextに⑦〜⑨追加。buildContextSection()を拡張（coachingContext/lastError/sessionOperationsをHaikuプロンプトに注入） |
| `api/src/slack/commands/coach.ts` | /coach完了後にcoachingContext + activeDealをセッション保存 |

#### キャンセルパターン拡張
```
❌ / いいえ / キャンセル / cancel / やっぱりやめた / やめた / やめて / 待って / ストップ / stop / 不要 / いらない / なしで / やめます
```
キャンセル時は `registrationDraft` と `pendingConfirmation` も同時クリア。

---

### 4/4 会社一覧・Slack検索でコンタクト名検索対応

**問題:** 会社ページで「田中」と検索するとヒットしない（accounts.nameのみ検索していた）

**修正内容:**
- `api/src/db/queries/accounts.ts` → `searchAccounts()` のSQL に `contacts.last_name / first_name` サブクエリ追加
- `api/src/routes/api.ts` → `GET /api/accounts` のWHERE節を同様に拡張

```sql
-- 追加されたOR条件
OR EXISTS (SELECT 1 FROM contacts cx
  WHERE cx.account_id = id
  AND (cx.last_name ILIKE $1 OR cx.first_name ILIKE $1))
```

「田中」→ 田中さんが所属する「株式会社シロ」がヒットするようになった。

---

### 4/4 UI用語大規模リネーム + No ディールバッジ実装

#### 用語統一方針（別Sonnetとの議論から決定）

> 「Dealって言葉はわかりやすい。FlowやAI Flow・商談といった言葉は『ディール』に統一しよう」

初見ユーザーにわかりやすい英語/日本語混合UXに統一。

| 変更前 | 変更後 | 場所 |
|--------|--------|------|
| AI Flow（ナビ・ブランド） | AI ディール / ディール | App.vue |
| 顧客（ナビ） | 顧客リスト | App.vue |
| 会社（ナビ） | 会社リスト | App.vue |
| 分析（ナビ） | アナリティクス | App.vue |
| 商談化確率 | ディール確率 | FlowList.vue, FlowDetail.vue |
| 商談 (N件) / 商談なし | ディール (N件) / ディールなし | AccountDetail.vue |
| 商談数（テーブルヘッダー） | ディール数 | AccountList.vue |
| ✨ AI Flow / AI Flow 詳細 | ✨ ディール / ディール詳細 | FlowList.vue, FlowDetail.vue |
| AI Flow N件（ダッシュボード） | ディール N件 | Dashboard.vue |
| 分析（ページタイトル） | アナリティクス | Analytics.vue |
| 商談中（フィルタタブ） | ディール中 | ContactList.vue |

#### No ディールバッジ実装

**設計思想（重要）:**
- `active + open deal なし` → **No ディール**（琥珀バッジ）
- `active + open deal あり` → **ディール N件**（緑バッジ）
- `inactive` → 休眠（グレーバッジ）
- `discarded` → 廃棄（赤バッジ）

**"No ディール"は 0% ではない。** 案件前の顧客 = 「育成中」の別表現。win_probability=0% は「案件はあるが死にかけ」を意味し全く別の営業行動が必要なため、混在させてはいけない。

**API変更:**
```sql
-- GET /api/contacts に追加
(SELECT COUNT(*)::int FROM deals d
 WHERE d.account_id = c.account_id
 AND d.stage NOT IN ('closed_won','closed_lost')) AS open_deal_count
```

**型追加:** `Contact` インタフェースに `open_deal_count?: number` を追加 (`web/src/lib/api-client.ts`)

**バッジCSS:**
```css
.badge-deal-active { background: #dcfce7; color: #15803d; }  /* 緑 */
.badge-nodeal      { background: #fef3c7; color: #92400e; }  /* 琥珀 */
```

---

### 4/4 アーキテクチャ議論メモ（重要設計決定）

#### UI表示ラベル設計（2026-04-09 確定）

**ディール一覧がメイン、コンタクト一覧はアドレス帳的サブビュー**という整理に変更。
ステージ・成約見込みはディールに付ける。コンタクトには件数だけ表示。

**ディールステージ UIラベル（DB値は変えない）:**

| DBの値 | UIラベル | 備考 |
|--------|---------|------|
| open（prospect相当） | 🌱 アプローチ中 | |
| open（active相当） | 🔥 進行中 | 「商談中」は使わない（ディールと二重になるため） |
| open（inactive相当） | 💤 停滞中 | |
| closed_won / closed_lost | 🗑 クローズ | UIでは1つに統合。won/lostはDB内部に保持 |

**won/lost の扱い:**
- UIでは「クローズ」として1つに見せる（終わった案件はどちらでも同じ）
- アナリティクス画面でのみ won/lost を分けて表示（成約率・失注理由の分析）
- 実装コストゼロ（DBスキーマ変更なし、UIラベルだけ変更）

**成約見込み（win_probability）の表示場所:**
- ディール一覧 → 「進行中」のディールにのみ「成約見込み 70%」を併記
- アプローチ中・停滞中・クローズには表示しない
- コンタクト一覧には表示しない（ディール詳細で確認）

**コンタクト一覧の表示:**
- ステージラベルなし
- 「進行中 2件」など件数のみ表示

**win_probability vs lifecycle_stage の使い分け:**
- `lifecycle_stage` → 関係管理（案件化前・休眠・廃棄のトリガー）
- `win_probability` → 案件の勝率（open deal が存在する場合のみ有意義）
- 2つは別軸。統合しない。「案件前の人に確率0%」を付けると「死にかけ案件」との区別ができなくなる。

#### lifecycle_stage 3値化の方向性（将来）

```
現状（4値）: prospect(育成中) / active(商談中) / inactive(休眠) / discarded(廃棄)
将来（3値）: active(関係あり) / inactive(休眠) / discarded(廃棄)
```

「育成中 vs 商談中」の区別は `deals` テーブルのopen deal有無で自動判定できる。わざわざ手動でステージをセットするのは冗長。

**ただし今は実施しない理由:**
- DBマイグレーションコスト中〜高
- α版での実運用データが溜まってから判断する
- 現状は `open_deal_count` で自動表示することで対処済み

---

### 4/5 /coach A/B/C/D状況診断実装

#### 背景
`/coach` が「win_probability 降順」で上位3件を出すだけで、状況に関係ないコーチング質問を出していた問題を修正。

#### 状況診断ロジック（`diagnoseSituation()`）

| 状況 | 条件 | コーチング方向性 | 優先順位 |
|------|------|----------------|---------|
| `stale` ⏰ 滞留 | 最終活動から14日以上 | 何が止まっているか・次アクションを問う | 1位 |
| `atrisk` ⚠️ 危険 | win_probability ≤ 30% | 競合差異・撤退判断を問う | 2位 |
| `closing` 🏁 クロージング | win_probability ≥ 70% | 決裁者・残課題・クローズ日を問う | 3位 |
| `action` 📋 通常 | それ以外 | coaching_items の high priority 優先 | 4位 |
| `unassessed` | coaching_items なし かつ 確率なし | 再評価を促す（ボタンなし・URLリンクのみ） | 最後 |

滞留を最優先にした理由：確率が高くても放置すれば必ず下がる。

#### 実装ファイル
- `deal-coaching.service.ts` — `DealSituation` 型・`SITUATION_ITEMS` テンプレート・`diagnoseSituation()`・`getCoachingQuestions()` 全面改修
- `coach.ts` — 状況ラベル（`🏁 クロージング` 等）をタイトル行に追加表示

---

### 4/5 本番DB確認

open deals: 4件（全部 `U01MZ9A560H` = 鈴木さん）。Salesforceインポート285件はほぼ全件 won/lost。
東京写真工房「新規商談」が2件重複している可能性あり → 要確認。

---

### 🔖 担当者（owner）設計 — 方針決定済み（2026-04-05）

**現状:**
- `deals` / `contacts` / `accounts` に `owner_slack_id` フィールドあり
- Slackで登録した操作者のIDが自動セット
- Salesforceインポートデータは owner 情報なし
- `/coach` は現状テナント全員の open ディールを対象

**決定事項:**

#### 課金モデル: テナント定額制
| プラン | 月額 | ユーザー数上限 | AI利用量 |
|--------|------|--------------|---------|
| Free | ¥0 | 3名 | 月100回 |
| Standard | ¥9,800/月 | 10名 | 月5,000回 |
| Premium | ¥29,800/月 | 無制限 | 無制限 |
| Enterprise | 要見積もり | 無制限 | 無制限+請負ナレッジ構築 |

**選定理由:** Salesforceとの差別化（「ユーザー数で課金しない」）。AI利用量で実質制限。Stripe実装がシンプル。

#### 実装方針（TASK_17-18で実施）
- `tenant_plans` に `max_users INT`, `stripe_customer_id`, `stripe_subscription_id` カラム追加
- `users` テーブル新設: `slack_user_id`, `tenant_id`, `role (admin/member/viewer)`, `created_at`
- `/coach` はデフォルト自分の担当案件、`/coach all` でチーム全体
- 担当者変更はFlowDetailモーダルにボタン追加
- SFインポート時の担当者名→Slack ID自動マッチ（未マッチはadminに割り当て）

#### α版（今）: 変更不要
- 実質1名利用。全ディール表示で問題なし。

---

### β版公開タイムライン（2026-04-12 確定）

| 時期 | 担当 | タスク |
|------|------|--------|
| 今週（4/12〜） | 鈴木さん + 黒子 | 特商・利用規約・PP を LP に組み込み → **Stripe審査提出** |
| 来週（4/19〜） | **オッパ** | **コードレビュー全件**（OPPA_CODEREVIEW.md） → 指摘リスト作成 |
| 来週（4/19〜） | 黒子 | レビュー指摘を受けて修正 |
| 2週間後（4/26〜） | 全員 | Stripe承認 + 修正完了 → **β版公開** 🎉 |

---

### 2026-04-14 Stripe審査承認 + LPリーガルページ + セキュリティ全件修正・デプロイ

#### Stripe審査 承認
- Stripe アカウントが審査承認済み（β版課金機能が本番利用可能に）

#### LP法的ページ追加（kuragedeal.ai）
- 特定商取引法に基づく表記・利用規約・プライバシーポリシー の3ページをLPに組み込み完了
- Settings.vue にプラン変更UI（現在のプラン表示・変更ボタン・解約ボタン）を追加
- Stripe checkout / change-plan / cancel フローをフロントから完結できるよう実装

#### セキュリティ全件修正（オッパの CODEREVIEW_REPORT_20260414.md 指摘19件すべて対応）

**マイグレーション (`023_security_hardening.sql`):**
- `stripe_webhook_events(event_id TEXT PRIMARY KEY, ...)` — Webhook冪等性テーブル新設
- `tenant_plans.api_key UUID DEFAULT gen_random_uuid()` — テナント別APIキー追加
- `oauth_states(state TEXT PRIMARY KEY, created_at TIMESTAMPTZ)` — OAuthステートをDB管理へ移行

**APIキー認証 (`api/src/routes/api.ts`):**
- `Authorization: Bearer <uuid>` ヘッダーでテナント認証（DB照合）
- 開発環境は `DEV_TENANT_ID` フォールバックで後方互換性維持
- DELETE /api/accounts/:id、DELETE /api/contacts/:id を BEGIN/COMMIT トランザクション化

**Stripe認証 (`api/src/routes/stripe.ts`):**
- `/checkout`, `/change-plan`, `/cancel` に `requireStripeTenantAuth` ミドルウェア追加
- `tenant_id` をリクエストボディから受け取る設計を廃止（認証済みテナントを使用）

**Webhook冪等性 (`api/src/services/stripe.service.ts`):**
```typescript
// event_id PRIMARY KEY の一意制約でDuplicate受信を検出
INSERT INTO stripe_webhook_events (event_id, event_type) VALUES ($1, $2)
// → 23505 エラーなら既処理としてスキップ
```

**SQLインジェクション対策 (`api/src/slack/events/message.ts`):**
```typescript
const ALLOWED_DEAL_COLUMNS = new Set(['amount', 'stage', 'expected_close']);
const safeKeys = Object.keys(updates).filter(k => ALLOWED_DEAL_COLUMNS.has(k));
```

**`withTenant()` 一本化 (`api/src/services/tenant.service.ts`):**
- `db/client.ts` の `withTenant()` を正式採用・再エクスポート
- 末尾の重複実装（旧withTenant）を削除
- `xmax::text = '0'` で INSERT/UPDATE を正確に判定（タイムスタンプ比較を廃止）
- テナント自動作成時に `tenant_plans (plan='free', max_users=3)` も同時 ON CONFLICT DO NOTHING

**OAuthステート管理 (`api/src/routes/oauth.ts`):**
- `pendingStates = new Set()` をDB管理に移行（Cloud Run マルチインスタンス対応）
- コールバックで `DELETE ... WHERE created_at > NOW() - INTERVAL '10 minutes' RETURNING state` による有効期限チェック

**N+1解消 (`api/src/services/probability-engine.ts`):**
```sql
-- CASE WHEN バッチUPDATE（deals + contacts）
UPDATE deals SET win_probability = CASE WHEN id = $1 THEN $2 ... END WHERE id IN (...)
```

**AIフォールバック修正 (`api/src/services/draft-reply.service.ts`):**
- エラー時の `should_reply: true` → `false` に修正（誤送信防止）
- SendGridエラー時にSlackへ失敗通知を送信してから返るよう修正

**センチメント型安全性 (`api/src/services/sentiment-analyzer.ts`):**
- `overall_sentiment` の想定外値を `'neutral'` に正規化するバリデーション追加

**Webフロント認証 (`web/src/lib/api-client.ts`):**
- `authHeaders()` ヘルパー追加（VITE_API_KEY → localStorage フォールバック）
- 全API呼び出し（GET/PATCH/DELETE）に `Authorization: Bearer` ヘッダーを付与

**Dockerfileビルド時変数 (`web/Dockerfile`):**
- `ARG VITE_API_KEY=""` と `ENV VITE_API_KEY=$VITE_API_KEY` を追加

#### デプロイ結果
- API: `slacksfa-api-00223-25n` at `https://slacksfa-api-808596335261.asia-northeast1.run.app`
- Web: `slacksfa-web-00152-rxm` at `https://slacksfa-web-808596335261.asia-northeast1.run.app`
- Shiro テナントの api_key: `366d2746-18d0-43f4-a2d5-f7ce21cfb227`
- 認証確認: Bearer トークンあり → 200、なし → 401

#### オッパへの検証依頼
上記19件の修正が正しく実装されているか、`CODEREVIEW_REPORT_20260414.md` の指摘一覧と照合して検証をお願いしたい。

---

### 2026-04-14〜15 β公開準備・UX整備・settings.tsバグ修正

#### オッパコードレビュー残り2件 対応済み

| 指摘 | 修正内容 |
|------|---------|
| `DELETE /api/leads/:id` トランザクション未実装 | `pool.connect()` + `BEGIN/COMMIT` に変更 |
| `message.ts` dev tenant フォールバック残存 | `teamId` 未解決時は早期リターン（DEV_TENANT_ID 参照を完全削除） |

#### コマンド・URL名称統一

| 変更前 | 変更後 | 後方互換 |
|--------|--------|---------|
| `/crm-list` | `/list` | ✅ `/crm-list` も動作 |
| `/crm-link` | `/link` | ✅ `/crm-link` も動作 |
| `/settings` | `/setting`（sなし） | ✅ `/settings` も動作 |
| Web: `/flow` | `/deal` | ✅ リダイレクト |
| Web: `/settings` | `/setting` | ✅ リダイレクト |

Slack App管理画面でも `/list` `/link` `/setting` を登録・Reinstall済み（鈴木さんが実施）。

#### モーダルタイトル修正

`crm-list.ts` 内の「✨ AI Flow」表記を「✨ ディール」に全置換（`replace_all`）。

#### 処理中スピナー修正

ボタン操作後「処理中...」メッセージが消えない問題を修正。

| ハンドラ | 修正内容 |
|---------|---------|
| `select_contact_for_activity` | `chat.postMessage`（新規）→ `chat.update` でオリジナルTSを上書き |
| `confirm_action` | `executePendingAction` 後に `chat.delete(processingTs)` |
| `select_contact_for_note` | `executePendingAction` 後に `chat.delete(processingTs)` |

#### Webアプリ認証（ログイン画面 + ログアウト）

| ファイル | 内容 |
|---------|------|
| `web/src/views/Login.vue`（新規） | APIキー入力フォーム。`/api/settings/profile` で検証 → `localStorage('kd_api_key')` に保存 |
| `web/src/router/index.ts` | `router.beforeEach` で未認証時は `/login` へリダイレクト |
| `web/src/views/Settings.vue` | ログアウトボタン追加（localStorage削除 → `/login`） |
| `web/.env.production`（新規） | `VITE_API_BASE_URL` をハードコード（`--set-build-env-vars` が Docker ARGに渡らないため） |

`/setting` コマンドで APIキーをインラインコード + ダッシュボードボタン付きの ephemeral で送信するよう変更。

#### CLAUDE.md 作成

`slackSFA/CLAUDE.md` を新規作成。初見エージェントがシステムを把握できる引き継ぎドキュメント。
- サービス概要・URL・GCPプロジェクト
- ディレクトリ構成・ファイル役割
- 認証方法（Bearer token / Bolt署名検証）
- スラッシュコマンド一覧
- DB重要事項（withTenant必須・マイグレーション手順）
- デプロイコマンド（API / Web / LP）
- よくある障害と対処
- 環境変数一覧・AIモデル使い分け・開発ルール

#### settings.ts DEV_TENANT_ID バグ修正（オッパ指摘・致命的）

**問題:** `/setting` モーダルで「保存する」を押すと、実際のテナントではなく `DEV_TENANT_ID` に設定が上書きされていた。

**修正内容:**

| ファイル | 変更 |
|---------|------|
| `api/src/index.ts` | `settings_submit` ハンドラで `body.team?.id` を取得し `handleSettingsSubmit` に渡す |
| `api/src/slack/commands/settings.ts` | `handleSettingsSubmit` に `teamId` 引数追加。`pool.query` で `slack_workspace_id` からテナントID解決 → `withTenant()` 経由でUPDATE。`DEV_TENANT_ID` を完全削除。`import` に `withTenant` 追加。 |

#### LP 更新内容

| 変更 | 詳細 |
|------|------|
| 使い方ガイド フッター | 「サポートに問い合わせる→」リンク削除 → 「画面右下のクラゲくんにお問合せください」テキストに変更 |
| ChatWidget「お問い合わせ →」ボタン | `<button @click="toggle">` → クリック不可の `<span>` に変更（クラゲくんアイコンのみがチャットを開く） |
| ヒーローCTA×2 | `href="/contact"` → `:href="\`${API_URL}/slack/install\`"` に変更（フルセルフサービス化） |

#### デプロイ履歴

| 日時 | リビジョン | 内容 |
|------|-----------|------|
| 4/14 | `slacksfa-api-00223-25n` | セキュリティ全件修正 |
| 4/15 | `slacksfa-api-00244-dvx` | settings.ts DEV_TENANT_IDバグ修正 |

#### 現在の状態（2026-04-15）

| 項目 | 状態 |
|------|------|
| コードレビュー全件対応 | ✅ 完了 |
| Stripe審査 | ✅ 承認済み |
| settings.ts致命的バグ | ✅ 修正・デプロイ済み |
| Webアプリ認証（ログイン/ログアウト） | ✅ 完了 |
| TASK_17 OAuth（バックエンド） | ✅ 完了（oauth.ts + authorize()） |
| TASK_18 Stripe課金 | ✅ 完了（サンドボックス） |
| LP ヒーローCTA → /slack/install | ✅ 完了（フルセルフサービス） |
| β版公開 | 🎯 4/26前後（LP色調整完了後） |

#### 次のアクション

1. **LP色調整完了**（鈴木さんが対応中）→ Cloudflare Pages 自動デプロイ
2. **β版公開**（4/26前後）
3. **TASK_17 Slack App Directory申請**（β後・マルチテナントOAuthはバックエンド済み）
4. **Stripe本番化**（KYC・銀行口座・本番Productキー更新 → HANDOFF 4/10 参照）
特に以下の観点でレビューを:
1. SQLインジェクション対策のホワイトリストが抜け漏れなく適用されているか
2. `withTenant()` の二重実装が完全に消えているか (`tenant.service.ts` 末尾)
3. Stripe Webhookの冪等性が正しく機能するか（23505エラーハンドリング）
4. OAuthのDB管理移行で `pendingStates` Set が完全に除去されているか

---

### 残課題

| タスク | 優先度 | 備考 |
|:---|:---|:---|
| オッパによる修正19件の検証 | 🔴 最高 | 上記デプロイ済み。CODEREVIEW_REPORT_20260414.md 参照 |
| TASK_19: Slack App Directory申請 | 🟡 中 | β版公開後に着手 |
| URL を `/deals` / `/deals/:id` にリネーム | ⬜ 余裕があれば | ナビは「ディール」に統一済みだが URL はまだ `/flow` のまま |
| sessions テーブル 期限切れレコード削除ジョブ | ⬜ SaaS化前 | |

### 完了済み（4月）
- [x] TASK_17: Slack OAuth マルチテナント対応 ✅
- [x] TASK_18: Stripe 連携（Free/Standard/Premium） ✅
- [x] LP（kuragedeal.ai）公開 + クラゲくんAIチャット ✅
- [x] DNS設定・Stripe/OAuth環境変数設定 ✅
- [x] DBMリファクタ（ディール一覧メイン化） ✅
- [x] UIラベル刷新（アプローチ中/進行中/停滞中/クローズ） ✅
- [x] LP法的ページ（特商・利用規約・PP）組み込み ✅ (2026-04-14)
- [x] Stripe審査承認 ✅ (2026-04-14)
- [x] セキュリティ全19件修正・デプロイ ✅ (2026-04-14)

### インフラ
- [ ] Terraform dev/prod 環境分離
- [ ] `terraform plan` を CI（PR 時）に追加

### 将来の会話取得ソース拡張
- [x] support@kuragedeal.ai 受信→AI自動返信（Cloudflare Email Worker）✅ (2026-04-19)
- [ ] support@kuragedeal.ai 迷惑メール問題（送信実績積み上げで自然解消予定）
- [ ] /api/contact → /api/free リネーム（後日リファクタリング時）

---

### 2026-04-19 3レベル AI キルスイッチ実装・nurturing_mode廃止

#### 設計背景

| 課題 | 解決策 |
|------|--------|
| `nurturing_mode`（notify_only/draft_reply）はユーザーが手動で切り替える必要があり、使われない | `deals.progress_stage` で自動決定。適切な Phase は AI が選ぶ |
| 緊急時に AI を止める手段がなかった | 3レベルのキルスイッチを実装 |
| 「この顧客から連絡不要と言われた」をディールレベルで止めても別ディールから送られてしまう | コンタクトレベルのキルスイッチで人単位で停止可能に |

#### 3レベル AI キルスイッチ設計

```
テナント全体 (ai_paused)         … 緊急全停止（/setting モーダル）
  └── コンタクト (ai_paused)     … この人への全連絡を停止（Flow詳細ボタン）
        └── ディール (ai_paused) … この案件だけ停止（Flow詳細ボタン）
```

いずれか1つでも `true` なら AI 送信しない。ディールは複数持つ可能性があるため「顧客に連絡不要」はコンタクトレベルで止める必要がある（ディールレベルだと別ディールから送られてしまう）。

#### nurturing_mode 廃止 → progress_stage 自動決定

| progress_stage | 自動選択 Phase | 動作 |
|----------------|--------------|------|
| `approaching`  | Phase C      | AI が直接メール送信（自動送信） |
| `active`       | Phase B      | 下書き生成 → 人間が承認 |
| `stalled`      | Phase B      | 下書き生成 → 人間が承認 |

キルスイッチ = `approaching` での自動送信を止める緊急ブレーキとして機能する。

#### DB マイグレーション

`api/src/db/migrations/024_ai_pause.sql`
```sql
ALTER TABLE tenants  ADD COLUMN IF NOT EXISTS ai_paused BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS ai_paused BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE deals    ADD COLUMN IF NOT EXISTS ai_paused BOOLEAN NOT NULL DEFAULT false;
-- nurturing_mode カラムは残すが無視（将来 DROP）
```

#### 変更ファイル一覧

| ファイル | 変更内容 |
|---------|---------|
| `api/src/db/migrations/024_ai_pause.sql` | tenants/contacts/deals に `ai_paused` カラム追加 |
| `api/src/services/nurturing.service.ts` | 3レベルpause確認 + progress_stage による Phase 自動選択 |
| `api/src/services/draft-reply.service.ts` | `autoSend` オプション追加 + `autoSendReply()` 関数（Phase C）実装。nurturing_mode ガード削除 |
| `api/src/slack/views/flow-detail.ts` | ディール/コンタクトレベルの AI 一時停止ボタン追加。ディールクエリに `d.ai_paused` 追加 |
| `api/src/index.ts` | `toggle_deal_ai_pause` / `toggle_contact_ai_pause` アクションハンドラ追加 |
| `api/src/slack/commands/settings.ts` | `nurturing_mode` ドロップダウン削除。テナント全体の緊急停止ボタン追加（赤 danger ボタン） |

#### UX（Slack）

- `/setting` モーダル: 「⏸ 緊急停止（全体）」ボタン（赤）または「▶ AIを再開する」ボタン（緑）
- Flow詳細モーダル: 「⏸ AIを停止（このディール）」「⏸ AIを停止（この顧客）」ボタン
- 停止中は「⏸ AIを再開（この顧客）」のようにプライマリ色（青）で表示

---

### 2026-04-19 LP /free リネーム・インストールフロー整備・support@kuragedeal.ai 自動返信

#### LP /contact → /free リネーム

| 変更 | 詳細 |
|------|------|
| `pages/contact.vue` → `pages/free.vue` | ファイルリネーム。URLが `/free` に変更 |
| `components/TheNav.vue` | `/contact` → `/free` ×2箇所 |
| `pages/index.vue:668` | Premium `checkoutUrl` `/contact` → `/free` |
| ページ内テキスト | サブテキスト「まずはお気軽に…」を削除し、3ステップのフロー説明に置き換え |

**3ステップフロー説明（free.vue）:**
1. フォームに情報を入力して送信
2. インストールリンクがメールで自動送信されます
3. 遷移先からSlackにインストールして、すぐに使えます

#### フォーム送信→インストールリンク自動送付

`/api/contact` はもともと `router.use('/api', setTenant)` の下に定義されており、`Bearer token required` エラーが発生していた。`setTenant` より前に移動して認証をバイパス。

**auto-reply メール改修:**
- 差出人: `config.SENDGRID_FROM_EMAIL` → `support@kuragedeal.ai`
- 件名: 「お問い合わせを受け付けました」→「Slack へのインストールリンクをお送りします」
- 本文: インストールリンク（`/slack/install`）を直接記載

**送信完了テキスト改修（free.vue）:**
- 「1営業日以内にインストールリンクをお送りします」→「インストールリンクをメールでお送りしました。ご確認ください。」

#### SendGrid Domain Authentication（kuragedeal.ai）設定完了

| レコード | 内容 |
|---------|------|
| CNAME: `url4601`, `61045470` | SendGrid トラッキング |
| CNAME: `em3941` | バウンス処理 |
| CNAME: `s1._domainkey`, `s2._domainkey` | DKIM署名（最重要） |
| TXT: `_dmarc` | DMARC（p=none・監視のみ） |

Cloudflare DNS に追加 → SendGrid Verify → **✅ Verified**

#### support@kuragedeal.ai 受信→AI自動返信（Cloudflare Email Worker）

**アーキテクチャ:**
```
メール受信（support@kuragedeal.ai）
  ↓ Cloudflare Email Worker
  ├─ message.forward("suzuki@shiro-k.jp")  ← 転送（必ず実行）
  └─ fetch POST /api/inbound-email         ← AI返信生成
       ↓
       Claude Haiku（クラゲディールサポートとして応答）
       ↓
       SendGrid FROM: support@kuragedeal.ai → 送信者に返信
```

**新規ファイル:**
- `email-worker/wrangler.toml` — Worker設定（API_URL・FORWARD_TO）
- `email-worker/package.json` — postal-mime依存
- `email-worker/src/index.js` — メール受信→転送+AI返信ロジック

**新規APIエンドポイント（`api/src/routes/api.ts`）:**
- `POST /api/inbound-email`（認証不要・setTenant前に定義）
- 受信: `{ from, subject, text }`
- 処理: Claude Haiku でサポート返信生成 → SendGrid で返信送信

**Cloudflare設定:**
- Email Routing → `support@kuragedeal.ai` の宛先を「Send to a Worker」→ `kuragedeal-email-worker` に変更済み
- Worker URL: `https://kuragedeal-email-worker.suzuki-698.workers.dev`

**現状:** Delivered は確認済み（Gmail 迷惑メールに入る）。`support@kuragedeal.ai` は今日初稼働のため信頼スコアが低い。インストールリンクメールに「迷惑メールではないと設定してください」の一行を追加済み。時間とともに改善される。

#### deploy.yml シークレット永続化

`SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` が `gcloud run deploy` のたびに消える問題を根本対処。`.github/workflows/deploy.yml` の `--set-secrets` に2つを追加。

#### Cloud Run 最新リビジョン

| リビジョン | 内容 |
|-----------|------|
| `slacksfa-api-00274-zxc` | /api/inbound-email追加・support@kuragedeal.ai送信 |
| `slacksfa-api-00275-5fh` | 3レベル AI キルスイッチ・nurturing_mode廃止・migration 024 適用 |

---

## Phase 4 ビジョン：AI 自律化 & ナレッジ拡張

### AI 自律コミュニケーション — 段階的自律モデル

現在の AI は「通知 → 人間が判断 → 人間が実行」のループ。これを段階的に自律化する。

| Phase | 名称 | 動作 | 状態 |
|:---|:---|:---|:---|
| **A** | 通知のみ | インバウンド活動を検知 → 温度感・推奨アクションを Slack 通知 | ✅ 実装済み |
| **B** | 下書き承認 | AI が返信下書きを生成 → ユーザーが [承認]/[修正]/[エスカレート] | ✅ 実装済み |
| **C** | セミオート | **カテゴリー別に自動送信を許可**。安全なカテゴリー（お礼・日程調整・資料送付）は人間の承認なしで AI が送信。重要な判断（価格交渉・契約条件）は Phase B のまま承認制 | 🔮 構想 |
| **D** | フルオート | AI が営業プロセス全体を自律実行。人間は例外処理とレビューのみ | 🔮 長期構想 |

#### Phase C 設計メモ

```
テナント設定で「自動送信を許可するカテゴリー」をチェックボックスで選択:
  ☑ お礼メッセージ（面談後のフォローアップ）
  ☑ 日程調整（候補日の提示・確認）
  ☑ 資料送付（依頼された資料の送付）
  ☐ 価格提示（見積もり・ディスカウント）
  ☐ 契約関連（条件交渉・合意形成）

自動送信時も Slack に「✅ ABC社に日程調整メールを送信しました」と事後通知。
ユーザーはいつでもカテゴリーの自動送信を OFF にできる。
```

**Phase C の前提条件:**
- TASK_16（問いかけ型コーチング）完了 — AI の判断精度が十分に検証されていること
- 送信ログの完全な透明性（いつ・誰に・何を送ったか全履歴）
- ワンクリックで自動送信を全停止できる「キルスイッチ」

### Agentic Search（RAG の進化形）

ナーチャリングや商談コーチングで外部知識（業界情報・競合分析・ベストプラクティス）を参照する際、従来の RAG（Retrieval-Augmented Generation）ではなく **Agentic Search** を採用する方針。

> Boris Cherny 氏（Anthropic エンジニア / Claude Code 開発者）の知見:
> エージェントが自ら検索クエリを組み立て、結果を評価し、必要なら再検索する。
> 固定のベクトル DB チャンクではなく、動的な探索ループで最適な情報を取得する。

**SlackSFA への適用案:**
- 商談コーチング時: AI が「この業界の平均受注サイクル」「競合の最新動向」を自律的に検索し、コーチングの問いかけに反映
- エンリッチメント: 会社情報の補完を固定 API ではなく Web 検索 + AI 判断で実行
- ナーチャリング: 見込み客の最新ニュース（プレスリリース・IR 情報）を自動収集し、パーソナライズされたアプローチを提案

**技術的方向性:** MCP（Model Context Protocol）サーバーとして Web 検索・社内ナレッジ・CRM データを接続し、AI エージェントが必要に応じてツールを選択・実行する。

### Agentic Search / ナレッジ構築の請負ビジネス化

Agentic Search が機能するには、AI が参照する **社内ナレッジの整備** が必要。これは会社ごとにデータの所在・形式・粒度が全く異なるため、SaaS の標準機能としてセルフサービス化するのは非現実的。

#### SaaS / 請負の線引き

| SaaS に含める（全顧客共通） | 請負（個社対応） |
|:---|:---|
| Web 検索（業界ニュース・競合情報） | 社内ナレッジの棚卸し・構造化 |
| CRM データ内の Agentic Search | 基幹システム・社内 Wiki 連携 |
| 汎用コーチングナレッジ | 自社製品カタログの取り込み |
| | 業務フロー固有のカスタマイズ |

#### ビジネスモデル

```
SlackSFA（SaaS 月額）
  ¥980〜¥3,500/user
  → Slack CRM + コーチング + 汎用 Agentic Search（Web 検索）
        ↓
  「AI にもっと仕事を任せたい」「自社データで賢くしたい」
        ↓
ナレッジ構築（請負契約）
  初期構築: 30-100万円
  → データ棚卸し・クレンジング・MCP コネクタ開発
  → 納品物: 顧客専用 MCP サーバー + 運用マニュアル
        ↓
保守契約（月額）
  5-10万円/月
  → データ更新・チューニング・新コネクタ追加
```

#### 請負の納品物イメージ

```
MCP サーバー（顧客専用）
  ├── 社内 Wiki コネクタ（Confluence / Notion）
  ├── 製品カタログ検索
  ├── 過去提案書・事例検索
  └── 基幹システム連携（在庫・納期照会）
```

**横展開戦略:** 最初の数社は工数がかかるが、業種ごとにコネクタをテンプレート化（製造業パック・SIer パック等）すれば利益率が上がる。Salesforce の導入コンサルと同じ構造。

#### 顧客獲得フロー

```
Step 1: SlackSFA 無料トライアル（SaaS）
  → 「Slack でメモするだけで CRM が動く」を体験
Step 2: 有料プラン契約（SaaS 月額）
  → コーチング・ナーチャリング・日次ブリーフィング
Step 3: 請負契約 — ナレッジ構築
  → AI が自社製品・過去事例を踏まえて自律的に返信可能に
Step 4: 保守契約（月額）
  → 継続的なデータ更新・精度改善
```

---

## ロードマップ

```
2026年
 3月               4月          5月          6月     7月          8月
 ├──────────────────┼────────────┼────────────┼──────┼────────────┤
 │ Phase 3 完了     │品質安定化   │ SaaS 化準備                    │ Phase 4    │
 │ TASK_01-16 ✅    │テスト+修正  │ OAuth + Stripe + App Directory │            │
 │ /coach+alias ✅  │            │ 実運用フィードバック反映        │ Phase C    │
 │ Migration 019 ✅ │            │            │                    │ (セミオート)│
 │                  │            │ β版       ▲ 外販               │ Agentic    │
 ▲ 現在地(安定化)    ▲ テスト完了  ▲ SaaS化着手 ▲ β版    ▲ 外販   ▲ AI自律化
```

---

## 競合分析: Slack新AI機能「Where AI works」（2026-04-05 分析）

### 概要
2026年4月、Slackが「AIが働く場所」へ進化を発表。Claude基盤の新Slackbot、Slack CRM（Salesforce統合）、エージェント自動化機能を2026年6月GAでリリース予定。

### ポジショニング: 脅威ではなく追い風

| 観点 | Slack新機能 | SlackSFA |
|------|-----------|---------|
| ターゲット | Salesforce既存ユーザー（大企業） | Salesforce不要の中小企業 |
| CRMの位置づけ | SFデータの「ビューワー」 | CRM自体がSlackで完結 |
| 価格 | Slack Business+ + SF = ¥56,000〜470,000/月（10人） | **¥9,800/月（何人でも）** |
| AIの深さ | 汎用（パイプライン表示、レポート生成） | **営業特化（MEDDPICC、状況診断、問いかけ型コーチング）** |
| 自律性 | 人間が指示→AIが実行 | **Phase C: AIが自律フォローアップ** |

### 差別化の核心
1. **「Salesforceが要らなくなる」** — Slack新機能は「SFを開かなくて済む」だけ
2. **価格破壊** — 1/10以下の月額
3. **AIコーチングの深さ** — 汎用AIでは不可能なMEDDPICC+状況診断
4. **Phase C（セミオート送信）** — 根本的に異なるアーキテクチャ

### マーケティング進行計画

#### Phase M-1: LP準備（4月中旬〜5月上旬） — β版リリースと同時

| タスク | 期限 | 担当 | 成果物 |
|--------|------|------|--------|
| LP ワイヤーフレーム作成 | 4/14 | オッパ | Figma |
| コピーライティング（キャッチ: 「Salesforce不要のSlack CRM。月¥9,800。」） | 4/18 | オッパ | LP原稿 |
| LP実装（Nuxt3 or Next.js SSG） | 4/25 | 黒子 | デプロイ済みLP |
| 料金表ページ（Free/Standard/Premium比較） | 4/25 | 黒子 | LP内ページ |
| お問い合わせフォーム（SendGrid or Googleフォーム） | 4/25 | 黒子 | 動作確認済み |

#### Phase M-2: 比較コンテンツ（5月〜6月GA前）

| タスク | 期限 | 担当 | 成果物 |
|--------|------|------|--------|
| 「Slack CRM vs SlackSFA」比較記事 | 5/15 | オッパ | ブログ記事 or LP内ページ |
| 「Salesforceからの移行ガイド」 | 5/30 | オッパ+黒子 | ドキュメント |
| SEO対策（「Slack CRM」「Salesforce 代替」「Slack 営業管理」） | 5/30 | オッパ | メタタグ・構造化データ |
| Slack新機能GA直前プレスリリース | 6月初旬 | オッパ | PR文 |

#### Phase M-3: 差別化機能の前倒し（5月〜7月）

| タスク | 元予定 | 前倒し | 理由 |
|--------|--------|--------|------|
| Phase C（セミオート送信）着手 | 8月 | **6月** | 最大の差別化ポイント。Slack GA前に「AIが自律営業する」デモ動画を用意 |
| MCP基盤（外部ツール連携） | Phase 4 | **7月** | 「拡張性」を示す。最初はWeb検索MCPのみで十分 |

#### Phase M-4: Slack GA後の攻勢（6月〜）

| タスク | 期限 | 内容 |
|--------|------|------|
| Slack新機能レビュー記事 | GA後1週間 | 「使ってみた」記事で流入獲得。最後にSlackSFAを紹介 |
| Product Hunt登録 | 6月 | 英語圏への露出 |
| Xでの発信開始 | 6月〜 | 「#SlackCRM」「#Salesforce代替」でポジション確立 |

### ロードマップ（更新版）

```
2026年
 4月          5月          6月          7月         8月
 ├────────────┼────────────┼────────────┼───────────┤
 │品質安定化   │ SaaS準備    │ β版+外販   │ Phase 4   │
 │テスト+修正  │ OAuth+Stripe│ App Dir申請│           │
 │            │ LP公開 ←M-1 │ Slack GA ← │ Phase C   │
 │            │ 比較記事←M-2│ 攻勢  ←M-4 │ (セミオート)│
 │            │            │ Phase C着手│ MCP基盤   │
 ▲ 現在地      ▲ SaaS+LP    ▲ β版+GA攻勢 ▲ 差別化加速
```

---

## 月額コスト（概算）

| 区分 | 月額 |
|:---|:---|
| Anthropic API | ~¥1,000〜3,000 |
| GCP（Cloud Run + Cloud SQL） | ~¥5,000〜15,000 |
| Slack Pro | 会社負担 |
| **合計** | **~¥6,000〜18,000/月** |

---

## 参照ドキュメント一覧

| ファイル | 内容 |
|:---|:---|
| `SONNET_INSTRUCTIONS.md` | Sonnet への実装指示書（TASK_13 AI Flow 用） |
| `TASK_09_E2E_SEED_DATA.md` | Seed Data + Playwright E2E テスト設計 |
| `TASK_10_PROBABILITY_ENGINE.md` | センチメント駆動確率エンジン設計（完了） |
| `TASK_13_AI_FLOW_VIEW.md` | AI Flow ビュー統合設計（完了） |
| `TASK_11_WEB_DASHBOARD.md` | 旧 Web 設計（TASK_13 に統合・参考資料） |
| `TASK_12_SLACK_CRM_LIST.md` | 旧 Slack 設計（TASK_13 に統合・参考資料） |
| `Phase2.5_OVERVIEW.md` | Phase 2.5 全体設計書 |
| `SONNET_INSTRUCTIONS_NEXT.md` | /coach + alias 実装指示（完了） |
| `SONNET_INSTRUCTIONS_TESTGUARD.md` | テストガード + RLS 監査指示（次の黒子作業） |
| `TEST_SCRIPTS.md` | テスター別テストスクリプト（3名分） |
| `SONNET_INSTRUCTIONS_DEPLOY_AND_LP.md` | デプロイ + LP準備指示（registrationDraft修正・sessionsクリーンアップ・LP構成） |

---

## 重要リード：OPRO 本田雄介さん（2026-04-12 注記）

- **氏名:** 本田 雄介（Slack: `U05R8DEAEPJ` / yusuke.honda@jp.opro.net）
- **会社:** OPRO（オフィス系SaaSを提供する日本企業）
- **ステータス:** テスター4として2026-04-02からα版を実際に使用中
- **重要度:** 同社の偉い方（意思決定層）がプロダクトに強い興味を持っている

**オンボーディング状況:**
- shiro Slack ワークスペースに Slack Connect（外部ゲスト）で参加中だが、アプリが見つからない状態
- → LPのお問い合わせフォームから正式申し込みしてもらう方針

**本田さんからの機能要望（次期バージョン候補）:**
- 「見積もりから請求書発行まで」を Slack 上で完結させてほしい
- 営業の後工程（クロージング後の事務作業）もSlackで完結するイメージ
- OPROはオフィス文書系SaaSなので、この領域への知見・連携可能性もあり

**本田さんの重要な指摘（戦略的示唆）:**
> 「shiroは小さな会社なので、大きな企業を取引先に加えるのは難しい。OPROと何らかの形で提携できれば、この壁を越えられるかもしれない」

- shiroの課題は**プロダクト力ではなく信用力・ブランド力**
- OPROのような既存ブランド・営業網を持つ企業との提携が突破口になりえる
- 提携形態の候補: OEM/ホワイトラベル、代理販売、共同開発、資本業務提携など

**→ 最初の法人契約候補として最優先でフォローする**  
**→ テスト中のフィードバックを丁寧に拾い、要望はロードマップに反映を検討**  
**→ OPRO提携はシロの成長戦略上の最重要課題として別途検討する（Opusへ設計依頼推奨）**

---

## Phase C 候補：AIチャット + Slack連携アドオン（2026-04-12 提案）

### 背景と現状

LP（kuragedeal.ai）に「クラゲくん」AIチャットウィジェットを実装・稼働中。
エスカレーション時に SmallChat チャンネル（C06SWG53XNZ）へ Slack Block Kit 通知が飛び、
担当者がSlackで返信するとLP訪問者にリアルタイムで届く（SmallChat橋渡し）。

**shiro Inc. 自身がこの仕組みを使って見込み客対応をしている。**  
→ ドッグフーディングにより最高の説得材料になる。

**「クラゲディール on クラゲディール」（SoS戦略）**  
Salesforce が自社プロダクトを全社利用して営業トークにする「Salesforce on Salesforce（SoS）」と同じ戦略。  
- shiro の営業活動 → クラゲディールで管理  
- LPの問い合わせ → クラゲくん（自社AI）で一次対応 → Slackで受ける  
- 「本当に使えるんですか？」→「私たちが毎日使っています」で即答できる  
→ 特に展示会・商談でのデモ時に最強のトーク材料になる。

### 実装済み内容

```
LP訪問者 ──→ クラゲくん(Claude Haiku) ──→ 一次対応（Q&A）
                                            ↓ エスカレーション検知
                                    SmallChatチャンネルへSlack通知
                                    （Block Kit: 理由・日時・会話履歴）
                                            ↓
                                    担当者がSlackで返信
                                            ↓
                                    LP訪問者にリアルタイム応答
```

### ビジネス化の方向性

**アドオン名（仮）:** 「サイトチャット連携」または「Webチャット for クラゲディール」

| 項目 | 内容 |
|:-----|:-----|
| 提供形態 | Premium プラン特典 or 単体オプション（例: +¥2,980/月） |
| 必要なもの | SmallChat アカウント + 専用Slackチャンネル設定 |
| 差別化 | HubSpotチャット等は別ツール起動が必要。クラゲはSlack一本で完結 |
| ターゲット | 1〜30人営業チームで自社サイトを持つ会社 |

### Opusへの検討依頼

以下の点を設計・評価してほしい：

1. **機能スコープ定義**
   - MVP（最低限）vs フル機能（顧客自動登録連携等）の境界線はどこか
   - 「クラゲくん」のシステムプロンプトをテナントごとにカスタマイズ可能にする必要があるか

2. **実装コスト見積もり**
   - テナントごとの `support_slack_channel` をDB管理（現在は env var）
   - `/settings` モーダルへの「チャットサポートチャンネル」項目追加
   - LP埋め込み用スクリプト（`<script src="https://cdn.kuragedeal.ai/chat.js" data-tenant="xxx">`）

3. **課金モデル判断**
   - Premiumに含めるべきか、別途課金すべきか
   - SmallChat（外部サービス）への依存リスクをどう扱うか

4. **ロードマップへの組み込み**
   - Phase C（セミオート）との関係整理
   - 7〜8月の「差別化加速」フェーズに入れるべきか

---

## 近い将来の検討課題：展示会出展によるリード獲得（2026-04-12 提案）

### 背景

クラゲディールを普及させるにはリード獲得が最優先。展示会は中小企業の営業マネージャー・IT担当が集まる場として有効。

### なぜ展示会と相性が良いか

- **デモが30秒で完結** — Slackに一言打つだけ。ブースで即実演できる
- **SoS トークが活きる** — 「このブースの問い合わせ管理もクラゲディールでやってます」
- **名刺 → その場でコンタクト登録デモ** — 製品の価値を体験させながらリードを取れる
- **ターゲット層が集まる** — Japan IT Week、Sales Tech Summit 等

### 検討事項（Opusへの依頼）

1. 出展タイミング — β版外販後か、リード先行獲得フェーズで早期出展か
2. 費用対効果 — 小ブース出展費用（推定50〜100万円）vs リード獲得単価
3. 共同出展の可能性 — パートナー企業（OPROなど）と割り勘でリスク分散
4. 展示会以外のオフライン施策との比較（勉強会・ウェビナー等）

---

## Salesforceコミュニティとの関係戦略（2026-04-12）

### 基本方針
Salesforceのエコシステムに顔を出して関係を作っておく。ただし**部門によって競合/非競合が異なる**ため、接触先を見極めることが重要。

### 部門別の関係性

| 部門・コミュニティ | 関係性 | 方針 |
|:---|:---|:---|
| **SB（スモールビジネス）営業チーム** | ⚠️ **競合** | 1〜30人がまさに同じターゲット。直接的な競合になる |
| **Enterprise / Mid-market 営業** | ✅ 非競合 | クラゲのターゲット外。住み分けできる |
| **ISVパートナー / AppExchange** | ✅ 友好 | 「Salesforceが重すぎる層向けの補完製品」として共存できる |
| **SFUG（ユーザーグループ）** | ✅ 友好 | 現場の営業担当と直接繋がれる。リード獲得の場としても有効 |
| **World Tour Tokyo 等イベント** | ✅ 友好 | ISV・パートナー界隈と交流。SB部門には近づかない |

### 住み分けトーク（非競合部門向け）
> 「Salesforceが重すぎる1〜30人チームが最初に使えるツールです。大きくなったらSalesforceへ、という流れを作りたい」

→ Enterpriseや中堅向けのSalesforce担当には脅威にならず、むしろ「将来の顧客予備軍を育てている」と映る可能性がある。

### SB部門との関係の複雑さ
shiro Inc. 自身がSalesforce SBの顧客でもある。競合でありながら顧客という「人間らしい難しい関係」。距離感は慎重に保つ。

### アライアンス部門・開発ベンダーとは積極的に関係構築
SalesforceのAlliance部門や他の開発ベンダーはオープン。積極的に交流してよい。

### Slack部門との関係
Slack部門はSalesforce社内でも特に優秀な人材が集まっている。SlackはSalesforceのこれからのメインプロダクトになると考えられており、この流れは必ず起きる。クラゲディールはその波の先頭にいる。

### 創業者のビジョン（重要）
> 「SaaS is Dead ではなく、**CRM is Dead**だと思っている」

- 死んでいるのはSaaSというデリバリーモデルではなく、「**営業担当が自分で入力するCRM**」という概念そのもの
- AIが代替できる今、入力させる設計のツールに存在意義はなくなっていく
- クラゲディールはこの構造変化を正面から捉えたプロダクト

```
旧世界: 営業 → CRMに入力 → データができる
新世界: 営業 → Slackに話す → AIがCRMになる
```

→ LP・展示会・対外発信でこのフレーミングを一貫して使うことで、ポジションが明確になる。

---

## 2026-04-15〜16 NLU品質安定化テスト・バグ修正（コミット: `2df7771`）

### テスト結果（確認済み ✅）

| シナリオ | 結果 |
|---------|------|
| `株式会社TS 佐藤さんに電話した` → add_note | ✅ 正常（last_nameに「株式会社TS 佐藤」が入りILIKE検索でヒット） |
| `メモ表示して` → コンテキスト引き継ぎで佐藤（TS）のメモを表示 | ✅ 正常 |
| `株式会社TS 佐藤さんの商談を作成` → create_deal | ✅ 正常 |
| `佐藤さんのメモを見せて` → MEDDPICC分析が後から出てくる | ✅ 修正済み（add_note自動コーチングtrigger削除） |

### 修正内容（6ファイル変更）

#### 1. add_noteからの自動コーチングtrigger削除（`message.ts`）
- **問題:** メモ追加のたびに `assessAndNotify` が非同期で走り、MEDDPICCスコア+コーチング質問がドーッと出てくる
- **修正:** `message.ts` の lines 1316-1343（`dealIdForCoaching` ブロック全体）を削除
- **コーチングの起動場所:** `/coach` コマンド・`deal_coaching` intent からのみ（明示的操作時）

#### 2. スペースなし登録対応（`fast-intent.ts` Pattern 2a追加）
- **問題:** `株式会社TS佐藤さんで登録`（スペースなし）が Pattern2（`\s+`必須）に引っかからずHaikuフォールバック→「会社名を教えてください」と聞いてくる
- **修正:** Pattern2a追加: `((?:株式|有限|合同)会社[英数字カタカナ]+)(漢字1-4文字)さん...で登録`
- **対象:** `株式会社TS佐藤` → company=株式会社TS / last_name=佐藤 ✅
- **非対象:** `株式会社田中商事佐藤`（漢字会社名+スペースなし）→ 引き続きHaiku（許容範囲）

#### 3. 顧客削除のFK制約エラー修正（`contact.service.ts`）
- **問題:** `佐藤さんを削除` → 確認 → 実行 → `deals_primary_contact_id_fkey` 違反でエラー
- **原因:** `deals.primary_contact_id` に ON DELETE CASCADE/SET NULL が未設定のためDELETE失敗
- **修正:** `deleteContactService()` 内で DELETE前に `UPDATE deals SET primary_contact_id = NULL WHERE primary_contact_id = $1` を実行

#### 4. ディール一覧「最終活動内容」が空の問題修正（`api.ts` + `note.service.ts`）
- **問題:** WebのFlowList（ディール一覧）の「最終活動内容」列が常に `—` 表示
- **原因1:** `/api/deals` が `d.*, a.name` のみ返し `last_activity_summary` を含まない
- **原因2:** `note.service.ts` がメモ追加時に `deals.last_activity_at` を更新しない
- **修正1:** `/api/deals` に `crm_notes` から最新メモ60文字を取るサブクエリ追加
- **修正2:** `note.service.ts` でメモ追加時に `deals.last_activity_at = NOW()` を更新（deal直接 or contact経由）

#### 5. フルネーム検索対応（`contacts.ts` + `api.ts`）
- `searchContacts`: `(last_name || first_name) ILIKE` と `(last_name || ' ' || first_name) ILIKE` を追加
- `GET /api/contacts`: 同様のILIKE条件を追加（Webの顧客一覧検索「小林太郎」がヒットするように）

### 現在の状態（2026-04-16）

| 項目 | 状態 |
|------|------|
| 自動コーチングtrigger（add_note時）| ✅ 削除済み。/coachのみで起動 |
| スペースなし登録（株式会社TS佐藤） | ✅ Pattern 2aで対応 |
| 顧客削除のFK制約エラー | ✅ 修正済み |
| ディール最終活動内容 | ✅ サブクエリで取得 + last_activity_at更新 |
| フルネーム検索 | ✅ 修正済み |
| Anthropic APIキー | ✅ 有効（slacksfa-devキー / Apr 15に使用確認） |

### 翌日（4/16）のアクション

1. **LPブラッシュアップ** — 色調整・コピー改善・CVR向上施策
2. **テスト継続** — TEST_SCENARIOS_20260415.md の E〜H（同名disambiguationボタン、削除後確認、エッジケース）
3. **未テスト確認シナリオ:**
   - E-1〜E-3: 同名コンタクトのdisambiguationボタン → 選択後のコンテキスト引き継ぎ
   - F-1: 存在しない顧客の削除（エラーメッセージ確認）
   - H-2〜H-5: エッジケース（改行入り・極端な長文・敬語バリエーション）

---

## Phase 7-A.1 完了：個別ユーザー認証への完全移行（2026-05-06〜07）

オッパレビュー Critical-1（X-Slack-User-Id ヘッダ自己申告問題）の解消。
従来の「テナント API キー UUID + X-Slack-User-Id ヘッダ自己申告」を完全廃止し、
Bearer トークン 1 個から (tenant_id, slack_user_id, role) をサーバーが
改ざん不能に決定する方式に切り替え。

### 設計判断
- キー形式: `kdu_<43 文字 base64url>`（256bit エントロピー）、SHA-256 ハッシュ保管
- 保管先: 別表 `user_api_keys`（RLS なし）。当初オッパ提案は users 列追加だったが、
  users 表は FORCE RLS のため tenant 文脈未確定の認証ルックアップに不向きだったので
  別表化に変更。tenant_plans と同じパターンに揃える。
- last_used_at: lazy update（5 分粒度）で UPDATE 頻度を約 1/300 に抑制
- 互換期間なし: ログ確認の結果β テスター Web ログイン履歴ゼロのため即切替

### 変更点（Day 1: サーバー側、commit `8f0459c`）
- migration `035_user_api_keys.sql` / `036_dev_seed_user_key.sql`
- `services/user-key.service.ts` 新規（issue / verify / touch / revoke / getKeyMetaForUser）
- `routes/api.ts setTenant`: 新方式のみ。X-Slack-User-Id 完全無視、DEV_TENANT_ID 撤去
- `routes/stripe.ts`: 同方式 + admin only に変更（プラン変更・解約は admin のみ）
- `index.ts`: CORS Allow-Headers から `X-Slack-User-Id` 削除
- `slack/commands/settings.ts`: /setting モーダルに「個人ログインキーを発行する / 再発行する」
- `routes/oauth.ts`: ようこそ DM/メールから tenant UUID キー送信を撤去
- 単体テスト 15 件追加（user-key.service）

### 変更点（Day 2: Web 側）
- `Login.vue`: 入力欄 1 個（kdu_...）、Slack User ID 入力欄撤去
- `lib/api-client.ts`: `kd_user_key` 読み込み、X-Slack-User-Id 送信廃止、VITE_API_KEY 廃止
- `App.vue` / `router/index.ts` / `Settings.vue` / `Debug.vue`: localStorage `kd_api_key` → `kd_user_key`
- `Debug.vue`: 視点切替 UI（impersonation）撤去 — Bearer から決定するため不可能になった
- `web/Dockerfile`: VITE_API_KEY ARG 削除

### 検証
- API: tsc=0 / vitest 332/332 PASS
- Web: vite build 成功

### β テスター案内（要・鈴木さん作成）
旧 UUID キーで運用中のテスターへ「Slack で `/setting` → 個人ログインキーを発行する → コピー → 新ログイン画面に貼り付け」の 1 枚ペラ。

### 残タスク（Phase 7-A.2 候補・後日）
- Slack マジックリンクログイン（API キーコピペ不要化）

---

## Phase 7 完全完了（2026-05-08 オッパ最終承認）

Phase 7 全 8 項目がオッパレビュー通過し完了。β 版の認証・認可・本番化準備は揃った。

| Phase | 内容 | 完了日 | 主 commit |
|---|---|---|---|
| 7-A.1 | 個別ユーザー API キー認証（C1 解消） | 2026-05-06〜07 | `8f0459c` + `688843b` |
| 7-B | fail-closed 徹底（C2 / C3） | 2026-05-04 | `2722807` |
| 7-C | 起動時 advisory lock（C4） | 2026-05-04 | `2722807` |
| 7-D | SQL placeholder 化（M1 + M6） | 2026-05-07 | `6405959` + `3d4340e`（軽微改善） |
| 7-E | REST API RBAC 完全化（C5 / C6） | 2026-05-04 | `6724f08` |
| 7-F | Slack delete RBAC（C7） | 2026-05-04 | `6724f08` |
| 7-G | RBAC 回帰テストスイート（M8） | 2026-05-04 | `56bd69d` |
| 7-H | Web UI Router admin guard（M3 / M7） | 2026-05-04 | `2722807` |
| Stripe POST 化 | Phase 7-A.1 後続バグ解消 | 2026-05-07 | `2de4f8c` |

### 軽微改善 M-A / M-B（2026-05-08 commit `3d4340e`）
- M-A: sentiment-summary の params を `[sid, sid]` 重複 push + `$1/$2` 別参照に変更（fragment 自己完結性向上）
- M-B: `accountVisibilityFragment` に複数 fragment 連結時の注意コメント追加
- M-C（`applyDualOwnerFilter` ヘルパー化）はオッパも「過剰設計」として不採用

### 次のステップ
- β 継続運用で実環境動作を観察
- Phase 7-A.2（Slack マジックリンク）は 2026-06 初〜中旬に着手予定
- Salesforce パートナー面談に向けて Security Review 提出可能状態として進められる
