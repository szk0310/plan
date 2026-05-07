# Phase 7-A: 個別ユーザー認証 設計ドラフト

**作成日**: 2026-05-03（オッパレビュー反映: 2026-05-05）
**対象**: オッパレビュー Critical-1 「X-Slack-User-Id ヘッダ信用問題」
**ステータス**: ✅ オッパ設計レビュー完了 → 実装着手 OK

---

## オッパレビュー結果サマリ（2026-05-05）

> 設計書のままで進めて OK。データモデル / 認証フロー / 旧経路完全削除 / 段階移行 / 工数見積もり 全て妥当。
> ただし以下 5 点（A〜E）の細部修正と、`last_used_at` 更新方法を **lazy update（5分粒度）**に変更してから実装に入ること。

### 実装着手時の発見（2026-05-06）

**`users` 表は FORCE ROW LEVEL SECURITY の対象**（[028_force_rls.sql:31](../../APP/slackSFA/api/src/db/migrations/028_force_rls.sql#L31)）。
オッパ指摘 #2 の「列追加で OK」は tenant 文脈確定後の通常クエリを想定した判断だが、認証ルックアップは tenant 文脈が**まだない**段階で hash 検索する必要がある。
FORCE RLS 配下で users を lookup するには SECURITY DEFINER + BYPASSRLS 役割等の機構が必要で、Cloud SQL 制約と運用複雑度が上がる。

→ **設計変更**: `users` への列追加 → **別表 `user_api_keys`（RLS なし）** に変更。
- 既存 `tenant_plans` と同じ「認証ルックアップ用テーブルは RLS なし、tenant 境界は中の `tenant_id` 列で担保」パターンに揃う
- ハッシュ検索が単表 lookup で完結（FK join 不要）
- 将来の履歴保持（key rotation 履歴等）はサイブリング表で拡張可能

**Phase 7 の実施順序の訂正**: PART2 で「Phase 7-E 先」と書いたのは誤り。**Phase 7-A.1（認証層の信頼性確保）が先** — 認証層が偽装可能なまま RBAC を完成させても抜け道で全て無意味。
（→ ただし既に 7-E/7-F/7-G は実装済みなので、Phase 7-A.1 で認証層を固めて初めて 7-E/7-F/7-G の RBAC が真に有効になる）

次回レビュー: Phase 7-A.1 完了後（5/7 頃）の差分レビューを依頼予定。

---

## 背景：現状の信用モデル

```
クライアント → API
  Authorization: Bearer <tenant API key (UUID)>      → tenant 識別
  X-Slack-User-Id: U01ABC...                          → user 識別（自己申告）
```

**問題**:
- テナント API キーは「テナント全体で 1 個」を全メンバーが共有
- `X-Slack-User-Id` はクライアントが自由に書ける単なる文字列
- → メンバー B が `X-Slack-User-Id: U_ADMIN_OF_A` と書けば admin になりすませる
- → 退職者がキーを持ち出すと永遠に有効

オッパ評価: 「**β 段階の暫定**としては理解できるが、本番リリース前に必ず除去すべき**最重要 Critical**」

---

## ゴール

**user 単位で発行・取り消し可能な認証トークン**で、`(tenant_id, slack_user_id, role)` をサーバーが**改ざん不能に**決定する。

### 必須要件
1. クライアントが `slack_user_id` を自由に書けない（トークンから導出）
2. ユーザー単位で revoke できる（退職時に即無効化）
3. テスターに優しい（インストール/設定が複雑にならない）

> **β 互換は不要**：Cloud Run ログ確認の結果、現時点で β テスターによる Web ログイン履歴がゼロ（鈴木さん本人のドッグフーディングのみ）。
> 旧経路（テナント API キー UUID + `X-Slack-User-Id` ヘッダ）は **Phase 7-A.1 で完全削除**してよい。互換期間・段階移行は不要。

### Non-goals（Phase 7-A スコープ外）
- パスワード or MFA — Slack workspace の所有が認証根拠で十分
- 完全な OAuth 2.0 サーバー実装
- フルセッション管理 / refresh token

---

## 案の比較

| 案 | 概要 | 実装コスト | UX | 安全性 |
|---|---|---|---|---|
| **A. 個別 API キー（不透明トークン）** | `users.api_key` に長い乱数を保持。Slack `/setting` で個人 DM に表示 | ★☆☆ 1.5 日 | ★★☆ コピペ | ★★☆ 長期キー |
| **B. Slack マジックリンクログイン** | `/login` slash → 一時トークン付き URL を DM → クリックで session 確立 | ★★☆ 3 日 | ★★★ ワンクリック | ★★★ Slack 所有を毎回確認 |
| **C. Slack OAuth で Web ログイン** | "Sign in with Slack" ボタン → OAuth → session | ★★★ 5 日 | ★★★ 業界標準 | ★★★ |

### 推奨：**A → B の二段階**

1. **Phase 7-A.1（明日〜2 日後）**：個別 API キー方式（案 A）  
   X-Slack-User-Id 自己申告と旧テナント UUID 経路を **同時に廃止**。誰もまだ Web ログインしていないので互換不要
2. **Phase 7-A.2（β 後・有料化までに）**：Slack マジックリンク（案 B）  
   テスターが API キーをコピペする手間と漏洩リスクを排除

本ドキュメントは **Phase 7-A.1（案 A）** を詳細設計する。

---

## Phase 7-A.1 設計：個別 API キー方式

### データモデル

#### 新マイグレーション `035_user_api_keys.sql`

```sql
-- per-user API キー（既存の tenant_plans.api_key とは別物）
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS api_key_hash TEXT,           -- bcrypt or sha256 hash
  ADD COLUMN IF NOT EXISTS api_key_prefix TEXT,         -- "kdu_xxxx" 表示用先頭 8 文字
  ADD COLUMN IF NOT EXISTS api_key_issued_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS api_key_last_used_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS api_key_revoked_at TIMESTAMPTZ;

-- 引き当て用 index（hash の先頭 8 byte 等での O(1) lookup）
CREATE INDEX IF NOT EXISTS idx_users_api_key_prefix
  ON users (api_key_prefix)
  WHERE api_key_revoked_at IS NULL;

-- RLS は既存の users_tenant ポリシーがそのまま効く
```

**選択理由**:
- `users` テーブル自体に列追加 — 別表 join 不要、シンプル
- `api_key_hash` のみ DB 保管。平文は発行時に 1 度だけ DM
- `api_key_prefix` で「どのキーが使われたか」識別子だけは検索可能（hash 全体を毎回比較するためではない）

#### キー形式
```
kdu_<32 byte base64url>
例: kdu_aB3xK9mN2pQrL5vT8wF1jH4yE6sD0gC9
```
- `kdu_` プレフィックスで「Kuragedeal User key」と判別可能
- 32 byte = 256 bit のエントロピー（推測不可）
- base64url（URL safe、コピペ可、特殊文字なし）

#### ハッシュ
- **SHA-256** を採用（bcrypt は不要 — entropy 256bit なら brute force 不可、bcrypt は遅すぎてリクエストごとの照合に向かない）
- 保管: `sha256(plaintext_key).hex()` — 64 文字

### 認証フロー

#### 1. キー発行（Slack `/setting` → 「個人ログインキーを発行する」ボタン）

```
ユーザー → /setting
  ↓
モーダル「⚙️ 設定」内に
  「🔑 個人ログインキーを発行 / 再発行」ボタンを追加
  ↓
クリック → サーバー処理
  1. crypto.randomBytes(32) → base64url → "kdu_..." 生成
  2. sha256 を計算
  3. UPDATE users SET api_key_hash=$1, api_key_prefix=$2, api_key_issued_at=NOW(),
                       api_key_revoked_at=NULL
              WHERE tenant_id=$3 AND slack_user_id=$4
  4. ephemeral DM に平文キー表示
     ※ ephemeral message は Slack API で chat.delete できないため「自動削除」は不可。
       「このメッセージは Slack 履歴には残りません（ephemeral）」とだけ注記する
  5. "再発行すると古いキーは即無効化されます" 警告表示
```

**重要**: 平文は DB に **保存しない**。発行時の chat.postEphemeral に 1 度だけ載せる。失くしたら再発行（過去のキーは即 revoke）。

**/setting モーダルの再描画フロー**（オッパ指摘 B）:
1. 「個人ログインキー発行」ボタン → モーダルは閉じる
2. ephemeral DM で平文キーを 1 回だけ表示（コピペ用）
3. `/setting` を再度開くと「✅ 発行済み（プレフィックス: `kdu_aB3x...`）」と表示
4. 「再発行する」ボタンで何度でも作り直し可能（古いキーは即 revoke）

**admin promotion との独立性**（オッパ指摘 D）:
- キー発行は `upsertUser` を介さず `users` 表を直接 UPDATE する
- → Phase 4-5 で実装した admin promotion ロジックは発火しない（影響なし）

#### 2. ログイン（Web）

既存 `Login.vue` を改修:

```
[ 旧 ]
  入力欄: [API キー (UUID)] + [Slack User ID]
[ 新 ]
  入力欄: [個人ログインキー (kdu_...)]   ← これ 1 個だけ
```

クライアント:
- `localStorage.setItem('kd_user_key', key)`
- `Authorization: Bearer <kdu_...>` で API 呼び出し
- `X-Slack-User-Id` ヘッダは **送らない**（送っても無視）

`localStorage.kd_slack_user_id` は **/api/me から取得した値を保存**（ヘッダ送信用ではなく UI 表示用）。

#### 3. サーバー認証（`setTenant` ミドルウェア改修）

```typescript
// 受け取った Bearer トークン
const token = authHeader.slice(7).trim();

if (!token.startsWith('kdu_')) {
  return res.status(401).json({ error: 'Unauthorized: invalid token format' });
}

const hash = sha256(token);
const r = await pool.query(`
  SELECT u.tenant_id, u.slack_user_id, u.role
    FROM users u
   WHERE u.api_key_hash = $1
     AND u.api_key_revoked_at IS NULL
     AND u.is_active = true
   LIMIT 1
`, [hash]);
if (!r.rows[0]) {
  return res.status(401).json({ error: 'Unauthorized' });
}
tenantId = r.rows[0].tenant_id;
user = { slackUserId: r.rows[0].slack_user_id, role: r.rows[0].role };

// last_used_at 更新は lazy update（オッパ指摘 #3）。
// 5 分以内に更新済みなら skip → UPDATE 頻度が約 1/300 に下がり監査面でも 5 分粒度で十分
await pool.query(
  `UPDATE users SET api_key_last_used_at = NOW()
    WHERE api_key_hash = $1
      AND (api_key_last_used_at IS NULL
           OR api_key_last_used_at < NOW() - INTERVAL '5 minutes')`,
  [hash]
);

// X-Slack-User-Id ヘッダは「読まない・存在を許容しない」(将来の偽装余地を残さない)
// → CORS allowed-headers から削除、middleware で req.headers['x-slack-user-id'] を参照しない
```

旧経路（UUID + X-Slack-User-Id）は **同 PR で削除**：
- `setTenant` から UUID 受け入れブロックを削除（[routes/api.ts:150](../../APP/slackSFA/api/src/routes/api.ts#L150)）
- CORS `Access-Control-Allow-Headers` から `X-Slack-User-Id` を外す（[index.ts:761](../../APP/slackSFA/api/src/index.ts#L761)）
- `index.ts` で受け付けていたヘッダ参照を全削除

**`tenant_plans.api_key` 列の扱い**（オッパ指摘 #4）: **列保持**で確定。grep の結果、以下 4 箇所で参照中:

| 参照箇所 | 用途 | Phase 7-A.1 での処理 |
|---|---|---|
| `routes/api.ts:150` | 旧 setTenant 経路 | **削除**（このPRで） |
| `routes/stripe.ts:36` | Stripe webhook 認証 | **保持**（webhook 専用認証として残す） |
| `routes/oauth.ts:128` | インストール完了 DM/メール送信 | **置換**: ようこそ DM の文言を「`/setting` で個人ログインキーを発行してください」に変更し、UUID 自体は送らない |
| `slack/commands/settings.ts:249` | 旧「ログインキー確認」ボタン | **削除**: 新ボタン「個人ログインキー発行」に置換 |

→ 列自体は DB に残す。Stripe webhook で使い続ける + 将来の他連携の余地を残すため。

---

## 実装タスク分解

### Day 1（明日）
- [ ] migration `035_user_api_keys.sql` 適用（再発行=上書きの注釈コメント追加：オッパ指摘 C）
- [ ] `services/user-key.service.ts` 新規（issue / verify / revoke）
- [ ] `setTenant` middleware を **新方式のみ**に書き換え
  - 旧 UUID 経路削除（[routes/api.ts:150](../../APP/slackSFA/api/src/routes/api.ts#L150)）
  - DEV_TENANT_ID フォールバック削除（オッパ指摘 E）→ 開発キーは seed 経由
  - last_used_at は **lazy update（5 分粒度）**
- [ ] CORS `Access-Control-Allow-Headers` から `X-Slack-User-Id` 削除（[index.ts:761](../../APP/slackSFA/api/src/index.ts#L761)）
- [ ] Slack `/setting` モーダル改修
  - 「ログインキー確認」ボタン削除
  - 「個人ログインキー発行 / 再発行」ボタン追加
  - 発行済み時は「✅ 発行済み（プレフィックス: `kdu_xxxx...`）」表示（オッパ指摘 B）
- [ ] action handler: `crypto.randomBytes(32)` → ephemeral DM 表示（自動削除は不可なので注記のみ：オッパ指摘 A）
- [ ] `routes/oauth.ts:128` 置換: ようこそ DM の文言変更（UUID 自体は送らない）
- [ ] 単体テスト: `user-key.service.test.ts`（issue → verify → revoke / 再発行 / lazy update）
- [ ] 単体テスト: `setTenant` の Bearer 検証（有効 / revoked / 不正形式 / DEV_TENANT_ID 廃止確認）
- [ ] dev seed: `036_dev_seed_user_key.sql`（NODE_ENV=development 用、DEV_TENANT_ID 存在時のみ）

### Day 2
- [ ] `Login.vue` 改修: 入力欄を 1 個に統一（`kdu_...` のみ）
- [ ] `api-client.ts` 改修: `kd_user_key` 読み込み、`X-Slack-User-Id` 送信廃止
- [ ] `App.vue`, `router/index.ts`, `Settings.vue`, `Debug.vue` の localStorage キー名整理（`kd_api_key` → `kd_user_key`）
- [ ] `/api/me` を「Bearer から user 解決して role/slack_user_id/tenant_id を返す」に整理
- [ ] β テスター 4 社への案内: 「Slack で `/setting` → 個人ログインキー発行 → コピー → Web ログイン」の 1 枚ペラ（鈴木さん作成）
- [ ] E2E 動作確認: 新規発行 → ログイン → 通常操作 → 再発行 → 古いキーで 401
- [ ] HANDOFF.md 更新
- [ ] オッパへ差分レビュー依頼（5/7 頃）

---

## オッパレビュー回答（2026-05-05 完了）

| # | 質問 | オッパ回答 | 反映 |
|---|---|---|---|
| 1 | SHA-256 で OK か | ✅ OK。256bit エントロピーなら bcrypt 不要 | そのまま |
| 2 | 列追加 vs 別表 | ✅ 列追加で OK（Phase 7-A.1 では）。Phase 7-A.2 で再評価 | そのまま |
| 3 | last_used_at 更新 | **lazy update（5 分粒度）推奨**。fire-and-forget は失敗検知できない | ✅ 反映済み |
| 4 | tenant_plans.api_key | 当面列保持。Stripe webhook で使用中（grep 確認済） | ✅ 反映済み |
| 5 | キー漏洩検知 | Phase 7-A.1 では last_used_at + Cloud Run ログで十分。7-A.2 で auth_events 検討 | そのまま |

**オッパ追加指摘 5 点（A〜E）の反映状況**:

- **A. ephemeral 自動削除は不可** → 注記のみに変更 ✅
- **B. /setting モーダルの再描画フロー** → 4 ステップで明示 ✅
- **C. キー再発行 = 上書き** → migration にコメント追加 ✅
- **D. admin promotion との独立性** → 設計書に明記 ✅
- **E. DEV_TENANT_ID フォールバック削除** → seed migration に切替 ✅

---

## 後続：Phase 7-A.2 構想（β 後）

- Slack マジックリンク: `/login` slash → ephemeral DM に「ログインリンク」ボタン → クリックで Web に飛ぶ → サーバーが session_token を発行 → cookie 保存
- セッション短期失効（24h）+ refresh
- 個別 API キーは「プログラム呼び出し用」として残し、Web UI は session に切替
