# TASK_13: AI Flow ビュー — 案件ベースの統合 SFA 画面

> **目的**: 顧客・ナーチャリング・商談の3画面を「AI Flow」1画面に統合し、SFA 未経験者にも直感的な UX を提供する
> **優先度**: 🔴 最優先（TASK_11/12 を置き換える）
> **依存**: TASK_10（確率エンジン）完了済み

---

## 1. なぜこの変更をするのか

### 問題

現在の画面構成は SFA の専門用語がそのまま UI になっている：

| 画面 | 表示内容 | ユーザーの混乱 |
|------|----------|--------------|
| 顧客一覧 | deal_probability, nurturing_stage, ai_score | 「AI自信度と温度感の違いは？」 |
| ナーチャリング | confidence_score, ai_reasoning, status | 「これと顧客の温度感は何が違う？」 |
| 商談パイプライン | win_probability, progress_score, MEDDPICC | 「顧客一覧の確率とこの確率の関係は？」 |

**3つの画面に「AI の判断」が散らばっていて、SFA を知らない人には何を見ればいいかわからない。**

### 解決

営業活動の本質は「案件を進めること」。ナーチャリング（温める）もコーチング（育てる）も、やっていることは **「次のアクションを実行する」** という1つの行為。

**→ 全てを「件名」をキーにした1つのリスト（AI Flow）に統合する。**

### 副次的メリット：ブランディング

- 「ナーチャリング」という SFA 用語を廃止
- 代わりに **「AI Flow」** という名称で、AI が営業フローを自動で流す新カテゴリを作る
- Salesforce の下位互換ではなく、**全く新しい AI 営業ツール** として認識される

---

## 2. AI Flow ビューの仕様

### 2.1 テーブル定義

| カラム | 内容 | データソース |
|--------|------|-------------|
| 件名 | ファーストタッチの内容から AI が自動命名。Slack から編集可能 | contacts.flow_subject（新規カラム）or deals.title |
| 顧客 | 担当者名 | contacts.last_name + first_name |
| 商談化確率 | 見込み客 → 商談になる確率 | contacts.deal_probability |
| 受注確率 | 商談 → 受注に至る確率 | deals.win_probability（deal がなければ「—」） |
| 作成日時 | 初回登録日 | contacts.created_at |
| 最終活動 | 最後の活動からの経過日数 | contacts.last_activity_at から算出 |
| 最終活動内容 | 最後のやり取りの AI 要約 | activity_logs.ai_summary（最新1件） |

### 2.2 表示ルール

```
商談化前（deal なし）:
  件名: AI 自動生成（「ABC社 クラウド相談」）
  商談化確率: 45%
  受注確率: —

商談化後（deal あり）:
  件名: deals.title（= AI が生成 or ユーザーが編集したもの）
  商談化確率: (非表示 or ✅)
  受注確率: 62%

受注 / 失注:
  通常リストから消える（「完了」タブで閲覧可能）
```

### 2.3 ソート

デフォルト: 最終活動日の新しい順（放置されている案件が下に沈む）
切替可能: 確率の高い順 / 作成日順

### 2.4 センチメント・根拠の扱い

- **センチメントは確率に内包** — 別指標として表示しない
- **根拠は聞かれた時だけ答える**:
  - Slack: 「ABCの案件どうなってる？」→ AI が根拠付きで回答
  - Web: 行クリック → 詳細パネルで根拠表示

---

## 3. 件名の自動生成

### トリガー

コンタクト初回登録時に自動生成。

### AI プロンプト

```
以下の情報から、営業案件の件名を生成してください。
「{会社名} {話題の要約}」の形式で、15文字以内で返してください。

顧客情報:
- 名前: {last_name}{first_name}
- 会社: {company_name}
- 登録時のメモ: {initial_note}
- ソース: {source}

例:
- 「ABC社 クラウド移行」
- 「D社 イベント接点」
- 「E Holdings DX相談」
```

### 保存先

`contacts.flow_subject` カラムを新設（nullable, TEXT）。
deals が作成されたら `deals.title` が件名として使われる（flow_subject より優先）。

---

## 4. DB マイグレーション

```sql
-- api/src/db/migrations/012_flow_subject.sql

-- contacts に件名カラムを追加
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS flow_subject TEXT;

-- 既存データの件名を生成（後からバッチで AI 生成する）
-- 暫定: 会社名 + 「案件」
UPDATE contacts
SET flow_subject = COALESCE(
  (SELECT name FROM accounts WHERE id = contacts.account_id),
  contacts.company_name,
  '未登録'
) || ' 案件'
WHERE flow_subject IS NULL;
```

---

## 5. API エンドポイント

### 新規: GET /api/flows

AI Flow 一覧を返す統合エンドポイント。

```typescript
// api/src/routes/api.ts に追加

app.get('/api/flows', async (req, res) => {
  const { q, sort } = req.query;
  const tenantId = req.headers['x-tenant-id'] as string;

  const result = await withTenant(tenantId, async (client) => {
    let sql = `
      SELECT
        c.id AS contact_id,
        d.id AS deal_id,
        COALESCE(d.title, c.flow_subject, c.last_name || ' 案件') AS subject,
        c.last_name || COALESCE(c.first_name, '') AS contact_name,
        COALESCE(a.name, c.company_name, '会社未登録') AS company_name,
        c.deal_probability,
        d.win_probability,
        c.created_at,
        c.last_activity_at,
        (
          SELECT ai_summary FROM activity_logs
          WHERE contact_id = c.id
          ORDER BY created_at DESC LIMIT 1
        ) AS last_activity_summary
      FROM contacts c
      LEFT JOIN accounts a ON a.id = c.account_id
      LEFT JOIN deals d ON d.primary_contact_id = c.id AND d.stage = 'open'
      WHERE c.lifecycle_stage IN ('prospect', 'active')
    `;

    if (q) {
      sql += ` AND (c.last_name ILIKE $1 OR COALESCE(a.name, c.company_name) ILIKE $1 OR COALESCE(d.title, c.flow_subject) ILIKE $1)`;
    }

    const orderBy = sort === 'probability'
      ? 'ORDER BY COALESCE(d.win_probability, c.deal_probability, 0) DESC'
      : 'ORDER BY c.last_activity_at DESC NULLS LAST';

    sql += ` ${orderBy} LIMIT 50`;

    return client.query(sql, q ? [`%${q}%`] : []);
  });

  res.json(result.rows);
});
```

### 既存エンドポイントの扱い

| エンドポイント | 変更 |
|---------------|------|
| `GET /api/contacts` | 残す（基礎情報用） |
| `GET /api/deals` | 残す（Web 詳細用） |
| `GET /api/nurturing/drafts` | 残す（内部で AI Flow から参照） |
| `GET /api/flows` | **新規** — AI Flow ビューのメイン |

---

## 6. Slack UI（/crm コマンド）

### 6.1 デフォルトビュー = AI Flow 一覧

```
/crm                    → AI Flow 一覧（全件）
/crm 田中               → キーワード検索
/crm contacts           → 顧客基礎情報（名前・会社・連絡先のみ）
/crm accounts           → 会社基礎情報
/crm help               → 使い方
```

### 6.2 AI Flow 一覧の表示

```
🔥 78% | 受注: 45%
*ABC社 クラウド移行*
田中太郎 | 2日前 | 予算感のヒアリング
[詳細] [メモ追加] [アクション]

🌤️ 45% | 受注: —
*B社 基幹システム相談*
佐藤花子 | 5日前 | デモ日程の調整中
[詳細] [メモ追加] [アクション]

🧊 15% | 受注: —
*D社 イベント接点*
山本学 | ⚠️ 12日前 | 初回返信済み
[詳細] [メモ追加] [アクション]

[◀ 前の10件] [次の10件 ▶]
```

- 確率の絵文字は商談化確率 or 受注確率の高い方で決定
- 最終活動が 7日以上前の場合 ⚠️ を表示
- 「アクション」ボタン = AI 推奨の次のアクションをモーダルで表示 + 実行

### 6.3 詳細モーダル

行の「詳細」ボタンで開くモーダル:

```
┌─────────────────────────────────────┐
│  ABC社 クラウド移行                   │
│                                      │
│  👤 田中太郎（ABC株式会社・部長）       │
│  📧 tanaka@abc.co.jp | 📞 03-xxxx    │
│                                      │
│  商談化確率: 78%  受注確率: 45%        │
│  作成: 3/1  最終活動: 3/21（2日前）    │
│                                      │
│  ── 最近のやりとり ──                  │
│  3/21 📧 予算感のヒアリング            │
│  3/18 🤝 初回ミーティング実施           │
│  3/15 📞 電話で課題確認                │
│                                      │
│  ── AI 推奨アクション ──               │
│  🔥 決裁者との面談を設定してください    │
│  📋 提案書をカスタマイズして送付       │
│                                      │
│  [メモ追加] [編集] [商談作成]          │
└─────────────────────────────────────┘
```

### 6.4 件名の編集

```
/crm edit 件名 ABC社の新規クラウド案件
```

or 詳細モーダルの「編集」から件名フィールドを変更。

---

## 7. Web UI

### 7.1 左メニュー変更

```
旧:
  SlackSFA
  ├── 📊 ダッシュボード
  ├── 🎯 リード
  ├── 🏢 取引先
  ├── 💼 商談
  ├── 🤖 ナーチャリング
  └── 📈 分析

新:
  [AI キャラ + 'AI Flow']  ← ロゴ（左メニュー最上部）
  ├── 📊 ダッシュボード
  ├── ✨ AI Flow           ← メイン画面（旧ナーチャリング + 商談 + 顧客を統合）
  ├── 👤 顧客              ← 基礎情報のみ（CRUD なし）
  ├── 🏢 会社              ← 基礎情報のみ
  └── 📈 分析
```

### 7.2 AI Flow ページ（FlowList.vue 新規作成）

テーブル表示（あなたが定義した通り）:

```
┌──────────────────────────────────────────────────────────────────────┐
│  ✨ AI Flow                                            [検索...] 🔍 │
│                                                                      │
│  件名              顧客      商談化  受注  作成日  最終活動  内容     │
│  ─────────────────────────────────────────────────────────────────── │
│  ABC社クラウド移行  田中太郎  78%    45%   3/1    2日前    予算ヒア.. │
│  B社基幹システム    佐藤花子  92%    —     3/5    5日前    デモ調整.. │
│  D社イベント接点    山本学    15%    —     3/10   ⚠️12日   初回返信.. │
│  ...                                                                 │
│                                                                      │
│  [◀] 1 / 3 [▶]                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

行クリック → 右パネル or モーダルで詳細表示（やりとり履歴 + AI 推奨アクション + 確率推移グラフ）

### 7.3 AI キャラのロゴ

左メニュー最上部に配置。Claude Code の🦀のように、AI Flow のアイデンティティを表すマーク。

具体的なキャラデザインは後で決定。仮で以下のいずれか:
- ✨（スパークル）— AI の魔法感
- 🌊（ウェーブ）— Flow の流れ
- 🔮（水晶玉）— AI の予測力

実装時は SVG アイコンをプレースホルダーとして配置し、後からデザイナーのアセットに差し替えられるようにする。

### 7.4 削除する画面

| 旧画面 | 対応 |
|--------|------|
| ContactList.vue（CRUD付き） | → 顧客基礎情報テーブル（閲覧のみ）に簡素化 |
| NurturingList.vue | → **廃止**（AI Flow に統合） |
| DealBoard.vue（カンバン） | → **廃止**（AI Flow テーブルに統合） |
| DealDetail.vue | → AI Flow の詳細パネルとして再利用（確率推移グラフ等） |

---

## 8. 実装ファイル一覧

| ファイル | 操作 | 内容 |
|----------|------|------|
| `api/src/db/migrations/012_flow_subject.sql` | 新規 | flow_subject カラム追加 |
| `api/src/routes/api.ts` | 改修 | GET /api/flows エンドポイント追加 |
| `api/src/slack/commands/crm-list.ts` | 改修 | /crm デフォルト = AI Flow 一覧 |
| `api/src/slack/views/flow-detail.ts` | 新規 | AI Flow 詳細モーダル |
| `api/src/services/flow-subject.ts` | 新規 | 件名自動生成サービス |
| `web/src/views/FlowList.vue` | 新規 | AI Flow 一覧ページ |
| `web/src/views/FlowDetail.vue` | 新規 | AI Flow 詳細（グラフ含む） |
| `web/src/views/ContactList.vue` | 改修 | 基礎情報のみに簡素化 |
| `web/src/views/NurturingList.vue` | 削除 | AI Flow に統合 |
| `web/src/views/DealBoard.vue` | 削除 | AI Flow に統合 |
| `web/src/router/index.ts` | 改修 | ルート変更（/flow, /flow/:id） |
| `web/src/App.vue` | 改修 | 左メニュー変更 + AI Flow ロゴ |
| `web/src/lib/api-client.ts` | 改修 | flows() メソッド追加 |

---

## 9. 完了条件

- [ ] contacts.flow_subject カラムが追加されている
- [ ] コンタクト初回登録時に件名が AI で自動生成される
- [ ] GET /api/flows が contacts + deals + activity_logs を統合して返す
- [ ] `/crm` で AI Flow 一覧が表示される（10件/ページ）
- [ ] AI Flow 一覧に件名・顧客・商談化確率・受注確率・最終活動・内容が表示される
- [ ] 詳細モーダルでやりとり履歴と AI 推奨アクションが表示される
- [ ] 件名が Slack から編集できる
- [ ] Web に AI Flow ページが存在する
- [ ] Web の左メニューが新構成になっている（AI Flow ロゴ含む）
- [ ] NurturingList.vue と DealBoard.vue が削除されている
- [ ] ContactList.vue が基礎情報のみの閲覧テーブルになっている
- [ ] `npm run build` エラーなし

---

## 10. アカウントベース版の保全

**重要: 現在のコードを完全に保存すること。**

将来、サブスクリプション型企業向けに「アカウントベース版」を兄弟アプリとしてリリースする可能性がある。

### 保全方法

TASK_13 着手前に以下を実行:

```bash
# 現在の状態でタグを打つ
git tag v1.0-account-based -m "Account-based SFA version (before AI Flow migration)"
git push origin v1.0-account-based
```

これにより:
- `v1.0-account-based` タグからいつでも復元可能
- AI Flow 版と並行して開発・リリースできる
- 将来 fork して別リポジトリにすることも可能
