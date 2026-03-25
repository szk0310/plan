# TASK 03: leads テーブル完全廃止 & API 統一

> **優先度**: 🟡 高
> **対象ファイル**:
> - `api/src/routes/api.ts`
> - `api/src/services/lead.service.ts`
> - `api/src/db/queries/leads.ts`
> - `api/src/db/migrations/008_drop_leads.sql`（新規作成）
> - `web/src/views/LeadList.vue`（削除 or contacts に統合）
> - `web/src/router/index.ts`
> **依存**: TASK_01（RLS 修正）の完了が望ましい

---

## 背景

Migration 003 で Lead/Contact 統合（HubSpot モデル）に移行した。
contacts テーブルに `lifecycle_stage` カラムを追加し、leads のデータを移行済み。

**しかし以下が残存している：**

1. `leads` テーブル自体がまだ DB に存在
2. `api/src/routes/api.ts` に `/api/leads` エンドポイントが残っている（L43-84）
3. `api/src/services/lead.service.ts` が残っている
4. `api/src/db/queries/leads.ts` が残っている
5. `web/src/views/LeadList.vue` が leads API を呼んでいる可能性がある
6. `/api/dashboard` の KPI クエリが leads テーブルを直接参照している（L20-23）

---

## 修正手順

### Step 1: 影響範囲の確認

以下のコマンドで `leads` テーブルへの参照箇所を洗い出す：

```bash
cd /Users/szk/Desktop/APP/slackSFA
grep -rn "leads" api/src/ --include="*.ts" | grep -v node_modules | grep -v ".d.ts"
grep -rn "leads" web/src/ --include="*.ts" --include="*.vue" | grep -v node_modules
```

### Step 2: `/api/leads` エンドポイントの置き換え

`api/src/routes/api.ts` の `/api/leads` 関連エンドポイント（L43-84）を修正。

```typescript
// ❌ 変更前: leads テーブルを直接参照
router.get('/api/leads', async (req, res) => {
  let sql = `SELECT * FROM leads WHERE 1=1`;
  // ...
});

// ✅ 変更後: contacts テーブルの prospect を返す
router.get('/api/leads', async (req, res) => {
  // /api/leads は後方互換のために残すが、内部は contacts を参照
  const { q } = req.query as Record<string, string>;
  let sql = `SELECT c.*, a.name AS account_name
    FROM contacts c
    LEFT JOIN accounts a ON a.id = c.account_id
    WHERE c.lifecycle_stage IN ('prospect', 'active')`;
  const params: unknown[] = [];
  if (q) {
    params.push(`%${q}%`);
    sql += ` AND (c.last_name ILIKE $${params.length} OR COALESCE(a.name, c.company_name) ILIKE $${params.length})`;
  }
  sql += ` ORDER BY c.deal_probability DESC NULLS LAST, c.created_at DESC LIMIT 100`;
  const result = await pool.query(sql, params);
  res.json(result.rows);
});
```

### Step 3: Dashboard KPI の修正

`api/src/routes/api.ts` L18-34 のダッシュボード KPI クエリを修正。

```typescript
// ❌ 変更前
pool.query(`SELECT COUNT(*) AS total,
  COUNT(*) FILTER (WHERE is_converted = false) AS active,
  ROUND(AVG(deal_probability) FILTER (WHERE is_converted = false AND deal_probability IS NOT NULL)) AS avg_prob
  FROM leads`),

// ✅ 変更後
pool.query(`SELECT COUNT(*) AS total,
  COUNT(*) FILTER (WHERE lifecycle_stage IN ('prospect', 'active')) AS active,
  ROUND(AVG(deal_probability) FILTER (WHERE lifecycle_stage IN ('prospect', 'active') AND deal_probability IS NOT NULL)) AS avg_prob
  FROM contacts`),
```

### Step 4: `/api/leads/:id` の修正

```typescript
// ✅ 変更後: contacts から取得
router.get('/api/leads/:id', async (req, res) => {
  const [contact, notes] = await Promise.all([
    pool.query(`SELECT c.*, a.name AS account_name FROM contacts c LEFT JOIN accounts a ON a.id = c.account_id WHERE c.id = $1`, [req.params.id]),
    pool.query(`SELECT * FROM crm_notes WHERE contact_id = $1 ORDER BY created_at DESC`, [req.params.id]),
  ]);
  if (!contact.rows[0]) { res.status(404).json({ error: 'Not found' }); return; }
  res.json({ ...contact.rows[0], notes: notes.rows });
});
```

### Step 5: PATCH/DELETE `/api/leads/:id` の修正

`lead.service.ts` の `updateLeadService` / `deleteLeadService` は contacts 版に置き換え。

```typescript
// ✅ 変更後: contacts のサービスに委譲
router.patch('/api/leads/:id', async (req, res) => {
  // contacts の PATCH と同じロジックを使う
  // /api/contacts/:id の PATCH と同じ処理
  const allowed = ['last_name','first_name','email','phone','mobile','title','department',
                   'lifecycle_stage','company_name','source','website_url','is_primary'];
  const updates: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in req.body) updates[key] = req.body[key];
  }
  if (Object.keys(updates).length === 0) { res.status(400).json({ error: 'No fields to update' }); return; }
  const fields = Object.keys(updates).map((k, i) => `${k} = $${i + 1}`);
  const values = [...Object.values(updates), req.params.id];
  const result = await pool.query(
    `UPDATE contacts SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $${values.length} RETURNING *`,
    values
  );
  if (!result.rows[0]) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(result.rows[0]);
});

router.delete('/api/leads/:id', async (req, res) => {
  const result = await pool.query(`DELETE FROM contacts WHERE id = $1 RETURNING id`, [req.params.id]);
  if (!result.rows[0]) { res.status(404).json({ error: 'Not found' }); return; }
  res.json({ success: true });
});
```

### Step 6: `lead.service.ts` の廃止

`api/src/services/lead.service.ts` を削除。
import している箇所を洗い出して修正する：

```bash
grep -rn "lead.service" api/src/ --include="*.ts"
```

`api/src/routes/api.ts` L3 の import を削除。

### Step 7: `leads.ts`（DB queries）の廃止

`api/src/db/queries/leads.ts` を削除。
import している箇所を洗い出して修正する：

```bash
grep -rn "queries/leads" api/src/ --include="*.ts"
```

### Step 8: LeadList.vue の確認

`web/src/views/LeadList.vue` を確認し、以下のいずれかを実行：

- **案 A**: `/api/leads` を `/api/contacts?stage=prospect` に書き換える
- **案 B**: LeadList.vue を削除し、ContactList.vue に統合する
  - `web/src/router/index.ts` から `/leads` ルートを削除、または ContactList にリダイレクト

**推奨: 案 A**（後方互換を維持しつつ内部を切り替え）

### Step 9: マイグレーションファイル作成

`api/src/db/migrations/008_drop_leads.sql` を新規作成：

```sql
-- ============================================================
-- Migration 008: leads テーブル廃止
-- Lead/Contact 統合（Migration 003）で contacts に移行済み
-- REST API も contacts ベースに変更済み
-- ============================================================

-- ① ai_lead_assessments の lead_id FK を解除
-- （contact_id カラムが Migration 003 で追加済み）
ALTER TABLE ai_lead_assessments DROP CONSTRAINT IF EXISTS ai_lead_assessments_lead_id_fkey;

-- ② crm_notes の lead_id FK を解除し、カラムを残す（NULL許容）
-- 既存データの参照が壊れないよう、FK のみ解除
ALTER TABLE crm_notes DROP CONSTRAINT IF EXISTS crm_notes_lead_id_fkey;

-- ③ leads テーブルを DROP
-- ⚠️ 本番では事前にバックアップを取ること
DROP TABLE IF EXISTS leads CASCADE;

-- ④ ai_lead_assessments の lead_id カラムを削除（contact_id に統合済み）
-- 注意: lead_id にデータが残っている場合は、事前に contact_id にマッピングすること
-- ALTER TABLE ai_lead_assessments DROP COLUMN IF EXISTS lead_id;

-- ⑤ crm_notes の lead_id カラムの CHECK 制約を更新
-- lead_id が消えるので、contact_id がないとリンク切れになる
-- 既存レコードで lead_id のみセットされたものは contact_id に移行が必要
-- UPDATE crm_notes SET contact_id = ... WHERE lead_id IS NOT NULL AND contact_id IS NULL;
```

**⚠️ 注意**: 本番で実行する前に、leads テーブルのデータが全て contacts に移行されていることを確認すること。

---

## 完了条件

- [ ] `/api/leads` が内部的に contacts テーブルを参照している
- [ ] `/api/dashboard` KPI が contacts テーブルを参照している
- [ ] `lead.service.ts` が削除されている
- [ ] `db/queries/leads.ts` が削除されている
- [ ] `008_drop_leads.sql` マイグレーションファイルが作成されている
- [ ] LeadList.vue が contacts API を使っている
- [ ] TypeScript コンパイルエラーがないこと
- [ ] `grep -rn "FROM leads" api/src/` が 0 件（マイグレーション除く）
