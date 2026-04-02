import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { getCurrentUser } from '../../../_util';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const current = await getCurrentUser();
  if (!current) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const publicationId = String(params.id || '').trim();
  if (!publicationId) return NextResponse.json({ ok: false, error: 'missing publication id' }, { status: 400 });

  const body = await req.json().catch(() => null);
  const approvalNote = String(body?.approvalNote || '').trim() || null;
  const supabase = createRouteHandlerClient({ cookies });

  const { data: recipient, error: recipientError } = await supabase
    .from('document_publication_recipients')
    .select('id')
    .eq('publication_id', publicationId)
    .eq('recipient_user_id', current.id)
    .maybeSingle();
  if (recipientError) return NextResponse.json({ ok: false, error: recipientError.message }, { status: 500 });
  if (!recipient) return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });

  const now = new Date().toISOString();
  const { data: existing, error: existingError } = await supabase
    .from('document_publication_receipts')
    .select('id, first_opened_at')
    .eq('publication_id', publicationId)
    .eq('user_id', current.id)
    .maybeSingle();
  if (existingError) return NextResponse.json({ ok: false, error: existingError.message }, { status: 500 });

  if (!existing) {
    const { error: insertError } = await supabase
      .from('document_publication_receipts')
      .insert({
        publication_id: publicationId,
        user_id: current.id,
        first_opened_at: now,
        last_opened_at: now,
        approved_at: now,
        approval_note: approvalNote,
      });
    if (insertError) return NextResponse.json({ ok: false, error: insertError.message }, { status: 500 });
  } else {
    const patch: Record<string, string | null> = {
      last_opened_at: now,
      approved_at: now,
      approval_note: approvalNote,
    };
    if (!existing.first_opened_at) patch.first_opened_at = now;
    const { error: updateError } = await supabase
      .from('document_publication_receipts')
      .update(patch)
      .eq('id', existing.id);
    if (updateError) return NextResponse.json({ ok: false, error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}