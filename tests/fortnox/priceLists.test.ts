import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/domains/fortnox/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/domains/fortnox/client')>();
  return { ...actual, fortnoxGet: vi.fn(), fortnoxPost: vi.fn() };
});

import { fortnoxGet, fortnoxPost } from '@/lib/domains/fortnox/client';
import { createFortnoxPriceList, listFortnoxPriceListPrices } from '@/lib/domains/fortnox/priceLists';

const get = vi.mocked(fortnoxGet);

beforeEach(() => {
  vi.mocked(fortnoxGet).mockReset();
  vi.mocked(fortnoxPost).mockReset();
});

describe('listFortnoxPriceListPrices', () => {
  it('läser alla sidor av /prices/sublist/{lista}, utan artikelnummer', async () => {
    // Svarets form som testbolaget gav 2026-09-27.
    get
      .mockResolvedValueOnce({
        MetaInformation: { '@TotalResources': 3, '@TotalPages': 2, '@CurrentPage': 1 },
        Prices: [
          { '@url': 'https://api.fortnox.se/3/prices/160/1010/0', ArticleNumber: '1010', FromQuantity: 0, PriceList: '160', Price: 2900 },
          { '@url': 'https://api.fortnox.se/3/prices/160/13003/0', ArticleNumber: '13003', FromQuantity: 0, PriceList: '160', Price: 335.3 },
        ],
      })
      .mockResolvedValueOnce({
        MetaInformation: { '@TotalResources': 3, '@TotalPages': 2, '@CurrentPage': 2 },
        Prices: [{ ArticleNumber: '13003', FromQuantity: 10, PriceList: '160', Price: 300 }],
      });

    const prices = await listFortnoxPriceListPrices('160');

    expect(get).toHaveBeenCalledTimes(2);
    expect(get).toHaveBeenNthCalledWith(1, '/prices/sublist/160', { limit: '500', page: '1' });
    expect(get).toHaveBeenNthCalledWith(2, '/prices/sublist/160', { limit: '500', page: '2' });
    expect(prices).toEqual([
      { articleNumber: '1010', fromQuantity: 0, price: 2900 },
      { articleNumber: '13003', fromQuantity: 0, price: 335.3 },
      { articleNumber: '13003', fromQuantity: 10, price: 300 },
    ]);
  });

  it('tar inte med en rad utan pris — tomt blir aldrig 0 kr', async () => {
    get.mockResolvedValueOnce({
      MetaInformation: { '@TotalPages': 1 },
      Prices: [
        { ArticleNumber: '1010', FromQuantity: 0, Price: null },
        { ArticleNumber: '1011', FromQuantity: 0, Price: '' },
        { ArticleNumber: '1012', FromQuantity: '0', Price: '99.5' },
        { FromQuantity: 0, Price: 1 },
      ],
    });
    expect(await listFortnoxPriceListPrices('160')).toEqual([{ articleNumber: '1012', fromQuantity: 0, price: 99.5 }]);
  });

  it('en lista utan priser ger en tom lista', async () => {
    get.mockResolvedValueOnce({ MetaInformation: { '@TotalPages': 0 }, Prices: [] });
    expect(await listFortnoxPriceListPrices('160')).toEqual([]);
    expect(get).toHaveBeenCalledTimes(1);
  });
});

describe('createFortnoxPriceList', () => {
  it('skickar Fortnox fältnamn exakt', async () => {
    vi.mocked(fortnoxPost).mockResolvedValueOnce({});
    await createFortnoxPriceList('160', 'Byggvaruhandel');
    expect(fortnoxPost).toHaveBeenCalledWith('/pricelists', { PriceList: { Code: '160', Description: 'Byggvaruhandel' } });
  });
});
