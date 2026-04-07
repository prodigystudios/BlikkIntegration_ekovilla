import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { getCurrentUser } from '../../../_util';
import { getSupabaseAdmin } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function markPublicationOpened(publicationId: string, userId: string) {
  const supabase = createRouteHandlerClient({ cookies });
  const { data: recipient, error: recipientError } = await supabase
    .from('document_publication_recipients')
    .select('id')
    .eq('publication_id', publicationId)
    .eq('recipient_user_id', userId)
    .maybeSingle();
  if (recipientError) return { ok: false as const, status: 500, error: recipientError.message };
  if (!recipient) return { ok: false as const, status: 403, error: 'forbidden' };

  const now = new Date().toISOString();
  const { data: existing, error: existingError } = await supabase
    .from('document_publication_receipts')
    .select('id, first_opened_at')
    .eq('publication_id', publicationId)
    .eq('user_id', userId)
    .maybeSingle();
  if (existingError) return { ok: false as const, status: 500, error: existingError.message };

  if (!existing) {
    const { error: insertError } = await supabase
      .from('document_publication_receipts')
      .insert({
        publication_id: publicationId,
        user_id: userId,
        first_opened_at: now,
        last_opened_at: now,
      });
    if (insertError) return { ok: false as const, status: 500, error: insertError.message };
  } else {
    const patch: Record<string, string> = { last_opened_at: now };
    if (!existing.first_opened_at) patch.first_opened_at = now;
    const { error: updateError } = await supabase
      .from('document_publication_receipts')
      .update(patch)
      .eq('id', existing.id);
    if (updateError) return { ok: false as const, status: 500, error: updateError.message };
  }

  return { ok: true as const };
}

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const current = await getCurrentUser();
  if (!current) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const publicationId = String(params.id || '').trim();
  if (!publicationId) return NextResponse.json({ ok: false, error: 'missing publication id' }, { status: 400 });

  const marked = await markPublicationOpened(publicationId, current.id);
  if (!marked.ok) return NextResponse.json({ ok: false, error: marked.error }, { status: marked.status });

  return NextResponse.json({ ok: true }, { status: 200 });
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const current = await getCurrentUser();
  if (!current) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const publicationId = String(params.id || '').trim();
  if (!publicationId) return NextResponse.json({ ok: false, error: 'missing publication id' }, { status: 400 });

  const marked = await markPublicationOpened(publicationId, current.id);
  if (!marked.ok) return NextResponse.json({ ok: false, error: marked.error }, { status: marked.status });

  const supabase = createRouteHandlerClient({ cookies });
  const admin = getSupabaseAdmin();
  const { data: publication, error: publicationError } = await supabase
    .from('document_publications')
    .select('file_id')
    .eq('id', publicationId)
    .maybeSingle();
  if (publicationError) return NextResponse.json({ ok: false, error: publicationError.message }, { status: 500 });
  if (!publication?.file_id) return NextResponse.json({ ok: false, error: 'file_not_found' }, { status: 404 });

  const { data: file, error: fileError } = await supabase
    .from('documents_files')
    .select('storage_bucket, storage_path, file_name')
    .eq('id', publication.file_id)
    .maybeSingle();
  if (fileError) return NextResponse.json({ ok: false, error: fileError.message }, { status: 500 });
  if (!file) return NextResponse.json({ ok: false, error: 'file_not_found' }, { status: 404 });

  const { data: signed, error: signedError } = await admin.storage
    .from(String((file as any).storage_bucket))
    .createSignedUrl(String((file as any).storage_path), 60 * 30);
  if (signedError || !signed?.signedUrl) {
    return NextResponse.json({ ok: false, error: signedError?.message || 'failed_signed_url' }, { status: 500 });
  }

  return NextResponse.redirect(signed.signedUrl, { status: 302 });
}
