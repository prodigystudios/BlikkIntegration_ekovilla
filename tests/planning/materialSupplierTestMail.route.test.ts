import { describe, it, expect, vi, beforeEach } from 'vitest';
import { adminUser, konsultUser, salesUser, effectivePermissionsForRole } from '../crm/helpers/supabase';

// Testmailet för en leverantörs beställningsmall. Mallmodulen har egna tester; det som prövas HÄR är
// routens beslut: vem som får skicka, VART mailet går, och att ett överhoppat utskick inte kallas skickat.
//
// 🧨 MOTTAGAREN. Routen får aldrig mejla en adress som kommer från anropet eller från leverantörsraden —
// bara den inloggades egen, ur sessionen. Annars är den en öppen relä med företagets avsändare.

vi.mock('@/lib/auth/route', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/route')>();
  return { ...actual, getCurrentUser: vi.fn() };
});
vi.mock('@/lib/auth/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/permissions')>();
  return { ...actual, getEffectivePermissions: vi.fn() };
});
vi.mock('@/lib/domains/planning/materialSuppliers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/domains/planning/materialSuppliers')>();
  return { ...actual, getSupplier: vi.fn() };
});
vi.mock('@/lib/email', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/email')>();
  return { ...actual, sendEmail: vi.fn() };
});

// Klienterna MÄRKS, så en elevering till service-role syns.
const ADMIN_CLIENT = { __client: 'admin' } as any;
const getUser = vi.fn();
vi.mock('@/lib/supabase/server', () => ({ getSupabaseAdmin: vi.fn(() => ADMIN_CLIENT) }));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('@supabase/auth-helpers-nextjs', () => ({
  createRouteHandlerClient: vi.fn(() => ({ __client: 'session', auth: { getUser } })),
}));

import { getCurrentUser } from '@/lib/auth/route';
import { getEffectivePermissions } from '@/lib/auth/permissions';
import { getSupplier } from '@/lib/domains/planning/materialSuppliers';
import { EmailSendError, sendEmail } from '@/lib/email';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { POST } from '@/app/api/crm/planering/material-suppliers/[id]/test-mail/route';
import { updateSupplierSchema } from '@/app/api/crm/planering/_lib';

const ID = '11111111-2222-4333-8444-555555555555';
const MY_ADDRESS = 'william@ekovilla.se';
const FACTORY = {
  id: ID,
  name: 'Ekovilla Oy',
  email: 'fabriken@example.fi',
  contact_name: 'Pekka',
  phone: null,
  materials: ['EKOVILLA'],
  lead_time_days: 7,
  note: null,
  active: true,
  order_email_language: 'en',
  order_email_subject: null,
  order_email_body: null,
};

function asRole(user: typeof adminUser) {
  (getCurrentUser as any).mockResolvedValue({ ...user, name: 'William Ali' });
  (getEffectivePermissions as any).mockResolvedValue(effectivePermissionsForRole(user.role));
}
const post = (body: unknown) =>
  POST(new Request('http://localhost/x', { method: 'POST', body: JSON.stringify(body) }), { params: { id: ID } });
const sent = () => (sendEmail as any).mock.calls[0][0];

beforeEach(() => {
  vi.clearAllMocks();
  (getSupplier as any).mockResolvedValue({ data: FACTORY, error: null });
  (sendEmail as any).mockResolvedValue({ id: 'email_1', skipped: false });
  getUser.mockResolvedValue({ data: { user: { email: MY_ADDRESS } }, error: null });
});

describe('behörighetsgrinden — depot.manage', () => {
  it('nekar sales', async () => {
    asRole(salesUser);
    expect((await post({ order_email_language: 'sv' })).status).toBe(403);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('nekar konsult', async () => {
    asRole(konsultUser);
    expect((await post({ order_email_language: 'sv' })).status).toBe(403);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('släpper igenom admin', async () => {
    asRole(adminUser);
    expect((await post({ order_email_language: 'sv' })).status).toBe(200);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });
});

describe('mottagaren', () => {
  /** 🧨 Varken en adress i anropet eller fabrikens adress får bli mottagare. */
  it('är alltid den inloggades egen adress', async () => {
    asRole(adminUser);
    const res = await post({ order_email_language: 'sv', to: 'angripare@example.com', recipient_email: 'x@y.z' });
    expect(res.status).toBe(200);
    expect(sent().to).toBe(MY_ADDRESS);
    expect(JSON.stringify(sent())).not.toContain('angripare@example.com');
    expect(JSON.stringify(sent())).not.toContain(FACTORY.email);
  });

  it('ett konto utan e-postadress får ett svar, inget mail', async () => {
    asRole(adminUser);
    getUser.mockResolvedValue({ data: { user: { email: null } }, error: null });
    expect((await post({ order_email_language: 'sv' })).status).toBe(400);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('läser leverantören och sessionen med sessionsklienten, aldrig service-role', async () => {
    asRole(adminUser);
    await post({ order_email_language: 'sv' });
    expect((getSupplier as any).mock.calls[0][0]).toEqual(expect.objectContaining({ __client: 'session' }));
    expect(getUser).toHaveBeenCalled();
    expect(getSupabaseAdmin).not.toHaveBeenCalled();
  });
});

describe('innehållet', () => {
  it('är märkt som test och bär exempelrader', async () => {
    asRole(adminUser);
    await post({ order_email_language: 'sv' });
    expect(sent().subject.startsWith('[TEST – inte skickad till fabriken] ')).toBe(true);
    expect(sent().text).toContain('INTE skickats till Ekovilla Oy');
    expect(sent().text).toContain('EXEMPELDEPÅ SYD');
    expect(sent().subject).toContain('#0');
  });

  it('utkastet skickas, inte det sparade — på utkastets språk', async () => {
    asRole(adminUser);
    await post({
      order_email_language: 'en',
      order_email_subject: 'Order #{ordernummer} for {leverantör}',
      order_email_body: 'Hi {kontaktperson}\n\n{orderrader}',
    });
    expect(sent().subject).toBe('[TEST – inte skickad till fabriken] Order #0 for Ekovilla Oy');
    expect(sent().text).toContain('Hi Pekka');
    expect(sent().text).toContain('delivery by');
  });

  it('en ogiltig mall avvisas med fältets fel, och inget skickas', async () => {
    asRole(adminUser);
    const res = await post({ order_email_language: 'sv', order_email_subject: 'Utan nummer', order_email_body: 'Utan rader' });
    expect(res.status).toBe(400);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('en leverantör som inte finns ger 404, inget mail', async () => {
    asRole(adminUser);
    (getSupplier as any).mockResolvedValue({ data: null, error: null });
    expect((await post({ order_email_language: 'sv' })).status).toBe(404);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});

describe('utfallet', () => {
  /** Ett överhoppat utskick är inte ett skickat — knappen får inte säga "skickat" när inget lämnade servern. */
  it('överhoppat (mail ej konfigurerat) ger 503, inte 200', async () => {
    asRole(adminUser);
    (sendEmail as any).mockResolvedValue({ id: null, skipped: true });
    expect((await post({ order_email_language: 'sv' })).status).toBe(503);
  });

  it('ett fel från Resend ger 502 med meddelandet', async () => {
    asRole(adminUser);
    (sendEmail as any).mockRejectedValue(new EmailSendError('validation_error', 'Invalid from'));
    const res = await post({ order_email_language: 'sv' });
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).toContain('Invalid from');
  });
});

describe('updateSupplierSchema — mallen', () => {
  it('godtar en giltig egen mall', () => {
    expect(
      updateSupplierSchema.safeParse({ order_email_subject: 'Order #{ordernummer}', order_email_body: '{orderrader}' }).success,
    ).toBe(true);
  });

  it('godtar återställning: båda null', () => {
    expect(updateSupplierSchema.safeParse({ order_email_subject: null, order_email_body: null }).success).toBe(true);
  });

  it('avvisar ämne utan text och tvärtom', () => {
    expect(updateSupplierSchema.safeParse({ order_email_subject: 'Order #{ordernummer}' }).success).toBe(false);
    expect(updateSupplierSchema.safeParse({ order_email_subject: null, order_email_body: '{orderrader}' }).success).toBe(false);
  });

  /** Ett anrop förbi redigeraren får inte kunna spara en mall som skickar ett mail utan beställning. */
  it('avvisar en mall utan {orderrader}, med felet på textfältet', () => {
    const r = updateSupplierSchema.safeParse({ order_email_subject: 'Order #{ordernummer}', order_email_body: 'Hej' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.map((i) => i.path.join('.'))).toContain('order_email_body');
  });

  it('avvisar ett okänt språk', () => {
    expect(updateSupplierSchema.safeParse({ order_email_language: 'fi' }).success).toBe(false);
  });

  it('en ändring som inte rör mallen berörs inte av mallreglerna', () => {
    expect(updateSupplierSchema.safeParse({ lead_time_days: 5 }).success).toBe(true);
  });
});
