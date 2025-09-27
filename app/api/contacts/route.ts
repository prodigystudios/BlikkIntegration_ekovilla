import { NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { adminSupabase } from '../../../lib/adminSupabase';
import { cookies } from 'next/headers';

// Public (authenticated) contacts output: { contacts: [...], addresses: [...] }
export async function GET() {
  const supabase = createRouteHandlerClient({ cookies });

  const [{ data: cats, error: catErr }, { data: people, error: peopleErr }, { data: addresses, error: addrErr }] = await Promise.all([
    supabase.from('contact_categories').select('id, name, sort').order('sort', { ascending: true }).order('name', { ascending: true }),
    supabase.from('contacts').select('id, category_id, name, phone, location, role, sort').order('sort', { ascending: true }).order('name', { ascending: true }),
    supabase.from('addresses').select('id, name, address, sort').order('sort', { ascending: true }).order('name', { ascending: true })
  ]);

  if (catErr) return NextResponse.json({ error: catErr.message }, { status: 500 });
  if (peopleErr) return NextResponse.json({ error: peopleErr.message }, { status: 500 });
  if (addrErr) return NextResponse.json({ error: addrErr.message }, { status: 500 });


  // If not authenticated (public view) RLS may return empty; fallback to service role read (safe limited fields)
  let effectiveCats = cats;
  let effectivePeople = people;
  let effectiveAddresses = addresses;
  if ((effectiveCats?.length || 0) === 0 && adminSupabase) {
    const [catsSR, peopleSR, addrSR] = await Promise.all([
      adminSupabase.from('contact_categories').select('id, name, sort').order('sort', { ascending: true }).order('name', { ascending: true }),
      adminSupabase.from('contacts').select('id, category_id, name, phone, location, role, sort').order('sort', { ascending: true }).order('name', { ascending: true }),
      adminSupabase.from('addresses').select('id, name, address, sort').order('sort', { ascending: true }).order('name', { ascending: true })
    ]);
    if (!catsSR.error && catsSR.data) effectiveCats = catsSR.data;
    if (!peopleSR.error && peopleSR.data) effectivePeople = peopleSR.data;
    if (!addrSR.error && addrSR.data) effectiveAddresses = addrSR.data;
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

  return NextResponse.json({ contacts, addresses: addressesOut }, { headers: { 'Cache-Control': 'no-store' } });
}
