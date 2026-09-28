import { describe, it, expect } from 'vitest';
import { getPortalJobBadge } from '@/lib/domains/portal/jobBadge';
import { memoryAdmin } from './helpers/memoryAdmin';

/**
 * Brickan "Från återförsäljarportalen" (fas 3b). Läses med sessionen; RLS och kolumngranten prövas i
 * supabase/checks/portal_jobs.sql. Här: uppslaget på arbetsordern, en vanlig order ger ingen bricka, ett id som inte
 * är en uuid frågas aldrig (Postgres hade kastat 22P02), och ett databasfel kastar (sidan fångar det).
 */

const WO = '22222222-2222-4222-8222-222222222222';

describe('getPortalJobBadge', () => {
  it('butikens namn och offertnumret för ordern', async () => {
    const m = memoryAdmin({ crm_portal_jobs: [{ work_order_id: WO, store_name: 'Norrbygg AB', quote_number: '2026-015' }] });
    expect(await getPortalJobBadge(m.admin, WO)).toEqual({ storeName: 'Norrbygg AB', quoteNumber: '2026-015' });
    expect(m.calls[0].filters).toEqual([['eq', 'work_order_id', WO]]);
  });

  it('en vanlig order: ingen bricka', async () => {
    expect(await getPortalJobBadge(memoryAdmin().admin, WO)).toBeNull();
  });

  it('ett id som inte är en uuid frågas aldrig', async () => {
    const m = memoryAdmin();
    expect(await getPortalJobBadge(m.admin, 'inte-ett-id')).toBeNull();
    expect(m.calls).toHaveLength(0);
  });

  it('ett databasfel kastar', async () => {
    const m = memoryAdmin();
    m.failOn(() => true, { message: 'permission denied' });
    await expect(getPortalJobBadge(m.admin, WO)).rejects.toThrow(/permission denied/);
  });
});
