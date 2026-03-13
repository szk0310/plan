# AI ナーチャリング Phase B：返信下書き生成 詳細設計

## 概要

Phase A（通知のみ）が完成したことを前提に、次のステップとして
**「AI が返信の下書きを生成し、担当者が Slack 上で承認して送信する」**フローを設計する。

> **Phase A:** 「動きがありました」→ 人間が自分で判断・対応
> **Phase B:** 「こう返信しませんか？」→ 人間が承認するだけ ← **ここ**

---

## 1. 全体フロー

```
[顧客からのアクション]
  │  メール受信 / Web問い合わせ / Slack共有チャンネル発言
  ▼
[activity_logs に記録]  ← Phase A で実装済み
  │
  ▼
[Phase B: 下書き生成パイプライン]
  │
  ├─ Step 1: コンテキスト収集（Flash）
  │   └─ contact 情報 + 直近の activity_logs + 過去のやり取り履歴
  │
  ├─ Step 2: 行動判断（Haiku / Flash）
  │   └─ 「返信すべきか？」「何を伝えるべきか？」の判断
  │   └─ → 返信不要 → Phase A の通知だけで終了
  │   └─ → 返信必要 → Step 3 へ
  │
  ├─ Step 3: 下書き生成（Sonnet / Pro）
  │   └─ 営業方針プロンプト + RAG参照情報 + コンテキスト → 文章生成
  │
  └─ Step 4: Slack 承認フロー
      └─ 担当者へ下書きを提示 → [送信] [修正] [却下] [自分で対応]
          │
          ├─ [送信] → メール / Slack で自動送信
          ├─ [修正] → モーダルで編集 → 送信
          ├─ [却下] → ログに記録して終了
          └─ [自分で対応] → 担当者に引き継ぎ通知
```

---

## 2. DB スキーマ追加（マイグレーション案）

```sql
-- 005_ai_draft_replies.sql（設計メモ）

CREATE TABLE ai_draft_replies (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL REFERENCES tenants(id),

    -- 紐づき
    contact_id        UUID NOT NULL REFERENCES contacts(id),
    trigger_activity_id UUID REFERENCES activity_logs(id),

    -- AI 生成内容
    draft_subject     TEXT,                        -- メール件名
    draft_body        TEXT NOT NULL,               -- 本文
    ai_reasoning      TEXT,                        -- AI の判断理由
    confidence_score  SMALLINT CHECK (confidence_score BETWEEN 0 AND 100),

    -- 承認フロー
    status            TEXT NOT NULL DEFAULT 'pending',
    -- 'pending' | 'approved' | 'edited_and_sent' | 'rejected' | 'escalated'
    reviewer_slack_id TEXT,
    edited_body       TEXT,                        -- 修正があった場合の最終文
    reviewed_at       TIMESTAMPTZ,

    -- 送信結果
    sent_via          TEXT,                        -- 'email' | 'slack' | null
    sent_at           TIMESTAMPTZ,
    send_error        TEXT,

    -- コスト追跡
    model_used        TEXT,                        -- 'claude-3.5-sonnet' など
    prompt_tokens     INTEGER,
    completion_tokens INTEGER,
    cost_estimate_yen NUMERIC(8,2),

    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_drafts_contact ON ai_draft_replies (contact_id);
CREATE INDEX idx_drafts_status ON ai_draft_replies (status) WHERE status = 'pending';

-- RLS
ALTER TABLE ai_draft_replies ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_drafts ON ai_draft_replies
    USING (tenant_id = current_setting('app.tenant_id')::UUID);
```

---

## 3. サービス層の設計

### 3-1. `draft-reply.service.ts` の責務

```
[generateDraftReply(activityId)]
  │
  ├─ 1. activity_logs から該当アクティビティ取得
  ├─ 2. contacts + accounts から顧客情報取得
  ├─ 3. 直近 20 件の activity_logs（同一 contact）取得 ← 会話の「文脈」
  ├─ 4. RAG: 自社ドキュメントから関連情報を検索
  │
  ├─ 5. 行動判断プロンプト（Flash / Haiku）
  │     入力: 顧客情報 + 最新アクション + 履歴サマリー
  │     出力: { should_reply: boolean, reason: string, tone: string }
  │
  │     should_reply = false → Phase A 通知のみ。終了。
  │
  ├─ 6. 下書き生成プロンプト（Sonnet / Pro）
  │     入力: 顧客情報 + 行動判断結果 + RAG参照情報 + 営業方針
  │     出力: { subject: string, body: string, confidence: number }
  │
  ├─ 7. ai_draft_replies テーブルに INSERT
  │
  └─ 8. Slack に承認メッセージ送信
```

### 3-2. 行動判断プロンプト（Step 5）

```
あなたは営業アシスタントです。以下の状況を分析し、返信が必要か判断してください。

【顧客情報】
- 名前: {{contact.last_name}} {{contact.first_name}}
- 会社: {{contact.company_name}}
- ステージ: {{contact.lifecycle_stage}}

【今回のアクション】
{{activity.description}}

【過去のやり取り（直近5件）】
{{recentActivities}}

JSON で出力:
{
  "should_reply": true/false,
  "reason": "判断理由（50文字以内）",
  "urgency": "high/medium/low",
  "suggested_tone": "formal/casual/grateful"
}
```

### 3-3. 下書き生成プロンプト（Step 6）

```
あなたは {{company_name}} の営業担当アシスタントです。

【営業方針】
{{tenant.sales_policy}}   ← テナントごとにカスタマイズ可能

【絶対に守ること】
- 価格の値引きや特別条件を約束しない
- 納期を確約しない
- 「担当に確認します」で逃げて良い
- 競合の悪口を言わない

【参照可能な情報】
{{rag_documents}}

【顧客の状況】
{{context}}

【返信のトーン】
{{suggested_tone}}

JSON で出力:
{
  "subject": "メール件名",
  "body": "本文（200文字以内、簡潔に）",
  "confidence": 0-100
}
```

---

## 4. Slack 承認 UI（Block Kit）

```
🤖 AI ナーチャリング Bot
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📩 田中太郎さん（ABC株式会社）への返信案

┌─ きっかけ ──────────────────────┐
│ 資料請求のメールが届きました        │
│ （10分前）                         │
└──────────────────────────────────┘

┌─ AI の判断 ─────────────────────┐
│ 🔥 緊急度: 高                     │
│ 📊 自信度: 85/100                 │
│ 💡 理由: 2回目の問い合わせ。        │
│    前回は予算未定で見送り。          │
│    今回は具体的な機能について質問    │
│    → 予算確保済みの可能性            │
└──────────────────────────────────┘

┌─ 下書き ───────────────────────┐
│ 件名: Re: 〇〇機能について         │
│                                   │
│ 田中様                            │
│ お世話になっております。            │
│ ご質問いただいた〇〇機能について、 │
│ 詳しい資料をお送りいたします。      │
│                                   │
│ もしよろしければ、15分ほど          │
│ オンラインでご説明させていただく     │
│ ことも可能です。                   │
└──────────────────────────────────┘

[👍 このまま送信]  [✍️ 修正して送信]
[❌ 送らない]      [📞 自分で対応する]
```

### ボタン押下時の処理

| ボタン | アクション |
|:---|:---|
| 👍 このまま送信 | `status='approved'` → メール送信 → `sent_at` 記録 |
| ✍️ 修正して送信 | Slack モーダル表示 → 編集 → `status='edited_and_sent'` → 送信 |
| ❌ 送らない | `status='rejected'` → ログ記録のみ |
| 📞 自分で対応する | `status='escalated'` → 担当者に引き継ぎ通知 |

---

## 5. モデル使い分けとコスト

| 処理 | モデル | 1回あたり | 理由 |
|:---|:---|:---|:---|
| 行動判断 | Claude Haiku | ~0.3円 | Phase Aで実績あり。高速・安価 |
| 下書き生成 | Claude 3.5 Sonnet | ~5円 | 日本語の自然さが最重要 |

### 月間コスト試算（1営業マンあたり）
- 行動判断: 30回/月 × 0.3円 = 9円
- 下書き生成: 15回/月 × 5円 = 75円
- **合計: 約 84円/月/ユーザー** → Pro プラン ¥4,980 に対して **利益率 98%以上**

---

## 6. メール送信の実装方針

### 推奨: Phase B 初期は SendGrid
- API がシンプルで実装が早い
- 送信ログも自動で取れる
- 将来: Gmail API への切り替えオプションを残す

---

## 7. 安全装置

| シナリオ | 対応 |
|:---|:---|
| confidence 50未満 | 下書き表示せず Phase A 通知にフォールバック |
| メール送信失敗 | `send_error` 記録 + Slack通知 |
| 同一contactに1日3回以上 | レートリミット発動 |
| 担当者が24時間放置 | リマインダー。48時間で `expired` |

---

## 8. Phase A → B 移行の判断基準

- [ ] Phase A で 50件以上の通知が正常動作
- [ ] activity_logs に十分なデータ蓄積
- [ ] 営業方針プロンプトがテナント設定済み
- [ ] SendGrid API キー設定済み

```sql
-- テナントごとの切り替えフラグ
ALTER TABLE tenants ADD COLUMN nurturing_mode TEXT DEFAULT 'notify_only';
-- 'notify_only' (Phase A) | 'draft_reply' (Phase B) | 'auto_send' (Phase C)
```
