import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/domains/fortnox/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/domains/fortnox/client')>();
  return { ...actual, fortnoxGet: vi.fn() };
});

import { fortnoxGet } from '@/lib/domains/fortnox/client';
import { listFortnoxArticleNumbers } from '@/lib/domains/fortnox/articles';

const get = vi.mocked(fortnoxGet);

beforeEach(() => get.mockReset());

describe('listFortnoxArticleNumbers', () => {
  it('läser alla sidor av /articles', async () => {
    get
      .mockResolvedValueOnce({ Articles: [{ ArticleNumber: '1010' }, { ArticleNumber: '13003' }], MetaInformation: { '@TotalPages': 2 } })
      .mockResolvedValueOnce({ Articles: [{ ArticleNumber: '2410509' }], MetaInformation: { '@TotalPages': 2 } });

    const numbers = await listFortnoxArticleNumbers();

    expect(get).toHaveBeenNthCalledWith(1, '/articles', { limit: '500', page: '1' });
    expect(get).toHaveBeenNthCalledWith(2, '/articles', { limit: '500', page: '2' });
    expect([...numbers]).toEqual(['1010', '13003', '2410509']);
  });
});
