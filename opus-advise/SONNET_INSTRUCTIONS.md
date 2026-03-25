# SlackSFA Phase 3 — Sonnet 実装指示書

## Context

SlackSFA は α版として稼働中の Slack 統合 AI-CRM。Phase 2.5 で品質・セキュリティの底上げが完了し、Phase 3 では **差別化機能の実装** と **AI Flow への UX 統合** に進む。

### Phase 2.5 完了済み（触らないこと）
- ✅ TASK_01: RLS セッション修正（withTenant + SET LOCAL）
- ✅ TASK_02: 不要依存削除、AI モデル一元化（ai-models.ts）
- ✅ TASK_03: leads テーブル廃止 → contacts 統合（lifecycle_stage）
- ✅ TASK_04: テスト基盤（vitest + client/intent-parser/contact.service テスト）
- ✅ TASK_05: Terraform IaC 初版
- ✅ TASK_06: エンリッチメント（Claude Haiku）
- ✅ TASK_07: Slack Block Kit（/crm-list + 詳細モーダル）
- ✅ TASK_08: 商談コーチング AI（MEDDPICC 8要素）

### TASK_10 完了済み（触らないこと）
- ✅ センチメント駆動の確率エンジン（sentiment-analyzer + probability-engine）
- ✅ 商談ステージ 3値化（open / won / lost）
- ✅ 時間減衰ロジック（毎朝ブリーフィングに組み込み）
- ✅ Slack チャンネル監視（/crm-link + channel_links + バッチ分析）
- ✅ センチメント分析の精度改善（メモ + activity_logs.body 連結）

### Phase 3 の設計思想

1. **AI Flow**: 顧客・ナーチャリング・商談を「件名」をキーにした1画面に統合
2. **センチメント駆動**: 活動の「回数」ではなく「中身」から確率を算出する
3. **Slack メイン**: 日常操作の 90% は Slack で完結。Web はダッシュボード＋分析
4. **2つの確率**:
   - `deal_probability`（商談化確率）: 見込み客が商談になるか
   - `win_probability`（受注確率）: 商談が受注に至るか

---

## なぜ AI Flow への統合が必要か

### 問題

現在の3画面（顧客一覧・ナーチャリング・商談パイプライン）は SFA の専門用語がそのまま UI になっている。

- 顧客一覧に `deal_probability`, `nurturing_stage`, `ai_score` が表示される
- ナーチャリング画面に `confidence_score`, `ai_reasoning` が表示される
- 商談画面に `win_probability`, `progress_score` が表示される

**SFA を知らない人には「AI 自信度と温度感の違い」「顧客の確率と商談の確率の関係」がわからない。**

### 解決

営業活動の本質は「案件を進めること」。ナーチャリングもコーチングも、やっていることは「次のアクションを実行する」という1つの行為。

**→ 全てを「件名」をキーにした1つのリスト（AI Flow）に統合する。**

### ブランディング

- 「ナーチャリング」という SFA 用語を廃止
- 代わりに **AI Flow** という名称で、AI が営業フローを自動で流す新カテゴリを作る
- Web の左メニュー最上部に AI キャラ + 「AI Flow」ロゴを配置

---

## 実行順序と優先度

```
⚠️ 作業開始前に必ず実行 ⚠️
git tag v1.0-account-based -m "Account-based SFA version (before AI Flow migration)"
git push origin v1.0-account-based

TASK_13（AI Flow ビュー）🔴 ← 最優先
    ↓
TASK_09（Seed Data + E2E テスト）🟡 ← UI 確定後に書く
```

**旧 TASK_11（Web ダッシュボード特化）と旧 TASK_12（Slack /crm-list 強化）は TASK_13 に統合された。** それらの設計書は参考資料として残すが、実装は TASK_13 に従うこと。

---

## 現在のコードの保全（重要）

**TASK_13 着手前に以下を必ず実行すること:**

```bash
git tag v1.0-account-based -m "Account-based SFA version (before AI Flow migration)"
git push origin v1.0-account-based
```

理由: 将来、サブスクリプション型企業向けに「アカウントベース版」を兄弟アプリとしてリリースする可能性がある。現在のコードを完全に復元できるようにタグで保存する。

---

## TASK_13: AI Flow ビュー 🔴

**設計書:** `TASK_13_AI_FLOW_VIEW.md` を必ず読むこと

### 概要

顧客・ナーチャリング・商談の3画面を「AI Flow」1画面に統合する。件名をキーに、全ての営業活動を1つのリストで管理する。

### 実装ステップ（この順序で進めること）

#### Step 0: コード保全

```bash
git tag v1.0-account-based -m "Account-based SFA version (before AI Flow migration)"
git push origin v1.0-account-based
```

#### Step 1: DB マイグレーション

```sql
-- api/src/db/migrations/012_flow_subject.sql

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS flow_subject TEXT;

-- 既存データの件名を暫定生成
UPDATE contacts
SET flow_subject = COALESCE(
  (SELECT name FROM accounts WHERE id = contacts.account_id),
  contacts.company_name,
  '未登録'
) || ' 案件'
WHERE flow_subject IS NULL;
```

#### Step 2: 件名自動生成サービス

新規ファイル: `api/src/services/flow-subject.ts`

- コンタクト初回登録時に自動実行
- 入力: 登録時のメモ or Slack メッセージ + 会社名
- AI（Haiku）で「{会社名} {話題の要約}」を15文字以内で生成
- `contacts.flow_subject` に保存
- Slack から `/crm edit 件名 {新しい件名}` で変更可能

#### Step 3: API エンドポイント

新規: `GET /api/flows`

```typescript
// contacts + deals + activity_logs を JOIN して1つのリストにする
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
ORDER BY c.last_activity_at DESC NULLS LAST
LIMIT 50;
```

既存エンドポイント（/api/contacts, /api/deals 等）は残す。内部で使っている箇所があるため。

#### Step 4: Slack — /crm コマンドの変更

`api/src/slack/commands/crm-list.ts` を改修:

```
/crm                    → AI Flow 一覧（デフォルト）
/crm 田中               → キーワード検索
/crm contacts           → 顧客基礎情報（名前・会社・連絡先のみ）
/crm accounts           → 会社基礎情報
```

**AI Flow 一覧の表示フォーマット:**

```
🔥 78% | 受注: 45%
*ABC社 クラウド移行*
田中太郎 | 2日前 | 予算感のヒアリング
[詳細] [メモ追加] [アクション]

🌤️ 45% | 受注: —
*B社 基幹システム相談*
佐藤花子 | 5日前 | デモ日程の調整中
[詳細] [メモ追加] [アクション]
```

- 確率の絵文字: 🧊(0-30%) / 🌤️(31-60%) / 🔥(61-90%) / ⭐(91%+)
  - 商談化確率 or 受注確率の高い方で決定
- 最終活動が 7日以上前の場合 ⚠️ を付与
- 10件/ページのページネーション

**重要: センチメント指標は確率に内包する。別指標として表示しない。**
**根拠は Slack で聞かれた時のみ回答する（「ABCの案件どうなってる？」→ AI が根拠付きで回答）。**

#### Step 5: Slack — 詳細モーダル

新規ファイル: `api/src/slack/views/flow-detail.ts`

既存の `detail-card.ts` を参考にしつつ、AI Flow 用に再構成:
- ヘッダー: 件名
- 基本情報: 顧客名・会社名・連絡先
- 確率: 商談化確率 / 受注確率
- やりとり履歴（最新5件）: activity_logs + crm_notes を時系列マージ
- AI 推奨アクション（上位2件）: suggested_actions から取得
- ボタン: [メモ追加] [編集] [商談作成]（deal がない場合）

#### Step 6: Slack — メモ追加・編集モーダル

旧 TASK_12 の設計をそのまま流用:
- `api/src/slack/views/note-modal.ts` — メモ追加モーダル
- `api/src/slack/views/edit-modal.ts` — 顧客編集モーダル（件名フィールドを追加）

#### Step 7: Web — AI Flow ページ

新規ファイル: `web/src/views/FlowList.vue`

テーブル表示:

| 件名 | 顧客 | 商談化確率 | 受注確率 | 作成日 | 最終活動 | 最終活動内容 |
|------|------|-----------|---------|--------|---------|------------|

- デフォルトソート: 最終活動日の新しい順
- 切替可能: 確率の高い順 / 作成日順
- 検索: 件名・顧客名・会社名
- ページネーション: 10件/ページ
- 行クリック → FlowDetail.vue に遷移

新規ファイル: `web/src/views/FlowDetail.vue`

- 既存の DealDetail.vue のグラフ部分（確率推移、MEDDPICC レーダー）を再利用
- やりとり履歴の時系列表示
- AI 推奨アクションの表示

#### Step 8: Web — 左メニュー変更

`web/src/App.vue`（またはレイアウトコンポーネント）を改修:

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
  [✨ AI Flow]              ← ロゴ（最上部、AI を表すアイコン）
  ├── 📊 ダッシュボード
  ├── ✨ AI Flow             ← メイン画面
  ├── 👤 顧客               ← 基礎情報のみ
  ├── 🏢 会社
  └── 📈 分析
```

AI を表すアイコン:
- SVG プレースホルダーを配置する（後からデザイナーのアセットに差し替え可能にする）
- 仮アイコンとして ✨ または 🔮 を使用

#### Step 9: Web — 不要画面の削除

| ファイル | 操作 |
|----------|------|
| `web/src/views/NurturingList.vue` | **削除** |
| `web/src/views/DealBoard.vue` | **削除** |
| `web/src/views/DealDetail.vue` | グラフ部分を FlowDetail.vue に移植後、**削除** |
| `web/src/views/ContactList.vue` | CRUD 削除、基礎情報のみのテーブルに簡素化 |

ルーター変更:
```typescript
// 旧ルートを削除/リダイレクト
{ path: '/nurturing', redirect: '/flow' },
{ path: '/deals', redirect: '/flow' },
{ path: '/deals/:id', redirect: to => `/flow/${to.params.id}` },

// 新ルート追加
{ path: '/flow', component: FlowList },
{ path: '/flow/:id', component: FlowDetail },
```

#### Step 10: Web — Dashboard.vue の調整

Dashboard は残す。ただし以下を調整:
- 旧 TASK_11 で追加した確率分布チャート・センチメントサマリー・推奨アクションはそのまま活用
- 「商談パイプライン」の KPI を「AI Flow」の KPI に名称変更
- リンク先を /deals → /flow に変更

**完了条件:**
- [ ] `git tag v1.0-account-based` が打たれている
- [ ] contacts.flow_subject カラムが追加されている
- [ ] コンタクト初回登録時に件名が AI で自動生成される
- [ ] GET /api/flows が統合リストを返す
- [ ] `/crm` で AI Flow 一覧が表示される（10件/ページ）
- [ ] AI Flow 一覧に件名・顧客・商談化確率・受注確率・最終活動・内容が表示される
- [ ] 詳細モーダルでやりとり履歴と AI 推奨アクションが表示される
- [ ] 件名が Slack から編集できる
- [ ] メモ追加・顧客編集モーダルが動作する
- [ ] Web に FlowList.vue と FlowDetail.vue が存在する
- [ ] Web の左メニューが新構成になっている（AI Flow ロゴ含む）
- [ ] NurturingList.vue と DealBoard.vue が削除されている
- [ ] ContactList.vue が基礎情報のみの閲覧テーブルになっている
- [ ] Dashboard.vue の名称・リンクが AI Flow に更新されている
- [ ] `npm run build` エラーなし、`npm test` PASS
- [ ] HANDOFF.md が更新されている

---

## TASK_09: Seed Data + Playwright E2E テスト 🟡

**設計書:** `TASK_09_E2E_SEED_DATA.md` を必ず読むこと

TASK_13 完了後に着手。テストシナリオは AI Flow ベースに書き換えること:
- FlowList: テーブル表示、検索、ソート切替、ページネーション
- FlowDetail: やりとり履歴、AI 推奨アクション、確率推移グラフ
- Dashboard: KPI、確率分布チャート
- ContactList: 基礎情報のみ表示（CRUD ボタンがないこと）
- AccountList: 一覧、検索、詳細遷移
- API: /api/flows エンドポイントの検証

---

## 横断ルール（全タスク共通）

### コーディング規約

1. **既存のコードスタイルに従う**: TypeScript strict, async/await, サービス層分離
2. **マイグレーションは追番**: 次は `012_` から
3. **AI モデルは `ai-models.ts` の定数を使う**: ハードコード禁止
4. **ラベルは `crm-labels.ts` を使う**: Web/Slack で同じラベルを表示する
5. **エラーを握りつぶさない**: `.catch(() => {})` は禁止。最低限 `console.error` でログ出力

### 作業ルール

1. **TASK_13 着手前に `git tag v1.0-account-based` を打つ**: 必須
2. **各ステップ完了時に git commit**: `task13-step1: add flow_subject column`
3. **不明点は実装前に聞く**: 推測で進めない
4. **テストが通る状態を維持**: red のまま次のステップに行かない
5. **HANDOFF.md を完了時に更新**: 進捗を記録

### 検証方法

各ステップ完了時:
1. `npm run build` — TypeScript コンパイルエラーなし
2. `npm test` — 全テスト PASS
3. `docker compose up` — ローカルで動作確認
4. Slack で `/crm` が AI Flow 一覧を返す
5. Web で AI Flow ページが正しく表示される

---

## 参照ドキュメント

| ファイル | 内容 |
|----------|------|
| `TASK_13_AI_FLOW_VIEW.md` | AI Flow ビュー詳細設計（テーブル定義、API、Slack/Web UI） |
| `TASK_09_E2E_SEED_DATA.md` | E2E テスト設計（AI Flow ベースに書き換えること） |
| `TASK_10_PROBABILITY_ENGINE.md` | 確率エンジン設計（完了済み・参考資料） |
| `TASK_11_WEB_DASHBOARD.md` | 旧 Web ダッシュボード設計（TASK_13 に統合・参考資料） |
| `TASK_12_SLACK_CRM_LIST.md` | 旧 Slack 強化設計（TASK_13 に統合・参考資料） |
| `HANDOFF.md` | プロジェクト全体の状態 |
