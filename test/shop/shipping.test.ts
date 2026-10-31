import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  countryName,
  isKnownCountry,
  rateOf,
  shippingCostMinor,
  shippingCountriesOf,
  shippingCountriesStatement,
  shippingRateStatement,
} from '../../src/plugins/shop/lib/shipping.js';
import { api, clearShopTables, db, ensureSite, holdWrites } from './helpers.js';

const PANEL = '/_mallok/api/plugins/shop/panels/shipping';

function zone(values: Record<string, unknown>): Promise<Response> {
  return api('POST', `${PANEL}/records`, {
    values: {
      name: 'Europe',
      countries: ['DE', 'FR'],
      rates: [
        {
          price: { amount: 4500, currency: 'EUR' },
          free_over: { amount: 90000, currency: 'EUR' },
        },
        { price: { amount: 4900, currency: 'USD' }, free_over: null },
      ],
      sort_order: 1,
      ...values,
    },
  });
}

async function errorsOf(response: Response): Promise<Record<string, string>> {
  expect(response.status).toBe(422);
  return ((await response.json()) as { errors: Record<string, string> }).errors;
}

describe('shipping', () => {
  describe('a country', () => {
    it('is named in the page’s language, and is its code where it has no name', () => {
      expect(countryName('DE', 'en')).toBe('Germany');
      expect(countryName('DE', 'de')).toBe('Deutschland');
      expect(countryName('GB', 'fr')).toBe('Royaume-Uni');
      expect(countryName('QZ', 'en')).toBe('QZ');
    });

    it('is known by its two-letter code, in capitals, and no other way', () => {
      expect(isKnownCountry('DE')).toBe(true);
      expect(isKnownCountry('de')).toBe(false);
      expect(isKnownCountry('QZ')).toBe(false);
      expect(isKnownCountry('DEU')).toBe(false);
      expect(isKnownCountry('')).toBe(false);
    });
  });

  describe('what it costs', () => {
    const rate = { amountMinor: 4500, freeOverMinor: 90000 };

    it('is the zone’s rate below the amount past which it is free', () => {
      expect(shippingCostMinor(rate, 89999)).toBe(4500);
    });

    it('is nothing from that amount up', () => {
      expect(shippingCostMinor(rate, 90000)).toBe(0);
      expect(shippingCostMinor(rate, 250000)).toBe(0);
    });

    it('is always the rate where nothing ships free', () => {
      expect(
        shippingCostMinor({ amountMinor: 4500, freeOverMinor: null }, 10 ** 9),
      ).toBe(4500);
    });
  });

  describe('zones in the admin', () => {
    beforeAll(ensureSite);
    beforeEach(clearShopTables);

    it('are saved with their countries and rates, and read back as the form sends them', async () => {
      const created = await zone({ countries: ['de', 'FR', 'DE', ' fr '] });
      expect(created.status).toBe(201);
      const { id } = (await created.json()) as { id: string };

      const loaded = await api('GET', `${PANEL}/records/${id}`);

      expect(await loaded.json()).toMatchObject({
        values: {
          name: 'Europe',
          // Upper case, once each.
          countries: ['DE', 'FR'],
          rates: [
            {
              price: { amount: 4500, currency: 'EUR' },
              free_over: { amount: 90000, currency: 'EUR' },
            },
            { price: { amount: 4900, currency: 'USD' }, free_over: null },
          ],
          sort_order: 1,
        },
      });
    });

    it('give a country its rate in a currency, and nothing in a currency they have no rate in', async () => {
      await zone({});
      const read = async (country: string, currency: 'EUR' | 'GBP') =>
        rateOf(
          (await shippingRateStatement(db(), country, currency).all())
            .results[0] ?? null,
        );

      expect(await read('DE', 'EUR')).toEqual({
        zoneId: expect.any(String),
        zoneName: 'Europe',
        currency: 'EUR',
        amountMinor: 4500,
        freeOverMinor: 90000,
      });
      expect(await read('DE', 'GBP')).toBeNull();
      // A country in no zone is not shipped to.
      expect(await read('GB', 'EUR')).toBeNull();
    });

    it('list the countries shipped to, with the currencies each can be paid in', async () => {
      await zone({});
      await zone({
        name: 'United Kingdom',
        countries: ['GB'],
        rates: [{ price: { amount: 3900, currency: 'GBP' }, free_over: null }],
      });

      const { results } = await shippingCountriesStatement(db()).all();

      expect(shippingCountriesOf(results)).toEqual([
        { code: 'DE', currencies: ['USD', 'EUR'] },
        { code: 'FR', currencies: ['USD', 'EUR'] },
        { code: 'GB', currencies: ['GBP'] },
      ]);
    });

    it.each([
      [{ name: '  ' }, 'name'],
      [{ countries: [] }, 'countries'],
      [{ countries: ['DE', 'QZ', 'Germany'] }, 'countries'],
      [{ rates: [] }, 'rates'],
      [
        {
          rates: [
            { price: { amount: 4500, currency: 'EUR' }, free_over: null },
            { price: { amount: 4600, currency: 'EUR' }, free_over: null },
          ],
        },
        'rates.1.price',
      ],
      [
        {
          rates: [
            {
              price: { amount: 4500, currency: 'EUR' },
              free_over: { amount: 90000, currency: 'USD' },
            },
          ],
        },
        'rates.0.free_over',
      ],
    ])('refuse %j, beside the field %s', async (values, field) => {
      const errors = await errorsOf(await zone(values));

      expect(Object.keys(errors)).toContain(field);
      const { results } = await db()
        .prepare('SELECT COUNT(*) AS n FROM p_shop_shipping_zone')
        .all<{ n: number }>();
      expect(results[0]?.n).toBe(0);
    });

    it('put a country in one zone at most, and say which zone has it', async () => {
      await zone({});

      const errors = await errorsOf(
        await zone({ name: 'Western Europe', countries: ['FR', 'ES'] }),
      );

      expect(errors.countries).toBe(
        'Already in another zone: FR (Europe). A country is in one zone at most.',
      );
    });

    it('put a country in one zone at most when two saves claim it at once', async () => {
      // Both read "nobody has FR" before either writes; the table's key
      // refuses the second, which reads again to say who has it.
      const gate = holdWrites((sql) =>
        sql.includes('INSERT INTO p_shop_shipping_zone'),
      );
      let answers: Response[];
      try {
        const both = Promise.all([
          zone({ name: 'One', countries: ['FR'] }),
          zone({ name: 'Two', countries: ['FR'] }),
        ]);
        await gate.arrived(2);
        gate.open();
        answers = await both;
      } finally {
        gate.restore();
      }

      expect(answers.map((answer) => answer.status).sort()).toEqual([201, 422]);
      const { results } = await db()
        .prepare(
          'SELECT z.name AS name FROM p_shop_shipping_country AS c JOIN p_shop_shipping_zone AS z ON z.id = c.zone_id',
        )
        .all<{ name: string }>();
      expect(results).toHaveLength(1);
      // The refused save left no zone behind.
      const zones = await db()
        .prepare('SELECT COUNT(*) AS n FROM p_shop_shipping_zone')
        .first<{ n: number }>();
      expect(zones?.n).toBe(1);
    });

    it('move a country by saving the zone without it, then the other with it', async () => {
      const created = await zone({});
      const { id } = (await created.json()) as { id: string };
      const edited = await api('PUT', `${PANEL}/records/${id}`, {
        values: {
          name: 'Europe',
          countries: ['DE'],
          rates: [
            { price: { amount: 4500, currency: 'EUR' }, free_over: null },
          ],
          sort_order: 1,
        },
      });
      expect(edited.status).toBe(200);

      const other = await zone({ name: 'France', countries: ['FR'] });

      expect(other.status).toBe(201);
    });

    it('take their countries and rates with them when deleted', async () => {
      const created = await zone({});
      const { id } = (await created.json()) as { id: string };

      const removed = await api('DELETE', `${PANEL}/records/${id}`);

      expect(removed.ok).toBe(true);
      for (const table of [
        'p_shop_shipping_zone',
        'p_shop_shipping_country',
        'p_shop_shipping_rate',
      ]) {
        const row = await db()
          .prepare(`SELECT COUNT(*) AS n FROM ${table}`)
          .first<{ n: number }>();
        expect(row?.n, table).toBe(0);
      }
    });
  });
});
