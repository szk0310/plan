# TASK_09: Seed Data + Playwright E2E テスト基盤

> **目的**: ダミーデータを自動投入し、全画面の E2E テストを人手ゼロで実行可能にする
> **優先度**: 🟡 高
> **依存**: TASK_10, 11, 12（UI 変更後に書く）

---

## 1. 設計方針

### テストの原則

1. **再現可能**: `docker compose up` → `npm test` だけで全テスト通過
2. **独立**: テスト間でデータが干渉しない（各テストで seed リセット）
3. **高速**: Playwright の並列実行、API テストは supertest で直接
4. **人手ゼロ**: CI で自動実行、スクリーンショットで結果確認

---

## 2. Seed Data 設計

### 2.1 テスト用テナント

```sql
-- tests/fixtures/seed.sql

-- テスト用テナント
INSERT INTO tenants (id, name, slack_team_id) VALUES
  ('00000000-0000-0000-0000-000000000099', 'テストテナント', 'T_TEST_TEAM');
```

### 2.2 Accounts（5社）

```sql
INSERT INTO accounts (id, tenant_id, name, website_url, industry, prefecture, phone) VALUES
  ('a0000000-0001', '...099', '株式会社テストA', 'https://test-a.co.jp', 'IT', '東京都', '03-1111-1111'),
  ('a0000000-0002', '...099', '株式会社テストB', 'https://test-b.co.jp', '製造業', '大阪府', '06-2222-2222'),
  ('a0000000-0003', '...099', 'テストC合同会社', 'https://test-c.co.jp', '小売', '愛知県', '052-3333-3333'),
  ('a0000000-0004', '...099', 'D株式会社',       'https://test-d.co.jp', 'コンサル', '福岡県', '092-4444-4444'),
  ('a0000000-0005', '...099', 'E Holdings',      'https://test-e.com', '金融', '東京都', '03-5555-5555');
```

### 2.3 Contacts（15人 — 各ステージ・温度に分散）

| # | 名前 | 会社 | lifecycle | nurturing | deal_prob | 目的 |
|---|------|------|-----------|-----------|-----------|------|
| 1 | 田中太郎 | A社 | prospect | cold | 15% | 冷えた見込み客 |
| 2 | 佐藤花子 | A社 | prospect | warm | 45% | 温まり中 |
| 3 | 鈴木一郎 | B社 | active | hot | 78% | ホットリード |
| 4 | 高橋美咲 | B社 | active | warm | 55% | 中間 |
| 5 | 伊藤健太 | C社 | customer | warm | — | 既存顧客 |
| 6 | 渡辺直美 | C社 | customer | hot | — | 既存顧客 |
| 7 | 山本学   | D社 | prospect | cold | 10% | 新規見込み |
| 8 | 中村優子 | D社 | inactive | cold | 5% | 休眠 |
| 9 | 小林誠   | E社 | active | hot | 85% | ほぼ商談化 |
| 10 | 加藤裕介 | E社 | prospect | warm | 35% | 中間 |
| 11 | 吉田恵  | A社 | churned | cold | 0% | 離反 |
| 12 | 松本大輝 | B社 | prospect | cold | 20% | 冷えた見込み |
| 13 | 井上さくら | C社 | active | warm | 60% | 中間 |
| 14 | 木村拓也 | D社 | customer | warm | — | 既存 |
| 15 | 林真理子 | E社 | prospect | hot | 70% | エスカレーション閾値 |

### 2.4 Deals（8件 — 確率帯に分散）

| # | 案件名 | 会社 | stage | win_prob | amount |
|---|--------|------|-------|----------|--------|
| 1 | クラウド移行 | A社 | open | 78% | ¥5,000,000 |
| 2 | 基幹システム刷新 | B社 | open | 45% | ¥12,000,000 |
| 3 | セキュリティ監査 | C社 | open | 22% | ¥800,000 |
| 4 | AI チャットボット | D社 | open | 91% | ¥3,000,000 |
| 5 | データ分析基盤 | E社 | open | 55% | ¥7,500,000 |
| 6 | 受注済み案件 | A社 | won | 100% | ¥2,000,000 |
| 7 | 失注案件 | C社 | lost | 0% | ¥1,500,000 |
| 8 | 新規案件 | B社 | open | 15% | ¥500,000 |

### 2.5 CRM Notes（20件）

各コンタクト・案件に 1〜3件のメモを配置。
note_type を meeting / call / email / general に分散。
日付を過去30日間に分散。

### 2.6 Activity Logs（10件）

activity_type を email_received / call / meeting / slack_message に分散。
ai_interest_score を 1〜5 に分散。

### 2.7 Deal Progress History（各案件3件）

3時点の win_probability を記録（グラフテスト用）。

---

## 3. Seed 投入の自動化

### 3.1 Seed スクリプト

```typescript
// tests/helpers/seed.ts

import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';

const TEST_DB_URL = process.env.TEST_DATABASE_URL
  ?? 'postgresql://slacksfa_app:localdev@localhost:5432/slacksfa';

export async function seedTestData(): Promise<void> {
  const pool = new Pool({ connectionString: TEST_DB_URL });
  const sql = fs.readFileSync(
    path.join(__dirname, '../fixtures/seed.sql'), 'utf-8'
  );

  await pool.query('BEGIN');
  await pool.query(`SET LOCAL app.tenant_id = '00000000-0000-0000-0000-000000000099'`);
  await pool.query(sql);
  await pool.query('COMMIT');
  await pool.end();
}

export async function cleanTestData(): Promise<void> {
  const pool = new Pool({ connectionString: TEST_DB_URL });
  await pool.query(`DELETE FROM deal_progress_history WHERE tenant_id = '00000000-0000-0000-0000-000000000099'`);
  await pool.query(`DELETE FROM activity_logs WHERE tenant_id = '00000000-0000-0000-0000-000000000099'`);
  await pool.query(`DELETE FROM crm_notes WHERE tenant_id = '00000000-0000-0000-0000-000000000099'`);
  await pool.query(`DELETE FROM ai_draft_replies WHERE tenant_id = '00000000-0000-0000-0000-000000000099'`);
  await pool.query(`DELETE FROM deals WHERE tenant_id = '00000000-0000-0000-0000-000000000099'`);
  await pool.query(`DELETE FROM contacts WHERE tenant_id = '00000000-0000-0000-0000-000000000099'`);
  await pool.query(`DELETE FROM accounts WHERE tenant_id = '00000000-0000-0000-0000-000000000099'`);
  await pool.end();
}
```

### 3.2 Playwright Global Setup

```typescript
// tests/global-setup.ts

import { seedTestData, cleanTestData } from './helpers/seed';

export default async function globalSetup() {
  await cleanTestData();
  await seedTestData();
  console.log('✅ Test seed data loaded');
}
```

### 3.3 playwright.config.ts の更新

```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  globalSetup: './global-setup.ts',
  use: {
    baseURL: 'http://localhost:3001',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'cd ../api && npm run dev',
      port: 3000,
      reuseExistingServer: true,
    },
    {
      command: 'cd ../web && npm run dev',
      port: 3001,
      reuseExistingServer: true,
    },
  ],
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
  reporter: [['html', { open: 'never' }]],
});
```

---

## 4. E2E テストシナリオ

### 4.1 Dashboard テスト

```typescript
// tests/e2e/dashboard.spec.ts

test.describe('ダッシュボード', () => {
  test('KPI が seed データと一致する', async ({ page }) => {
    await page.goto('/');
    // アクティブリード数 = lifecycle_stage in (prospect, active) の件数
    await expect(page.getByText('12')).toBeVisible(); // 15人中 prospect+active
    // パイプライン = open deals の合計金額
    await expect(page.getByText('¥28,800,000')).toBeVisible();
  });

  test('確率分布チャートが表示される', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('canvas')).toBeVisible(); // Chart.js canvas
  });

  test('AI 推奨アクション TOP 5 が表示される', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('推奨アクション')).toBeVisible();
  });

  test('サイドバーから各ページに遷移できる', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: /商談/ }).click();
    await expect(page).toHaveURL('/deals');
  });
});
```

### 4.2 DealBoard テスト

```typescript
// tests/e2e/deal-board.spec.ts

test.describe('商談パイプライン', () => {
  test('確率帯カンバンが表示される', async ({ page }) => {
    await page.goto('/deals');
    await expect(page.getByText('低')).toBeVisible();   // 0-30%
    await expect(page.getByText('中')).toBeVisible();   // 31-60%
    await expect(page.getByText('高')).toBeVisible();   // 61-90%
    await expect(page.getByText('確実')).toBeVisible(); // 91%+
  });

  test('カードに確率とネクストアクションが表示される', async ({ page }) => {
    await page.goto('/deals');
    await expect(page.getByText('78%')).toBeVisible();
    await expect(page.getByText('クラウド移行')).toBeVisible();
  });

  test('カードクリックで詳細に遷移する', async ({ page }) => {
    await page.goto('/deals');
    await page.getByText('クラウド移行').click();
    await expect(page).toHaveURL(/\/deals\//);
  });

  test('確率帯に正しい件数が表示される', async ({ page }) => {
    await page.goto('/deals');
    // 0-30%: 2件（セキュリティ監査22%, 新規案件15%）
    // 31-60%: 2件（基幹システム45%, データ分析55%）
    // 61-90%: 1件（クラウド移行78%）
    // 91%+: 1件（AIチャットボット91%）
  });
});
```

### 4.3 DealDetail テスト

```typescript
// tests/e2e/deal-detail.spec.ts

test.describe('商談詳細', () => {
  test('確率推移グラフが表示される', async ({ page }) => {
    await page.goto('/deals/d0000000-0001'); // クラウド移行
    await expect(page.locator('canvas')).toBeVisible();
  });

  test('MEDDPICC 要素が表示される', async ({ page }) => {
    await page.goto('/deals/d0000000-0001');
    await expect(page.getByText('課題の特定')).toBeVisible();
    await expect(page.getByText('意思決定者')).toBeVisible();
  });

  test('推奨アクションリストが表示される', async ({ page }) => {
    await page.goto('/deals/d0000000-0001');
    await expect(page.getByText(/推奨|アクション/)).toBeVisible();
  });
});
```

### 4.4 ContactList テスト

```typescript
// tests/e2e/contact-list.spec.ts

test.describe('顧客一覧', () => {
  test('全件が表示される', async ({ page }) => {
    await page.goto('/contacts');
    await expect(page.locator('table')).toBeVisible();
    // 最初のページに10件表示（ページネーション）
  });

  test('ライフサイクルフィルタが動作する', async ({ page }) => {
    await page.goto('/contacts');
    await page.getByText('見込み客').click();
    // prospect のみ表示されることを確認
    await expect(page.getByText('田中太郎')).toBeVisible();
    await expect(page.getByText('伊藤健太')).not.toBeVisible(); // customer
  });

  test('検索が動作する', async ({ page }) => {
    await page.goto('/contacts');
    await page.fill('input[placeholder*="検索"]', '田中');
    await page.waitForTimeout(500);
    await expect(page.getByText('田中太郎')).toBeVisible();
  });

  test('CRUD ボタンが存在しない（Slack に移行済み）', async ({ page }) => {
    await page.goto('/contacts');
    await expect(page.locator('button[title="編集"]')).toHaveCount(0);
    await expect(page.locator('button[title="削除"]')).toHaveCount(0);
  });

  test('アカウント詳細に遷移できる', async ({ page }) => {
    await page.goto('/contacts');
    await page.getByText('田中太郎').click();
    await expect(page).toHaveURL(/\/accounts\//);
  });
});
```

### 4.5 AccountList テスト

```typescript
// tests/e2e/account-list.spec.ts

test.describe('取引先一覧', () => {
  test('5社が表示される', async ({ page }) => {
    await page.goto('/accounts');
    const rows = page.locator('tbody tr');
    await expect(rows).toHaveCount(5);
  });

  test('検索が動作する', async ({ page }) => {
    await page.goto('/accounts');
    await page.fill('input[placeholder*="検索"]', 'テストA');
    await page.waitForTimeout(500);
    await expect(page.getByText('株式会社テストA')).toBeVisible();
  });

  test('会社クリックで詳細に遷移する', async ({ page }) => {
    await page.goto('/accounts');
    await page.getByText('株式会社テストA').click();
    await expect(page).toHaveURL(/\/accounts\//);
  });
});
```

### 4.6 API テスト（Playwright の request fixture）

```typescript
// tests/e2e/api.spec.ts

const API = 'http://localhost:3000';

test.describe('API エンドポイント', () => {
  test('GET /api/contacts が配列を返す', async ({ request }) => {
    const res = await request.get(`${API}/api/contacts`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(15);
  });

  test('GET /api/contacts?stage=prospect がフィルタされる', async ({ request }) => {
    const res = await request.get(`${API}/api/contacts?stage=prospect`);
    const body = await res.json();
    for (const c of body) {
      expect(c.lifecycle_stage).toBe('prospect');
    }
  });

  test('GET /api/deals が open deals を返す', async ({ request }) => {
    const res = await request.get(`${API}/api/deals`);
    const body = await res.json();
    expect(body.length).toBeGreaterThanOrEqual(6);
  });

  test('GET /api/dashboard/probability-distribution が確率帯を返す', async ({ request }) => {
    const res = await request.get(`${API}/api/dashboard/probability-distribution`);
    const body = await res.json();
    expect(body).toHaveProperty('low');
    expect(body).toHaveProperty('medium');
    expect(body).toHaveProperty('high');
    expect(body).toHaveProperty('very_high');
  });

  test('GET /api/deals/:id/progress-history が履歴を返す', async ({ request }) => {
    const res = await request.get(`${API}/api/deals/d0000000-0001/progress-history`);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(3);
  });
});
```

---

## 5. CI 連携

### GitHub Actions

```yaml
# .github/workflows/e2e.yml
name: E2E Tests

on:
  pull_request:
    branches: [main]

jobs:
  e2e:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15-alpine
        env:
          POSTGRES_DB: slacksfa
          POSTGRES_USER: slacksfa_app
          POSTGRES_PASSWORD: localdev
        ports:
          - 5432:5432

    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install dependencies
        run: |
          cd api && npm ci
          cd ../web && npm ci
          cd ../tests && npm ci
          npx playwright install --with-deps chromium

      - name: Run migrations
        run: cd api && npm run migrate:dev
        env:
          DATABASE_URL: postgresql://slacksfa_app:localdev@localhost:5432/slacksfa

      - name: Start servers
        run: |
          cd api && npm run dev &
          cd web && npm run dev &
          npx wait-on http://localhost:3000/health http://localhost:3001

      - name: Run E2E tests
        run: cd tests && npx playwright test
        env:
          TEST_DATABASE_URL: postgresql://slacksfa_app:localdev@localhost:5432/slacksfa

      - name: Upload test report
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: tests/playwright-report/
```

---

## 6. 実装ファイル一覧

| ファイル | 操作 | 内容 |
|----------|------|------|
| `tests/fixtures/seed.sql` | 新規 | ダミーデータ INSERT |
| `tests/helpers/seed.ts` | 新規 | Seed 投入・クリーンアップ |
| `tests/global-setup.ts` | 新規 | Playwright 起動前に seed |
| `tests/playwright.config.ts` | 改修 | globalSetup + webServer 設定 |
| `tests/e2e/dashboard.spec.ts` | 改修 | KPI 数値検証、チャート、推奨アクション |
| `tests/e2e/deal-board.spec.ts` | 新規 | 確率帯カンバン、カード表示 |
| `tests/e2e/deal-detail.spec.ts` | 新規 | グラフ、MEDDPICC、アクション |
| `tests/e2e/contact-list.spec.ts` | 新規 | フィルタ、検索、CRUD 不在確認 |
| `tests/e2e/account-list.spec.ts` | 新規 | 一覧、検索、遷移 |
| `tests/e2e/api.spec.ts` | 新規 | 全 API エンドポイント検証 |
| `.github/workflows/e2e.yml` | 新規 | CI で PR 時に自動実行 |

---

## 7. 完了条件

- [ ] `docker compose up` → seed 自動投入 → 全テスト PASS
- [ ] Dashboard: KPI が seed データと一致
- [ ] DealBoard: 確率帯に正しい件数
- [ ] DealDetail: グラフ表示
- [ ] ContactList: フィルタ・検索が動作、CRUD ボタンがない
- [ ] AccountList: 一覧・検索・遷移
- [ ] API: 全エンドポイントが正しいレスポンス
- [ ] CI: PR 時に自動実行、失敗時にスクリーンショット保存
- [ ] 人手の操作: ゼロ
