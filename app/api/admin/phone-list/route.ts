import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdminUser } from '@/lib/auth/route';
import { getOptionalSupabaseAdmin } from '@/lib/supabase/server';
import { loadPhoneListDocument, phoneListDocumentSchema, savePhoneListDocument } from '@/lib/phoneListStorage';

function routeError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json(
    { ok: false, error: { code, message, ...(details !== undefined ? { details } : {}) } },
    { status },
  );
}

export async function GET() {
  if (!(await requireAdminUser())) return routeError(403, 'forbidden', 'Forbidden');
  const supabase = getOptionalSupabaseAdmin();
  const document = await loadPhoneListDocument(supabase);
  if (document) return NextResponse.json(document, { headers: { 'Cache-Control': 'no-store' } });
  return routeError(404, 'not_found', 'Phone list not found');
}

export async function PUT(req: NextRequest) {
  if (!(await requireAdminUser())) return routeError(403, 'forbidden', 'Forbidden');
  const supabase = getOptionalSupabaseAdmin();
  if (!supabase) return routeError(500, 'service_role_missing', 'Service role missing');

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return routeError(400, 'invalid_json', 'Invalid JSON');
  }

  const parsed = phoneListDocumentSchema.safeParse(body);
  if (!parsed.success) {
    return routeError(400, 'validation_error', 'Invalid phone list document', parsed.error.flatten());
  }

  if (Object.keys(parsed.data).length === 0) {
    return routeError(400, 'validation_error', 'Phone list document cannot be empty');
  }

  try {
    const uploadError = await savePhoneListDocument(supabase, parsed.data);
    if (uploadError) return routeError(500, 'upload_failed', 'Upload failed', uploadError.message);
    return NextResponse.json({ ok: true, data: null });
  } catch (error) {
    const message = error instanceof z.ZodError ? error.message : error instanceof Error ? error.message : 'Unexpected error';
    return routeError(500, 'unexpected', message);
  }
}

export const PATCH = PUT; // treat PATCH same as full replace for simplicity
