# TASK_14: アカウント情報 & AI 利用量管理

> **目的**: ユーザーにサブスク残量・プロフィール・テナント情報を見せる。SaaS 化の課金基盤を作る
> **優先度**: 🟡 高（SaaS 化準備の前提）
> **依存**: なし（独立して実装可能）

---

## 1. 設計方針

### なぜ必要か

- AI 利用コストはテナントごとに変動する。ユーザーが「あとどれくらい使えるか」を把握できないと不満につながる
- SaaS 外販時に課金・プラン管理が必須。今のうちに基盤を作っておく
- 現状、ユーザー情報やテナント設定を確認・変更する画面がない

### 表示場所

| 場所 | 内容 |
|------|------|
| Web: `/settings` | フル機能（プロフィール・テナント・AI 利用量・プラン） |
| Slack: `/crm-settings` | 簡易表示（AI 残量 + プラン + テナント名） |

---

## 2. DB 設計

### 2.1 ai_usage_log テーブル（新規）

全 AI 呼び出しのコストを一元記録する。既存の `ai_draft_replies.cost_estimate_yen` は下書き専用だが、このテーブルは NLU・センチメント・コーチング等すべてを記録する。

```sql
-- 016_ai_usage_log.sql
CREATE TABLE ai_usage_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  operation     TEXT NOT NULL,          -- 'nlu' | 'sentiment' | 'coaching' | 'draft' | 'enrichment' | 'flow_subject'
  model         TEXT NOT NULL,          -- 'claude-haiku-4-5-20251001' | 'claude-sonnet-4-6'
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_yen      NUMERIC(10,4) NOT NULL DEFAULT 0,  -- 円換算コスト
  context_id    UUID,                   -- 関連するコンタクト/商談の ID（任意）
  context_type  TEXT,                   -- 'contact' | 'deal'
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ai_usage_tenant_month ON ai_usage_log (tenant_id, created_at);

ALTER TABLE ai_usage_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_usage_log_tenant ON ai_usage_log
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
```

### 2.2 tenant_plans テーブル（新規）

テナントごとのプラン情報と AI 利用上限を管理する。

```sql
-- 016_ai_usage_log.sql（同じマイグレーション内）
CREATE TABLE tenant_plans (
  tenant_id         UUID PRIMARY KEY REFERENCES tenants(id),
  plan              TEXT NOT NULL DEFAULT 'free',  -- 'free' | 'standard' | 'premium'
  ai_quota_yen      NUMERIC(10,2) NOT NULL DEFAULT 500,  -- 月あたり AI 利用上限（円）
  overage_rate      NUMERIC(5,2) NOT NULL DEFAULT 1.5,   -- 超過時の倍率（1.5 = 50%増し）
  billing_cycle_day INTEGER NOT NULL DEFAULT 1,           -- 請求サイクル開始日
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE tenant_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_plans_tenant ON tenant_plans
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
```

### 2.3 プラン定義

| プラン | 月額 | AI 利用枠 | 超過時 | 対象 |
|--------|------|-----------|--------|------|
| `free` | ¥0 | ¥500/月（≒ Haiku 1,600回） | 機能制限（AI 分析停止） | α/βテスター |
| `standard` | ¥2,000/user | ¥1,500/月 | ¥1.5倍で従量課金 | 一般ユーザー |
| `premium` | ¥3,500/user | ¥5,000/月 | ¥1.2倍で従量課金 | ヘビーユーザー |

※ 現段階では `free` のみ。SaaS 化時に `standard` / `premium` を有効化

---

## 3. AI コスト計算ロジック

### 3.1 オペレーション別コスト

```typescript
// api/src/config/ai-cost.ts（新規）

export const AI_COST_PER_1K_TOKENS = {
  'claude-haiku-4-5-20251001': { input: 0.08, output: 0.4 },   // ¥/1Kトークン
  'claude-sonnet-4-6':         { input: 0.3,  output: 1.5 },
} as const;

export type AiOperation =
  | 'nlu'
  | 'sentiment'
  | 'coaching'
  | 'draft'
  | 'enrichment'
  | 'flow_subject';

export function calculateCostYen(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const rate = AI_COST_PER_1K_TOKENS[model as keyof typeof AI_COST_PER_1K_TOKENS];
  if (!rate) return 0;
  return (inputTokens / 1000) * rate.input + (outputTokens / 1000) * rate.output;
}
```

### 3.2 記録ヘルパー

```typescript
// api/src/services/ai-usage.service.ts（新規）

import { pool } from '../db/client';
import { calculateCostYen, AiOperation } from '../config/ai-cost';

export async function logAiUsage(params: {
  tenantId: string;
  operation: AiOperation;
  model: string;
  inputTokens: number;
  outputTokens: number;
  contextId?: string;
  contextType?: 'contact' | 'deal';
}): Promise<void> {
  const costYen = calculateCostYen(params.model, params.inputTokens, params.outputTokens);
  await pool.query(
    `INSERT INTO ai_usage_log (tenant_id, operation, model, input_tokens, output_tokens, cost_yen, context_id, context_type)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [params.tenantId, params.operation, params.model, params.inputTokens, params.outputTokens, costYen, params.contextId ?? null, params.contextType ?? null]
  );
}

/** 当月の利用状況を取得 */
export async function getMonthlyUsage(tenantId: string): Promise<{
  totalCostYen: number;
  quotaYen: number;
  usagePercent: number;
  remainingYen: number;
  isOverQuota: boolean;
  breakdown: { operation: string; count: number; costYen: number }[];
}> {
  // 当月1日を起点に集計
  const summary = await pool.query(
    `SELECT
       COALESCE(SUM(cost_yen), 0) AS total_cost,
       COUNT(*) AS total_calls
     FROM ai_usage_log
     WHERE tenant_id = $1
       AND created_at >= date_trunc('month', NOW())`,
    [tenantId]
  );

  const breakdown = await pool.query(
    `SELECT
       operation,
       COUNT(*) AS count,
       COALESCE(SUM(cost_yen), 0) AS cost_yen
     FROM ai_usage_log
     WHERE tenant_id = $1
       AND created_at >= date_trunc('month', NOW())
     GROUP BY operation
     ORDER BY cost_yen DESC`,
    [tenantId]
  );

  const plan = await pool.query(
    `SELECT ai_quota_yen FROM tenant_plans WHERE tenant_id = $1`,
    [tenantId]
  );

  const quotaYen = plan.rows[0]?.ai_quota_yen ?? 500;
  const totalCostYen = Number(summary.rows[0].total_cost);
  const remainingYen = Math.max(0, quotaYen - totalCostYen);
  const usagePercent = Math.min(100, Math.round((totalCostYen / quotaYen) * 100));

  return {
    totalCostYen,
    quotaYen,
    usagePercent,
    remainingYen,
    isOverQuota: totalCostYen > quotaYen,
    breakdown: breakdown.rows.map(r => ({
      operation: r.operation,
      count: Number(r.count),
      costYen: Number(r.cost_yen),
    })),
  };
}
```

### 3.3 既存 AI 呼び出しへの組み込み

各 AI 呼び出し箇所で `logAiUsage()` を追加する。Anthropic SDK の response に含まれる `usage.input_tokens` / `usage.output_tokens` を渡す。

| ファイル | 対象関数 | operation |
|----------|----------|-----------|
| `slack/nlu/intent-parser.ts` | `parseIntent()` | `nlu` |
| `services/probability-engine.ts` | `analyzeSentiment()` | `sentiment` |
| `services/deal-coaching.service.ts` | `assessDeal()` | `coaching` |
| `services/draft-reply.service.ts` | `generateDraft()` | `draft` |
| `services/enrichment.service.ts` | `enrichAccount()` | `enrichment` |
| `services/flow-subject.ts` | `generateFlowSubject()` | `flow_subject` |

---

## 4. 利用量アラート

### 4.1 閾値通知（Slack DM）

```
80% 到達時:
  ⚠️ AI 利用量が月間枠の 80% に達しました
  残り: ¥100（¥500 中 ¥400 使用）
  📊 内訳: NLU 320回 / センチメント 45回 / コーチング 12回

100% 到達時:
  🚫 AI 利用量が月間枠を超えました
  Free プランのため、AI 分析機能が一時停止されます。
  翌月1日に自動復旧します。
  💡 Standard プランにアップグレードすると、超過分も従量課金で継続利用できます。
```

### 4.2 チェックポイント

`logAiUsage()` の中で、記録後に累計を確認し、80% / 100% の閾値を超えた場合に1回だけ通知する。通知済みフラグは `tenant_plans` に `notified_80` / `notified_100` カラムで管理（毎月リセット）。

---

## 5. Web: Settings ページ

### 5.0 認証方針

**現段階は認証なし。** Web は社内利用のみ想定。将来的に Slack OAuth を追加予定。
パスワード変更・ログイン・セッション管理は TASK_14 スコープ外。

プロフィール情報は `SLACK_BOT_TOKEN` 経由で Slack API から取得（DB 保存なし）。
ユーザー識別は環境変数 `DEFAULT_SLACK_USER_ID` または固定テナント ID を使用。

### 5.1 画面構成

```
┌─────────────────────────────────────────────────────┐
│  ⚙️ 設定                                             │
│                                                      │
│  ┌── プロフィール ─────────────────────────────────┐  │
│  │  [アイコン]  鈴木 一郎                           │  │
│  │  メール:     szk@shiro-inc.jp                   │  │
│  │  Slack:      @suzuki                            │  │
│  │  部署・役職: 営業部 / マネージャー               │  │
│  │  最終ログイン: 2026年3月23日 14:32              │  │
│  │  ※ プロフィールは Slack と連動しています         │  │
│  └─────────────────────────────────────────────────┘  │
│                                                      │
│  ┌── テナント情報 ─────────────────────────────────┐  │
│  │  組織名:      shiro Inc.                        │  │
│  │  テナントID:  xxxxxxxx-xxxx-xxxx-xxxx           │  │
│  │  登録日:      2026年1月15日                      │  │
│  │  ユーザー数:  3                                  │  │
│  │                                     [編集]      │  │
│  └─────────────────────────────────────────────────┘  │
│                                                      │
│  ┌── AI 利用状況（今月） ──────────────────────────┐  │
│  │                                                  │  │
│  │  ████████████████░░░░░ 72%                      │  │
│  │  ¥360 / ¥500 使用済み     残り ¥140             │  │
│  │                                                  │  │
│  │  内訳:                                           │  │
│  │  ┌────────────┬──────┬────────┐                 │  │
│  │  │ NLU        │ 320回│  ¥96   │                 │  │
│  │  │ センチメント│  45回│  ¥14   │                 │  │
│  │  │ コーチング  │  12回│ ¥180   │                 │  │
│  │  │ 下書き生成  │   8回│  ¥60   │                 │  │
│  │  │ 件名生成    │  11回│   ¥3   │                 │  │
│  │  │ エンリッチ  │   3回│   ¥7   │                 │  │
│  │  └────────────┴──────┴────────┘                 │  │
│  │                                                  │  │
│  │  リセット日: 4月1日                              │  │
│  └─────────────────────────────────────────────────┘  │
│                                                      │
│  ┌── プラン ───────────────────────────────────────┐  │
│  │                                                  │  │
│  │  現在のプラン: 🆓 Free                           │  │
│  │  AI 利用枠:   ¥500/月                            │  │
│  │  超過時:      AI 分析一時停止                     │  │
│  │                                                  │  │
│  │  ┌─────────────┐  ┌─────────────┐               │  │
│  │  │ Standard    │  │ Premium     │               │  │
│  │  │ ¥2,000/user │  │ ¥3,500/user │               │  │
│  │  │ 枠 ¥1,500  │  │ 枠 ¥5,000  │               │  │
│  │  │ 超過:従量   │  │ 超過:従量   │               │  │
│  │  │ [詳細]     │  │ [詳細]     │               │  │
│  │  └─────────────┘  └─────────────┘               │  │
│  │                                                  │  │
│  │  ※ プランのアップグレードは近日公開予定           │  │
│  └─────────────────────────────────────────────────┘  │
│                                                      │
│  ┌── データ管理 ──────────────────────────────────┐  │
│  │  コンタクト数:   11 / 制限なし                   │  │
│  │  商談数:          8 / 制限なし                   │  │
│  │  メモ数:         20                              │  │
│  │                                                  │  │
│  │  [データエクスポート (CSV)]                       │  │
│  └─────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

### 5.2 ルーティング

```typescript
// web/src/router/index.ts に追加
{ path: '/settings', component: () => import('../views/Settings.vue') }
```

`App.vue` の左メニューに「設定」アイコンを最下部に追加。

---

## 6. Slack: /crm-settings コマンド

```
⚙️ *SlackSFA 設定*

📊 *AI 利用状況（3月）*
████████████████░░░░░ 72%
¥360 / ¥500 使用済み（残り ¥140）

📋 *プラン:* Free
🔄 *リセット日:* 4月1日
👥 *ユーザー数:* 3
🏢 *テナント:* shiro Inc.

[詳細を Web で見る]
```

- `api/src/slack/commands/crm-settings.ts`（新規）
- Slash Command `/crm-settings` を Slack App に登録する必要あり

---

## 7. API エンドポイント

| エンドポイント | メソッド | 用途 |
|---------------|---------|------|
| `GET /api/settings/profile` | GET | Slack API からプロフィール取得（名前・アイコン・部署・役職・最終ログイン） |
| `GET /api/settings/tenant` | GET | テナント情報取得 |
| `PUT /api/settings/tenant` | PUT | テナント情報編集（組織名のみ、管理者操作） |
| `GET /api/settings/usage` | GET | 当月 AI 利用状況 |
| `GET /api/settings/plan` | GET | 現在のプラン情報 |

---

## 8. 実装ファイル一覧

| ファイル | 操作 | 内容 |
|----------|------|------|
| `api/db/migrations/016_ai_usage_log.sql` | 新規 | ai_usage_log + tenant_plans テーブル |
| `api/src/config/ai-cost.ts` | 新規 | トークン単価定数 + コスト計算関数 |
| `api/src/services/ai-usage.service.ts` | 新規 | logAiUsage() + getMonthlyUsage() + アラート |
| `api/src/slack/commands/crm-settings.ts` | 新規 | /crm-settings コマンド |
| `api/src/routes/api.ts` | 改修 | /api/settings/* エンドポイント追加（profile は Slack API プロキシ） |
| `api/src/slack/nlu/intent-parser.ts` | 改修 | logAiUsage() 呼び出し追加 |
| `api/src/services/probability-engine.ts` | 改修 | logAiUsage() 呼び出し追加 |
| `api/src/services/deal-coaching.service.ts` | 改修 | logAiUsage() 呼び出し追加 |
| `api/src/services/draft-reply.service.ts` | 改修 | logAiUsage() 呼び出し追加 |
| `api/src/services/enrichment.service.ts` | 改修 | logAiUsage() 呼び出し追加 |
| `api/src/services/flow-subject.ts` | 改修 | logAiUsage() 呼び出し追加 |
| `web/src/views/Settings.vue` | 新規 | 設定画面（プロフィール・テナント・利用量・プラン） |
| `web/src/lib/api-client.ts` | 改修 | settings 系メソッド追加 |
| `web/src/router/index.ts` | 改修 | /settings ルート追加 |
| `web/src/App.vue` | 改修 | 左メニューに設定アイコン追加 |

---

## 9. 実装順序

```
Step 1: DB マイグレーション（016_ai_usage_log.sql）
Step 2: ai-cost.ts + ai-usage.service.ts（コスト計算・記録の基盤）
Step 3: 既存 AI 呼び出し 6 箇所に logAiUsage() を組み込み
Step 4: API エンドポイント（/api/settings/*）
Step 5: Web Settings.vue
Step 6: Slack /crm-settings コマンド
Step 7: 利用量アラート（80% / 100% 通知）
```

---

## 10. 完了条件

- [ ] `ai_usage_log` テーブルが存在し、全 AI 呼び出しでコストが記録される
- [ ] `tenant_plans` テーブルが存在し、テナントごとにプラン・上限が設定されている
- [ ] Web `/settings` でプロフィール（アイコン・氏名・部署・役職・最終ログイン）・テナント情報・AI 利用量・プランが表示される
- [ ] プロフィール情報は Slack API から自動取得される（編集不可、Slack 側で管理）
- [ ] AI 利用量がプログレスバーで視覚的に表示される
- [ ] 内訳テーブルにオペレーション別の回数・コストが表示される
- [ ] Slack `/crm-settings` で簡易利用状況が表示される
- [ ] 80% / 100% 到達時に Slack DM で通知される
- [ ] Free プランで 100% 超過時に AI 機能が停止する
- [ ] プロフィール・テナント名の編集が Web からできる
