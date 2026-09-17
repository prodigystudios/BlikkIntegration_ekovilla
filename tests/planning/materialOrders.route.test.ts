import { describe, it, expect, vi, beforeEach } from 'vitest';
import { adminUser, konsultUser, salesUser, effectivePermissionsForRole } from '../crm/helpers/supabase';

// Materialbeställningarnas rutter. Domänen och databasen har egna tester; det som prövas HÄR är HTTP-lagrets
// beslut: vem som släpps in, att sessionsklienten används, att klienten aldrig väljer mottagare eller depånamn,
// hur varje utfall blir ett svar — och att loggen (läsbar med schedule.read) aldrig får fabrikens namn eller adress.

vi.mock('@/lib/auth/route', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/route')>();
  return { ...actual, getCurrentUser: vi.fn() };
});
vi.mock('@/lib/auth/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/permissions')>();
  return { ...actual, getEffectivePermissions: vi.fn() };
});
vi.mock('@/lib/domains/planning/materialOrdersStore', () => ({
  listOrders: vi.fn(),
  getOrder: vi.fn(),
  expectedStatusesForOrders: vi.fn(async () => ({ data: new Map(), error: null })),
}));
vi.mock('@/lib/domains/planning/materialOrdersService', () => ({
  createDraft: vi.fn(),
  updateDraft: vi.fn(),
  discardDraft: vi.fn(),
  warningsForOrder: vi.fn(async () => []),
}));
vi.mock('@/lib/domains/planning/materialOrdersSend', () => ({
  sendMaterialOrder: vi.fn(),
  resolveMaterialOrder: vi.fn(),
}));
vi.mock('@/lib/domains/planning/materialSuppliers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/domains/planning/materialSuppliers')>();
  return { ...actual, getSupplier: vi.fn(async () => ({ data: { id: 's1', lead_time_days: 7 }, error: null })) };
});
vi.mock('@/lib/domains/planning/activity', () => ({ logActivity: vi.fn(async () => {}) }));
vi.mock('@/lib/email', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/email')>();
  return { ...actual, sendEmail: vi.fn(async () => ({ id: 'e1', skipped: false })) };
});

const ADMIN_CLIENT = { __client: 'admin' } as any;
const getUser = vi.fn();
vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: vi.fn(() => ADMIN_CLIENT) }));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('@supabase/auth-helpers-nextjs', () => ({
  createRouteHandlerClient: vi.fn(() => ({ __client: 'session', auth: { getUser } })),
}));

import { getCurrentUser } from '@/lib/auth/route';
import { getEffectivePermissions } from '@/lib/auth/permissions';
import { getOrder, listOrders } from '@/lib/domains/planning/materialOrdersStore';
import { createDraft, discardDraft, updateDraft } from '@/lib/domains/planning/materialOrdersService';
import { resolveMaterialOrder, sendMaterialOrder } from '@/lib/domains/planning/materialOrdersSend';
import { logActivity } from '@/lib/domains/planning/activity';
import { sendEmail } from '@/lib/email';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import * as listRoute from '@/app/api/crm/planering/material-orders/route';
import * as itemRoute from '@/app/api/crm/planering/material-orders/[id]/route';
import * as sendRoute from '@/app/api/crm/planering/material-orders/[id]/send/route';
import * as resolveRoute from '@/app/api/crm/planering/material-orders/[id]/resolve/route';
import * as testMailRoute from '@/app/api/crm/planering/material-orders/[id]/test-mail/route';

const ID = '11111111-2222-4333-8444-555555555555';
const SUP = '99999999-2222-4333-8444-555555555555';
const DEPOT = '88888888-2222-4333-8444-555555555555';
const ctx = { params: { id: ID } };
const req = (method: string, body?: unknown) =>
  new Request('http://localhost/x', { method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });

function asRole(user: typeof adminUser) {
  (getCurrentUser as any).mockResolvedValue({ ...user, name: 'William Ali' });
  (getEffectivePermissions as any).mockResolvedValue(effectivePermissionsForRole(user.role));
}

const ORDER = {
  id: ID,
  order_no: 14,
  supplier_id: SUP,
  status: 'draft',
  revision: 2,
  lines: [],
  other_lines: [],
  supplier_name: 'Ekovilla Oy',
  recipient_email: 'fabrik@example.fi',
  email_subject: 'Materialbeställning #14',
  email_text: 'Hej',
};
const LINE = { depot_id: DEPOT, material: 'EKOVILLA', sacks: 216, requested_on: '2026-10-01' };

const calls = {
  list: () => listRoute.GET(),
  create: () => listRoute.POST(req('POST', { supplier_id: SUP, lines: [LINE] })),
  read: () => itemRoute.GET(req('GET'), ctx),
  update: () => itemRoute.PATCH(req('PATCH', { revision: 2, lines: [LINE], other_lines: [], message: null }), ctx),
  discard: () => itemRoute.DELETE(req('DELETE'), ctx),
  send: () => sendRoute.POST(req('POST', { revision: 2, attempt: 1 }), ctx),
  resolve: () => resolveRoute.POST(req('POST', { delivered: true }), ctx),
  testMail: () => testMailRoute.POST(req('POST'), ctx),
};

beforeEach(() => {
  vi.clearAllMocks();
  (listOrders as any).mockResolvedValue({ data: [ORDER], error: null });
  (getOrder as any).mockResolvedValue({ data: ORDER, error: null });
  (createDraft as any).mockResolvedValue({ kind: 'created', order: ORDER });
  (updateDraft as any).mockResolvedValue({ kind: 'updated', order: ORDER });
  (discardDraft as any).mockResolvedValue({ kind: 'deleted' });
  (sendMaterialOrder as any).mockResolvedValue({ kind: 'sent', order_no: 14, created: 2, expected: 2 });
  (resolveMaterialOrder as any).mockResolvedValue({ kind: 'marked_sent' });
  getUser.mockResolvedValue({ data: { user: { email: 'william@ekovilla.se' } }, error: null });
});

describe('behörighetsgrinden — depot.manage på varje rutt', () => {
  for (const [name, call] of Object.entries(calls)) {
    it(`${name}: sales och konsult får 403, och ingenting i domänen anropas`, async () => {
      for (const user of [salesUser, konsultUser]) {
        asRole(user);
        expect((await call()).status).toBe(403);
      }
      for (const fn of [listOrders, getOrder, createDraft, updateDraft, discardDraft, sendMaterialOrder, resolveMaterialOrder, sendEmail]) {
        expect(fn).not.toHaveBeenCalled();
      }
    });
  }

  for (const [name, call] of Object.entries(calls)) {
    it(`${name}: admin släpps in med sessionsklienten, aldrig service-role`, async () => {
      asRole(adminUser);
      expect((await call()).status).toBeLessThan(300);
      expect(getSupabaseAdmin).not.toHaveBeenCalled();
    });
  }
});

describe('klienten väljer aldrig mottagare, avsändare eller depånamn', () => {
  it('insmugglade fält når aldrig domänen', async () => {
    asRole(adminUser);
    await listRoute.POST(
      req('POST', {
        supplier_id: SUP,
        recipient_email: 'angripare@example.com',
        from_address: 'x@y.z',
        email_text: 'annan text',
        lines: [{ ...LINE, depot_name: 'Påhittad', depot_location: 'Någonstans' }],
      }),
    );
    const input = (createDraft as any).mock.calls[0][1];
    expect(input.supplierId).toBe(SUP);
    expect(JSON.stringify(input)).not.toMatch(/angripare|x@y\.z|annan text|Påhittad|Någonstans/);
    expect((createDraft as any).mock.calls[0][0]).toEqual(expect.objectContaining({ __client: 'session' }));
  });

  it('en andra öppen order till samma fabrik: 409 med id:t att fortsätta i', async () => {
    asRole(adminUser);
    (createDraft as any).mockResolvedValue({ kind: 'open_order_exists', order_id: 'o-open', order_no: 12, status: 'draft' });
    const res = await calls.create();
    expect(res.status).toBe(409);
    expect((await res.json()).errorDetails.details).toMatchObject({ order_id: 'o-open', order_no: 12 });
  });
});

describe('utskickets svar', () => {
  it.each([
    [{ kind: 'blocked' }, 503],
    [{ kind: 'not_found' }, 404],
    [{ kind: 'already_sent', order: null }, 200],
    [{ kind: 'conflict', code: 'in_progress', message: 'x' }, 409],
    [{ kind: 'acknowledge_required', warnings: [{ kind: 'lead_time_zero' }], fingerprint: 'fp' }, 409],
    [{ kind: 'rejected', code: 'validation_error', message: 'x', attempt: 2 }, 422],
    [{ kind: 'unknown', message: 'x', retry_after_seconds: 120 }, 202],
    [{ kind: 'db_error', message: 'x' }, 500],
    [{ kind: 'sent', order_no: 14, created: 2, expected: 2 }, 201],
  ])('%o -> %i', async (outcome, status) => {
    asRole(adminUser);
    (sendMaterialOrder as any).mockResolvedValue(outcome);
    expect((await calls.send()).status).toBe(status);
  });

  it('skickar revision, försök och kvittering vidare, med processens miljö', async () => {
    asRole(adminUser);
    await sendRoute.POST(req('POST', { revision: 5, attempt: 2, acknowledged_warnings: 'fp-sidan-visade' }), ctx);
    const [deps, input] = (sendMaterialOrder as any).mock.calls[0];
    expect(input).toEqual({ orderId: ID, revision: 5, attempt: 2, acknowledgedWarnings: 'fp-sidan-visade' });
    expect(deps.env).toBe(process.env);
    expect(deps.supabase).toEqual(expect.objectContaining({ __client: 'session' }));
  });

  it('ett skickat utskick loggas — utan leverantörens namn eller adress', async () => {
    asRole(adminUser);
    await calls.send();
    expect(logActivity).toHaveBeenCalledTimes(1);
    const entry = JSON.stringify((logActivity as any).mock.calls[0][2]);
    expect(entry).toContain('#14');
    expect(entry).not.toMatch(/Ekovilla Oy|fabrik@example\.fi/);
  });

  it('ett oklart eller avvisat utskick loggas inte', async () => {
    asRole(adminUser);
    for (const outcome of [{ kind: 'unknown', message: 'x', retry_after_seconds: 120 }, { kind: 'rejected', code: 'x', message: 'x', attempt: 2 }]) {
      (sendMaterialOrder as any).mockResolvedValue(outcome);
      await calls.send();
    }
    expect(logActivity).not.toHaveBeenCalled();
  });

  it('ett felaktigt anrop (saknat försök) når aldrig domänen', async () => {
    asRole(adminUser);
    expect((await sendRoute.POST(req('POST', { revision: 2 }), ctx)).status).toBe(400);
    expect(sendMaterialOrder).not.toHaveBeenCalled();
  });
});

describe('testmailet', () => {
  it('går till den inloggades egen adress, märkt som test, med det lagrade mailet', async () => {
    asRole(adminUser);
    const res = await calls.testMail();
    expect(res.status).toBe(200);
    const [args, options] = (sendEmail as any).mock.calls[0];
    expect(args.to).toBe('william@ekovilla.se');
    expect(args.subject.startsWith('[TEST – inte skickad till fabriken] ')).toBe(true);
    expect(args.text).toContain('Hej');
    expect(options).toBeUndefined();
  });

  it('ett ogranskat utkast har inget att testa', async () => {
    asRole(adminUser);
    (getOrder as any).mockResolvedValue({ data: { ...ORDER, email_text: null }, error: null });
    expect((await calls.testMail()).status).toBe(409);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('överhoppat utskick är inte skickat', async () => {
    asRole(adminUser);
    (sendEmail as any).mockResolvedValue({ id: null, skipped: true });
    expect((await calls.testMail()).status).toBe(503);
  });
});

describe('beskedet om ett oklart utskick', () => {
  it('"gick fram" loggas', async () => {
    asRole(adminUser);
    expect((await calls.resolve()).status).toBe(200);
    expect(logActivity).toHaveBeenCalledTimes(1);
  });

  it('inom fönstret: 409', async () => {
    asRole(adminUser);
    (resolveMaterialOrder as any).mockResolvedValue({ kind: 'conflict', code: 'window_open', message: 'x' });
    expect((await calls.resolve()).status).toBe(409);
    expect(logActivity).not.toHaveBeenCalled();
  });
});

describe('svarens detaljer', () => {
  it('ett avvisat utskick säger vilket försök nästa Skicka ska använda', async () => {
    asRole(adminUser);
    (sendMaterialOrder as any).mockResolvedValue({ kind: 'rejected', code: 'validation_error', message: 'x', attempt: 2 });
    expect((await (await calls.send()).json()).errorDetails.details).toMatchObject({ attempt: 2 });
  });

  it('ett oklart utskick säger när man kan försöka igen', async () => {
    asRole(adminUser);
    (sendMaterialOrder as any).mockResolvedValue({ kind: 'unknown', message: 'x', retry_after_seconds: 120 });
    expect((await (await calls.send()).json()).data).toMatchObject({ state: 'unknown', retry_after_seconds: 120 });
  });

  it('varningarna som ska kvitteras kommer med sitt avtryck', async () => {
    asRole(adminUser);
    (sendMaterialOrder as any).mockResolvedValue({ kind: 'acknowledge_required', warnings: [{ kind: 'lead_time_zero' }], fingerprint: 'fp' });
    expect((await (await calls.send()).json()).errorDetails.details).toMatchObject({ warnings_fingerprint: 'fp' });
  });

  /** Ändra skickar hela utkastet: en PATCH utan Övrigt eller meddelande hade annars raderat dem tyst. */
  it('en PATCH utan alla fält avvisas', async () => {
    asRole(adminUser);
    expect((await itemRoute.PATCH(req('PATCH', { revision: 2, lines: [LINE] }), ctx)).status).toBe(400);
    expect(updateDraft).not.toHaveBeenCalled();
  });

  it('"gick inte fram" loggas också', async () => {
    asRole(adminUser);
    (resolveMaterialOrder as any).mockResolvedValue({ kind: 'released' });
    await resolveRoute.POST(req('POST', { delivered: false }), ctx);
    expect((logActivity as any).mock.calls[0][2].action).toBe('material_order.not_delivered');
  });
});
