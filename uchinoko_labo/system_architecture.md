# うちの子ラボ システム構成図

**作成日：2026年3月15日**

---

## 全体構成

```
┌─────────────────────────────────────────────────────────────────┐
│                        ユーザー（親御さん）                        │
│                   スマートフォン / ブラウザ                        │
│                    PWA（ホーム画面に追加可）                       │
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTPS
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    GCP Cloud Run                                 │
│              uchinoko-labo（asia-northeast1）                    │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                   Nuxt 4 アプリケーション                  │    │
│  │                                                          │    │
│  │  ┌──────────────────┐   ┌────────────────────────────┐  │    │
│  │  │  フロントエンド     │   │    サーバーサイド (Nitro)    │  │    │
│  │  │  Vue 3 + Tailwind │   │                            │  │    │
│  │  │                  │   │  /api/auth/register・login  │  │    │
│  │  │  /               │   │  /api/children             │  │    │
│  │  │  /register       │   │  /api/diagnosis/narrative  │  │    │
│  │  │  /login          │   │  /api/diagnosis/save       │  │    │
│  │  │  /dashboard      │   │  /api/chat                 │  │    │
│  │  │  /diagnosis      │   │  /api/logs                 │  │    │
│  │  │  /result         │   │  /api/insights/[childId]   │  │    │
│  │  │  /chat           │   │  /api/stripe/checkout      │  │    │
│  │  │  /logs/[childId] │   │  /api/stripe/webhook       │  │    │
│  │  └──────────────────┘   └────────────────────────────┘  │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  メモリ: 512Mi  │  最小インスタンス: 0  │  最大: 3              │
└──────┬──────────────────┬───────────────────────┬───────────────┘
       │ Unix Socket       │ HTTPS API             │ HTTPS API
       ▼                   ▼                       ▼
┌─────────────┐   ┌────────────────┐   ┌──────────────────────┐
│  Cloud SQL  │   │   Anthropic    │   │       Stripe         │
│ PostgreSQL  │   │   Claude API   │   │                      │
│    (共用)    │   │                │   │  Checkout Sessions   │
│             │   │ Haiku 4.5      │   │  Webhooks            │
│  DB:        │   │  └ 診断ナレーション│   │  Subscriptions       │
│  uchinoko   │   │  └ 週次インサイト │   │                      │
│             │   │ Sonnet 4.6     │   │  ¥980/月             │
│  Tables:    │   │  └ AI相談チャット │   └──────────────────────┘
│  users      │   └────────────────┘
│  children   │
│  diagnoses  │
│  growth_logs│
│  chat_messages
│  child_insights
└─────────────┘


```

---

## 認証フロー

```
ユーザー          Nuxt フロントエンド        Nitro サーバー          DB
   │                    │                       │                  │
   │── メール+パスワード→│                       │                  │
   │                    │── POST /api/auth/login →                 │
   │                    │                       │── SELECT users ─→│
   │                    │                       │←─ user row ──────│
   │                    │                       │ bcrypt.compare() │
   │                    │                       │ setUserSession() │
   │                    │←── Set-Cookie(sealed) ─│                  │
   │                    │ fetchSession()         │                  │
   │                    │── GET /api/_auth/session →               │
   │                    │←── { user: {...} } ────│                  │
   │←── /dashboard ─────│                       │                  │
```

---

## AI 処理フロー

```
                    ┌─────────────────────────────────┐
                    │         Claude Haiku 4.5         │
                    │                                  │
  診断完了          │  System: Being の肯定・150-200字  │
  ──────────────────│  Input:  9特性スコア + タイプ名  │──→ AIナレーション
                    │                                  │
  成長ログ蓄積後    │  System: Being の肯定・JSON出力  │
  ──────────────────│  Input:  7日分ログ + タグ        │──→ 週次インサイト
                    └─────────────────────────────────┘

                    ┌─────────────────────────────────┐
                    │        Claude Sonnet 4.6         │
                    │                                  │
  AI相談メッセージ  │  System: 共感ファースト           │
  ──────────────────│          エスカレーション5トリガー│──→ 返答
                    │  Input:  直近20件の会話履歴       │
                    └─────────────────────────────────┘
```

---

## CI/CD パイプライン

```
開発者（ローカル）          GitHub                    GCP
      │                       │                        │
      │── git push main ──────→│                        │
      │                       │ GitHub Actions 起動     │
      │                       │                        │
      │                       │ 1. Workload Identity   │
      │                       │    Federation 認証 ────→│
      │                       │                        │
      │                       │ 2. docker build        │
      │                       │    ./app               │
      │                       │                        │
      │                       │ 3. docker push ────────→ Artifact Registry
      │                       │                        │ asia-northeast1-docker.pkg.dev
      │                       │                        │
      │                       │ 4. gcloud run deploy ──→ Cloud Run
      │                       │    + Secrets注入        │ (自動マイグレーション実行)
```

---

## シークレット管理（GCP Secret Manager）

| シークレット名 | 用途 |
|:---|:---|
| `uchinoko-db-url` | PostgreSQL 接続文字列（Cloud SQL Unix Socket） |
| `uchinoko-anthropic-key` | Anthropic API キー |
| `uchinoko-stripe-secret` | Stripe シークレットキー |
| `uchinoko-stripe-public` | Stripe 公開キー |
| `uchinoko-stripe-price` | Stripe 価格ID（¥980/月） |
| `uchinoko-stripe-webhook-secret` | Stripe Webhook 署名シークレット |
| `uchinoko-session-password` | Cookie 暗号化キー（nuxt-auth-utils） |

---

## インフラ共用構成（コスト最適化）

```
┌─────────────────────────────────────────────┐
│           GCP プロジェクト                    │
│   gen-lang-client-0266211950                 │
│                                              │
│  ┌──────────────────┐ ┌──────────────────┐  │
│  │   Cloud Run      │ │   Cloud Run      │  │
│  │   slackSFA       │ │  uchinoko-labo   │  │
│  └────────┬─────────┘ └────────┬─────────┘  │
│           │                    │             │
│           └──────────┬─────────┘             │
│                      ▼                       │
│           ┌─────────────────────┐            │
│           │   Cloud SQL         │            │
│           │   slacksfa-db       │            │
│           │   (PostgreSQL 15)   │            │
│           │                     │            │
│           │  DB: slacksfa  ←── slackSFA      │
│           │  DB: uchinoko  ←── うちの子ラボ   │
│           └─────────────────────┘            │
└─────────────────────────────────────────────┘
```

同一 Cloud SQL インスタンスを2サービスで共用することで、
Cloud SQL の固定費（約 ¥3,000〜5,000/月）を按分。

---

## 技術スタック一覧

| レイヤー | 技術 | 備考 |
|:---|:---|:---|
| フロントエンド | Nuxt 4 + Vue 3 | `app/` srcDir 構成 |
| スタイリング | Tailwind CSS | ローズ系カラー |
| PWA | @vite-pwa/nuxt | Service Worker・ホーム画面追加 |
| 認証 | nuxt-auth-utils | 署名付き Cookie セッション |
| サーバー | Nitro (Nuxt内蔵) | API Routes |
| DB クライアント | node-postgres (pg) | Unix Socket 対応 |
| AI（診断・インサイト） | Claude Haiku 4.5 | 低コスト・高速 |
| AI（チャット） | Claude Sonnet 4.6 | 高品質な対話 |
| 決済 | Stripe | Checkout Sessions + Webhook |
| インフラ | GCP Cloud Run | サーバーレス・オートスケール |
| DB | GCP Cloud SQL | PostgreSQL 15 |
| コンテナ登録 | Artifact Registry | asia-northeast1 |
| シークレット | Secret Manager | 7シークレット |
| CI/CD | GitHub Actions | Workload Identity Federation |
| 音声入力 | Web Speech API | ブラウザネイティブ・無料 |
