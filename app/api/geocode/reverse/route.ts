import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { z } from 'zod';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const reverseGeocodeQuerySchema = z.object({
  lat: z.coerce.number().finite(),
  lon: z.coerce.number().finite(),
});

function ok<T>(data: T, legacy?: Record<string, unknown>, status = 200) {
  return NextResponse.json({ ok: true, data, ...(legacy ?? {}) }, { status });
}

function routeError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json(
    {
      ok: false,
      error: message,
      errorDetails: { code, message, ...(details !== undefined ? { details } : {}) },
      legacyError: message,
      ...(details !== undefined ? { details } : {}),
    },
    { status },
  );
}

export async function GET(req: NextRequest) {
  try {
    const supabase = createRouteHandlerClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return routeError(401, 'unauthorized', 'Unauthorized');

    const searchParams = new URL(req.url).searchParams;
    const parsedQuery = reverseGeocodeQuerySchema.safeParse({
      lat: searchParams.get('lat'),
      lon: searchParams.get('lon'),
    });
    if (!parsedQuery.success) {
      return routeError(400, 'validation_error', 'Missing or invalid lat/lon', parsedQuery.error.flatten());
    }

    const { lat, lon } = parsedQuery.data;

    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&addressdetails=1`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Ekovilla-Korjournal/1.0',
        'Accept': 'application/json'
      },
      cache: 'no-store'
    });
    if (!res.ok) throw new Error(`Reverse geocode failed: ${res.status}`);

    const data: any = await res.json();
    const addr = data?.address || {};

    const street = [addr.road, addr.house_number].filter(Boolean).join(' ').trim();
    const city = (addr.city || addr.town || addr.village || addr.municipality || addr.county || addr.state || '').toString();
    const compact = [street, city].filter(Boolean).join(' ').trim();
    const display = compact || data?.display_name || `${lat.toFixed(5)}, ${lon.toFixed(5)}`;

    // Keep `address` for existing clients (e.g. körjournal), but also return structured fields.
    const payload = { address: display, street, city, lat, lon };
    return ok(payload, payload);
  } catch (e: any) {
    return routeError(500, 'reverse_geocode_failed', e.message);
  }
}
