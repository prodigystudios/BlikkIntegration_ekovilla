import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { getCompensationReceiptRef, type CompensationReceiptRef } from '@/lib/domains/time/compensations';
import { getReceiptBucket, signReceiptUrl } from '@/lib/domains/time/receipts';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { invalidUuidParam, ok, requireSignedInUser, routeError } from '../../../_lib';

// nodejs: signeringen sker med service-role-nyckeln.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: { id: string } };

/**
 * Öppna kvittot på ett utlägg.
 *
 * EN ROUTE FÖR BÅDA LÄSARNA: den anställde i /tid och attestansvarig i /admin/tid. Skillnaden dem
 * emellan görs inte här utan av RLS på crm_time_compensations — man ser sitt eget, den med
 * time.entry.read.all ser allas. Två routes hade betytt två behörighetsbeslut om samma fil, och det
 * är precis så de glider isär.
 *
 * ⚠️ ORDNINGEN ÄR SÄKERHETEN. Raden läses med SESSIONSKLIENTEN, så policyn avgör om den här
 * användaren över huvud taget får se utlägget. Först därefter signerar vi med service-role. Att
 * signera först och kontrollera sedan hade gjort varje giltigt id till en läsbar bild.
 *
 * `?redirect=1` ger en 302 till den signerade URL:en i stället för JSON. Det är formen som duger som
 * href: länken går aldrig ut, eftersom åtkomsten prövas om vid varje klick. En signerad URL som
 * bakats in i listsvaret hade i stället dött efter 30 minuter och lämnat en trasig bild i en flik
 * kontoret haft uppe hela förmiddagen.
 *
 * `?download=1` sätter Content-Disposition: attachment via den signerade URL:en, med kvittots
 * riktiga filnamn — lagringsnyckeln är sanerad till ASCII och duger inte att spara under.
 *
 * SELECT-policyn bär inget periodlås, med flit: att TITTA på ett kvitto i en attesterad månad är
 * precis vad kontoret ska göra.
 */
export async function GET(req: Request, context: RouteContext) {
  try {
    const currentUser = await requireSignedInUser();
    if (currentUser.response) return currentUser.response;

    const badId = invalidUuidParam(context.params.id);
    if (badId) return badId;

    const { searchParams } = new URL(req.url);
    const wantsRedirect = searchParams.get('redirect') === '1';
    const wantsDownload = searchParams.get('download') === '1';

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await getCompensationReceiptRef(supabase, context.params.id);
    if (error) return routeError(500, 'time_receipt_read_failed', error.message);

    const row = (data as CompensationReceiptRef | null) ?? null;
    // Samma svar för "posten finns inte", "du får inte se den" och "den har inget kvitto". De två
    // första är RLS-frågor som inte ska gå att skilja åt utifrån; den tredje är ett normalt tillstånd
    // (utlägg utan kvitto går att spara) och inget att lägga en egen felkod på.
    if (!row?.receipt_path) return routeError(404, 'time_receipt_not_found', 'Kvittot hittades inte.');

    const url = await signReceiptUrl(
      getSupabaseAdmin(),
      row.receipt_bucket || getReceiptBucket(),
      row.receipt_path,
      wantsDownload ? row.receipt_name || 'kvitto' : undefined,
    );
    if (!url) return routeError(500, 'time_receipt_sign_failed', 'Kunde inte skapa en länk till kvittot.');

    if (wantsRedirect) return NextResponse.redirect(url, { status: 302 });

    return ok({ url, file_name: row.receipt_name, content_type: row.receipt_content_type });
  } catch (e: any) {
    return routeError(500, 'time_receipt_unexpected', e?.message || 'Kunde inte hämta kvittot');
  }
}
