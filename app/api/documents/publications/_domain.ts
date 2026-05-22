import { getOptionalSupabaseAdmin } from '@/lib/supabase/server';
import type { ApprovePublicationInput, CreatePublicationInput, PublicationRecipientInput } from './_lib';

type PublicationsSessionClient = {
  from: (table: string) => any;
};

export class PublicationsRouteError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const publicationBaseSelect = `
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

function getSupabaseOrThrow() {
  const supabase = getOptionalSupabaseAdmin();
  if (!supabase) {
    throw new PublicationsRouteError('service role not configured', 500);
  }

  return supabase;
}

function requirePublicationId(publicationId: string) {
  if (!publicationId) {
    throw new PublicationsRouteError('missing publication id', 400);
  }
}

async function ensurePublicationRecipient(sessionSupabase: PublicationsSessionClient, publicationId: string, userId: string) {
  const { data: recipient, error: recipientError } = await sessionSupabase
    .from('document_publication_recipients')
    .select('id')
    .eq('publication_id', publicationId)
    .eq('recipient_user_id', userId)
    .maybeSingle();

  if (recipientError) {
    throw new PublicationsRouteError(recipientError.message, 500);
  }

  if (!recipient) {
    throw new PublicationsRouteError('forbidden', 403);
  }
}

async function upsertPublicationReceipt(
  sessionSupabase: PublicationsSessionClient,
  params: {
    publicationId: string;
    userId: string;
    approvalNote?: string | null;
    markApproved?: boolean;
  },
) {
  const now = new Date().toISOString();
  const { publicationId, userId, approvalNote = null, markApproved = false } = params;

  const { data: existing, error: existingError } = await sessionSupabase
    .from('document_publication_receipts')
    .select('id, first_opened_at')
    .eq('publication_id', publicationId)
    .eq('user_id', userId)
    .maybeSingle();

  if (existingError) {
    throw new PublicationsRouteError(existingError.message, 500);
  }

  if (!existing) {
    const payload: Record<string, string | null> = {
      publication_id: publicationId,
      user_id: userId,
      first_opened_at: now,
      last_opened_at: now,
    };

    if (markApproved) {
      payload.approved_at = now;
      payload.approval_note = approvalNote;
    }

    const { error: insertError } = await sessionSupabase.from('document_publication_receipts').insert(payload);
    if (insertError) {
      throw new PublicationsRouteError(insertError.message, 500);
    }

    return;
  }

  const patch: Record<string, string | null> = {
    last_opened_at: now,
  };

  if (!existing.first_opened_at) {
    patch.first_opened_at = now;
  }

  if (markApproved) {
    patch.approved_at = now;
    patch.approval_note = approvalNote;
  }

  const { error: updateError } = await sessionSupabase
    .from('document_publication_receipts')
    .update(patch)
    .eq('id', existing.id);

  if (updateError) {
    throw new PublicationsRouteError(updateError.message, 500);
  }
}

export async function listPublicationsForViewer(current: { id: string; role: string }, fileId: string) {
  const supabase = getSupabaseOrThrow();

  if (current.role === 'admin') {
    let query = supabase
      .from('document_publications')
      .select(publicationBaseSelect)
      .is('archived_at', null)
      .order('created_at', { ascending: false })
      .limit(30);

    if (fileId) {
      query = query.eq('file_id', fileId);
    }

    const { data, error } = await query;
    if (error) {
      throw new PublicationsRouteError(error.message, 500);
    }

    return data || [];
  }

  const { data, error } = await supabase
    .from('document_publication_recipients')
    .select(`
      publication_id,
      document_publications:publication_id (
        ${publicationBaseSelect}
      )
    `)
    .eq('recipient_user_id', current.id)
    .limit(30);

  if (error) {
    throw new PublicationsRouteError(error.message, 500);
  }

  return (data || []).map((row: any) => row.document_publications).filter(Boolean);
}

export async function createPublicationWithRecipients(params: {
  currentUserId: string;
  input: CreatePublicationInput;
  recipients: Array<{ userId: string; sourceType: PublicationRecipientInput['userIds'][number] extends never ? 'user' | 'tag' : 'user' | 'tag'; sourceValue: string | null }>;
}) {
  const { currentUserId, input, recipients } = params;
  const supabase = getSupabaseOrThrow();

  const { data: file, error: fileError } = await supabase
    .from('documents_files')
    .select('id, file_name')
    .eq('id', input.fileId)
    .maybeSingle();

  if (fileError) {
    throw new PublicationsRouteError(fileError.message, 500);
  }

  if (!file) {
    throw new PublicationsRouteError('file_not_found', 404);
  }

  const { data: publication, error: publicationError } = await supabase
    .from('document_publications')
    .insert({
      file_id: input.fileId,
      title: input.title,
      description: input.description,
      version_label: input.versionLabel,
      due_at: input.dueAt,
      requires_approval: input.requiresApproval,
      published_by: currentUserId,
    })
    .select('id, file_id, title, version_label, due_at, requires_approval, created_at')
    .single();

  if (publicationError) {
    throw new PublicationsRouteError(publicationError.message, 500);
  }

  const { error: recipientsError } = await supabase.from('document_publication_recipients').insert(
    recipients.map((item) => ({
      publication_id: publication.id,
      recipient_user_id: item.userId,
      source_type: item.sourceType,
      source_value: item.sourceValue,
    })),
  );

  if (recipientsError) {
    await supabase.from('document_publications').delete().eq('id', publication.id);
    throw new PublicationsRouteError(recipientsError.message, 500);
  }

  return publication;
}

export async function getPublicationStatus(publicationId: string) {
  requirePublicationId(publicationId);

  const supabase = getSupabaseOrThrow();

  const { data: publication, error: publicationError } = await supabase
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

  if (publicationError) {
    throw new PublicationsRouteError(publicationError.message, 500);
  }

  if (!publication) {
    throw new PublicationsRouteError('publication_not_found', 404);
  }

  const { data: recipients, error: recipientsError } = await supabase
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

  if (recipientsError) {
    throw new PublicationsRouteError(recipientsError.message, 500);
  }

  const { data: receipts, error: receiptsError } = await supabase
    .from('document_publication_receipts')
    .select('user_id, first_opened_at, last_opened_at, approved_at, approval_note')
    .eq('publication_id', publicationId);

  if (receiptsError) {
    throw new PublicationsRouteError(receiptsError.message, 500);
  }

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
  const isComplete = (item: { firstOpenedAt: string | null; approvedAt: string | null }) => !!item.approvedAt || (!requiresApproval && !!item.firstOpenedAt);

  const summary = {
    total: items.length,
    unread: items.filter((item) => !item.firstOpenedAt).length,
    read: items.filter((item) => !!item.firstOpenedAt && !isComplete(item)).length,
    approved: items.filter((item) => isComplete(item)).length,
  };

  return { publication, summary, items };
}

export async function listMyPublicationAssignments(userId: string) {
  const supabase = getSupabaseOrThrow();

  const { data, error } = await supabase
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
    .eq('recipient_user_id', userId)
    .is('document_publications.archived_at', null)
    .order('created_at', { ascending: false });

  if (error) {
    throw new PublicationsRouteError(error.message, 500);
  }

  const publicationIds = (data || []).map((row: any) => row.publication_id).filter(Boolean);
  let receiptMap = new Map<string, any>();

  if (publicationIds.length > 0) {
    const { data: receipts, error: receiptsError } = await supabase
      .from('document_publication_receipts')
      .select('publication_id, first_opened_at, last_opened_at, approved_at, approval_note')
      .eq('user_id', userId)
      .in('publication_id', publicationIds);

    if (receiptsError) {
      throw new PublicationsRouteError(receiptsError.message, 500);
    }

    receiptMap = new Map((receipts || []).map((receipt: any) => [receipt.publication_id as string, receipt]));
  }

  return (data || []).map((row: any) => {
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
      receipt: receipt
        ? {
            firstOpenedAt: receipt.first_opened_at || null,
            lastOpenedAt: receipt.last_opened_at || null,
            approvedAt: receipt.approved_at || null,
            approvalNote: receipt.approval_note || null,
          }
        : null,
    };
  });
}

export async function markPublicationOpenedForUser(sessionSupabase: PublicationsSessionClient, publicationId: string, userId: string) {
  requirePublicationId(publicationId);
  await ensurePublicationRecipient(sessionSupabase, publicationId, userId);
  await upsertPublicationReceipt(sessionSupabase, { publicationId, userId });
}

export async function approvePublicationForUser(
  sessionSupabase: PublicationsSessionClient,
  params: {
    publicationId: string;
    userId: string;
    input: ApprovePublicationInput;
  },
) {
  requirePublicationId(params.publicationId);
  await ensurePublicationRecipient(sessionSupabase, params.publicationId, params.userId);
  await upsertPublicationReceipt(sessionSupabase, {
    publicationId: params.publicationId,
    userId: params.userId,
    approvalNote: params.input.approvalNote,
    markApproved: true,
  });
}

export async function createPublicationOpenRedirectUrl(sessionSupabase: PublicationsSessionClient, publicationId: string) {
  requirePublicationId(publicationId);

  const { data: publication, error: publicationError } = await sessionSupabase
    .from('document_publications')
    .select('file_id')
    .eq('id', publicationId)
    .maybeSingle();

  if (publicationError) {
    throw new PublicationsRouteError(publicationError.message, 500);
  }

  if (!publication?.file_id) {
    throw new PublicationsRouteError('file_not_found', 404);
  }

  const { data: file, error: fileError } = await sessionSupabase
    .from('documents_files')
    .select('storage_bucket, storage_path, file_name')
    .eq('id', publication.file_id)
    .maybeSingle();

  if (fileError) {
    throw new PublicationsRouteError(fileError.message, 500);
  }

  if (!file) {
    throw new PublicationsRouteError('file_not_found', 404);
  }

  const admin = getSupabaseOrThrow();
  const { data: signed, error: signedError } = await admin.storage
    .from(String((file as any).storage_bucket))
    .createSignedUrl(String((file as any).storage_path), 60 * 30);

  if (signedError || !signed?.signedUrl) {
    throw new PublicationsRouteError(signedError?.message || 'failed_signed_url', 500);
  }

  return signed.signedUrl;
}