import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  api,
  clearShopTables,
  db,
  ensureSite,
  storeInquiry,
} from './helpers.js';

const PANEL = '/_mallok/api/plugins/shop/panels/inquiries';

function store(input: {
  readonly id: string;
  readonly name: string;
  readonly at: string;
}): Promise<string> {
  return storeInquiry({
    id: input.id,
    at: input.at,
    form: {
      name: input.name,
      email: 'buyer@buyer.example',
      company: 'Engines Ltd',
      message: 'Delivered prices, please.',
    },
    ipHash: 'f'.repeat(64),
  });
}

function act(action: string, body: Record<string, unknown>): Promise<Response> {
  return api('POST', `${PANEL}/actions/${action}`, body);
}

async function statuses(): Promise<Record<string, string>> {
  const { results } = await db()
    .prepare('SELECT id, status FROM p_shop_inquiry ORDER BY id')
    .all<{ id: string; status: string }>();
  return Object.fromEntries(results.map((row) => [row.id, row.status]));
}

describe('inquiries in the admin', () => {
  beforeAll(ensureSite);
  beforeEach(async () => {
    await clearShopTables();
    await store({ id: 'a', name: 'Ada', at: '2026-10-07T08:00:00.000Z' });
    await store({ id: 'b', name: 'Grace', at: '2026-10-08T08:00:00.000Z' });
    await store({ id: 'c', name: 'Edsger', at: '2026-10-09T08:00:00.000Z' });
  });

  it('lists them newest first, with what the panel declares and nothing else', async () => {
    const response = await api('GET', PANEL);
    const { rows } = (await response.json()) as {
      rows: Record<string, unknown>[];
    };

    expect(response.status).toBe(200);
    expect(rows.map((row) => row.name)).toEqual(['Edsger', 'Grace', 'Ada']);
    expect(rows[0]).toMatchObject({
      id: 'c',
      name: 'Edsger',
      company: 'Engines Ltd',
      email: 'buyer@buyer.example',
      country: 'GB',
      line_count: 2,
      // A sum is stated only when every line has a price.
      subtotal: '',
      status: 'new',
      created_at: '2026-10-09T08:00:00.000Z',
      message: 'Delivered prices, please.',
      locale: 'en',
      currency: 'USD',
    });
    // The cart it came from, and the mark of who sent it, stay in the table.
    for (const row of rows) {
      expect(row).not.toHaveProperty('cart_id');
      expect(row).not.toHaveProperty('ip_hash');
    }
  });

  it('finds one by its number, a name, a company or an address', async () => {
    const find = async (q: string): Promise<unknown[]> => {
      const response = await api('GET', `${PANEL}?q=${encodeURIComponent(q)}`);
      return ((await response.json()) as { rows: { id: string }[] }).rows.map(
        (row) => row.id,
      );
    };
    const number = await db()
      .prepare("SELECT inquiry_no FROM p_shop_inquiry WHERE id = 'b'")
      .first<{ inquiry_no: string }>();

    expect(await find(number?.inquiry_no ?? 'none')).toEqual(['b']);
    expect(await find('grace')).toEqual(['b']);
    expect(await find('Engines')).toHaveLength(3);
    expect(await find('buyer.example')).toHaveLength(3);
    expect(await find('nobody')).toEqual([]);
  });

  it('shows the lines of one, in the order they were in the cart', async () => {
    const response = await api('GET', `${PANEL}/related/lines?parent=b`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      rows: [
        {
          sku: 'CS-10',
          name: 'Cap screw M5',
          quantity: 300,
          unit_price: '$1.85',
          line_total: '$555.00',
        },
        {
          sku: 'WA-5',
          name: 'Washer M5',
          quantity: 50,
          unit_price: '',
          line_total: '',
        },
      ],
      hasMore: false,
    });
  });

  it('marks the ones ticked as answered, as spam, and as new again', async () => {
    expect(
      (await act('inquiry_mark_answered', { ids: ['a', 'b'] })).status,
    ).toBe(200);
    expect(await statuses()).toEqual({
      a: 'answered',
      b: 'answered',
      c: 'new',
    });

    await act('inquiry_mark_spam', { ids: ['c'] });
    await act('inquiry_mark_new', { ids: ['a'] });

    expect(await statuses()).toEqual({ a: 'new', b: 'answered', c: 'spam' });
  });

  it('can be filtered by status', async () => {
    await act('inquiry_mark_spam', { ids: ['c'] });

    const response = await api('GET', `${PANEL}?status=spam`);
    const { rows } = (await response.json()) as { rows: { id: string }[] };

    expect(rows.map((row) => row.id)).toEqual(['c']);
  });

  it('exports the ones ticked as a CSV file, and the latest when none is', async () => {
    const ticked = await act('inquiry_export_csv', { ids: ['a'] });

    expect(ticked.status).toBe(200);
    expect(ticked.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(ticked.headers.get('content-disposition')).toMatch(
      /^attachment; filename="inquiries-\d{4}-\d\d-\d\d\.csv"$/,
    );
    const rows = (await ticked.text()).trim().split('\r\n');
    // The heading, and a row for each of its two lines.
    expect(rows).toHaveLength(3);
    expect(rows[1]).toContain(',Ada,Engines Ltd,');

    const all = await act('inquiry_export_csv', { ids: [] });
    const names = (await all.text())
      .trim()
      .split('\r\n')
      .slice(1)
      .map((row) => row.split(',')[3]);
    expect(names).toEqual(['Edsger', 'Edsger', 'Grace', 'Grace', 'Ada', 'Ada']);
  });

  it('deletes the ones ticked for good, with their lines, once the box is ticked', async () => {
    const response = await act('inquiry_delete', {
      ids: ['a', 'b'],
      params: { confirm: true },
    });

    expect(response.status).toBe(200);
    expect(await statuses()).toEqual({ c: 'new' });
    const lines = await db()
      .prepare('SELECT DISTINCT inquiry_id FROM p_shop_inquiry_line')
      .all<{ inquiry_id: string }>();
    expect(lines.results).toEqual([{ inquiry_id: 'c' }]);
  });

  it.each([
    ['the box is not ticked', { confirm: false }],
    ['nothing is said of it', {}],
  ])('deletes nothing when %s', async (_what, params) => {
    const response = await act('inquiry_delete', { ids: ['a'], params });

    expect(response.status).toBe(422);
    expect(Object.keys(await statuses())).toEqual(['a', 'b', 'c']);
  });

  it('needs a row to act on, except to export', async () => {
    for (const action of [
      'inquiry_mark_answered',
      'inquiry_mark_new',
      'inquiry_mark_spam',
      'inquiry_delete',
    ]) {
      const response = await act(action, {
        ids: [],
        params: { confirm: true },
      });
      expect(response.status, action).toBe(400);
    }
    expect(await statuses()).toEqual({ a: 'new', b: 'new', c: 'new' });
  });

  it('refuses a status the table does not know', async () => {
    await expect(
      db()
        .prepare("UPDATE p_shop_inquiry SET status = 'paid' WHERE id = 'a'")
        .run(),
    ).rejects.toThrow();
  });
});
