# TASK 06: URL → AI 自動補完（accounts エンリッチメント）

> **優先度**: 🟢 中
> **対象ファイル**:
> - `api/src/services/enrichment.service.ts`（新規作成）
> - `api/src/slack/events/message.ts`（エンリッチメントトリガー追加）
> - `api/src/routes/api.ts`（手動トリガー API 追加）
> **依存**: なし

---

## 背景

初期設計で `website_url` をキーに AI が住所・電話・業種・規模を自動補完する
「入力しないCRM」機能が計画されていた。accounts テーブルには以下のカラムが既に存在する：

- `website_url` — 補完の起点
- `enriched_at` — 補完完了日時（NULL = 未補完）
- `enrichment_source` — `'gemini_search'` | `'manual'`

---

## 設計方針

### AI モデルの選択

| 選択肢 | メリット | デメリット |
|--------|---------|-----------|
| **Claude + Web検索なし** | 既存スタックに統一 | 最新情報が取れない |
| **Gemini + Search Grounding** | Web検索で最新情報取得 | 別SDKが必要 |
| **Claude + Brave Search API** | Claude のまま Web 検索 | 追加 API 契約が必要 |

**推奨**: **Gemini 2.0 Flash + Search Grounding**
理由: エンリッチメントは「公開情報の検索・抽出」が本質。Gemini の Search Grounding はこの用途に最適。
NLU/ナーチャリングは Claude のまま、エンリッチメントのみ Gemini を使うのは合理的な棲み分け。

### 実装する場合

```bash
cd /Users/szk/Desktop/APP/slackSFA/api
npm install @google/generative-ai
```

`config.ts` に追加:

```typescript
GEMINI_API_KEY: z.string().optional(), // エンリッチメント専用
```

---

## 実装内容

### `api/src/services/enrichment.service.ts`（新規）

```typescript
/**
 * URL → AI 自動補完（accounts エンリッチメント）
 * website_url を起点に Gemini が住所/電話/業種/規模を補完する
 */
import { pool } from '../db/client';
import { config } from '../config';

// Gemini SDK（エンリッチメント専用）
let genAI: any = null;
async function getGeminiModel() {
  if (!config.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not configured');
  if (!genAI) {
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    genAI = new GoogleGenerativeAI(config.GEMINI_API_KEY);
  }
  return genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    // Search Grounding を有効化（公式 API をチェック）
  });
}

interface EnrichmentResult {
  phone?: string;
  postal_code?: string;
  prefecture?: string;
  city?: string;
  address_line?: string;
  industry?: string;
  size_range?: string;
  domain?: string;
}

/**
 * 指定した account の website_url から情報を補完する
 * 非同期で呼び出し、結果を DB に保存する
 */
export async function enrichAccount(accountId: string, slackClient?: any): Promise<void> {
  // account を取得
  const res = await pool.query(
    `SELECT id, name, website_url, enriched_at, owner_slack_id FROM accounts WHERE id = $1`,
    [accountId]
  );
  const account = res.rows[0];
  if (!account) {
    console.warn(`[Enrichment] Account not found: ${accountId}`);
    return;
  }
  if (!account.website_url) {
    console.warn(`[Enrichment] No website_url for account: ${accountId}`);
    return;
  }

  // 既に補完済みで24時間以内の場合はスキップ
  if (account.enriched_at) {
    const enrichedAge = Date.now() - new Date(account.enriched_at).getTime();
    if (enrichedAge < 24 * 60 * 60 * 1000) {
      console.log(`[Enrichment] Account ${accountId} was enriched recently, skipping`);
      return;
    }
  }

  try {
    const model = await getGeminiModel();

    const prompt = `以下のWebサイトURLから、この会社の情報を調べてください。

URL: ${account.website_url}
会社名: ${account.name}

以下のJSON形式のみで回答してください（説明不要）:
{
  "phone": "代表電話番号（ハイフン付き）",
  "postal_code": "郵便番号（ハイフン付き）",
  "prefecture": "都道府県",
  "city": "市区町村",
  "address_line": "番地以降",
  "industry": "業種（IT/製造/小売/金融/医療/建設/不動産/教育/サービス/その他）",
  "size_range": "従業員規模（1-10/11-50/51-200/201-）",
  "domain": "メインドメイン"
}

見つからない項目は null にしてください。`;

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const jsonMatch = text.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      const enriched: EnrichmentResult = JSON.parse(jsonMatch[0]);

      // NULL でない値のみ UPDATE
      const updates: string[] = [];
      const values: unknown[] = [];
      let paramIdx = 1;

      const fields: (keyof EnrichmentResult)[] = [
        'phone', 'postal_code', 'prefecture', 'city',
        'address_line', 'industry', 'size_range', 'domain',
      ];

      for (const field of fields) {
        if (enriched[field] != null) {
          updates.push(`${field} = $${paramIdx}`);
          values.push(enriched[field]);
          paramIdx++;
        }
      }

      if (updates.length > 0) {
        updates.push(`enriched_at = NOW()`);
        updates.push(`enrichment_source = 'gemini_search'`);
        values.push(accountId);

        await pool.query(
          `UPDATE accounts SET ${updates.join(', ')} WHERE id = $${paramIdx}`,
          values
        );

        console.log(`[Enrichment] Account ${accountId} enriched: ${updates.length - 2} fields updated`);

        // Slack 通知（担当者がいる場合）
        if (slackClient && account.owner_slack_id) {
          const updatedFields = fields
            .filter(f => enriched[f] != null)
            .map(f => `• ${fieldLabel(f)}: ${enriched[f]}`)
            .join('\n');

          await slackClient.chat.postMessage({
            channel: account.owner_slack_id,
            text: `🔍 ${account.name} の情報を自動補完しました`,
            blocks: [
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: `🔍 *${account.name}* の情報を自動補完しました\n\n${updatedFields}`,
                },
              },
            ],
          });
        }
      } else {
        console.log(`[Enrichment] No new information found for account ${accountId}`);
      }
    }
  } catch (err) {
    console.error(`[Enrichment] Error enriching account ${accountId}:`, err);
  }
}

function fieldLabel(field: string): string {
  return {
    phone: '電話番号',
    postal_code: '郵便番号',
    prefecture: '都道府県',
    city: '市区町村',
    address_line: '住所',
    industry: '業種',
    size_range: '従業員規模',
    domain: 'ドメイン',
  }[field] ?? field;
}

/**
 * 未補完の全 accounts を一括エンリッチする（バッチ用）
 * 1回の実行で最大 count 件を処理
 */
export async function enrichPendingAccounts(count = 10, slackClient?: any): Promise<number> {
  const res = await pool.query(
    `SELECT id FROM accounts
     WHERE website_url IS NOT NULL
       AND (enriched_at IS NULL OR enriched_at < NOW() - INTERVAL '30 days')
     ORDER BY enriched_at ASC NULLS FIRST
     LIMIT $1`,
    [count]
  );

  for (const row of res.rows) {
    await enrichAccount(row.id, slackClient);
    // レートリミット: 1秒間隔
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  return res.rows.length;
}
```

### API ルートの追加

`api/src/routes/api.ts` に手動トリガー API を追加：

```typescript
// ── Enrichment ─────────────────────────────────────────────
router.post('/api/accounts/:id/enrich', async (req, res) => {
  const { enrichAccount } = await import('../services/enrichment.service');
  try {
    await enrichAccount(req.params.id);
    res.json({ success: true, message: 'Enrichment triggered' });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
```

### NLU からの自動トリガー

`message.ts` の `create_contact` ケースで、`website_url` が含まれている場合に
非同期でエンリッチメントをトリガー：

```typescript
case 'create_contact': {
  // ... 既存の処理 ...
  const lead = await createContactFromEntities({ ... });

  // website_url があれば accounts を非同期でエンリッチ
  if (nlu.entities.website_url && lead.account_id) {
    import('../../services/enrichment.service').then(({ enrichAccount }) => {
      enrichAccount(lead.account_id!, client).catch(err =>
        logger.error('[Enrichment] async error:', err)
      );
    });
  }
  break;
}
```

---

## 完了条件

- [ ] `enrichment.service.ts` が作成されている
- [ ] `enrichAccount()` が Gemini で情報を取得して accounts を更新する
- [ ] 補完結果が Slack DM で担当者に通知される
- [ ] `/api/accounts/:id/enrich` API が機能する
- [ ] `enrichPendingAccounts()` バッチ関数が存在する
- [ ] TypeScript コンパイルエラーがないこと
