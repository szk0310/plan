# TASK 01: RLS セッション管理の脆弱性修正

> **優先度**: 🔴 最優先（セキュリティ）
> **対象ファイル**:
> - `api/src/slack/events/message.ts`
> - `api/src/slack/events/voice.ts`（追加: L48, L212 にも同じ問題あり）
> - `api/src/routes/api.ts`
> - `api/src/db/client.ts`
> **依存**: なし

---

## 問題の説明

現在のコードは `pool.query()` で直接 `SET app.tenant_id` を実行している。
PostgreSQL のコネクションプールでは、同じコネクションが別のリクエストに再利用されるため、
**テナント A が SET した tenant_id がテナント B のリクエストに漏洩する可能性がある**。

### 問題箇所 1: `api/src/slack/events/message.ts` L263

```typescript
// ❌ 現在のコード（危険）
await pool.query(`SET app.tenant_id = '${tenantId}'`);
```

### 問題箇所 2: `api/src/routes/api.ts` L11

```typescript
// ❌ 現在のコード（危険）
async function setTenant(_req: Request, _res: Response, next: NextFunction) {
  await pool.query(`SET app.tenant_id = '${DEV_TENANT_ID}'`);
  next();
}
```

### 問題箇所 3: `api/src/slack/events/voice.ts` L48（getSpeechPhrases 内）

```typescript
// ❌ 現在のコード（危険）
await dbPool.query(`SET app.tenant_id = '00000000-0000-0000-0000-000000000001'`);
```

### 問題箇所 4: `api/src/slack/events/voice.ts` L212（file_shared ハンドラ内）

```typescript
// ❌ 現在のコード（危険）
await pool.query(`SET app.tenant_id = '${tenant.id}'`);
```

### 追加問題: SQL インジェクションリスク

`tenantId` を文字列補間で直接埋め込んでおり、パラメータ化されていない。

### 追加注意: voice.ts L51-53 に leads テーブル参照あり

```typescript
SELECT last_name AS phrase FROM leads   WHERE last_name IS NOT NULL
UNION SELECT first_name               FROM leads   WHERE first_name IS NOT NULL
UNION SELECT company_name             FROM leads   WHERE company_name IS NOT NULL
```

→ これは **TASK_03（leads テーブル廃止）完了後に contacts に書き換える**。
  この TASK_01 では RLS の修正のみ行い、leads 参照はそのままで OK。

---

## 修正方針

### Step 1: `db/client.ts` にテナント付きクエリヘルパーを追加

```typescript
// api/src/db/client.ts に追加

import { Pool, PoolClient } from 'pg';

// 既存の pool はそのまま残す

/**
 * テナントスコープでクエリを実行するヘルパー
 * SET LOCAL はトランザクション内でのみ有効なので、コネクション漏洩がない
 */
export async function withTenant<T>(
  tenantId: string,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  // UUID フォーマット検証（SQL インジェクション防止）
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(tenantId)) {
    throw new Error(`Invalid tenant ID format: ${tenantId}`);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.tenant_id = '${tenantId}'`);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
```

### Step 2: `message.ts` の修正

`executePendingAction` 関数内の `pool.query(SET ...)` を `withTenant()` で包む。

```typescript
// ❌ 変更前（L262-263）
await pool.query(`SET app.tenant_id = '${tenantId}'`);

// ✅ 変更後
// executePendingAction 関数全体を withTenant で包む
import { withTenant } from '../../db/client';

async function executePendingAction(
  pending: PendingAction,
  client: any,
  logger: any
): Promise<void> {
  const { nlu, userId, channel, tenantId } = pending;

  await withTenant(tenantId, async (dbClient) => {
    // この中のクエリは全て dbClient を使う
    // （pool を直接使わない）
    // switch 文の中身はそのまま維持するが、
    // pool.query() → dbClient.query() に置き換える
    // ...
  });
}
```

**注意**: `executePendingAction` 内で `pool.query()` を使っている箇所は直接的には少ない（各 service が pool を内部的に使っている）。サービス層のクエリも将来的には dbClient を渡す設計にすべきだが、**まずは API ルートのミドルウェアから修正する**。

### Step 3: `routes/api.ts` の修正

Express ミドルウェアでテナント設定を行っている箇所を修正。

```typescript
// ❌ 変更前
async function setTenant(_req: Request, _res: Response, next: NextFunction) {
  await pool.query(`SET app.tenant_id = '${DEV_TENANT_ID}'`);
  next();
}

// ✅ 変更後（Phase 2.5 の暫定対応）
// リクエストごとにコネクションを取得し、SET LOCAL を使う
async function setTenant(req: Request, _res: Response, next: NextFunction) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.tenant_id = '${DEV_TENANT_ID}'`);
    // リクエストオブジェクトに dbClient を付与
    (req as any).dbClient = client;
    (req as any).dbClientCleanup = async () => {
      await client.query('COMMIT');
      client.release();
    };
    next();
  } catch (err) {
    await client.query('ROLLBACK');
    client.release();
    next(err);
  }
}

// リクエスト終了時にクリーンアップするミドルウェアを追加
function cleanupTenant(req: Request, _res: Response, next: NextFunction) {
  _res.on('finish', async () => {
    if ((req as any).dbClientCleanup) {
      await (req as any).dbClientCleanup();
    }
  });
  next();
}
```

### Step 4: 段階的移行の方針

サービス層（`contact.service.ts` 等）の内部で `pool` を直接 import して使っている箇所は多い。
一気に全て書き換えるのは危険なので、以下の段階で進める：

1. **[今回]** `withTenant()` ヘルパーを追加し、API ルートのミドルウェアで正しく SET LOCAL する
2. **[次フェーズ]** サービス層に `PoolClient` を DI できるようにリファクタ
3. **[将来]** 全クエリがテナントスコープ内で実行されるようにする

---

## 完了条件

- [ ] `db/client.ts` に `withTenant()` ヘルパーが追加されている
- [ ] `withTenant()` 内で UUID フォーマット検証が行われている
- [ ] `routes/api.ts` の `setTenant` が `SET LOCAL` を使っている
- [ ] `message.ts` の `SET app.tenant_id` が `SET LOCAL` または `withTenant()` に置き換わっている
- [ ] TypeScript のコンパイルエラーがないこと
- [ ] 既存の動作が壊れないこと（手動テストで DM → NLU → CRUD が通ること）
