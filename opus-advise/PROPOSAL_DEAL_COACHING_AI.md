# 商談クロージングAIコーチ — 設計提案書

> **作成日**: 2026-03-19
> **提案者**: Opus (Antigravity)
> **ステータス**: アイデア段階 → レビュー待ち

---

## 1. コンセプト

### 一言で言うと

> **「この商談を受注するために、あと何をすべきか」を AI がリアルタイムで教えてくれる**

### Salesforce との違い

| Salesforce | SlackSFA |
|-----------|---------|
| ステージを手動で変更する | AI がやり取りの内容を読んで自動判定する |
| 確度（probability）は人間の勘 | AI が根拠付きで算出する |
| 「次のアクション」は人間が考える | **AI が具体的アクションを提案し、優先順位をつける** |
| 入力しないと機能しない | Slack に書くだけで自動的に更新される |

---

## 2. 機能設計

### 2.1 ディール達成率（Deal Progress Score）

商談が受注に至るまでに **必要な条件がどれだけ揃っているか** を 0〜100% で表示する。

これは単なる「ステージの進み具合」ではなく、
**受注に必要な8つの要素（MEDDPICC ベース）がどれだけ充足されているか** を AI が判断する。

```
┌──────────────────────────────────────────────────┐
│  山田商事 — 新規システム導入案件                       │
│                                                  │
│  達成率: ████████████░░░░░░░░  62%               │
│                                                  │
│  ✅ 課題特定       ████████ 完了                  │
│  ✅ 意思決定者      ████████ 部長と接触済み          │
│  ✅ 予算感         ████████ 500万と聞き取り済み      │
│  🔶 タイムライン    ████░░░░ 「来期から」とのみ        │
│  🔶 競合状況       ████░░░░ 不明（要確認）           │
│  ❌ 技術適合       ░░░░░░░░ 未ヒアリング             │
│  ❌ 決済プロセス    ░░░░░░░░ 稟議フローが不明          │
│  ❌ チャンピオン    ░░░░░░░░ 社内推進者がいない        │
│                                                  │
│  📋 次のアクション（AI推奨）:                        │
│  1. 🔥 技術部門の担当者との打ち合わせを設定する         │
│  2. 📞 田中部長に決裁フローを確認する                 │
│  3. 📧 競合との比較資料を送付する                     │
└──────────────────────────────────────────────────┘
```

### 2.2 達成率の算出ロジック

**MEDDPICC をベースにした8要素**（B2B 営業のベストプラクティス）:

| # | 要素 | 英語 | 判断基準 | 配点 |
|---|-----|------|---------|------|
| 1 | 課題の特定 | Metrics / Pain | 顧客の課題・ペインが明確に記録されているか | 15% |
| 2 | 意思決定者 | Economic Buyer | キーパーソン（決裁者）と接触しているか | 15% |
| 3 | 決裁プロセス | Decision Process | 稟議フロー・承認ステップが把握できているか | 10% |
| 4 | 判断基準 | Decision Criteria | 顧客の選定基準（価格・機能・納期）を理解しているか | 10% |
| 5 | 予算 | Budget | 予算感や予算確保状況がわかっているか | 15% |
| 6 | タイムライン | Timeline | 導入時期・発注時期の目安があるか | 10% |
| 7 | 競合状況 | Competition | 競合の有無・優劣がわかっているか | 10% |
| 8 | チャンピオン | Champion | 社内で推進してくれる人がいるか | 15% |

**AI はこれらを「メモ」「活動ログ」「やり取りの内容」から自動的に読み取って評価する。**
手動入力は一切不要。

### 2.3 ネクストアクション提案

AI は達成率の低い要素に対して、**具体的なアクション**を提案する：

```typescript
interface SuggestedAction {
  priority: 'high' | 'medium' | 'low';
  category: string;        // 上記8要素のいずれか
  action: string;          // 具体的なアクション文
  reason: string;          // なぜこのアクションが必要か
  suggested_message?: string; // 顧客に送るメッセージの例
}
```

**提案例：**

| 足りない要素 | AI が提案するアクション |
|------------|---------------------|
| 技術適合が不明 | 「技術チームとの PoC ミーティングを提案してください。田中部長に以下のメッセージが効果的です：...」 |
| 決裁プロセスが不明 | 「田中部長に、社内の承認フローを確認してください。決裁者は誰か、稟議にかかる期間はどのくらいか。」 |
| 競合が不明 | 「他社の検討状況を自然にヒアリングしてください。例：『他にご検討されているソリューションはありますか？』」 |
| チャンピオンがいない | 「田中部長が社内推進者になり得ます。導入メリットの社内プレゼン資料を提供しましょう。」 |

---

## 3. データフロー

```
Slack 自然文入力
  ↓
NLU（既存）→ メモ/活動を DB に保存
  ↓
Deal Progress Analyzer（新規）
  ↓ 商談に関連するメモ・活動を全て収集
  ↓ Claude Haiku で8要素の充足度を評価
  ↓
deals テーブルに結果を保存
  ↓
┌──────────────────────────────┐
│ Slack への通知:               │
│ ・定期レポート（毎朝 or 週次）  │
│ ・メモ追加時にリアルタイム更新   │
│ ・クロージング率が変動した時    │
│                              │
│ Web ダッシュボード:            │
│ ・パイプラインに達成率バー表示   │
│ ・商談詳細にレーダーチャート     │
│ ・ネクストアクション一覧        │
└──────────────────────────────┘
```

---

## 4. DB スキーマ拡張

### `deals` テーブルへのカラム追加

```sql
-- Migration 009_deal_progress.sql

-- 達成率スコア（AI 算出）
ALTER TABLE deals ADD COLUMN IF NOT EXISTS
  progress_score SMALLINT CHECK (progress_score BETWEEN 0 AND 100);

-- 8要素の詳細スコア（JSON）
ALTER TABLE deals ADD COLUMN IF NOT EXISTS
  progress_details JSONB;
-- 例: {
--   "pain": {"score": 80, "evidence": "価格の問い合わせあり", "status": "done"},
--   "economic_buyer": {"score": 100, "evidence": "田中部長と3回面談", "status": "done"},
--   "decision_process": {"score": 0, "evidence": null, "status": "missing"},
--   ...
-- }

-- AI が提案したネクストアクション
ALTER TABLE deals ADD COLUMN IF NOT EXISTS
  suggested_actions JSONB;
-- 例: [
--   {"priority": "high", "category": "技術適合", "action": "PoC の提案", ...},
--   {"priority": "medium", "category": "競合", "action": "比較資料送付", ...}
-- ]

-- 最終評価日時
ALTER TABLE deals ADD COLUMN IF NOT EXISTS
  progress_assessed_at TIMESTAMPTZ;
```

### 評価履歴テーブル（新規）

```sql
CREATE TABLE IF NOT EXISTS deal_progress_history (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id          UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  tenant_id        UUID NOT NULL REFERENCES tenants(id),
  progress_score   SMALLINT NOT NULL,
  progress_details JSONB NOT NULL,
  suggested_actions JSONB,
  trigger_type     TEXT NOT NULL DEFAULT 'manual',
  -- 'note_added' | 'activity_logged' | 'manual' | 'scheduled'
  assessed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_deal_progress_deal ON deal_progress_history(deal_id, assessed_at DESC);

-- RLS
ALTER TABLE deal_progress_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY deal_progress_tenant ON deal_progress_history
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
```

---

## 5. AI プロンプト設計

### 評価プロンプト（Claude Haiku）

```
あなたは B2B 営業コーチです。商談の進捗を MEDDPICC フレームワークで評価してください。

【商談情報】
- タイトル: ${deal.title}
- 金額: ¥${deal.amount}
- ステージ: ${deal.stage}
- クローズ予定: ${deal.expected_close}
- 顧客: ${contactName}（${companyName}）

【これまでのやり取り（古い順）】
${allNotesAndActivities}

以下の8要素それぞれについて、0〜100 のスコアと根拠を JSON で返してください。

要素:
1. pain — 顧客の課題・ペインの明確さ
2. economic_buyer — 決裁者との接触
3. decision_process — 購買プロセスの把握
4. decision_criteria — 選定基準の理解
5. budget — 予算の把握
6. timeline — 導入時期の明確さ
7. competition — 競合状況の把握
8. champion — 社内推進者の存在

レスポンス形式:
{
  "overall_score": 62,
  "elements": {
    "pain": {"score": 80, "evidence": "根拠を1文で", "status": "done|partial|missing"},
    ...
  },
  "suggested_actions": [
    {
      "priority": "high|medium|low",
      "category": "要素名",
      "action": "具体的なアクション",
      "reason": "なぜ必要か",
      "suggested_message": "顧客に送れるメッセージ例（任意）"
    }
  ],
  "risk_factors": ["リスク要因があれば"],
  "win_probability": 45
}
```

---

## 6. Slack 通知設計

### 6.1 メモ追加時のリアルタイム更新

商談に紐づくメモや活動が追加されたとき、達成率を再計算し変動があれば通知：

```
📊 山田商事 — 新規システム導入
達成率: 50% → 62% ⬆️ (+12%)

✅ 新たに確認された要素:
  • 予算: 500万円と確認

📋 次のアクション:
  1. 🔥 技術部門との PoC を提案してください
  2. 📞 決裁フローを確認してください

💡 「PoC を提案するメッセージを書いて」と言うと AI が下書きします
```

### 6.2 朝のブリーフィング（定期レポート）

毎朝9時にその日の注力商談をサマリー：

```
☀️ おはようございます！本日の商談ブリーフィングです

🔥 最優先（クローズ間近）:
  • 山田商事 — ¥5,000,000 — 達成率 82% — あと1つ: 最終見積もり提出

⚠️ 要アクション（停滞中）:
  • テスト社 — ¥3,200,000 — 達成率 45% — 2週間更新なし
    → 「進捗いかがですか？」とフォローアップを推奨

📈 全体パイプライン: ¥18,500,000（5件アクティブ）
```

### 6.3 自然文からの呼び出し

```
ユーザー: 「山田商事の商談、あとどうすればいい？」
↓ NLU → intent: deal_coaching
↓ Deal Progress Analyzer
↓
Slack 応答:
「山田商事の商談は達成率 62% です。
 足りない要素:
 ❌ 技術適合（未ヒアリング）
 ❌ 決裁プロセス（不明）
 
 最優先アクション: 技術部門との PoC ミーティングを設定しましょう。
 田中部長宛のメール下書きが必要であれば「下書きして」と言ってください。」
```

---

## 7. 実装フェーズ

### Phase A（MVP）— 1週間

1. `deal-coaching.service.ts` を新規作成
2. `deals` テーブルに `progress_score`, `progress_details`, `suggested_actions` カラム追加
3. メモ追加時に非同期で達成率を再計算
4. Slack でシンプルなテキスト通知

### Phase B（可視化）— 1週間

1. Web ダッシュボードの DealBoard.vue にプログレスバーを追加
2. 商談詳細ページにレーダーチャート（8要素の可視化）
3. ネクストアクション一覧のカード UI

### Phase C（自動化）— 1週間

1. NLU に `deal_coaching` インテントを追加
2. 朝のブリーフィング（定期レポート using setInterval or Cloud Scheduler）
3. 達成率変動時の自動通知
4. 「PoC提案メールの下書きして」→ draft-reply.service と連携

---

## 8. ビジネスインパクト

### 差別化ポイント

1. **Salesforce にはない機能** — SF は確度(probability)をユーザーが手動入力するだけ。「あと何が足りないか」は教えてくれない
2. **営業マネージャーの工数削減** — 週例の商談レビューで「あの案件どうなってる？」と聞く必要がなくなる
3. **新人営業の即戦力化** — ベテランの暗黙知（「この段階では技術検証が重要」）を AI が言語化する
4. **商品化の目玉機能** — SaaS 版の料金プランの差別化要素になる

### 想定される営業成績への効果

- 受注率向上: クロージングに必要な要素の漏れを防止
- 商談サイクル短縮: 次にやるべきことが明確なので停滞しない
- フォーキャスト精度向上: AI の達成率は人間の勘より正確

---

## 9. リスクと対策

| リスク | 対策 |
|-------|------|
| メモが少ないと評価精度が低い | 最低3件のメモがないと評価しない旨を表示 |
| AI の提案が的外れ | confidence score を表示し、低い場合は「情報不足」と明示 |
| 営業が AI に依存しすぎる | 「AI の評価は参考です。最終判断はあなたが行ってください」の注釈 |
| コスト増（AI API 呼び出し増） | Haiku を使用（低コスト）、評価は1商談/日に制限 |

---

> **結論: この機能は SlackSFA の最大の差別化ポイントになり得る。**
> TASK_03（leads 廃止）の後、Phase 2.5b〜3 で実装を推奨。
