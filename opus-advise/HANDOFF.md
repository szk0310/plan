# SlackSFA プロジェクト HANDOFF
**最終更新：2026年3月20日**

---

## プロジェクト概要

Slack 完全統合型 AI-CRM「SlackSFA」の自社開発。Salesforce の代替として社内で使いながら、将来的に SaaS 外販を目指す。

**核心価値：** CRM の入力は Slack で 30 秒。あとは AI が顧客との関係を温める。

**リポジトリ：** `szk0310/slackSFA`
**本番 API：** `https://slacksfa-api-808596335261.asia-northeast1.run.app`
**本番 Web：** `https://slacksfa-web-808596335261.asia-northeast1.run.app`

---

## Phase 2.5 完了状況（2026年3月20日 完走）

### 完了タスク一覧

| タスク | 内容 | コミット |
|:---|:---|:---|
| TASK_01 | RLS セッションリーク修正（withTenant + SET LOCAL） | ✅ |
| TASK_02 | 不要依存削除（Gemini/OpenAI）、vitest 導入 | ✅ |
| TASK_03 | leads テーブル廃止・contacts 統合（lifecycle_stage） | ✅ |
| TASK_04 | テスト基盤（client.test.ts / intent-parser.test.ts / contact.service.test.ts / e2e） | ✅ |
| TASK_05 | Terraform IaC（GCP Cloud Run + Cloud SQL + VPC + Secrets） | ✅ |
| TASK_06 | エンリッチメント（Claude Haiku + NLU 自動トリガー） | ✅ |
| TASK_07 | Slack Block Kit（/crm-list + コンタクト詳細モーダル） | ✅ |
| TASK_08 | 商談クロージング AI コーチ（MEDDPICC 8要素評価） | ✅ |
| 品質改善 | ai-models.ts 一元化・Zod バリデーション・リクエストログ・エラーログ修正 | ✅ |
| TASK_08追加 | スコア低下アラート（-10%）・週次サマリー（月曜8:00 JST） | ✅ |

### 実行済み DB マイグレーション

| ファイル | 内容 | 本番適用 |
|:---|:---|:---|
| 003_contacts | leads → contacts 統合 | ✅ |
| 007_nurturing_stage | nurturing_stage カラム追加 | ✅ |
| 008_drop_leads | leads テーブル削除 | ✅ |
| 009_deal_progress | 商談達成率カラム + deal_progress_history | ✅ |

---

## 現在の機能一覧

| 機能 | 状態 |
|:---|:---|
| Slack Bot 自然言語 CRM 操作 | ✅ 稼働中 |
| GCP Cloud SQL（PostgreSQL 15）| ✅ 稼働中 |
| マルチテナント設計（RLS + withTenant）| ✅ 修正済み |
| AI 意図解析 NLU（Claude Haiku） | ✅ 稼働中 |
| 音声入力 → STT → CRM 登録 | ✅ 稼働中 |
| Web ダッシュボード（Vue.js） | ✅ 稼働中 |
| AI ナーチャリング（通知 + 下書き承認） | ✅ 稼働中 |
| アカウントエンリッチメント（Claude） | ✅ 稼働中 |
| /crm-list スラッシュコマンド | ✅ 稼働中 |
| 商談コーチング AI（MEDDPICC）| ✅ 稼働中 |
| 日次ブリーフィング（毎朝9:00 JST）| ✅ 稼働中 |
| 週次サマリー（月曜8:00 JST）| ✅ 稼働中 |
| Zod バリデーション（PATCH エンドポイント）| ✅ 済み |

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
ENRICHMENT / COACHING: claude-haiku-4-5-20251001
```

---

## Slack App 設定（手動管理）

| 設定 | 値 |
|:---|:---|
| Slash Commands `/crm-list` | `https://slacksfa-api-.../slack/events/` |
| Interactivity Request URL | `https://slacksfa-api-.../slack/events/` |
| Event Subscriptions | 同上 |

---

## 主要ファイル構成

```
api/src/
├── config/
│   └── ai-models.ts          ← AIモデル定数（一元管理）
├── db/
│   ├── client.ts             ← withTenant<T>(), pool
│   ├── migrations/           ← 003〜009
│   └── queries/              ← contacts / deals / accounts / crm_notes
├── services/
│   ├── contact.service.ts
│   ├── deal-coaching.service.ts  ← MEDDPICC評価・アラート・週次サマリー
│   ├── enrichment.service.ts
│   ├── nurturing.service.ts
│   └── draft-reply.service.ts
├── slack/
│   ├── commands/crm-list.ts  ← /crm-list コマンド
│   ├── events/message.ts     ← メインハンドラ
│   ├── events/voice.ts
│   ├── nlu/intent-parser.ts  ← Claude NLU
│   └── views/detail-card.ts  ← コンタクト詳細 Block Kit
└── routes/
    ├── api.ts                ← REST API + リクエストログ
    └── schemas.ts            ← Zod バリデーションスキーマ

web/src/views/
├── DealBoard.vue             ← 達成率バー + 全件評価ボタン
├── DealDetail.vue            ← MEDDPICC詳細 + ネクストアクション
└── ...
```

---

## 残課題・次にやること

### フロント改善（ユーザーフィードバック待ち）
- [ ] フロント全体のフィードバック反映（2026年3月21日〜）
- [ ] /crm-list のページネーション（10件/ページ）
- [ ] コンタクト詳細モーダルの「メモ追加」ボタン

### テスト強化
- [ ] deal-coaching.service のユニットテスト
- [ ] API 統合テスト（supertest）
- [ ] CI でのテスト自動実行・デプロイブロック

### インフラ
- [ ] Terraform dev/prod 環境分離
- [ ] `terraform plan` を CI（PR 時）に追加

### Phase 3 方向
- [ ] Slack App Directory 申請準備
- [ ] マルチテナント OAuth フロー実装
- [ ] Stripe 連携

---

## 設計上の重要決定事項

### Lead/Contact 統合（完了）
- `contacts` テーブルに `lifecycle_stage` で統合：`prospect` / `active` / `customer` / `inactive` / `churned`
- `/api/leads/*` ルートは後方互換のため残存（内部は contacts を参照）

### RLS セッション管理
- `SET LOCAL` + `BEGIN/COMMIT` トランザクション内でのみテナント分離
- `withTenant<T>(tenantId, fn)` ヘルパー経由で全DB操作を行う
- UUID バリデーション（`^[0-9a-f-]{36}$`）で不正 tenantId を拒否

### 商談コーチング（TASK_08）
- MEDDPICC 8要素を Claude Haiku で評価
- スコア変動 ≥5% で Slack 通知、≥-10% 低下でアラート
- 毎朝9:00 日次ブリーフィング、毎週月曜8:00 週次サマリー

---

## ロードマップ

```
2026年
 3月  4月  5月  6月  7月  8月  9月
 ├────┼────┼────┼────┼────┼────┤
 │◀── Phase 2.5 完了 ──▶│
 │ フロント改善・テスト強化│
 │                      │◀── Phase 3 ──▶│
 │                      │ SaaS 化・外販   │
 ▲ 現在地               ▲ 社内本格運用   ▲ β版公開
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
| `TASK_01〜08_*.md` | 各タスクの設計書・完了条件 |
| `PROPOSAL_DEAL_COACHING_AI.md` | Deal Coaching AI 提案書 |
| `AI_Nurturing_Architecture.md` | AI ナーチャリング全体設計 |
| `AI_Nurturing_PhaseB_Design.md` | Phase B 詳細設計 |
| `SONNET_INSTRUCTIONS.md` | Sonnet への実装指示書（Opus作成） |
| `SlackSFA_Business_Report_for_CEO.md` | CEO 向け事業レポート |
