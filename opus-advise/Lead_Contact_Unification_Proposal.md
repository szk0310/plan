# Lead/Contact モデル統合の設計提言

## 結論：統合すべき。ただし「ライフサイクルステータス」で柔軟性を担保する

---

## 問1：Lead と Contact を統合して Contact 一本にすることの是非

### 回答：**統合を推奨する。**

#### 理由

**① szk様のビジネスモデルとの整合性**

受託型ビジネスにおいて「まだ取引のない見込み客（Lead）」と「既に取引のある顧客（Contact）」の境界線は曖昧です。

- 紹介で名刺をもらった人 → Lead？ Contact？
- 過去に1回仕事をもらった人から再度問い合わせ → 新規 Lead？ 既存 Contact？

Salesforce の Lead/Contact 分離モデルは、「大量のリードを漏斗（ファネル）で絞り込む」マーケティング型営業を前提としており、**紹介ベース・関係構築型の受託営業には過剰な複雑さ**です。

**② 現状の「コンバート」の苦痛**

現在の実装では `convertLeadToAccount()` で Lead → Contact + Account + Deal に変換しています。しかしこのプロセスは：
- データの重複（Lead テーブルと Contact テーブルに同じ人が存在する時間帯がある）
- ユーザーの混乱（「コンバートって何？」）
- 検索の複雑化（Lead テーブルと Contact テーブルの両方を UNION で探す必要がある）

を生んでいます。

**③ Slack UX との親和性**

「田中さんを検索して」と言われた時、Lead と Contact の両方を探して結果をマージする処理は複雑でバグの温床です。**1テーブルなら1クエリで完結**します。

---

## 問2：統合した場合の「新規見込み客」と「既存取引先」の区別方法

### 回答：`lifecycle_stage` カラムで表現する

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│  prospect    │───▶│  active      │───▶│  customer    │
│ (見込み客)    │    │ (商談中)      │    │ (既存顧客)    │
└──────────────┘    └──────────────┘    └──────────────┘
       │                                       │
       ▼                                       ▼
┌──────────────┐                       ┌──────────────┐
│  inactive    │                       │  churned     │
│ (休眠)       │                       │ (離反)       │
└──────────────┘                       └──────────────┘
```

#### 統合後の contacts テーブル設計案

| カラム名 | 型 | 説明 |
| :--- | :--- | :--- |
| `id` | UUID | PK |
| `account_id` | UUID (nullable) | 所属企業（prospect段階ではNULL可） |
| `last_name` | TEXT | 姓 |
| `first_name` | TEXT | 名 |
| `company_name` | TEXT | 会社名（account未リンク時の一時保管） |
| `email` | TEXT | メール |
| `phone`, `mobile` | TEXT | 電話番号 |
| `title`, `department` | TEXT | 役職・部署 |
| `lifecycle_stage` | TEXT | **`prospect` / `active` / `customer` / `inactive` / `churned`** |
| `source` | TEXT | 流入経路 (`referral` / `business_card` / `web_form` 等) |
| `ai_score` | SMALLINT | AI評価スコア（旧Leadから移行） |
| `deal_probability` | SMALLINT | 案件化確率 |
| `owner_slack_id` | TEXT | 担当者 |

#### 「コンバート」が不要になる

- Lead 時代：`leads.status = 'new'` → 手動で「コンバート」 → `contacts` テーブルに新規INSERT
- 統合後：`contacts.lifecycle_stage = 'prospect'` → 商談が生まれたら `'active'` に UPDATE するだけ

**テーブル間の移動がなくなり、データの一貫性が飛躍的に向上します。**

---

## 問3：将来の SaaS 展開（マルチテナント・複数業態）で統合モデルが問題になるか

### 回答：**問題にならない。むしろ有利。**

#### 理由

1. **HubSpot の成功例**: HubSpot は Lead/Contact を分離せず、全員を「Contact」として管理し、`lifecycle_stage` で分類しています。これは世界で最も成功した SaaS CRM の一つです。

2. **マルチテナントでの恩恵**: テーブルが少ないほど RLS ポリシーの管理が楽になります。現在 `leads` と `contacts` の両方に RLS をかけていますが、統合すれば **1テーブル分の RLS ポリシーで済む**。

3. **業態の違いへの対応**: `lifecycle_stage` の選択肢をテナントごとにカスタマイズ可能にすれば（例：不動産業なら `viewing` / `negotiation` / `contracted` など）、業態を問わず柔軟に運用できます。

#### 唯一の注意点
**Lead 固有だった AI 評価系カラム**（`ai_score`, `deal_probability` 等）を Contact テーブルに持たせることになります。既存顧客に対しても AI スコアが付くのは違和感がありますが、逆に **「既存顧客のリピート確率」** として再定義すれば、ビジネス上の価値がさらに高まります。

---

## 問4：Salesforce からの乗り換え需要を狙う場合、互換性をどこまで保つべきか

### 回答：**データインポート互換性だけ保つ。UIやモデルの互換性は不要。**

#### 根拠

Salesforce から乗り換える企業が求めているのは「Salesforce と同じ体験」ではなく、**「Salesforce では得られない体験」**です。

- ✅ **保つべき互換性**: Salesforce からのデータエクスポート（CSV）を取り込む**インポーター**。Lead/Contact/Account/Deal の各テーブルのデータを、統合後の `contacts` テーブルに正しくマッピングして読み込む機能。
- ❌ **捨てるべき互換性**: Salesforceの画面構成や用語の踏襲。SlackSFAの最大の武器は「Salesforceとは全く違う、Slackネイティブな体験」であり、それを Salesforce に寄せるのは自殺行為です。

#### インポーターの設計案

```
[Salesforce CSV]
  ├─ Lead.csv  ──→  contacts (lifecycle_stage = 'prospect')
  ├─ Contact.csv ──→ contacts (lifecycle_stage = 'customer')
  ├─ Account.csv ──→ accounts
  └─ Opportunity.csv ──→ deals
```

---

## 移行戦略（既存データがある場合）

### ステップ1：マイグレーション SQL の設計メモ
```sql
-- 概念的なイメージ（実行コードではなく設計メモ）
ALTER TABLE contacts ADD COLUMN lifecycle_stage TEXT DEFAULT 'customer';
ALTER TABLE contacts ADD COLUMN company_name TEXT;
ALTER TABLE contacts ADD COLUMN source TEXT;
ALTER TABLE contacts ADD COLUMN ai_score SMALLINT;
ALTER TABLE contacts ADD COLUMN deal_probability SMALLINT;
ALTER TABLE contacts ALTER COLUMN account_id DROP NOT NULL;

-- leads → contacts への移行
INSERT INTO contacts (last_name, first_name, company_name, email, ..., lifecycle_stage, source, ai_score)
SELECT last_name, first_name, company_name, email, ..., 
  CASE WHEN is_converted THEN 'customer' ELSE 'prospect' END,
  source, ai_score
FROM leads;
```

### ステップ2：サービス層のリファクタリング方針
- `lead.service.ts` と既存の `contact` 関連ロジックを統合し、`contact.service.ts` に一本化。
- `convertLeadToAccount()` → `promoteContact()` に簡素化。`lifecycle_stage` を UPDATE し、`account_id` を紐づけるだけ。

### ステップ3：Slack ハンドラの簡素化
- 「リードを登録して」→ `contacts` に `lifecycle_stage = 'prospect'` で INSERT。
- 「コンバートして」→ 同じ `contacts` レコードの `lifecycle_stage` を UPDATE。
- 検索は常に `contacts` 1テーブルのみ。

---

## まとめ

| 判断項目 | 結論 |
| :--- | :--- |
| Lead/Contact 統合 | **する（Contact 一本化）** |
| 区別方法 | `lifecycle_stage` で表現 |
| SaaS 展開への影響 | **有利（RLSポリシー削減、テーブル簡素化）** |
| Salesforce 互換性 | **データインポートのみ互換。UI/モデルは独自路線。** |

> **核心:** SlackSFA の価値は「Salesforceの代替」ではなく「Salesforceでは不可能な体験」にある。
> モデルをシンプルにすることは、その体験を磨くための土台である。
