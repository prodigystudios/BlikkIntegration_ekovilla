import { NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { getOptionalSupabaseAdmin } from '@/lib/supabase/server';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

type ContactCategoryRow = { id: string; name: string; sort: number | null };
type ContactRow = {
  id: string;
  category_id: string;
  name: string;
  phone: string | null;
  location: string | null;
  role: string | null;
  sort: number | null;
};
type AddressRow = { id: string; name: string; address: string; sort: number | null };

function ok<T>(data: T, legacy?: Record<string, unknown>, status = 200) {
  return NextResponse.json({ ok: true, data, ...(legacy ?? {}) }, { status });
}

function routeError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json(
    {
      ok: false,
      error: { code, message, ...(details !== undefined ? { details } : {}) },
      legacyError: message,
    },
    { status },
  );
}

async function loadContactsDataset(client: { from: (...args: any[]) => any }) {
  return Promise.all([
    client.from('contact_categories').select('id, name, sort').order('sort', { ascending: true }).order('name', { ascending: true }),
    client.from('contacts').select('id, category_id, name, phone, location, role, sort').order('sort', { ascending: true }).order('name', { ascending: true }),
    client.from('addresses').select('id, name, address, sort').order('sort', { ascending: true }).order('name', { ascending: true }),
  ]);
}

export async function GET() {
  const supabase = createRouteHandlerClient({ cookies });
  const admin = getOptionalSupabaseAdmin();

  const [{ data: cats, error: catErr }, { data: people, error: peopleErr }, { data: addresses, error: addrErr }] = await loadContactsDataset(supabase);

  if (catErr) return routeError(500, 'categories_query_failed', catErr.message);
  if (peopleErr) return routeError(500, 'contacts_query_failed', peopleErr.message);
  if (addrErr) return routeError(500, 'addresses_query_failed', addrErr.message);


  // If not authenticated (public view) RLS may return empty; fallback to service role read (safe limited fields)
  let effectiveCats = (cats ?? null) as ContactCategoryRow[] | null;
  let effectivePeople = (people ?? null) as ContactRow[] | null;
  let effectiveAddresses = (addresses ?? null) as AddressRow[] | null;
  if ((effectiveCats?.length || 0) === 0 && admin) {
    const [catsSR, peopleSR, addrSR] = await loadContactsDataset(admin);
    if (!catsSR.error && catsSR.data) effectiveCats = catsSR.data as ContactCategoryRow[];
    if (!peopleSR.error && peopleSR.data) effectivePeople = peopleSR.data as ContactRow[];
    if (!addrSR.error && addrSR.data) effectiveAddresses = addrSR.data as AddressRow[];
  }

  const catIndex: Record<string, string> = {};
  effectiveCats?.forEach(c => { catIndex[c.id] = c.name; });

  const contacts = (effectivePeople || []).filter(p => catIndex[p.category_id]).map(p => ({
    id: p.id,
    name: p.name,
    phone: p.phone,
    location: p.location || null,
    role: p.role || null,
    category: catIndex[p.category_id]
  }));

  const addressesOut = (effectiveAddresses || []).map(a => ({ id: a.id, name: a.name, address: a.address }));

  const payload = { contacts, addresses: addressesOut };
  return ok(payload, payload, 200);
}
