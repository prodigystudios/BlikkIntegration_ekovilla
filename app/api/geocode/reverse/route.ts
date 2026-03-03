import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const supabase = createRouteHandlerClient({ cookies });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const lat = Number(searchParams.get('lat'));
    const lon = Number(searchParams.get('lon'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return NextResponse.json({ error: 'Missing or invalid lat/lon' }, { status: 400 });
    }
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
    return NextResponse.json({ address: display, street, city, lat, lon });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
