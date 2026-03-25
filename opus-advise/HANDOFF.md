# SlackSFA プロジェクト HANDOFF
**最終更新：2026年3月24日（バグ修正・TASK_15・TASK_16 完了・本番デプロイ完了）**

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

**Migration 015 結果:** 6 accounts 新規作成 → 計 7 accounts。8/11 contacts に account_id 紐付け済み。

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
| AI ナーチャリング（通知 + 下書き承認） | ✅ 稼働中 |
| アカウントエンリッチメント（Claude） | ✅ 稼働中 |
| /crm-list + /crm スラッシュコマンド | ✅ 稼働中（/crm は Slack App 設定に手動追加が必要） |
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
| Slash Commands `/crm` | 未登録 ← **要追加**（同 URL） |
| Interactivity Request URL | `https://slacksfa-api-.../slack/events/` |
| Event Subscriptions | 同上 |

---

## 主要ファイル構成

```
api/src/
├── config/
│   ├── ai-models.ts          ← AIモデル定数（一元管理）
│   ├── crm-labels.ts         ← ステージラベル（育成中/商談中/休眠/廃棄）
│   └── sentiment-signals.ts  ← センチメントシグナル定義
├── db/
│   ├── client.ts             ← withTenant<T>(), pool
│   ├── migrations/           ← 003〜015
│   └── queries/              ← contacts / deals / accounts / crm_notes
├── services/
│   ├── contact.service.ts    ← コンタクト登録（upsertAccount + generateFlowSubject）
│   ├── flow-subject.ts       ← AI 件名自動生成（Haiku）
│   ├── probability-engine.ts ← 確率エンジン + 時間減衰 + 廃棄クリーンアップ
│   ├── deal-coaching.service.ts
│   ├── enrichment.service.ts
│   ├── nurturing.service.ts
│   └── draft-reply.service.ts
├── slack/
│   ├── commands/crm-list.ts  ← /crm-list + /crm コマンド、buildFlowBlocks()
│   ├── events/message.ts
│   ├── events/voice.ts
│   ├── nlu/intent-parser.ts
│   └── views/
│       ├── flow-detail.ts    ← AI Flow 詳細モーダル
│       ├── detail-card.ts    ← コンタクト詳細（旧）
│       ├── note-modal.ts     ← メモ追加モーダル
│       └── edit-modal.ts     ← 顧客編集モーダル
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

---

## 残課題（Phase 3 以降）

### Phase 3 後半（SaaS 化準備）
- [ ] Slack App Directory 申請準備
- [ ] マルチテナント OAuth フロー実装
- [ ] Stripe 連携（課金）

### インフラ
- [ ] Terraform dev/prod 環境分離
- [ ] `terraform plan` を CI（PR 時）に追加

### 将来の会話取得ソース拡張
- [ ] Gmail/Outlook 受信 Webhook（SendGrid Inbound Parse or Gmail API）

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
 3月          4月          5月          6月     7月          8月
 ├────────────┼────────────┼────────────┼──────┼────────────┤
 │ Phase 3    │ Phase 3 後半                    │ Phase 4    │
 │ TASK_13✅  │ promote削除→TASK_15→TASK_16     │            │
 │ TASK_09✅  │ Migration016→backfill           │ Phase C    │
 │ TASK_14✅  │            │ SaaS 化準備        │ (セミオート)│
 │            │            │ β版       ▲ 外販   │ Agentic    │
 ▲ 現在地(T16完)          ▲ β版      ▲ 外販    ▲ AI自律化
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
