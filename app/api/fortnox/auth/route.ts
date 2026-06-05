import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { requireCrmAdmin, routeError } from '../_shared';
import { buildFortnoxAuthUrl } from '@/lib/domains/fortnox/auth';

// Initiates the Fortnox OAuth flow. Redirects the user to Fortnox authorization page.
export async function GET() {
  try {
    const admin = await requireCrmAdmin();
    if (admin.response) return admin.response;

    const state = crypto.randomUUID();

    // Store state in a short-lived cookie to verify in callback
    const cookieStore = cookies();
    cookieStore.set('fortnox_oauth_state', state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 10, // 10 minutes
      path: '/',
    });

    const authUrl = buildFortnoxAuthUrl(state);
    return NextResponse.redirect(authUrl);
  } catch (e: any) {
    return routeError(500, 'fortnox_auth_init_failed', e?.message || 'Kunde inte starta Fortnox-koppling');
  }
}
