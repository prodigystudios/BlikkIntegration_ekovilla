import { describe, it, expect, vi, beforeEach } from 'vitest';
import { memberUser } from './helpers/supabase';

// GET /api/crm/work-orders/[id]: besättningen läser ordern via crew-policyn, som är radnivå och inte
// kan hålla personnummer och orderns ekonomi utanför svaret — den gränsen dras i routen. Sedan PR 3
// (2026-09-26) på NYCKELN: hela raden bara med kontorets läsnyckel crm.workorder.read, annars fältvyn.
// Förr `role === 'member'`.

const h = vi.hoisted(() => ({ effective: new Set<string>() }));

vi.mock('@/lib/auth/route', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/route')>();
  return { ...actual, getCurrentUser: vi.fn(async () => memberUser) };
});
vi.mock('@/lib/auth/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/permissions')>();
  return { ...actual, getEffectivePermissions: vi.fn(async () => h.effective) };
});
vi.mock('@/lib/supabase/session', () => ({ createSessionClient: vi.fn(() => ({ __client: 'session' })) }));
vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: vi.fn(() => ({ __client: 'admin' })) }));

const ROW = {
  id: '11111111-2222-4333-8444-555555555555',
  amount: 57500,
  pricing_summary: { subtotal: 46000, vat: 11500, total: 57500 },
  customer_snapshot: { contact_name: 'Pär', phone: '070', email: 'p@example.test', personal_number: '19800101-1234' },
  rot_details: { enabled: true, personal_number: '19800101-1234', property_designation: 'Testet 1:2' },
};

vi.mock('@/lib/domains/crm/work-orders', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/domains/crm/work-orders')>();
  return {
    ...actual,
    getCrmWorkOrder: vi.fn(async () => ({ data: structuredClone(ROW), error: null })),
    listWorkOrderInvoiceRounds: vi.fn(async () => ({ data: [], error: null })),
    getWorkOrderReportedSacks: vi.fn(async () => null),
    getWorkOrderSourceQuote: vi.fn(async () => null),
  };
});

import { GET } from '@/app/api/crm/work-orders/[id]/route';

async function item() {
  const res = await GET(new Request('http://localhost/x'), { params: { id: ROW.id } });
  return (await res.json()).data.item as Record<string, any>;
}

beforeEach(() => {
  h.effective = new Set();
});

describe('GET /api/crm/work-orders/[id] — fältvyn vs hela raden', () => {
  it('utan crm.workorder.read (besättningen): inget personnummer, ingen ekonomi', async () => {
    h.effective = new Set(['app.staff', 'time.entry.write']);
    const it_ = await item();
    expect(it_.amount).toBeUndefined();
    expect(it_.pricing_summary).toBeUndefined();
    expect(JSON.stringify(it_)).not.toContain('19800101-1234');
  });

  it('med crm.workorder.read (kontoret): hela raden', async () => {
    h.effective = new Set(['crm.access', 'crm.workorder.read']);
    const it_ = await item();
    expect(it_.amount).toBe(57500);
    expect(it_.rot_details.personal_number).toBe('19800101-1234');
  });

  // Failar stängt: ett fel i behörighetsuppslaget är en tom mängd — alltså fältvyn, aldrig hela raden.
  it('en tom mängd ger fältvyn', async () => {
    expect(JSON.stringify(await item())).not.toContain('19800101-1234');
  });
});
