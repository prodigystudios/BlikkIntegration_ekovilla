import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { requireCrmAdmin, routeError } from '../_shared';
import { buildFortnoxAuthUrl } from '@/lib/domains/fortnox/auth';
import { fortnoxConnectPreflight } from '@/lib/domains/fortnox/connectionGuard';

// Initiates the Fortnox OAuth flow. Redirects the user to Fortnox authorization page.
export async function GET(req: Request) {
  try {
    const admin = await requireCrmAdmin();
    if (admin.response) return admin.response;

    // Utanför produktion utan tillåtelselista avvisas varje bolag i callbacken ändå — skicka då inte
    // användaren till Fortnox, där det riktiga bolaget annars hade hunnit godkänna kopplingen.
    const preflight = fortnoxConnectPreflight(process.env);
    if (!preflight.ok) {
      return NextResponse.redirect(
        new URL(`/crm/installningar?fortnox_error=${encodeURIComponent(preflight.message)}`, req.url),
      );
    }

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
