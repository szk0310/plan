# TASK_10: 確率エンジン刷新 — センチメント駆動の商談化・受注確率

> **目的**: 活動回数ではなく「顧客の言葉」から確率を算出する AI エンジンを構築する
> **優先度**: 🔴 最優先（Phase 3 の差別化の核）
> **依存**: なし（既存の ai-assessment / deal-coaching を置き換える）

---

## 1. 設計思想

### 従来 CRM との違い

| 従来 CRM | SlackSFA |
|----------|----------|
| 営業が手動でステージを移動 | AI が会話内容から確率を自動算出 |
| 活動「回数」で評価 | 活動「中身」のセンチメントで評価 |
| 確率は営業の主観 | 確率は AI の客観的判断 + 根拠提示 |
| 放置しても数字が変わらない | 時間経過で確率が減衰する |

### 2つの確率

```
deal_probability（商談化確率）
  対象: contacts（lifecycle_stage = 'prospect' or 'active'）
  意味: この見込み客が商談になる可能性
  用途: ナーチャリング優先度の判断

win_probability（受注確率）
  対象: deals（status = 'open'）
  意味: この商談が受注に至る可能性
  用途: パイプライン管理、売上予測、リスク検知
```

---

## 2. センチメント分析エンジン

### 2.1 分析対象の会話ソース

| ソース | 取得方法 | 実装状態 |
|--------|----------|----------|
| Slack Bot へのメッセージ | 既存の message.ts | ✅ 実装済み |
| ユーザーが手動入力したメモ | crm_notes テーブル | ✅ 実装済み |
| メール本文（ユーザーが貼り付け） | activity_logs.body | ✅ 実装済み |
| Slack チャンネルの会話監視 | Bolt event subscription | 🔲 Phase 3.1 |
| Gmail/Outlook 受信 Webhook | SendGrid Inbound Parse or Gmail API | 🔲 Phase 3.2 |

### 2.2 センチメントシグナルの定義

```typescript
// api/src/config/sentiment-signals.ts（新規作成）

export const POSITIVE_SIGNALS = [
  { signal: 'budget_mention',     label: '予算への言及',         weight: +8 },
  { signal: 'timeline_urgency',   label: '導入時期の具体化',     weight: +7 },
  { signal: 'decision_maker_ref', label: '決裁者への言及',       weight: +9 },
  { signal: 'demo_request',       label: 'デモ・提案依頼',       weight: +10 },
  { signal: 'pricing_inquiry',    label: '価格・見積もり依頼',    weight: +9 },
  { signal: 'positive_feedback',  label: '好意的な反応',         weight: +5 },
  { signal: 'internal_champion',  label: '社内推進者の存在',     weight: +8 },
  { signal: 'repeat_contact',     label: '繰り返しの接触',       weight: +4 },
] as const;

export const NEGATIVE_SIGNALS = [
  { signal: 'competitor_mention', label: '競合の存在',           weight: -5 },
  { signal: 'budget_concern',    label: '予算懸念',              weight: -6 },
  { signal: 'timeline_delay',    label: '導入時期の後退',        weight: -7 },
  { signal: 'no_response',       label: '返信なし',              weight: -4 },
  { signal: 'rejection',         label: '明確な断り',            weight: -15 },
  { signal: 'stakeholder_change',label: '担当者変更',            weight: -5 },
  { signal: 'vague_interest',    label: '曖昧な関心（社交辞令）', weight: -3 },
  { signal: 'long_silence',      label: '長期間の沈黙',          weight: -6 },
] as const;
```

### 2.3 AI プロンプト設計

```typescript
// api/src/services/sentiment-analyzer.ts（新規作成）

const SENTIMENT_PROMPT = `あなたは B2B 営業のセンチメント分析の専門家です。
顧客とのやり取りを読み、以下を JSON で返してください。

【分析対象】
{conversation_text}

【判断基準】
顧客の「言葉」と「トーン」から、以下のシグナルを検出してください。
推測ではなく、テキストに根拠がある場合のみ検出すること。

返却 JSON:
{
  "detected_signals": [
    {
      "signal": "budget_mention|timeline_urgency|...",
      "evidence": "顧客の発言の該当部分を引用",
      "confidence": 0.0-1.0
    }
  ],
  "overall_sentiment": "positive|neutral|negative|mixed",
  "sentiment_score": -100〜+100,
  "key_insight": "この顧客の現在の心理状態を1文で",
  "recommended_approach": "次にどういうトーンで接触すべきか1文で"
}

重要:
- 社交辞令（「検討します」「ありがとうございます」）はポジティブシグナルとしてカウントしない
- 日本のビジネスコミュニケーションでは断りが婉曲になる傾向がある。「難しい」「厳しい」は実質的な断りとして扱う
- 「来期」「次年度」は urgency が低いシグナル
- 質問が具体的であるほどポジティブ（「何人まで使えますか？」＞「便利そうですね」）
`;
```

---

## 3. 確率更新ロジック

### 3.1 商談化確率（deal_probability）の更新

```typescript
// api/src/services/probability-engine.ts（新規作成）

interface ProbabilityUpdate {
  previous: number;
  new_value: number;
  delta: number;
  reasons: string[];
  signals: DetectedSignal[];
}

export async function updateDealProbability(
  contactId: string,
  newConversation: string,
  triggerType: 'note' | 'activity' | 'email' | 'slack_message' | 'time_decay'
): Promise<ProbabilityUpdate> {

  // 1. 過去の会話履歴を取得（最新10件）
  const history = await getConversationHistory(contactId, 10);

  // 2. 新しい会話のセンチメント分析
  const sentiment = await analyzeSentiment(newConversation);

  // 3. 現在の確率を取得
  const current = await getCurrentProbability(contactId);

  // 4. シグナルベースの確率調整
  let delta = 0;
  for (const sig of sentiment.detected_signals) {
    const config = [...POSITIVE_SIGNALS, ...NEGATIVE_SIGNALS]
      .find(s => s.signal === sig.signal);
    if (config) {
      delta += config.weight * sig.confidence;
    }
  }

  // 5. 確率を更新（0-100 でクランプ）
  const newValue = Math.max(0, Math.min(100, current + delta));

  // 6. DB 更新
  await updateContactProbability(contactId, newValue, sentiment);

  return { previous: current, new_value: newValue, delta, reasons: [...], signals: [...] };
}
```

### 3.2 受注確率（win_probability）の更新

```typescript
export async function updateWinProbability(
  dealId: string,
  triggerType: 'note' | 'activity' | 'time_decay' | 'manual'
): Promise<ProbabilityUpdate> {

  // 1. 商談に紐づく全会話（notes + activities）を時系列で取得
  const timeline = await getDealTimeline(dealId);

  // 2. 直近の会話だけでなく「流れ」を見る
  //    - 温度が上がってきているか（トレンド）
  //    - キーパーソンが登場しているか
  //    - 具体性が増しているか
  const trendAnalysis = await analyzeTrend(timeline);

  // 3. MEDDPICC 8要素は残す（ただし自動算出）
  const meddpicc = await evaluateMEDDPICC(timeline);

  // 4. 最終確率 = MEDDPICC加重平均(60%) + センチメントトレンド(30%) + 時間係数(10%)
  const score = Math.round(
    meddpicc.weighted_score * 0.6 +
    trendAnalysis.momentum_score * 0.3 +
    timeDecayFactor(deal.last_activity_at) * 0.1
  );

  return { ... };
}
```

### 3.3 時間減衰ロジック

```typescript
// 毎日の定期実行（既存の朝ブリーフィングに組み込み）

export function timeDecayFactor(lastActivityAt: Date): number {
  const daysSince = diffInDays(new Date(), lastActivityAt);

  if (daysSince <= 3)  return 100;  // 直近3日以内 → 減衰なし
  if (daysSince <= 7)  return 90;   // 4-7日 → 軽微な減衰
  if (daysSince <= 14) return 70;   // 8-14日 → 中程度
  if (daysSince <= 30) return 40;   // 15-30日 → 大幅減衰
  return 10;                        // 30日超 → ほぼ冷え切り
}

// 毎朝実行: 全 open deals & active contacts の確率を時間減衰で更新
export async function runDailyDecay(): Promise<void> {
  // contacts: 最終活動から計算して deal_probability を減衰
  // deals: 最終活動から計算して win_probability を減衰
  // 大幅低下（-10%以上）があれば Slack アラート
}
```

---

## 4. Deal ステージの簡素化

### 4.1 マイグレーション

```sql
-- 010_simplify_deal_stage.sql

-- 既存の6ステージを3値に変換
UPDATE deals SET stage = 'won'  WHERE stage = 'closed_won';
UPDATE deals SET stage = 'lost' WHERE stage = 'closed_lost';
UPDATE deals SET stage = 'open' WHERE stage NOT IN ('closed_won', 'closed_lost', 'won', 'lost');

-- CHECK 制約を更新
ALTER TABLE deals DROP CONSTRAINT IF EXISTS deals_stage_check;
ALTER TABLE deals ADD CONSTRAINT deals_stage_check
  CHECK (stage IN ('open', 'won', 'lost'));
```

### 4.2 Web UI の変更

DealBoard.vue のカンバンを確率帯に変更:

```
旧: 初期 | 見込み | 提案 | 交渉 | 受注 | 失注
新: 🧊 低 (0-30%) | 🌤️ 中 (31-60%) | 🔥 高 (61-90%) | ⭐ 確実 (91%+) | ✅ 受注 | ❌ 失注
```

### 4.3 Slack crm-list の変更

```
旧: 📋 初期 *案件名*
新: 🔥 78% *案件名*
    💡 次: 決裁者との面談を設定してください
```

---

## 5. 通知・アラート設計

### Slack 通知のタイミング

| イベント | 通知内容 |
|----------|----------|
| 確率 +10% 以上の上昇 | 「📈 {案件名} の受注確率が {old}% → {new}% に上昇。根拠: {evidence}」 |
| 確率 -10% 以上の低下 | 「⚠️ {案件名} の受注確率が低下。{reason}。推奨: {action}」 |
| 7日間アクション無し | 「⏰ {contact名} に7日間接触していません。確率が低下し始めます」 |
| センチメント急変 | 「🚨 {contact名} のメール返信にネガティブシグナル検出: {key_insight}」 |
| 商談化確率 70% 超え | 「🔥 {contact名} の商談化確率が {prob}% — 商談を作成しますか？」 |

---

## 6. 実装ファイル一覧

| ファイル | 操作 | 内容 |
|----------|------|------|
| `api/src/config/sentiment-signals.ts` | 新規 | シグナル定義（weight 付き） |
| `api/src/services/sentiment-analyzer.ts` | 新規 | Claude Haiku でセンチメント解析 |
| `api/src/services/probability-engine.ts` | 新規 | 確率更新ロジック（シグナル + 時間減衰） |
| `api/src/services/ai-assessment.service.ts` | 改修 | probability-engine を呼ぶように変更 |
| `api/src/services/deal-coaching.service.ts` | 改修 | win_probability をセンチメント込みで算出 |
| `api/src/slack/events/message.ts` | 改修 | 確率変動時の通知追加 |
| `api/src/db/migrations/010_simplify_deal_stage.sql` | 新規 | ステージ3値化 |
| `web/src/views/DealBoard.vue` | 改修 | 確率帯カンバンに変更 |
| `api/src/slack/commands/crm-list.ts` | 改修 | 確率 + ネクストアクション表示 |

---

## 7. 完了条件

- [ ] センチメント分析がノート追加時に自動実行される
- [ ] 検出されたシグナルと根拠が DB に保存される
- [ ] deal_probability がセンチメントに基づいて上下する
- [ ] win_probability が MEDDPICC + センチメント + 時間減衰で算出される
- [ ] 7日間未接触で確率が自動低下する
- [ ] deals.stage が 'open' / 'won' / 'lost' の3値になっている
- [ ] DealBoard が確率帯で表示される
- [ ] `/crm-list deals` が確率 + ネクストアクションを表示する
- [ ] 確率変動時に Slack 通知が飛ぶ

---

## 8. テスト観点

| テスト | 内容 |
|--------|------|
| センチメント解析 | ポジティブ/ネガティブ/混合テキストで正しいシグナルが検出されるか |
| 確率計算 | シグナルの weight 加算が正しいか、0-100 にクランプされるか |
| 時間減衰 | 3日/7日/14日/30日でそれぞれ期待通り減衰するか |
| ステージ移行 | 既存データが open/won/lost に正しく変換されるか |
| 通知条件 | 閾値（±10%）を超えた時だけ通知されるか |
