import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { z } from 'zod';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Forward address search (autocomplete) — same free Nominatim/OSM provider as
// /api/geocode/reverse. Used by the address-autocomplete input so picking a street
// fills postal code + city. Sweden-scoped; the client debounces to respect the
// Nominatim usage policy (no per-keystroke spam).

const searchQuerySchema = z.object({
  q: z.string().trim().min(3).max(120),
});

function ok<T>(data: T, status = 200) {
  return NextResponse.json({ ok: true, data }, { status });
}

function routeError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json(
    { ok: false, error: message, errorDetails: { code, message, ...(details !== undefined ? { details } : {}) } },
    { status },
  );
}

export async function GET(req: NextRequest) {
  try {
    const supabase = createRouteHandlerClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return routeError(401, 'unauthorized', 'Unauthorized');

    const parsed = searchQuerySchema.safeParse({ q: new URL(req.url).searchParams.get('q') });
    if (!parsed.success) return ok({ items: [] }); // too short / invalid → empty, not an error

    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&dedupe=1&limit=6&countrycodes=se&q=${encodeURIComponent(parsed.data.q)}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Ekovilla-CRM/1.0', 'Accept': 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`Geocode search failed: ${res.status}`);

    const data: any = await res.json();
    const rows: any[] = Array.isArray(data) ? data : [];

    const items = rows
      .map((r) => {
        const a = r?.address || {};
        const street = [a.road, a.house_number].filter(Boolean).join(' ').trim();
        const city = (a.city || a.town || a.village || a.municipality || a.county || '').toString().trim();
        const postal_code = (a.postcode || '').toString().trim();
        const label = [street, [postal_code, city].filter(Boolean).join(' ')].filter(Boolean).join(', ') || (r?.display_name ?? '');
        return { label, street, postal_code, city };
      })
      // Keep street-level hits (an address picker, not a place picker).
      .filter((it) => it.street)
      // Drop near-duplicates that collapse to the same label.
      .filter((it, i, arr) => arr.findIndex((o) => o.label === it.label) === i);

    return ok({ items });
  } catch (e: any) {
    return routeError(500, 'geocode_search_failed', e.message);
  }
}
