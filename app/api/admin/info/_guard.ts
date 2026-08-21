import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getCurrentUser } from '@/lib/auth/route';
import { routeError } from '@/lib/api/responses';
import { InfoPageError } from '@/lib/domains/info-page/mutations';

// Adminvakten för /api/admin/info/*. Bara vakten bor här — svarsformen kommer från
// lib/api/responses.ts, som säger uttryckligen att en tredje variant inte ska införas.
//
// RLS gatar redan skrivningarna. Rollkontrollen finns för felmeddelandets skull: en 403 säger
// vad som hände, medan RLS bara låter skrivningen träffa noll rader.
export async function requireAdmin(): Promise<{ client: SupabaseClient; userId: string } | Response> {
  const currentUser = await getCurrentUser();
  if (!currentUser) return routeError(401, 'unauthorized', 'Unauthorized');
  if (currentUser.role !== 'admin') return routeError(403, 'forbidden', 'Forbidden');
  return { client: createRouteHandlerClient({ cookies }), userId: currentUser.id };
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

// Domänen kastar InfoPageError med sin egen status; allt annat är oväntat och blir 500.
export function toRouteError(error: unknown) {
  if (error instanceof InfoPageError) return routeError(error.status, error.code, error.message);
  return routeError(500, 'unexpected_error', (error as any)?.message || 'unexpected_error');
}
