# TASK_15 実装指示書（Sonnet 向け）

**作業開始前に必ず読むこと: `HANDOFF.md` と `TASK_15_RESPONSE_SPEED.md`**

---

## 前提・現状

- Migration 016 本番適用済み ✅
- backfillFlowSubjects 本番実行済み（11 contacts）✅
- 本番 API: `https://slacksfa-api-808596335261.asia-northeast1.run.app`
- リポジトリ: `/Users/szk/Desktop/APP/slackSFA`

---

## Part 0: 緊急バグ修正（最初に対応すること）

本番で以下の2つのバグが確認された。promote 削除・TASK_15 の前に修正すること。

### Fix 1: メモが保存できない（`crm_notes_lead_id_fkey`）

**ファイル**: `api/src/slack/events/message.ts`

`add_note` ハンドラーでコンタクトの ID を `leadId` として渡しているため、
`crm_notes.lead_id` FK 制約に違反する。

```typescript
// 現状（L349 付近）
let leadId: string | undefined;
if (leads.length > 0) leadId = leads[0].id;
await addNoteFromEntities({ leadId, ... });

// 修正後
let contactId: string | undefined;
if (leads.length > 0) contactId = leads[0].id;
await addNoteFromEntities({ contactId, ... });
```

`add_note` ケース全体で `leadId` → `contactId` に置き換えること。
`note.service.ts` の `AddNoteParams` 型で `contactId` が定義済みなので型エラーは出ない。

### Fix 2: 商談が作れない（`deals_stage_check`）

**ファイル**: `api/src/db/queries/deals.ts`

Phase 3 で deals.stage を `open / won / lost` の3値に変更したが、デフォルト値が旧ステージのまま。

```typescript
// 現状
input.stage ?? 'prospecting',           // L39
AND d.stage NOT IN ('closed_won','closed_lost')  // L69

// 修正後
input.stage ?? 'open',                  // L39
AND d.stage NOT IN ('won','lost')        // L69
```

修正後に `npm run build` + `npm test` を確認すること。

---

## Part 1: promote コード削除（TASK_15 の前処理）

`customer` ライフサイクルステージは Migration 014 で廃止済み。
`promoteContactToCustomer()` はそのステージを参照するため壊れている。
以下をすべて削除すること。

### 削除対象

| ファイル | 削除内容 |
|:---|:---|
| `api/src/slack/nlu/intent-parser.ts` | `'promote'` インテント定義 |
| `api/src/slack/events/message.ts` | `case 'promote':` ハンドラー + `コンバート` キーワード検知 |
| `api/src/services/contact.service.ts` | `promoteContactToCustomer()` 関数 |
| `api/src/db/queries/contacts.ts` | `promoteContact()` クエリ |

削除後:
- `npm run build` でコンパイルエラーがないこと
- `npm test` が通過すること

---

## Part 2: TASK_15 — Slack 応答速度の改善

詳細設計は `TASK_15_RESPONSE_SPEED.md` を参照。以下の順序で実装すること。

### Step 1: ⏳ リアクション追加（低リスク・即効）

`api/src/slack/events/message.ts` を改修:

```typescript
// メッセージ受信直後（NLU 呼び出し前）に追加
await client.reactions.add({
  channel: event.channel,
  timestamp: event.ts,
  name: 'hourglass_flowing_sand',
});

// ... 既存の NLU + 処理 ...

// 処理完了後（返信の直前）に削除
await client.reactions.remove({
  channel: event.channel,
  timestamp: event.ts,
  name: 'hourglass_flowing_sand',
}).catch(() => {});
```

音声入力の `api/src/slack/events/voice.ts` にも同様に追加すること。

---

### Step 2: 正規表現ショートカット（NLU バイパス）

**新規ファイル**: `api/src/slack/nlu/fast-intent.ts`

`TASK_15_RESPONSE_SPEED.md` の Section 2.2 のコードをそのまま実装すること。

`api/src/slack/events/message.ts` の NLU 呼び出し箇所を以下に置き換え:

```typescript
import { fastIntentMatch } from '../nlu/fast-intent';

const fast = fastIntentMatch(text);
let nlu: NluResult;

if (fast) {
  nlu = { intent: fast.intent, entities: fast.entities, confidence: 0.95 };
} else {
  nlu = await parseIntent(text);
}
```

---

### Step 3: 音声 — STT とコンテキスト取得を並列化

`api/src/slack/events/voice.ts` を改修:

```typescript
// 変更前（直列）
const rawText = await transcribe(audioBuffer);
const knownNames = await getKnownNames(tenantId);

// 変更後（並列）
const [rawText, knownNames] = await Promise.all([
  transcribe(audioBuffer),
  getKnownNames(tenantId),
]);
```

---

### Step 4: 音声 — 同音異義語修正 + NLU を 1 回の Haiku 呼び出しに統合

`api/src/slack/nlu/intent-parser.ts` に `parseIntentWithCorrection()` を追加。
`TASK_15_RESPONSE_SPEED.md` の Section 2.3 のプロンプトとコードをそのまま実装すること。

`api/src/slack/events/voice.ts` の呼び出しを以下に変更:

```typescript
// 変更前
const corrected = await correctHomophones(rawText, knownNames);
const nlu = await parseIntent(corrected);

// 変更後
const nlu = await parseIntentWithCorrection(rawText, knownNames);
```

---

### Step 5: Cloud Run min-instances 設定

`deploy.yml` の API デプロイ step に `--min-instances=1` を追加:

```yaml
gcloud run deploy ${{ env.API_SERVICE }} \
  --image "$IMAGE" \
  --region ${{ env.REGION }} \
  --platform managed \
  --allow-unauthenticated \
  --min-instances=1 \
  --max-instances=10 \
  ...（既存の --set-env-vars 等はそのまま）
```

---

## 完了条件

- [ ] promote 関連コードが全ファイルから削除されている
- [ ] `npm run build` エラーなし
- [ ] `npm test` 全テスト PASS
- [ ] テキスト入力で即座に ⏳ リアクションが表示される
- [ ] 音声入力で ⏳ リアクションが表示される
- [ ] `fast-intent.ts` が存在し、明確な指示パターンで Haiku をバイパスする
- [ ] 音声入力の Haiku 呼び出しが 2 回 → 1 回になっている
- [ ] 音声 STT と DB 先読みが Promise.all で並列化されている
- [ ] `deploy.yml` に `--min-instances=1` が追加されている
- [ ] main ブランチへ push（GitHub Actions で自動デプロイ）
- [ ] HANDOFF.md の残タスク表を更新

---

## 注意事項

- `correctHomophones()` を呼んでいる箇所が他にもあれば確認して対応すること
- `fast-intent.ts` のパターンは保守的に始める（誤マッチは Haiku より悪い）
- min-instances=1 追加後は GCP コンソールで課金額を確認すること（約 ¥2,000/月増）
