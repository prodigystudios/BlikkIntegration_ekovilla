import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { getTimeApproval, isPeriodLocked, periodStartOf, statusOf, type TimeApprovalRow } from '@/lib/domains/time/approvals';
import {
  buildReceiptPath,
  createReceiptUploadUrl,
  getReceiptBucket,
  validateReceiptFile,
} from '@/lib/domains/time/receipts';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { ok, receiptUploadUrlSchema, requirePermission, routeError, validationError } from '../../_lib';

// nodejs: myntandet sker med service-role-nyckeln.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Steg 1 av tre i kvittouppladdningen. Här skapas INGEN databasrad och ingen koppling — bara en
// engångs-URL som klienten laddar upp till. Ett avbrutet formulär lämnar därför aldrig ett tomt
// utlägg i löneunderlaget; det lämnar på sin höjd ett oåtkomligt objekt i en privat bucket.
//
// STATISK SEGMENT FÖRE [id] MED FLIT: sökvägen bär ingen postidentitet, för posten finns inte än när
// kvittot fotograferas. Ägaren är den enda identitet som behövs, och den tas ur sessionen — aldrig
// ur kroppen.
export async function POST(req: Request) {
  try {
    // Samma grind som att skapa själva posten. Den som inte får rapportera tid ska inte heller kunna
    // lägga objekt i bucketen.
    const gate = await requirePermission('time.entry.write');
    if (gate.response || !gate.currentUser) return gate.response;

    const parsed = receiptUploadUrlSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);

    // Avvisa det uppenbart felaktiga innan användaren betalar för uppladdningen över mobilnätet.
    // Påståendena är inte att lita på — steg 3 läser filens faktiska storlek och typ ur lagringen —
    // men en fil som redan på pappret är 40 MB ska stoppas här.
    const claimError = validateReceiptFile({
      size: parsed.data.size_bytes,
      type: parsed.data.content_type,
      name: parsed.data.file_name,
    });
    if (claimError) return routeError(400, 'time_receipt_invalid', claimError);

    // Periodlåset, i förväg. Databasen stoppar skrivningen i steg 3 ändå — det är den spärr som
    // gäller — men utan den här kontrollen laddar användaren upp ett kvitto över mobilnätet och får
    // sitt "månaden är inlämnad" EFTERÅT, med bytena redan betalda och ett objekt kvar i bucketen.
    const supabase = createRouteHandlerClient({ cookies });
    const approval = await getTimeApproval(supabase, gate.currentUser.id, periodStartOf(parsed.data.entry_date));
    // statusOf och inte en rå kolumnläsning: en period utan attestrad är 'open', och den
    // normaliseringen ska ske på samma ställe som överallt annars.
    const status = statusOf(approval.data as Pick<TimeApprovalRow, 'status'> | null);
    if (isPeriodLocked(status)) {
      return routeError(
        409,
        'time_period_locked',
        status === 'approved'
          ? 'Perioden är attesterad och kan inte ändras. Be en attestansvarig öppna den.'
          : 'Perioden är inlämnad. Ångra inlämningen först om du behöver ändra.',
      );
    }

    const bucket = getReceiptBucket();
    // Ägarens id ligger i sökvägen — se buildReceiptPath. Det är spärren som gör att ingen kan spela
    // tillbaka en annans objektsökväg till bekräftelsesteget och få den kopplad till sitt utlägg.
    const path = buildReceiptPath(gate.currentUser.id, parsed.data.file_name, crypto.randomUUID());

    const { signedUrl, token, error } = await createReceiptUploadUrl(getSupabaseAdmin(), bucket, path);
    if (error || !signedUrl || !token) {
      return routeError(500, 'time_receipt_upload_url_failed', error?.message || 'Kunde inte skapa uppladdningslänk.');
    }

    return ok({ bucket, path, token, signed_url: signedUrl });
  } catch (e: any) {
    return routeError(500, 'time_receipt_upload_url_unexpected', e?.message || 'Kunde inte förbereda uppladdningen');
  }
}
