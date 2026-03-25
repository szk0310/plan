# TASK 07: Slack Block Kit Views & Slash Commands

> **優先度**: 🟢 中
> **対象ファイル**:
> - `api/src/slack/views/list-modal.ts`（新規作成）
> - `api/src/slack/views/detail-card.ts`（新規作成）
> - `api/src/slack/commands/crm-list.ts`（新規作成）
> - `api/src/slack/commands/crm-search.ts`（新規作成）
> - `api/src/index.ts`（コマンドハンドラ登録）
> **依存**: TASK_03（leads 廃止）の完了が望ましい

---

## 背景

初期設計で以下のディレクトリが予定されていたが、現在は空：
- `api/src/slack/commands/` — 空
- `api/src/slack/views/` — 空

設計方針として「モーダル・リッチカードは一覧表示・詳細表示のみ」「入力は自然文メインで」を維持する。

---

## 実装内容

### 1. `/crm-list` コマンド — 一覧表示モーダル

`api/src/slack/commands/crm-list.ts`:

```typescript
import { App } from '@slack/bolt';
import { pool } from '../../db/client';

export function registerCrmListCommand(app: App): void {
  app.command('/crm-list', async ({ command, ack, client }) => {
    await ack();

    // パラメータ解析: /crm-list [contacts|deals|accounts] [キーワード]
    const args = command.text.trim().split(/\s+/);
    const target = args[0] || 'contacts';
    const keyword = args.slice(1).join(' ');

    try {
      const blocks = await buildListBlocks(target, keyword);

      await client.views.open({
        trigger_id: command.trigger_id,
        view: {
          type: 'modal',
          title: { type: 'plain_text', text: `${targetLabel(target)} 一覧` },
          close: { type: 'plain_text', text: '閉じる' },
          blocks,
        },
      });
    } catch (err) {
      console.error('[crm-list] error:', err);
      await client.chat.postEphemeral({
        channel: command.channel_id,
        user: command.user_id,
        text: '⚠️ 一覧の取得に失敗しました',
      });
    }
  });
}

async function buildListBlocks(target: string, keyword: string): Promise<any[]> {
  const blocks: any[] = [];

  switch (target) {
    case 'contacts':
    case 'leads': {
      let sql = `SELECT c.id, c.last_name, c.first_name, c.lifecycle_stage,
                        c.deal_probability, c.nurturing_stage,
                        COALESCE(a.name, c.company_name, '会社未登録') AS company_name
                 FROM contacts c
                 LEFT JOIN accounts a ON a.id = c.account_id
                 WHERE c.lifecycle_stage IN ('prospect', 'active')`;
      const params: unknown[] = [];
      if (keyword) {
        params.push(`%${keyword}%`);
        sql += ` AND (c.last_name ILIKE $1 OR COALESCE(a.name, c.company_name) ILIKE $1)`;
      }
      sql += ` ORDER BY c.deal_probability DESC NULLS LAST LIMIT 20`;

      const res = await pool.query(sql, params);

      if (res.rows.length === 0) {
        blocks.push({
          type: 'section',
          text: { type: 'mrkdwn', text: keyword ? `「${keyword}」に一致するリードはありません` : 'アクティブなリードはありません' },
        });
      } else {
        blocks.push({
          type: 'header',
          text: { type: 'plain_text', text: `リード・見込客（${res.rows.length}件）` },
        });

        for (const c of res.rows) {
          const stageEmoji = { cold: '🧊', warm: '🌤️', hot: '🔥' }[c.nurturing_stage] ?? '❓';
          const prob = c.deal_probability != null ? ` | 案件化: ${c.deal_probability}%` : '';

          blocks.push({
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `${stageEmoji} *${c.last_name}${c.first_name ?? ''}*（${c.company_name}）${prob}`,
            },
            accessory: {
              type: 'button',
              text: { type: 'plain_text', text: '詳細' },
              action_id: 'view_contact_detail',
              value: c.id,
            },
          });
        }
      }
      break;
    }

    case 'deals': {
      let sql = `SELECT d.id, d.title, d.stage, d.amount, d.expected_close,
                        a.name AS account_name
                 FROM deals d
                 JOIN accounts a ON a.id = d.account_id
                 WHERE d.stage NOT IN ('closed_won', 'closed_lost')`;
      const params: unknown[] = [];
      if (keyword) {
        params.push(`%${keyword}%`);
        sql += ` AND (d.title ILIKE $1 OR a.name ILIKE $1)`;
      }
      sql += ` ORDER BY d.expected_close ASC NULLS LAST LIMIT 20`;

      const res = await pool.query(sql, params);

      if (res.rows.length === 0) {
        blocks.push({
          type: 'section',
          text: { type: 'mrkdwn', text: 'アクティブな商談はありません' },
        });
      } else {
        blocks.push({
          type: 'header',
          text: { type: 'plain_text', text: `商談（${res.rows.length}件）` },
        });

        const stageMap: Record<string, string> = {
          prospecting: '📋 初期', qualified: '✅ 適格',
          proposal: '📑 提案', negotiation: '🤝 交渉',
        };

        for (const d of res.rows) {
          const amount = d.amount ? `¥${Number(d.amount).toLocaleString()}` : '金額未定';
          const close = d.expected_close
            ? new Date(d.expected_close).toLocaleDateString('ja-JP')
            : '未定';

          blocks.push({
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `${stageMap[d.stage] ?? d.stage} *${d.title}*\n${d.account_name} | ${amount} | クローズ: ${close}`,
            },
          });
        }
      }
      break;
    }

    case 'accounts': {
      let sql = `SELECT a.id, a.name, a.industry,
                        COUNT(DISTINCT c.id) AS contact_count,
                        COUNT(DISTINCT d.id) AS deal_count
                 FROM accounts a
                 LEFT JOIN contacts c ON c.account_id = a.id
                 LEFT JOIN deals d ON d.account_id = a.id`;
      const params: unknown[] = [];
      if (keyword) {
        params.push(`%${keyword}%`);
        sql += ` WHERE a.name ILIKE $1`;
      }
      sql += ` GROUP BY a.id ORDER BY a.updated_at DESC LIMIT 20`;

      const res = await pool.query(sql, params);

      blocks.push({
        type: 'header',
        text: { type: 'plain_text', text: `会社（${res.rows.length}件）` },
      });

      for (const a of res.rows) {
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `🏢 *${a.name}* ${a.industry ? `(${a.industry})` : ''}\n担当者: ${a.contact_count}人 | 商談: ${a.deal_count}件`,
          },
        });
      }
      break;
    }

    default:
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: '使い方: `/crm-list [contacts|deals|accounts] [キーワード]`' },
      });
  }

  return blocks;
}

function targetLabel(target: string): string {
  return { contacts: 'コンタクト', leads: 'リード', deals: '商談', accounts: '会社' }[target] ?? target;
}
```

### 2. 詳細表示カード

`api/src/slack/views/detail-card.ts`:

```typescript
import { pool } from '../../db/client';

/**
 * コンタクト詳細を Block Kit リッチカードとして返す
 */
export async function buildContactDetailBlocks(contactId: string): Promise<any[]> {
  const [contactRes, notesRes, activitiesRes] = await Promise.all([
    pool.query(
      `SELECT c.*, COALESCE(a.name, c.company_name) AS company_name, a.website_url AS company_url
       FROM contacts c LEFT JOIN accounts a ON a.id = c.account_id WHERE c.id = $1`,
      [contactId]
    ),
    pool.query(
      `SELECT memo, note_type, created_at FROM crm_notes WHERE contact_id = $1 ORDER BY created_at DESC LIMIT 5`,
      [contactId]
    ),
    pool.query(
      `SELECT activity_type, subject, ai_summary, created_at FROM activity_logs WHERE contact_id = $1 ORDER BY created_at DESC LIMIT 5`,
      [contactId]
    ),
  ]);

  const c = contactRes.rows[0];
  if (!c) return [{ type: 'section', text: { type: 'mrkdwn', text: '⚠️ コンタクトが見つかりません' } }];

  const stageEmoji = { cold: '🧊', warm: '🌤️', hot: '🔥' }[c.nurturing_stage] ?? '';
  const lifecycleLabel = {
    prospect: '見込客', active: '商談中', customer: '顧客', inactive: '休眠', churned: '離反',
  }[c.lifecycle_stage] ?? c.lifecycle_stage;

  const blocks: any[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `${c.last_name}${c.first_name ?? ''} さん` },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*会社*\n${c.company_name}` },
        { type: 'mrkdwn', text: `*ステージ*\n${lifecycleLabel} ${stageEmoji}` },
        { type: 'mrkdwn', text: `*案件化確率*\n${c.deal_probability != null ? `${c.deal_probability}%` : '未評価'}` },
        { type: 'mrkdwn', text: `*役職*\n${c.title ?? '不明'}` },
        ...(c.email ? [{ type: 'mrkdwn', text: `*メール*\n${c.email}` }] : []),
        ...(c.phone ? [{ type: 'mrkdwn', text: `*電話*\n${c.phone}` }] : []),
      ],
    },
  ];

  // 最近のメモ
  if (notesRes.rows.length > 0) {
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'header',
      text: { type: 'plain_text', text: '📝 最近のメモ' },
    });
    for (const n of notesRes.rows) {
      const date = new Date(n.created_at).toLocaleDateString('ja-JP');
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `*${date}* — ${n.memo.slice(0, 100)}` },
      });
    }
  }

  // 最近の活動
  if (activitiesRes.rows.length > 0) {
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'header',
      text: { type: 'plain_text', text: '📊 最近の活動' },
    });
    for (const a of activitiesRes.rows) {
      const date = new Date(a.created_at).toLocaleDateString('ja-JP');
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `*${date}* — ${a.subject ?? a.activity_type}${a.ai_summary ? `\n_${a.ai_summary}_` : ''}` },
      });
    }
  }

  return blocks;
}
```

### 3. `index.ts` にコマンド登録を追加

```typescript
// api/src/index.ts に追加
import { registerCrmListCommand } from './slack/commands/crm-list';

// main() 内で追加
registerCrmListCommand(app);

// 詳細表示ボタンのアクション
app.action('view_contact_detail', async ({ ack, body, client }) => {
  await ack();
  const contactId = (body as any).actions[0].value;
  const { buildContactDetailBlocks } = await import('./slack/views/detail-card');
  const blocks = await buildContactDetailBlocks(contactId);

  await client.views.open({
    trigger_id: (body as any).trigger_id,
    view: {
      type: 'modal',
      title: { type: 'plain_text', text: 'コンタクト詳細' },
      close: { type: 'plain_text', text: '閉じる' },
      blocks,
    },
  });
});
```

### 4. Slack App 設定の更新

Slack API 管理画面で以下のコマンドを追加する必要がある：

| コマンド名 | 説明 | Request URL |
|-----------|------|------------|
| `/crm-list` | CRM 一覧表示 | `https://[API_URL]/slack/events` |

---

## 完了条件

- [ ] `/crm-list` コマンドが contacts/deals/accounts の一覧をモーダルで表示する
- [ ] 一覧の「詳細」ボタンからコンタクト詳細モーダルが開く
- [ ] 詳細モーダルにメモ履歴と活動履歴が表示される
- [ ] TypeScript コンパイルエラーがないこと
- [ ] `api/src/slack/commands/crm-list.ts` が作成されている
- [ ] `api/src/slack/views/detail-card.ts` が作成されている
