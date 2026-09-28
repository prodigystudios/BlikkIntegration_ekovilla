import type { SupabaseClient } from '@supabase/supabase-js';
import { portalJobDocumentKey, type PortalJobDocumentKind } from './jobDocuments';

/**
 * Vilket dokument vinner (RESELLER_PORTAL_CRM_PLAN.md fas 7)? Det senast BESLUTADE av sin sort på jobbet, som kortet
 * visar det. Regeln står EN gång, här, och används av köandet (queueReady) och av utskicket (preparePortalPayload):
 * utskicket prövar precis före sändningen, eftersom kön ersätter i den ordning händelserna kom och en äldre kan ha
 * köats efter en nyare.
 *
 * Ett senare beslut räknas när det är FRYST och på väg: ingen händelse i kön än (köandet kommer inom någon minut, cron
 * tar det annars) eller en händelse som inte getts upp. Ett beslut som bara byggs räknas inte: faller det har butiken
 * inget. En senare som getts upp räknas inte heller: butiken fick den aldrig, och då ska den äldre fram.
 *
 * Två beslut i samma mikrosekund (created_at) räknas inte som senare än varandra; båda skickas, i köordning.
 */
export async function hasNewerLiveDocument(
  admin: SupabaseClient,
  doc: { quoteId: string; kind: PortalJobDocumentKind | string; createdAt: string },
): Promise<boolean> {
  const later = await admin
    .from('crm_portal_job_documents')
    .select('id')
    .eq('quote_id', doc.quoteId)
    .eq('kind', doc.kind)
    .eq('status', 'ready')
    .gt('created_at', doc.createdAt)
    .order('created_at', { ascending: false })
    .limit(20);
  if (later.error) throw new Error(`Senare dokument gick inte att läsa: ${later.error.message}`);
  const ids = ((later.data ?? []) as { id: string }[]).map((r) => r.id);
  if (ids.length === 0) return false;

  const events = await admin
    .from('portal_outbound_events')
    .select('idempotency_key, status')
    .in('idempotency_key', ids.map(portalJobDocumentKey));
  if (events.error) throw new Error(`De senare dokumentens status gick inte att läsa: ${events.error.message}`);
  const status = new Map(((events.data ?? []) as { idempotency_key: string; status: string }[]).map((e) => [e.idempotency_key, e.status]));
  return ids.some((id) => status.get(portalJobDocumentKey(id)) !== 'dead');
}

/**
 * Ett nytt dokument har köats: äldre BESLUT av samma sort som ännu väntar i kön behöver aldrig fram (butiken behåller
 * det senast mottagna). Samma sak som köns supersedeKey gjorde, men i beslutsordning: en äldre som köas sent ersätter
 * aldrig en nyare, eftersom bara äldre beslut än det nya rörs. Bara väntande händelser; en som redan skickas går fram, och
 * den nya kommer efter.
 */
export async function supersedeOlderDocuments(
  admin: SupabaseClient,
  doc: { id: string; quoteId: string; kind: PortalJobDocumentKind | string; createdAt: string },
): Promise<void> {
  const older = await admin
    .from('crm_portal_job_documents')
    .select('id')
    .eq('quote_id', doc.quoteId)
    .eq('kind', doc.kind)
    .eq('status', 'ready')
    .lt('created_at', doc.createdAt)
    .limit(100);
  if (older.error) throw new Error(`Äldre dokument gick inte att läsa: ${older.error.message}`);
  const keys = ((older.data ?? []) as { id: string }[]).map((r) => portalJobDocumentKey(r.id));
  if (keys.length === 0) return;
  const { error } = await admin
    .from('portal_outbound_events')
    .update({ status: 'superseded', last_error: 'dokumentet: ersatt av ett senare' })
    .in('idempotency_key', keys)
    .eq('status', 'pending');
  if (error) throw new Error(`Äldre dokument kunde inte ersättas: ${error.message}`);
}
