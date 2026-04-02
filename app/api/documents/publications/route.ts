import { NextRequest, NextResponse } from 'next/server';
import { adminSupabase } from '@/lib/adminSupabase';
import { getCurrentUser } from '../_util';
import { normalizeRecipients, requireAdminUser, resolvePublicationRecipients } from './_lib';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const current = await getCurrentUser();
  if (!current) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  if (!adminSupabase) return NextResponse.json({ ok: false, error: 'service role not configured' }, { status: 500 });

  const { searchParams } = new URL(req.url);
  const fileId = (searchParams.get('fileId') || '').trim();

  const baseSelect = `
    id,
    file_id,
    title,
    description,
    version_label,
    due_at,
    requires_approval,
    archived_at,
    created_at,
    documents_files:file_id ( id, file_name )
  `;

  if (current.role === 'admin') {
    let query = adminSupabase.from('document_publications').select(baseSelect).is('archived_at', null).order('created_at', { ascending: false }).limit(30);
    if (fileId) query = query.eq('file_id', fileId);
    const { data, error } = await query;
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, items: data || [] }, { status: 200, headers: new Headers({ 'Cache-Control': 'no-store' }) });
  }

  const { data, error } = await adminSupabase!
    .from('document_publication_recipients')
    .select(`
      publication_id,
      document_publications:publication_id (
        ${baseSelect}
      )
    `)
    .eq('recipient_user_id', current.id)
    .limit(30);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, items: (data || []).map((row: any) => row.document_publications).filter(Boolean) }, { status: 200, headers: new Headers({ 'Cache-Control': 'no-store' }) });
}

export async function POST(req: NextRequest) {
  try {
    const current = await requireAdminUser();
    if (!current) return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
    if (!adminSupabase) return NextResponse.json({ ok: false, error: 'service role not configured' }, { status: 500 });

    const body = await req.json().catch(() => null);
    const fileId = String(body?.fileId || '').trim();
    const title = String(body?.title || '').trim();
    const description = String(body?.description || '').trim() || null;
    const versionLabel = String(body?.versionLabel || '').trim() || null;
    const dueAt = String(body?.dueAt || '').trim() || null;
    const requiresApproval = body?.requiresApproval !== false;
    const recipients = normalizeRecipients(body);

    if (!fileId) return NextResponse.json({ ok: false, error: 'missing fileId' }, { status: 400 });
    if (!title) return NextResponse.json({ ok: false, error: 'missing title' }, { status: 400 });

    const resolvedRecipients = await resolvePublicationRecipients(recipients);
    if (!resolvedRecipients.length) return NextResponse.json({ ok: false, error: 'missing recipients' }, { status: 400 });

    const { data: file, error: fileError } = await adminSupabase
      .from('documents_files')
      .select('id, file_name')
      .eq('id', fileId)
      .maybeSingle();
    if (fileError) return NextResponse.json({ ok: false, error: fileError.message }, { status: 500 });
    if (!file) return NextResponse.json({ ok: false, error: 'file_not_found' }, { status: 404 });

    const { data: publication, error: publicationError } = await adminSupabase
      .from('document_publications')
      .insert({
        file_id: fileId,
        title,
        description,
        version_label: versionLabel,
        due_at: dueAt,
        requires_approval: requiresApproval,
        published_by: current.id,
      })
      .select('id, file_id, title, version_label, due_at, requires_approval, created_at')
      .single();
    if (publicationError) return NextResponse.json({ ok: false, error: publicationError.message }, { status: 500 });

    const { error: recipientsError } = await adminSupabase
      .from('document_publication_recipients')
      .insert(resolvedRecipients.map(item => ({
        publication_id: publication.id,
        recipient_user_id: item.userId,
        source_type: item.sourceType,
        source_value: item.sourceValue,
      })));

    if (recipientsError) {
      await adminSupabase.from('document_publications').delete().eq('id', publication.id);
      return NextResponse.json({ ok: false, error: recipientsError.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, publication }, { status: 201 });
  } catch (error: any) {
    const message = error?.message === 'service_role_missing' ? 'service role not configured' : (error?.message || 'unexpected_error');
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
