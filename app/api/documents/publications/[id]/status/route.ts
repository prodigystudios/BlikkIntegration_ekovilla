import { NextResponse } from 'next/server';
import { adminSupabase } from '@/lib/adminSupabase';
import { requireAdminUser } from '../../_lib';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const current = await requireAdminUser();
    if (!current) return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
    if (!adminSupabase) return NextResponse.json({ ok: false, error: 'service role not configured' }, { status: 500 });

    const publicationId = String(params.id || '').trim();
    if (!publicationId) return NextResponse.json({ ok: false, error: 'missing publication id' }, { status: 400 });

    const { data: publication, error: publicationError } = await adminSupabase
      .from('document_publications')
      .select(`
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
          file_name
        )
      `)
      .eq('id', publicationId)
      .maybeSingle();
    if (publicationError) return NextResponse.json({ ok: false, error: publicationError.message }, { status: 500 });
    if (!publication) return NextResponse.json({ ok: false, error: 'publication_not_found' }, { status: 404 });

    const { data: recipients, error: recipientsError } = await adminSupabase
      .from('document_publication_recipients')
      .select(`
        recipient_user_id,
        source_type,
        source_value,
        created_at,
        profiles:recipient_user_id (
          id,
          full_name,
          role
        )
      `)
      .eq('publication_id', publicationId)
      .order('created_at', { ascending: true });
    if (recipientsError) return NextResponse.json({ ok: false, error: recipientsError.message }, { status: 500 });

    const { data: receipts, error: receiptsError } = await adminSupabase
      .from('document_publication_receipts')
      .select('user_id, first_opened_at, last_opened_at, approved_at, approval_note')
      .eq('publication_id', publicationId);
    if (receiptsError) return NextResponse.json({ ok: false, error: receiptsError.message }, { status: 500 });

    const receiptMap = new Map((receipts || []).map((receipt: any) => [receipt.user_id as string, receipt]));
    const items = (recipients || []).map((recipient: any) => {
      const receipt = receiptMap.get(recipient.recipient_user_id) || null;
      return {
        userId: recipient.recipient_user_id,
        name: recipient.profiles?.full_name || 'Okänd användare',
        role: recipient.profiles?.role || 'member',
        sourceType: recipient.source_type || 'user',
        sourceValue: recipient.source_value || null,
        assignedAt: recipient.created_at,
        firstOpenedAt: receipt?.first_opened_at || null,
        lastOpenedAt: receipt?.last_opened_at || null,
        approvedAt: receipt?.approved_at || null,
        approvalNote: receipt?.approval_note || null,
      };
    });

    const requiresApproval = publication.requires_approval !== false;
    const isComplete = (item: { firstOpenedAt: string | null; approvedAt: string | null }) => {
      return !!item.approvedAt || (!requiresApproval && !!item.firstOpenedAt);
    };

    const summary = {
      total: items.length,
      unread: items.filter(item => !item.firstOpenedAt).length,
      read: items.filter(item => !!item.firstOpenedAt && !isComplete(item)).length,
      approved: items.filter(item => isComplete(item)).length,
    };

    return NextResponse.json({ ok: true, publication, summary, items }, { status: 200, headers: new Headers({ 'Cache-Control': 'no-store' }) });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || 'unexpected_error' }, { status: 500 });
  }
}