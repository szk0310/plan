# TASK 08: 商談クロージング AI コーチ（Deal Coaching AI）

> **優先度**: 🟡 高（差別化の目玉機能）
> **対象ファイル**:
> - `api/src/services/deal-coaching.service.ts`（新規作成）
> - `api/src/db/migrations/009_deal_progress.sql`（新規作成）
> - `api/src/slack/events/message.ts`（NLU インテント追加 + トリガー）
> - `api/src/slack/nlu/intent-parser.ts`（`deal_coaching` インテント追加）
> - `api/src/routes/api.ts`（REST API 追加）
> - `web/src/views/DealBoard.vue`（プログレスバー追加）
> - `web/src/views/DealDetail.vue`（新規作成 — 詳細ページ）
> - `web/src/router/index.ts`（ルート追加）
> **依存**: TASK_03（leads 廃止）の完了が望ましい。TASK_01（RLS 修正）完了推奨。

---

## コンセプト

**商談が受注に至るまでに必要な条件（MEDDPICC 8要素）の充足度を AI が自動判定し、
「あと何をすれば契約が取れるか」を具体的にサジェストする。**

営業担当は Slack にメモを書くだけ。手動入力は一切不要。

---

## Step 1: DB マイグレーション

`api/src/db/migrations/009_deal_progress.sql` を新規作成:

```sql
-- ============================================================
-- Migration 009: Deal Progress（商談達成率 AI コーチ）
-- MEDDPICC ベースの8要素で商談の進捗を自動評価し、
-- 受注までに必要なアクションをサジェストする
-- ============================================================

-- ① deals テーブルにコーチングカラムを追加
ALTER TABLE deals ADD COLUMN IF NOT EXISTS
  progress_score SMALLINT CHECK (progress_score BETWEEN 0 AND 100);

ALTER TABLE deals ADD COLUMN IF NOT EXISTS
  progress_details JSONB;
-- 格納形式:
-- {
--   "pain":             {"score": 80, "evidence": "...", "status": "done"},
--   "economic_buyer":   {"score": 100, "evidence": "...", "status": "done"},
--   "decision_process": {"score": 0,  "evidence": null,  "status": "missing"},
--   "decision_criteria":{"score": 40, "evidence": "...", "status": "partial"},
--   "budget":           {"score": 80, "evidence": "...", "status": "done"},
--   "timeline":         {"score": 40, "evidence": "...", "status": "partial"},
--   "competition":      {"score": 40, "evidence": "...", "status": "partial"},
--   "champion":         {"score": 0,  "evidence": null,  "status": "missing"}
-- }

ALTER TABLE deals ADD COLUMN IF NOT EXISTS
  suggested_actions JSONB;
-- 格納形式:
-- [
--   {
--     "priority": "high",
--     "category": "decision_process",
--     "category_label": "決裁プロセス",
--     "action": "田中部長に稟議フローを確認する",
--     "reason": "予算は把握済みだが、誰が最終決裁するか不明",
--     "suggested_message": "田中様、社内でのご検討にあたり..."
--   }
-- ]

ALTER TABLE deals ADD COLUMN IF NOT EXISTS
  progress_assessed_at TIMESTAMPTZ;

ALTER TABLE deals ADD COLUMN IF NOT EXISTS
  win_probability SMALLINT CHECK (win_probability BETWEEN 0 AND 100);
-- AI が算出する受注確率（既存の probability カラムは人間入力用として残す）

ALTER TABLE deals ADD COLUMN IF NOT EXISTS
  risk_factors JSONB;
-- ["2週間以上動きがない", "競合が価格で優位"] 等

-- ② 評価履歴テーブル（推移の追跡用）
CREATE TABLE IF NOT EXISTS deal_progress_history (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id           UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  progress_score    SMALLINT NOT NULL,
  progress_details  JSONB NOT NULL,
  suggested_actions JSONB,
  win_probability   SMALLINT,
  risk_factors      JSONB,
  trigger_type      TEXT NOT NULL DEFAULT 'manual',
  -- 'note_added' | 'activity_logged' | 'manual' | 'scheduled'
  model_used        TEXT,
  prompt_tokens     INTEGER,
  completion_tokens INTEGER,
  assessed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deal_progress_deal
  ON deal_progress_history(deal_id, assessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_deal_progress_tenant
  ON deal_progress_history(tenant_id);

-- RLS
ALTER TABLE deal_progress_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY deal_progress_tenant_isolation ON deal_progress_history
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
```

---

## Step 2: サービス層の実装

`api/src/services/deal-coaching.service.ts` を新規作成:

```typescript
/**
 * 商談クロージング AI コーチ
 * MEDDPICC ベースの 8 要素で商談の達成率を自動評価し、
 * 受注までに必要な具体的アクションをサジェストする。
 */
import { pool } from '../db/client';
import { config } from '../config';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

const DEV_TENANT_ID = '00000000-0000-0000-0000-000000000001';

// ── 型定義 ───────────────────────────────────────────────

type ElementStatus = 'done' | 'partial' | 'missing';

interface ProgressElement {
  score: number;        // 0-100
  evidence: string | null;
  status: ElementStatus;
}

interface SuggestedAction {
  priority: 'high' | 'medium' | 'low';
  category: string;
  category_label: string;
  action: string;
  reason: string;
  suggested_message?: string;
}

interface CoachingResult {
  overall_score: number;
  elements: Record<string, ProgressElement>;
  suggested_actions: SuggestedAction[];
  win_probability: number;
  risk_factors: string[];
}

// ── 8 要素の定義 ─────────────────────────────────────────

const ELEMENT_DEFINITIONS = {
  pain: { label: '課題の特定', weight: 15 },
  economic_buyer: { label: '意思決定者', weight: 15 },
  decision_process: { label: '決裁プロセス', weight: 10 },
  decision_criteria: { label: '判断基準', weight: 10 },
  budget: { label: '予算', weight: 15 },
  timeline: { label: 'タイムライン', weight: 10 },
  competition: { label: '競合状況', weight: 10 },
  champion: { label: 'チャンピオン', weight: 15 },
} as const;

const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(ELEMENT_DEFINITIONS).map(([k, v]) => [k, v.label])
);

// ── メイン関数 ───────────────────────────────────────────

/**
 * 商談の達成率を評価し、ネクストアクションを提案する
 * @param dealId 商談 ID
 * @param triggerType 評価トリガーの種類
 * @returns 評価結果、または情報不足の場合は null
 */
export async function assessDealProgress(
  dealId: string,
  triggerType: 'note_added' | 'activity_logged' | 'manual' | 'scheduled' = 'manual'
): Promise<CoachingResult | null> {

  // ① 商談情報を取得
  const dealRes = await pool.query(
    `SELECT d.*, a.name AS account_name,
            c.last_name || COALESCE(c.first_name, '') AS contact_name,
            c.title AS contact_title,
            c.lifecycle_stage, c.nurturing_stage
     FROM deals d
     JOIN accounts a ON a.id = d.account_id
     LEFT JOIN contacts c ON c.id = d.primary_contact_id
     WHERE d.id = $1`,
    [dealId]
  );
  const deal = dealRes.rows[0];
  if (!deal) {
    console.warn(`[DealCoaching] Deal not found: ${dealId}`);
    return null;
  }

  // ② この商談に関連するメモと活動ログを全て収集
  const [notesRes, activitiesRes] = await Promise.all([
    pool.query(
      `SELECT n.memo, n.note_type, n.created_at, n.author_slack_id
       FROM crm_notes n
       WHERE n.deal_id = $1 OR n.account_id = $2
       ORDER BY n.created_at ASC`,
      [dealId, deal.account_id]
    ),
    pool.query(
      `SELECT al.activity_type, al.direction, al.subject, al.body,
              al.ai_summary, al.created_at
       FROM activity_logs al
       WHERE al.deal_id = $1
          OR al.account_id = $2
          OR al.contact_id = $3
       ORDER BY al.created_at ASC`,
      [dealId, deal.account_id, deal.primary_contact_id]
    ),
  ]);

  // 情報が少なすぎる場合はスキップ（メモ + 活動の合計が 2 件未満）
  const totalRecords = notesRes.rows.length + activitiesRes.rows.length;
  if (totalRecords < 2) {
    console.log(`[DealCoaching] Not enough data for deal ${dealId} (${totalRecords} records)`);
    return null;
  }

  // ③ やり取りのタイムラインを構築
  const timeline = buildTimeline(notesRes.rows, activitiesRes.rows);

  // ④ Claude Haiku で評価
  const result = await evaluateWithAI(deal, timeline);
  if (!result) return null;

  // ⑤ deals テーブルに結果を保存
  await pool.query(
    `UPDATE deals SET
       progress_score = $2,
       progress_details = $3,
       suggested_actions = $4,
       win_probability = $5,
       risk_factors = $6,
       progress_assessed_at = NOW()
     WHERE id = $1`,
    [
      dealId,
      result.overall_score,
      JSON.stringify(result.elements),
      JSON.stringify(result.suggested_actions),
      result.win_probability,
      JSON.stringify(result.risk_factors),
    ]
  );

  // ⑥ 評価履歴を保存
  const tenantId = deal.tenant_id ?? DEV_TENANT_ID;
  await pool.query(
    `INSERT INTO deal_progress_history
       (deal_id, tenant_id, progress_score, progress_details,
        suggested_actions, win_probability, risk_factors, trigger_type, model_used)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      dealId, tenantId, result.overall_score,
      JSON.stringify(result.elements),
      JSON.stringify(result.suggested_actions),
      result.win_probability,
      JSON.stringify(result.risk_factors),
      triggerType, 'claude-haiku-4-5',
    ]
  );

  console.log(`[DealCoaching] Deal ${dealId} assessed: ${result.overall_score}% (win: ${result.win_probability}%)`);
  return result;
}

// ── タイムライン構築 ─────────────────────────────────────

function buildTimeline(notes: any[], activities: any[]): string {
  const items: { date: Date; text: string }[] = [];

  for (const n of notes) {
    items.push({
      date: new Date(n.created_at),
      text: `[メモ] ${n.memo.slice(0, 200)}`,
    });
  }

  for (const a of activities) {
    const label = a.direction === 'inbound' ? '▶ 顧客' : '◀ 営業';
    const summary = a.ai_summary ?? a.subject ?? a.activity_type;
    const bodySnippet = a.body ? ` — ${a.body.slice(0, 150).replace(/\n/g, ' ')}` : '';
    items.push({
      date: new Date(a.created_at),
      text: `${label}（${summary}）${bodySnippet}`,
    });
  }

  // 古い順にソート
  items.sort((a, b) => a.date.getTime() - b.date.getTime());

  return items
    .map(i => `${i.date.toLocaleDateString('ja-JP')} ${i.text}`)
    .join('\n');
}

// ── AI 評価 ──────────────────────────────────────────────

async function evaluateWithAI(deal: any, timeline: string): Promise<CoachingResult | null> {
  const contactName = deal.contact_name ?? '（担当者不明）';
  const companyName = deal.account_name ?? '（会社名不明）';
  const amount = deal.amount ? `¥${Number(deal.amount).toLocaleString()}` : '未定';
  const close = deal.expected_close
    ? new Date(deal.expected_close).toLocaleDateString('ja-JP')
    : '未定';
  const today = new Date().toISOString().split('T')[0];

  const stageLabel: Record<string, string> = {
    prospecting: '初期アプローチ',
    qualified: '適格確認済み',
    proposal: '提案中',
    negotiation: '交渉中',
    closed_won: '受注',
    closed_lost: '失注',
  };

  try {
    const res = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1200,
      messages: [{
        role: 'user',
        content: `あなたは B2B 営業マネージャーです。商談の進捗を MEDDPICC フレームワークで評価してください。

【商談情報】
- 商談名: ${deal.title}
- 金額: ${amount}
- ステージ: ${stageLabel[deal.stage] ?? deal.stage}
- クローズ予定: ${close}
- 顧客: ${contactName}（${companyName}）
- 今日の日付: ${today}

【これまでのやり取り（時系列順）】
${timeline.slice(0, 3000)}

以下の8要素それぞれについて、やり取りの内容を根拠に 0〜100 で評価してください。
メモや活動に明示的な言及がない要素は低スコアにしてください。推測で高スコアをつけないこと。

要素:
1. pain — 顧客が抱えている課題・ペインが明確に特定されているか
2. economic_buyer — 最終決裁者（予算権限者）と接触しているか
3. decision_process — 購買の承認プロセス（稟議フロー等）を把握しているか
4. decision_criteria — 顧客がベンダーを選ぶ基準（価格/機能/サポート等）を理解しているか
5. budget — 予算額・予算確保状況がわかっているか
6. timeline — 導入希望時期・発注時期の目安があるか
7. competition — 競合他社の存在・優劣がわかっているか
8. champion — 顧客社内で自社を推してくれる人がいるか

suggested_actions は「まだ足りない要素」に対して、営業担当が明日できる具体的なアクションを提案してください。
顧客に送るメッセージ例（suggested_message）があると特に有用です。

JSONのみで回答してください:
{
  "overall_score": 0〜100の整数,
  "elements": {
    "pain": {"score": 0〜100, "evidence": "根拠を1文で（なければnull）", "status": "done|partial|missing"},
    "economic_buyer": {...},
    "decision_process": {...},
    "decision_criteria": {...},
    "budget": {...},
    "timeline": {...},
    "competition": {...},
    "champion": {...}
  },
  "suggested_actions": [
    {
      "priority": "high|medium|low",
      "category": "要素名（英語）",
      "category_label": "要素名（日本語）",
      "action": "具体的なアクション",
      "reason": "なぜ必要か",
      "suggested_message": "顧客に送れるメッセージ例（任意、null可）"
    }
  ],
  "risk_factors": ["リスク要因を箇条書き（なければ空配列）"],
  "win_probability": 0〜100の整数
}`,
      }],
    });

    const text = res.content[0].type === 'text' ? res.content[0].text : '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      console.error('[DealCoaching] No JSON in AI response');
      return null;
    }

    const parsed = JSON.parse(match[0]) as CoachingResult;

    // overall_score を重み付き計算で検証（AI の出力が極端な場合の補正）
    const weightedScore = Object.entries(parsed.elements).reduce((sum, [key, el]) => {
      const weight = ELEMENT_DEFINITIONS[key as keyof typeof ELEMENT_DEFINITIONS]?.weight ?? 10;
      return sum + (el.score * weight / 100);
    }, 0);
    parsed.overall_score = Math.round(weightedScore);

    // category_label を補完
    for (const action of parsed.suggested_actions) {
      if (!action.category_label) {
        action.category_label = CATEGORY_LABELS[action.category] ?? action.category;
      }
    }

    return parsed;
  } catch (err) {
    console.error('[DealCoaching] AI evaluation error:', err);
    return null;
  }
}

// ── Slack 通知 ───────────────────────────────────────────

/**
 * 達成率の評価結果を Slack に通知する
 */
export async function notifyDealProgress(
  dealId: string,
  result: CoachingResult,
  slackClient: any,
  channel?: string
): Promise<void> {
  // 商談情報を取得
  const dealRes = await pool.query(
    `SELECT d.title, d.amount, d.owner_slack_id, d.progress_score AS prev_score,
            a.name AS account_name
     FROM deals d
     JOIN accounts a ON a.id = d.account_id
     WHERE d.id = $1`,
    [dealId]
  );
  const deal = dealRes.rows[0];
  if (!deal) return;

  const notifyTarget = channel ?? deal.owner_slack_id ?? config.NURTURING_NOTIFY_CHANNEL;
  if (!notifyTarget) return;

  // 前回スコアとの差分
  const prevScore = deal.prev_score ?? 0;
  const diff = result.overall_score - prevScore;
  const diffText = diff > 0 ? `⬆️ +${diff}%` : diff < 0 ? `⬇️ ${diff}%` : '';
  const amount = deal.amount ? `¥${Number(deal.amount).toLocaleString()}` : '金額未定';

  // 8要素のサマリー
  const elementLines = Object.entries(result.elements)
    .map(([key, el]) => {
      const label = CATEGORY_LABELS[key] ?? key;
      const icon = el.status === 'done' ? '✅' : el.status === 'partial' ? '🔶' : '❌';
      const bar = '█'.repeat(Math.round(el.score / 10)) + '░'.repeat(10 - Math.round(el.score / 10));
      return `${icon} ${label}: ${bar} ${el.score}%${el.evidence ? ` — _${el.evidence}_` : ''}`;
    })
    .join('\n');

  // ネクストアクション（上位3件）
  const topActions = result.suggested_actions
    .sort((a, b) => {
      const prio = { high: 0, medium: 1, low: 2 };
      return (prio[a.priority] ?? 2) - (prio[b.priority] ?? 2);
    })
    .slice(0, 3);

  const actionLines = topActions
    .map((a, i) => {
      const emoji = a.priority === 'high' ? '🔥' : a.priority === 'medium' ? '📋' : '🌱';
      return `${i + 1}. ${emoji} ${a.action}\n     _${a.reason}_`;
    })
    .join('\n');

  // リスク要因
  const riskText = result.risk_factors.length > 0
    ? `\n⚠️ *リスク*: ${result.risk_factors.join(' / ')}`
    : '';

  const blocks: any[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `📊 ${deal.account_name} — ${deal.title}`,
      },
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*達成率*\n${'█'.repeat(Math.round(result.overall_score / 5))}${'░'.repeat(20 - Math.round(result.overall_score / 5))} *${result.overall_score}%* ${diffText}`,
        },
        {
          type: 'mrkdwn',
          text: `*受注確率*\n${result.win_probability}% | *金額* ${amount}`,
        },
      ],
    },
    { type: 'divider' },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*📋 要素別スコア*\n${elementLines}` },
    },
    { type: 'divider' },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*🎯 ネクストアクション*\n${actionLines}${riskText}` },
    },
  ];

  // ネクストアクションに suggested_message がある場合は「下書き生成」ボタンを追加
  const hasMessage = topActions.some(a => a.suggested_message);
  if (hasMessage) {
    blocks.push({
      type: 'context',
      elements: [{
        type: 'mrkdwn',
        text: '💡 「〇〇のメールを下書きして」と言うと AI がドラフトを作成します',
      }],
    });
  }

  try {
    await slackClient.chat.postMessage({
      channel: notifyTarget,
      text: `📊 ${deal.title} — 達成率 ${result.overall_score}%`,
      blocks,
    });
  } catch (err) {
    console.error('[DealCoaching] Slack notification error:', err);
  }
}

// ── 前回比較付きの評価 + 通知 ──────────────────────────────

/**
 * 商談を評価し、スコアが変動した場合に Slack 通知する
 * メモ/活動追加時のトリガーとして使う
 */
export async function assessAndNotify(
  dealId: string,
  triggerType: 'note_added' | 'activity_logged',
  slackClient: any,
  channel?: string
): Promise<void> {
  // 前回のスコアを取得
  const prevRes = await pool.query(
    `SELECT progress_score FROM deals WHERE id = $1`,
    [dealId]
  );
  const prevScore = prevRes.rows[0]?.progress_score ?? null;

  const result = await assessDealProgress(dealId, triggerType);
  if (!result) return;

  // スコアが 5% 以上変動した場合、または初回評価の場合に通知
  const shouldNotify = prevScore === null || Math.abs(result.overall_score - prevScore) >= 5;

  if (shouldNotify) {
    await notifyDealProgress(dealId, result, slackClient, channel);
  }
}

// ── 全商談の定期評価（朝のブリーフィング用） ───────────────

/**
 * アクティブな全商談を評価し、日次ブリーフィングを Slack に送信する
 */
export async function dailyBriefing(slackClient: any): Promise<void> {
  const dealsRes = await pool.query(
    `SELECT d.id, d.title, d.amount, d.expected_close, d.stage,
            d.progress_score, d.owner_slack_id,
            a.name AS account_name
     FROM deals d
     JOIN accounts a ON a.id = d.account_id
     WHERE d.stage NOT IN ('closed_won', 'closed_lost')
     ORDER BY d.progress_score DESC NULLS LAST`
  );

  if (dealsRes.rows.length === 0) return;

  // 未評価の商談を評価
  for (const deal of dealsRes.rows) {
    if (deal.progress_score === null) {
      await assessDealProgress(deal.id, 'scheduled');
      // レートリミット
      await new Promise(r => setTimeout(r, 1500));
    }
  }

  // 再取得（評価後のスコアを反映）
  const updatedRes = await pool.query(
    `SELECT d.id, d.title, d.amount, d.expected_close, d.stage,
            d.progress_score, d.win_probability, d.suggested_actions,
            d.owner_slack_id, a.name AS account_name
     FROM deals d
     JOIN accounts a ON a.id = d.account_id
     WHERE d.stage NOT IN ('closed_won', 'closed_lost')
     ORDER BY d.progress_score DESC NULLS LAST`
  );

  // 通知先の決定（全商談のオーナーごとにグルーピングするか、1チャンネルにまとめるか）
  const notifyTarget = config.NURTURING_NOTIFY_CHANNEL;
  if (!notifyTarget) return;

  const hotDeals = updatedRes.rows.filter(d => (d.progress_score ?? 0) >= 70);
  const actionNeeded = updatedRes.rows.filter(d => (d.progress_score ?? 0) < 50);
  const totalPipeline = updatedRes.rows.reduce(
    (sum, d) => sum + (Number(d.amount) || 0), 0
  );

  const hotLines = hotDeals.length > 0
    ? hotDeals.map(d => {
        const topAction = d.suggested_actions?.[0];
        return `• *${d.account_name}* — ¥${Number(d.amount || 0).toLocaleString()} — 達成率 ${d.progress_score}%${topAction ? `\n   あと: ${topAction.action}` : ''}`;
      }).join('\n')
    : '該当なし';

  const actionLines = actionNeeded.length > 0
    ? actionNeeded.slice(0, 5).map(d => {
        const topAction = d.suggested_actions?.[0];
        return `• *${d.account_name}* — 達成率 ${d.progress_score ?? '未評価'}%${topAction ? `\n   → ${topAction.action}` : ''}`;
      }).join('\n')
    : '該当なし';

  await slackClient.chat.postMessage({
    channel: notifyTarget,
    text: '☀️ 本日の商談ブリーフィング',
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: '☀️ 本日の商談ブリーフィング' },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `📈 *パイプライン合計*: ¥${totalPipeline.toLocaleString()}（${updatedRes.rows.length}件アクティブ）`,
        },
      },
      { type: 'divider' },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `🔥 *クローズ間近（達成率 70%+）*\n${hotLines}`,
        },
      },
      { type: 'divider' },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `⚠️ *要アクション（達成率 50%未満）*\n${actionLines}`,
        },
      },
    ],
  });

  console.log(`[DealCoaching] Daily briefing sent: ${updatedRes.rows.length} deals`);
}
```

---

## Step 3: NLU にインテントを追加

`api/src/slack/nlu/intent-parser.ts` を修正:

### IntentType に追加

```typescript
export type IntentType =
  | 'create_contact'
  | 'add_note'
  | 'search'
  | 'promote'
  | 'show_list'
  | 'create_deal'
  | 'delete_contact'
  | 'update_deal'
  | 'update_contact'
  | 'deal_coaching'    // ← 追加
  | 'unknown';
```

### SYSTEM_PROMPT に追加

```
- deal_coaching: 商談の進捗確認・次のアクション確認（「あとどうすればいい」「この商談の状況は」「何が足りない」等）
```

---

## Step 4: message.ts にハンドラを追加

`api/src/slack/events/message.ts` の `executePendingAction` に `deal_coaching` ケースを追加:

```typescript
case 'deal_coaching': {
  const keyword = nlu.entities.company_name ?? nlu.entities.last_name ?? nlu.entities.keyword ?? '';
  
  // 商談の検索
  let dealId: string | undefined;
  
  if (keyword) {
    const deals = await searchDealsService(keyword);
    if (deals.length > 0) dealId = deals[0].id;
  }
  
  // コンテキストから商談を取得
  if (!dealId) {
    const ctx = getUserContext(userId);
    if (ctx?.accountId) {
      const { listDealsByAccount } = await import('../../db/queries/deals');
      const deals = await listDealsByAccount(ctx.accountId);
      if (deals.length > 0) dealId = deals[0].id;
    }
  }
  
  if (!dealId) {
    await client.chat.postMessage({
      channel,
      text: '⚠️ 商談が特定できませんでした。「山田商事の商談の状況は？」のように会社名を指定してください。',
    });
    return;
  }
  
  // 「解析中...」メッセージ
  const analyzing = await client.chat.postMessage({
    channel,
    text: '📊 商談を分析中...',
  });
  
  const { assessDealProgress, notifyDealProgress } = await import('../../services/deal-coaching.service');
  const result = await assessDealProgress(dealId, 'manual');
  
  // 「解析中」を削除
  await client.chat.delete({ channel, ts: analyzing.ts as string }).catch(() => {});
  
  if (!result) {
    await client.chat.postMessage({
      channel,
      text: '⚠️ この商談はまだ情報が少なく、評価ができません。メモや活動をもう少し記録してから再度お試しください。',
    });
    return;
  }
  
  await notifyDealProgress(dealId, result, client, channel);
  break;
}
```

### メモ追加時の自動トリガー

`add_note` ケースの既存処理の後に、商談に紐づくメモの場合にコーチングをトリガー:

```typescript
case 'add_note': {
  // ... 既存のメモ追加処理 ...

  // 商談に紐づいている場合は達成率を再評価（非同期）
  if (accountId) {
    (async () => {
      try {
        const { listDealsByAccount } = await import('../../db/queries/deals');
        const deals = await listDealsByAccount(accountId);
        if (deals.length > 0) {
          const { assessAndNotify } = await import('../../services/deal-coaching.service');
          await assessAndNotify(deals[0].id, 'note_added', client, channel);
        }
      } catch (e) {
        logger.error('[DealCoaching] auto-assess error:', e);
      }
    })();
  }
  break;
}
```

---

## Step 5: REST API の追加

`api/src/routes/api.ts` に以下を追加:

```typescript
// ── Deal Coaching ─────────────────────────────────────────
router.get('/api/deals/:id/progress', async (req, res) => {
  const deal = await pool.query(
    `SELECT d.*, a.name AS account_name,
            c.last_name || COALESCE(c.first_name, '') AS contact_name
     FROM deals d
     JOIN accounts a ON a.id = d.account_id
     LEFT JOIN contacts c ON c.id = d.primary_contact_id
     WHERE d.id = $1`,
    [req.params.id]
  );
  if (!deal.rows[0]) { res.status(404).json({ error: 'Not found' }); return; }
  res.json({
    ...deal.rows[0],
    progress_details: deal.rows[0].progress_details ?? null,
    suggested_actions: deal.rows[0].suggested_actions ?? [],
  });
});

router.post('/api/deals/:id/assess', async (req, res) => {
  const { assessDealProgress } = await import('../services/deal-coaching.service');
  try {
    const result = await assessDealProgress(req.params.id, 'manual');
    if (!result) {
      res.status(422).json({ error: 'Not enough data to assess' });
      return;
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get('/api/deals/:id/progress-history', async (req, res) => {
  const limit = Number(req.query.limit) || 20;
  const result = await pool.query(
    `SELECT * FROM deal_progress_history
     WHERE deal_id = $1
     ORDER BY assessed_at DESC
     LIMIT $2`,
    [req.params.id, limit]
  );
  res.json(result.rows);
});
```

---

## Step 6: Web ダッシュボード

### DealBoard.vue にプログレスバーを追加

既存の商談一覧に `progress_score` のプログレスバーを表示。
各商談カードに以下を追加：

```html
<div class="progress-bar-container" v-if="deal.progress_score != null">
  <div class="progress-bar" :style="{ width: deal.progress_score + '%' }"
       :class="progressClass(deal.progress_score)">
  </div>
  <span class="progress-label">{{ deal.progress_score }}%</span>
</div>
```

### DealDetail.vue（新規ページ）

`web/src/views/DealDetail.vue` を新規作成。以下の表示を含む：

1. **達成率プログレスバー**（大型表示）
2. **8要素のレーダーチャート**（Canvas or SVG）
3. **要素別スコア一覧**（バー形式）
4. **ネクストアクション一覧**（カード形式、優先度別で色分け）
5. **達成率の推移グラフ**（progress_history から取得）
6. **「再評価」ボタン**（`POST /api/deals/:id/assess` を呼ぶ）

### router に追加

```typescript
// web/src/router/index.ts
import DealDetail from '../views/DealDetail.vue';

// routes に追加
{ path: '/deals/:id', component: DealDetail },
```

---

## Step 7: 朝のブリーフィング（定期実行）

`api/src/index.ts` に定期実行を追加:

```typescript
// 朝 9:00 に日次ブリーフィングを送信（JST）
import { dailyBriefing } from './services/deal-coaching.service';

function scheduleDailyBriefing(slackClient: any) {
  const checkInterval = 60 * 60 * 1000; // 1時間ごとにチェック
  let lastBriefingDate = '';

  setInterval(() => {
    const now = new Date();
    const jstHour = (now.getUTCHours() + 9) % 24;
    const todayStr = now.toISOString().split('T')[0];

    // JST 9:00〜9:59 で、今日まだブリーフィングしていない場合
    if (jstHour === 9 && lastBriefingDate !== todayStr) {
      lastBriefingDate = todayStr;
      dailyBriefing(slackClient).catch(err =>
        console.error('[DailyBriefing] error:', err)
      );
    }
  }, checkInterval);
}

// main() 内で呼び出し
scheduleDailyBriefing(app.client);
```

---

## Step 8: `deal_coaching` を即実行に設定

`message.ts` の検索・一覧と同様に、`deal_coaching` は確認不要で即実行する。

```typescript
// 既存の即実行判定に deal_coaching を追加
if (nlu.intent === 'search' || nlu.intent === 'show_list' || nlu.intent === 'deal_coaching') {
  await deleteThinking();
  const pending: PendingAction = { nlu, userId, channel: msg.channel, ts: msg.ts, tenantId, expiresAt: 0 };
  await executePendingAction(pending, client, logger);
  return;
}
```

---

## 完了条件

- [ ] `009_deal_progress.sql` マイグレーションファイルが作成されている
- [ ] `deal-coaching.service.ts` が作成されている
- [ ] `assessDealProgress()` が Claude Haiku で8要素を評価する
- [ ] `notifyDealProgress()` が Slack にリッチカードで通知する
- [ ] NLU に `deal_coaching` インテントが追加されている
- [ ] Slack で「山田商事の商談の状況は？」と聞くと達成率が返る
- [ ] メモ追加時に商談の達成率が自動再評価される（スコア変動 ≥ 5% で通知）
- [ ] `/api/deals/:id/progress` API が機能する
- [ ] `/api/deals/:id/assess` API が機能する
- [ ] `/api/deals/:id/progress-history` API が機能する
- [ ] Web に `/deals/:id` の詳細ページが追加されている
- [ ] 朝のブリーフィング定期実行が index.ts に登録されている
- [ ] TypeScript コンパイルエラーがないこと
