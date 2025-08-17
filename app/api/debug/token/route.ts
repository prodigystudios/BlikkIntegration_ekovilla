import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  // Only allow in non-production to avoid exposing token diagnostics publicly
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 404 });
  }

  const baseUrl = process.env.BLIKK_BASE_URL || 'https://publicapi.blikk.com';
  const appId = process.env.BLIKK_APP_ID;
  const appSecret = process.env.BLIKK_APP_SECRET;

  if (!appId || !appSecret) {
    return NextResponse.json({
      ok: false,
      error: 'Missing BLIKK_APP_ID or BLIKK_APP_SECRET',
    }, { status: 400 });
  }

  try {
    const basic = Buffer.from(`${appId}:${appSecret}`).toString('base64');
    const res = await fetch(`${baseUrl}/v1/Auth/Token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        Accept: 'application/json',
      },
      cache: 'no-store',
    });

    const text = await res.text();
    let body: any = null;
    try { body = JSON.parse(text); } catch {}

    if (!res.ok) {
      return NextResponse.json({
        ok: false,
        status: res.status,
        statusText: res.statusText,
        body: body || text,
        hints: [
          'Verify Application Id and Secret exactly as in Blikk Admin → API Applications',
          'Ensure values have no quotes or trailing spaces in .env.local',
          'Confirm the app is active and allowed to use the API',
        ],
      }, { status: 200 });
    }

    const token = (body && (body.accessToken as string)) || '';
    const expires = body && body.expires;
    const preview = token ? `${token.slice(0, 6)}...${token.slice(-6)}` : '';

    return NextResponse.json({ ok: true, tokenPreview: preview, expires }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
