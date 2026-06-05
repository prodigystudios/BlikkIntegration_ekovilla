import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { requireCrmAdmin } from '@/app/api/fortnox/_shared';
import { exchangeCodeForToken, saveFortnoxIntegration } from '@/lib/domains/fortnox/auth';

const SETTINGS_URL = '/crm/installningar';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  // Fortnox returned an error (user denied, etc.)
  if (error) {
    return NextResponse.redirect(
      new URL(`${SETTINGS_URL}?fortnox_error=${encodeURIComponent(error)}`, req.url),
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(
      new URL(`${SETTINGS_URL}?fortnox_error=invalid_callback`, req.url),
    );
  }

  // Verify CSRF state
  const cookieStore = cookies();
  const storedState = cookieStore.get('fortnox_oauth_state')?.value;
  cookieStore.delete('fortnox_oauth_state');

  if (!storedState || storedState !== state) {
    return NextResponse.redirect(
      new URL(`${SETTINGS_URL}?fortnox_error=state_mismatch`, req.url),
    );
  }

  // Use shared helper for role check; redirect on failure instead of returning JSON.
  const { currentUser, response } = await requireCrmAdmin();
  if (response || !currentUser) {
    return NextResponse.redirect(
      new URL(`${SETTINGS_URL}?fortnox_error=unauthorized`, req.url),
    );
  }

  try {
    const tokenData = await exchangeCodeForToken(code);
    await saveFortnoxIntegration(tokenData, currentUser.id);
    return NextResponse.redirect(new URL(`${SETTINGS_URL}?fortnox_connected=1`, req.url));
  } catch (e: any) {
    const msg = encodeURIComponent(e?.message || 'token_exchange_failed');
    return NextResponse.redirect(new URL(`${SETTINGS_URL}?fortnox_error=${msg}`, req.url));
  }
}
