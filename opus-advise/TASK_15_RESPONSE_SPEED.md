# TASK_15: Slack 応答速度の改善

> **目的**: テキスト入力 2-4秒 → 1秒以内、音声入力 5-11秒 → 3-5秒に短縮
> **優先度**: 🟡 高（UX に直結）
> **依存**: promote コード削除の後に実施

---

## 1. 現状のボトルネック

### テキスト入力（現状: 2-4秒）

```
ユーザー入力
  → Bolt SDK 受信            ~100ms
  → Haiku NLU 呼び出し       ~1,000-3,000ms  ★ 主因
  → DB 検索（コンテキスト）    ~200ms
  → 確認メッセージ返信        ~100ms
合計: 約 2-4秒
```

### 音声入力（現状: 5-11秒）

```
音声ファイルアップロード
  → ファイルダウンロード      ~500ms
  → Google STT 文字起こし    ~2,000-5,000ms  ★
  → Haiku 同音異義語修正     ~1,000-2,000ms  ★
  → Haiku NLU 解析           ~1,000-3,000ms  ★
  → DB 検索 + 確認           ~300ms
合計: 約 5-11秒（Haiku 2回 + STT 1回 = 3回の外部 API）
```

---

## 2. 改善施策

### 2.1 即時リアクション（体感改善）

メッセージ受信直後に ⏳ リアクションを付け、処理完了後に削除する。
ユーザーに「受け取った」ことを即座に伝える。

```typescript
// api/src/slack/events/message.ts

// メッセージ受信直後（NLU 呼び出し前）
await client.reactions.add({
  channel: event.channel,
  timestamp: event.ts,
  name: 'hourglass_flowing_sand',  // ⏳
});

// ... NLU + 処理 ...

// 処理完了後
await client.reactions.remove({
  channel: event.channel,
  timestamp: event.ts,
  name: 'hourglass_flowing_sand',
}).catch(() => {});  // 失敗しても無視
```

**効果**: 体感待ち時間の大幅改善（実時間は変わらないが「無反応」がなくなる）
**工数**: 小（message.ts に 10 行追加）

### 2.2 正規表現ショートカット（NLU バイパス）

明確なパターンのメッセージは Haiku を呼ばずに即座にインテントを確定する。
NLU 呼び出し 1-3 秒を完全に削減。

```typescript
// api/src/slack/nlu/fast-intent.ts（新規）

interface FastIntentResult {
  intent: Intent;
  entities: Record<string, string>;
}

const FAST_PATTERNS: { pattern: RegExp; intent: Intent; extract: (m: RegExpMatchArray) => Record<string, string> }[] = [
  // 検索系（最も頻出）
  {
    pattern: /^(.{1,20})(を|の)(検索|情報|詳細)/,
    intent: 'search',
    extract: (m) => ({ keyword: m[1].trim() }),
  },
  // メモ追加
  {
    pattern: /^(.{1,20})(の|さんの)メモ[：:](.+)/s,
    intent: 'add_note',
    extract: (m) => ({ keyword: m[1].trim(), memo: m[3].trim() }),
  },
  // 削除
  {
    pattern: /^(.{1,20})(を|さんを)削除/,
    intent: 'delete_contact',
    extract: (m) => ({ keyword: m[1].trim() }),
  },
  // 一覧表示
  {
    pattern: /^(顧客|商談|会社|リード)一覧/,
    intent: 'show_list',
    extract: (m) => ({ list_type: m[1] }),
  },
  // 登録
  {
    pattern: /^(.{1,20})(を|さんを)(.{1,30})(として|の|で)登録/,
    intent: 'create_contact',
    extract: (m) => ({ keyword: m[1].trim(), company_or_title: m[3].trim() }),
  },
];

/** 正規表現で即座に判定。マッチしなければ null → Haiku NLU にフォールバック */
export function fastIntentMatch(text: string): FastIntentResult | null {
  for (const { pattern, intent, extract } of FAST_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      return { intent, entities: extract(match) };
    }
  }
  return null;
}
```

呼び出し側（message.ts）:

```typescript
import { fastIntentMatch } from '../nlu/fast-intent';

// NLU 呼び出し前にショートカットを試行
const fast = fastIntentMatch(text);
let nlu: NluResult;

if (fast) {
  // Haiku をスキップ
  nlu = { intent: fast.intent, entities: fast.entities, confidence: 0.95 };
} else {
  // 従来の Haiku NLU
  nlu = await parseIntent(text);
}
```

**効果**: 検索・メモ・削除・一覧等の明確な指示で Haiku 1-3秒を削減
**工数**: 中（fast-intent.ts 新規 + message.ts 改修）
**注意**: エンティティ抽出（名前・会社・金額等の細かい解析）は Haiku の方が正確。正規表現が拾えるのはインテント判定と主要キーワードのみ。create_contact の詳細（役職・メール・電話）は確認ステップ後に追加質問する方式にする。

### 2.3 音声: 同音異義語修正 + NLU を 1 回に統合

現状 voice.ts で:
1. Google STT → テキスト
2. Haiku: 同音異義語修正（既存の顧客名・会社名で補正）
3. Haiku: NLU 意図解析

これを **1 回の Haiku 呼び出し**に統合する。

```typescript
// api/src/slack/events/voice.ts の修正

// 変更前: 2回の API 呼び出し
const corrected = await correctHomophones(rawText, knownNames);  // Haiku 1回目
const nlu = await parseIntent(corrected);                        // Haiku 2回目

// 変更後: 1回の API 呼び出し
const nlu = await parseIntentWithCorrection(rawText, knownNames);  // Haiku 1回のみ
```

```typescript
// api/src/slack/nlu/intent-parser.ts に追加

export async function parseIntentWithCorrection(
  rawText: string,
  knownNames: string[],
): Promise<NluResult> {
  const nameList = knownNames.slice(0, 50).join(', ');  // 上位50件

  const res = await anthropic.messages.create({
    model: AI_MODELS.NLU,
    max_tokens: 300,
    messages: [{
      role: 'user',
      content: `音声認識テキストを解析してください。

【音声認識結果（誤変換の可能性あり）】
${rawText}

【登録済みの顧客名・会社名】
${nameList}

以下を同時に行ってください:
1. 音声認識の誤変換を上記の既知の名前で補正
2. 補正後のテキストから意図を解析

JSON形式で回答:
{
  "corrected_text": "補正後のテキスト",
  "intent": "create_contact | add_note | search | ...",
  "entities": { ... },
  "confidence": 0.0-1.0
}`
    }],
  });

  // ... parse response ...
}
```

**効果**: 音声入力で Haiku 1回分（1-2秒）削減
**工数**: 中（voice.ts + intent-parser.ts 改修）

### 2.4 音声: STT とコンテキスト取得を並列化

STT の待ち時間（2-5秒）の間に、DB からユーザーコンテキスト（直近の操作対象）と既知の名前リストを先読みする。

```typescript
// api/src/slack/events/voice.ts

// 変更前（直列）
const rawText = await transcribe(audioBuffer);
const knownNames = await getKnownNames(tenantId);
const context = await getUserContext(userId);

// 変更後（並列）
const [rawText, knownNames, context] = await Promise.all([
  transcribe(audioBuffer),
  getKnownNames(tenantId),
  getUserContext(userId),
]);
```

**効果**: 200-500ms 削減
**工数**: 小（Promise.all に変更するだけ）

### 2.5 Cloud Run min-instances（コールドスタート回避）

```yaml
# api/cloudbuild.yaml or terraform
gcloud run deploy slacksfa-api \
  --min-instances=1 \
  --max-instances=10
```

**効果**: 初回リクエストの 3-5 秒のコールドスタートを排除
**コスト増**: ~¥2,000/月（常時 1 インスタンス稼働）
**工数**: 小（デプロイ設定変更のみ）

---

## 3. 改善後の想定レイテンシ

### テキスト入力

```
施策 2.1 + 2.2 適用後:

パターンA（正規表現マッチ）:
  ⏳ リアクション即時表示
  → 正規表現マッチ             ~5ms
  → DB 検索                   ~200ms
  → 確認メッセージ             ~100ms
  合計: ~300ms（体感即時）

パターンB（Haiku フォールバック）:
  ⏳ リアクション即時表示
  → Haiku NLU                ~1,000-3,000ms
  → DB 検索 + 確認            ~300ms
  合計: ~1,300-3,300ms（体感: ⏳ があるので許容範囲）
```

### 音声入力

```
施策 2.1 + 2.3 + 2.4 適用後:

  ⏳ リアクション即時表示
  → STT + DB 先読み（並列）   ~2,000-5,000ms
  → Haiku 統合（修正+NLU）    ~1,500-3,000ms（1回のみ）
  → DB 検索 + 確認            ~300ms
  合計: ~3,800-8,300ms → 現状比 30-40% 削減
```

---

## 4. 実装ファイル一覧

| ファイル | 操作 | 施策 | 内容 |
|----------|------|------|------|
| `api/src/slack/events/message.ts` | 改修 | 2.1, 2.2 | ⏳ リアクション + fastIntentMatch 呼び出し |
| `api/src/slack/nlu/fast-intent.ts` | 新規 | 2.2 | 正規表現ショートカットパターン定義 |
| `api/src/slack/nlu/intent-parser.ts` | 改修 | 2.3 | `parseIntentWithCorrection()` 追加 |
| `api/src/slack/events/voice.ts` | 改修 | 2.3, 2.4 | 統合 NLU 呼び出し + Promise.all 並列化 |
| Terraform or cloudbuild.yaml | 改修 | 2.5 | `--min-instances=1` 追加 |

---

## 5. 実装順序

```
Step 1: ⏳ リアクション追加（即効、低リスク）
Step 2: fast-intent.ts + message.ts 統合（テキスト高速化のメイン）
Step 3: voice.ts 並列化 + 統合 NLU（音声高速化のメイン）
Step 4: Cloud Run min-instances 設定（要コスト判断）
```

---

## 6. 完了条件

- [ ] テキスト入力で即座に ⏳ リアクションが表示される
- [ ] 「〇〇を検索」「メモ：〜」等の明確な指示が Haiku を経由せず即座に処理される
- [ ] Haiku フォールバック時も ⏳ で待ち状態が伝わる
- [ ] 音声入力で Haiku 呼び出しが 2 回 → 1 回に削減されている
- [ ] 音声入力で STT と DB 先読みが並列実行されている
- [ ] E2E テストが引き続き通過する

---

## 7. 将来の追加最適化（スコープ外メモ）

- **インテントキャッシュ**: 同一ユーザーの直近5分間の同一テキストはキャッシュから返す
- **Streaming NLU**: Haiku のストリーミングで部分的に意図が確定した時点で先行処理開始
- **Google STT Streaming**: バッチ認識をストリーミング認識に変更（リアルタイム文字起こし）
- **Edge 推論**: 頻出パターンを ONNX モデルでローカル推論（Haiku 不要化の究極形）
