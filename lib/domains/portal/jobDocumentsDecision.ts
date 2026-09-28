import type { SupabaseClient } from '@supabase/supabase-js';
import { portalJobDocumentKey, type PortalJobDocumentKind } from './jobDocuments';

/**
 * Vilket dokument vinner (RESELLER_PORTAL_CRM_PLAN.md fas 7)? Det senast BESLUTADE och FRYSTA av sin sort på jobbet, som
 * kortet visar det. Regeln står EN gång, här, och används av köandet (queueReady), av automatiken (buildAutomatic) och av
 * utskicket (preparePortalPayload): utskicket prövar precis före sändningen, eftersom kön ersätter i den ordning
 * händelserna kom och en äldre kan ha köats efter en nyare.
 *
 * Ett beslut som bara byggs räknas inte (faller det hade butiken inget fått). Ett fryst räknas också när dess händelse
 * senare gavs upp, oavsett varför (portalen nekade, filen stämde inte, två dygn utan svar): då syns det som "Kom inte
 * fram" på kortet, och knappen där skickar ett NYTT beslut, som alltid köas på nytt (portalsidans "Skicka om" kan nekas
 * när jobbet har senare händelser). Att tyst falla tillbaka på en äldre version hade kunnat ge butiken inaktuellt
 * innehåll, och kortet hade visat ett dokument som butiken inte har.
 *
 * Två beslut i samma mikrosekund (created_at) räknas inte som senare än varandra; båda skickas, i köordning.
 */
export async function hasNewerFrozenDocument(
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
    .limit(1);
  if (later.error) throw new Error(`Senare dokument gick inte att läsa: ${later.error.message}`);
  return (later.data ?? []).length > 0;
}

/**
 * Ett nytt dokument har köats: äldre BESLUT av samma sort som ännu väntar i kön behöver aldrig fram (butiken behåller
 * det senast mottagna). Samma sak som köns supersedeKey gjorde, men i beslutsordning: en äldre som köas sent ersätter
 * aldrig en nyare, eftersom bara äldre beslut än det nya rörs. Bara väntande händelser; en som redan skickas går fram, och
 * den nya kommer efter. De senaste äldre först, om det någon gång skulle finnas fler än gränsen.
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
    .order('created_at', { ascending: false })
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
