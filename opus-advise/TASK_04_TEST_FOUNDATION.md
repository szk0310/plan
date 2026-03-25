# TASK 04: テスト基盤構築

> **優先度**: 🟡 高
> **対象ディレクトリ**:
> - `api/` — vitest + supertest 導入
> - `tests/` — E2E テスト拡充
> **依存**: TASK_01, TASK_03 の完了が望ましい

---

## 現状

- E2E テスト: Playwright（`tests/e2e/dashboard.spec.ts` のみ）
- 単体テスト: **なし**
- 統合テスト: **なし**

---

## 修正内容

### Step 1: vitest のセットアップ

```bash
cd /Users/szk/Desktop/APP/slackSFA/api
npm install -D vitest @vitest/coverage-v8
```

`api/vitest.config.ts` を新規作成：

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/db/migrations/**', 'src/**/*.test.ts', 'src/**/*.spec.ts'],
    },
  },
});
```

`api/package.json` の scripts に追加：

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage"
  }
}
```

### Step 2: NLU のモックテスト

`api/src/slack/nlu/intent-parser.test.ts` を新規作成：

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Anthropic SDK をモック
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: vi.fn(),
    },
  })),
}));

// config もモック
vi.mock('../../config', () => ({
  config: {
    ANTHROPIC_API_KEY: 'test-key',
  },
}));

import { parseIntent } from './intent-parser';
import Anthropic from '@anthropic-ai/sdk';

describe('parseIntent', () => {
  let mockCreate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    const mockClient = new Anthropic({ apiKey: 'test' });
    mockCreate = mockClient.messages.create as ReturnType<typeof vi.fn>;
  });

  it('should parse create_contact intent', async () => {
    mockCreate.mockResolvedValue({
      content: [{
        type: 'text',
        text: JSON.stringify({
          intent: 'create_contact',
          entities: {
            last_name: '田中',
            company_name: '山田商事',
            email: 'tanaka@yamada.co.jp',
          },
          confirmation_message: '田中さん（山田商事）をコンタクトとして登録します',
          confidence: 0.95,
        }),
      }],
    });

    const result = await parseIntent('山田商事の田中さんを登録して');
    expect(result.intent).toBe('create_contact');
    expect(result.entities.last_name).toBe('田中');
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('should return unknown for errors', async () => {
    mockCreate.mockRejectedValue(new Error('API error'));

    const result = await parseIntent('test');
    expect(result.intent).toBe('unknown');
    expect(result.confidence).toBe(0);
  });

  it('should handle non-JSON response', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'これはJSONではありません' }],
    });

    const result = await parseIntent('test');
    expect(result.intent).toBe('unknown');
  });
});
```

### Step 3: サービス層のテスト

`api/src/services/contact.service.test.ts` を新規作成：

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// DB モック
vi.mock('../db/client', () => ({
  pool: {
    query: vi.fn(),
    connect: vi.fn(),
  },
}));

vi.mock('../db/queries/contacts', () => ({
  createContact: vi.fn(),
  findContactById: vi.fn(),
  searchContacts: vi.fn(),
  listProspects: vi.fn(),
  listContacts: vi.fn(),
  promoteContact: vi.fn(),
  findContactByEmail: vi.fn(),
  updateContact: vi.fn(),
}));

vi.mock('../db/queries/accounts', () => ({
  upsertAccount: vi.fn(),
}));

vi.mock('../db/queries/deals', () => ({
  createDeal: vi.fn(),
}));

vi.mock('./account.service', () => ({
  logActivity: vi.fn(),
}));

import { createContactFromEntities, promoteContactToCustomer } from './contact.service';
import { createContact, findContactById, promoteContact } from '../db/queries/contacts';
import { upsertAccount } from '../db/queries/accounts';

describe('createContactFromEntities', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('should create a prospect contact', async () => {
    const mockContact = {
      id: 'test-uuid',
      last_name: '田中',
      first_name: '太郎',
      company_name: '山田商事',
      lifecycle_stage: 'prospect',
    };
    (createContact as ReturnType<typeof vi.fn>).mockResolvedValue(mockContact);

    const result = await createContactFromEntities({
      entities: { last_name: '田中', first_name: '太郎', company_name: '山田商事' },
      ownerSlackId: 'U12345',
    });

    expect(result.last_name).toBe('田中');
    expect(createContact).toHaveBeenCalledWith(
      expect.objectContaining({
        last_name: '田中',
        lifecycle_stage: 'prospect',
      })
    );
  });
});

describe('promoteContactToCustomer', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('should promote a prospect to customer', async () => {
    const mockContact = {
      id: 'contact-uuid',
      last_name: '田中',
      company_name: '山田商事',
      lifecycle_stage: 'prospect',
    };
    const mockAccount = { id: 'account-uuid', name: '山田商事' };
    const mockPromoted = { ...mockContact, lifecycle_stage: 'customer', account_id: 'account-uuid' };

    (findContactById as ReturnType<typeof vi.fn>).mockResolvedValue(mockContact);
    (upsertAccount as ReturnType<typeof vi.fn>).mockResolvedValue(mockAccount);
    (promoteContact as ReturnType<typeof vi.fn>).mockResolvedValue(mockPromoted);

    const result = await promoteContactToCustomer({
      contactId: 'contact-uuid',
      actorSlackId: 'U12345',
    });

    expect(result.accountId).toBe('account-uuid');
    expect(result.contact.lifecycle_stage).toBe('customer');
  });

  it('should throw if already a customer', async () => {
    (findContactById as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'contact-uuid',
      lifecycle_stage: 'customer',
    });

    await expect(
      promoteContactToCustomer({ contactId: 'contact-uuid', actorSlackId: 'U12345' })
    ).rejects.toThrow('Already a customer');
  });
});
```

### Step 4: withTenant ヘルパーのテスト（TASK_01 完了後）

`api/src/db/client.test.ts` を新規作成：

```typescript
import { describe, it, expect, vi } from 'vitest';

// pool をモック
vi.mock('pg', () => {
  const mockClient = {
    query: vi.fn(),
    release: vi.fn(),
  };
  return {
    Pool: vi.fn().mockImplementation(() => ({
      query: vi.fn(),
      connect: vi.fn().mockResolvedValue(mockClient),
      _mockClient: mockClient,
    })),
  };
});

// withTenant のテスト — TASK_01 で実装後に追加

describe('withTenant', () => {
  it('should set tenant_id within transaction', async () => {
    // TASK_01 完了後に具体的なテストを記述
  });

  it('should reject invalid tenant ID format', async () => {
    // TASK_01 完了後に具体的なテストを記述
  });

  it('should rollback on error', async () => {
    // TASK_01 完了後に具体的なテストを記述
  });
});
```

### Step 5: E2E テスト拡充

`tests/e2e/contacts.spec.ts` を新規作成：

```typescript
import { test, expect } from '@playwright/test';

const BASE_URL = process.env.WEB_URL ?? 'http://localhost:3001';

test.describe('Contacts page', () => {
  test('should load contacts list', async ({ page }) => {
    await page.goto(`${BASE_URL}/contacts`);
    await expect(page.locator('h1, h2, .page-title')).toContainText(/顧客|コンタクト|Contacts/i);
  });

  test('should search contacts', async ({ page }) => {
    await page.goto(`${BASE_URL}/contacts`);
    const searchInput = page.locator('input[type="text"], input[type="search"]').first();
    if (await searchInput.isVisible()) {
      await searchInput.fill('テスト');
      // 検索結果の表示を待つ
      await page.waitForTimeout(1000);
    }
  });
});

test.describe('Deals page', () => {
  test('should load deals board', async ({ page }) => {
    await page.goto(`${BASE_URL}/deals`);
    await expect(page.locator('h1, h2, .page-title')).toContainText(/商談|Deals/i);
  });
});

test.describe('Analytics page', () => {
  test('should load analytics', async ({ page }) => {
    await page.goto(`${BASE_URL}/analytics`);
    await expect(page.locator('h1, h2, .page-title')).toContainText(/分析|Analytics/i);
  });
});
```

---

## 完了条件

- [ ] `vitest` が導入され、`npm test` でテストが実行できる
- [ ] NLU テスト（intent-parser.test.ts）が PASS する
- [ ] サービス層テスト（contact.service.test.ts）が PASS する
- [ ] E2E テスト（contacts.spec.ts）が追加されている
- [ ] `npm test` で全テスト PASS
