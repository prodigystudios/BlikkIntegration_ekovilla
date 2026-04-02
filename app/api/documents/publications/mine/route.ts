import { NextResponse } from 'next/server';
import { adminSupabase } from '@/lib/adminSupabase';
import { getCurrentUser } from '../../_util';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const current = await getCurrentUser();
  if (!current) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  if (!adminSupabase) return NextResponse.json({ ok: false, error: 'service role not configured' }, { status: 500 });

  const { data, error } = await adminSupabase
    .from('document_publication_recipients')
    .select(`
      publication_id,
      created_at,
      document_publications:publication_id (
        id,
        title,
        description,
        version_label,
        due_at,
        requires_approval,
        created_at,
        archived_at,
        documents_files:file_id (
          id,
          file_name,
          content_type
        )
      )
    `)
    .eq('recipient_user_id', current.id)
    .is('document_publications.archived_at', null)
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const publicationIds = (data || []).map((row: any) => row.publication_id).filter(Boolean);
  let receiptMap = new Map<string, any>();
  if (publicationIds.length > 0) {
    const { data: receipts, error: receiptsError } = await adminSupabase
      .from('document_publication_receipts')
      .select('publication_id, first_opened_at, last_opened_at, approved_at, approval_note')
      .eq('user_id', current.id)
      .in('publication_id', publicationIds);
    if (receiptsError) return NextResponse.json({ ok: false, error: receiptsError.message }, { status: 500 });
    receiptMap = new Map((receipts || []).map((receipt: any) => [receipt.publication_id as string, receipt]));
  }

  const items = (data || []).map((row: any) => {
    const receipt = receiptMap.get(row.publication_id) || null;
    const publication = row.document_publications;
    return {
      publicationId: row.publication_id,
      assignedAt: row.created_at,
      title: publication?.title || 'Dokument',
      description: publication?.description || null,
      versionLabel: publication?.version_label || null,
      dueAt: publication?.due_at || null,
      requiresApproval: publication?.requires_approval !== false,
      file: publication?.documents_files || null,
      receipt: receipt ? {
        firstOpenedAt: receipt.first_opened_at || null,
        lastOpenedAt: receipt.last_opened_at || null,
        approvedAt: receipt.approved_at || null,
        approvalNote: receipt.approval_note || null,
      } : null,
    };
  });

  return NextResponse.json({ ok: true, items }, { status: 200, headers: new Headers({ 'Cache-Control': 'no-store' }) });
}
