# TASK 02: 未使用依存パッケージ削除 & AI モデル方針の統一

> **優先度**: 🟡 高
> **対象ファイル**:
> - `api/package.json`
> - `api/src/config.ts`
> - `.env.example`
> - `docker-compose.yml`
> - `docs/architecture.md`
> **依存**: なし

---

## 問題の説明

### 1. AI モデル方針の不整合

初期設計では **Gemini（Vertex AI）** を使う計画だったが、
実際の実装は全て **Anthropic Claude** に移行済み。
ドキュメントと設定ファイルに Gemini の痕跡が残っている。

### 2. 未使用パッケージ

`api/package.json` に以下の使用されていないパッケージが含まれている：

```json
"@google/generative-ai": "^0.21.0"  // Gemini SDK — 実際に使われていない
"openai": "^6.27.0"                 // OpenAI SDK — 実際に使われていない
```

確認方法: プロジェクト全体で以下を grep して 0 件であることを確認

```bash
cd /Users/szk/Desktop/APP/slackSFA
grep -r "from '@google/generative-ai'" api/src/
grep -r "from 'openai'" api/src/
grep -r "import.*generative-ai" api/src/
grep -r "import.*openai" api/src/
```

---

## 修正内容

### Step 1: `api/package.json` から未使用パッケージを削除

```bash
cd /Users/szk/Desktop/APP/slackSFA/api
npm uninstall @google/generative-ai openai
```

### Step 2: `.env.example` の修正

```diff
 # Slack App
 SLACK_BOT_TOKEN=xoxb-your-token-here
 SLACK_SIGNING_SECRET=your-signing-secret-here
 
 # Database (local dev)
 DATABASE_URL=postgresql://slacksfa_app:localdev@localhost:5432/slacksfa
 
-# Vertex AI / Gemini
-GEMINI_API_KEY=your-gemini-api-key-here
-GCP_PROJECT_ID=your-gcp-project-id
-GCP_REGION=asia-northeast1
+# Anthropic Claude（NLU + ナーチャリング AI）
+ANTHROPIC_API_KEY=your-anthropic-api-key-here
+
+# GCP（本番インフラ）
+GCP_PROJECT_ID=your-gcp-project-id
+GCP_REGION=asia-northeast1
 
 # GCP Cloud SQL (本番用 - unix socket)
 # DATABASE_URL=postgresql://slacksfa_app:PASSWORD@/slacksfa?host=/cloudsql/PROJECT:REGION:INSTANCE
 # INSTANCE_CONNECTION_NAME=PROJECT:REGION:INSTANCE
 
+# AI ナーチャリング通知先チャンネル
+# NURTURING_NOTIFY_CHANNEL=C0123456789
+
+# SendGrid（AI ナーチャリング Phase B メール送信）
+# SENDGRID_API_KEY=your-sendgrid-api-key
+# SENDGRID_FROM_EMAIL=noreply@example.com
+# SENDGRID_FROM_NAME=SlackSFA
+
 # Node.js
 NODE_ENV=development
 PORT=3000
```

### Step 3: `docker-compose.yml` の修正

```diff
   api:
     build: ./api
     ports:
       - "3000:3000"
     environment:
       DATABASE_URL: postgresql://slacksfa_app:localdev@postgres:5432/slacksfa
       SLACK_BOT_TOKEN: ${SLACK_BOT_TOKEN}
       SLACK_SIGNING_SECRET: ${SLACK_SIGNING_SECRET}
-      GEMINI_API_KEY: ${GEMINI_API_KEY}
+      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
       PORT: 3000
       NODE_ENV: development
```

### Step 4: `docs/architecture.md` の更新

architecture.md の Mermaid 図とコンポーネント表を実態に合わせて更新する。

主な変更点：
1. `Anthropic API` セクションは正しい（Claude Haiku + Sonnet）→ そのまま
2. NLU ノードの `Claude Haiku` → 正確な記述に
3. コンポーネント一覧の「NLU: Claude Haiku」→ 正確なモデル名 `claude-haiku-4-5`
4. 「下書き生成: Claude Sonnet」→ `claude-sonnet-4-6`

### Step 5: config.ts に `GEMINI_API_KEY` が不要であることを確認

現在の `config.ts` を確認：`ANTHROPIC_API_KEY` が必須、`GEMINI_API_KEY` は含まれていない → OK。

---

## 決定が必要な事項

> **URL 自動補完（accounts エンリッチメント）で Gemini を使うかどうか**
>
> TASK_06 でエンリッチメント機能を実装する際、Gemini の Search Grounding（Web検索付き生成）を
> 使うのが最適な選択肢。その場合は `@google/generative-ai` を再導入することになる。
>
> **この TASK_02 では一旦削除し、TASK_06 で必要に応じて再導入する方針**とする。

---

## 完了条件

- [ ] `@google/generative-ai` と `openai` が `package.json` から削除されている
- [ ] `node_modules` が更新されている（`npm install` 実行済み）
- [ ] `.env.example` が Anthropic ベースに更新されている
- [ ] `docker-compose.yml` から `GEMINI_API_KEY` が削除されている
- [ ] `docs/architecture.md` のモデル名が実態と一致している
- [ ] `grep -r "generative-ai\|openai" api/src/` が 0 件であること
