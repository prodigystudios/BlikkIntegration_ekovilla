import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import {
  compensationConstraintError,
  createCompensation,
  findCompensationByReceiptPath,
  listCompensations,
  type CompensationReceiptPatch,
} from '@/lib/domains/time/compensations';
import { getReceiptBucket, isReceiptPath, removeReceiptObject, resolveReceiptAttachment } from '@/lib/domains/time/receipts';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { createCompensationSchema, ok, periodLockError, rangeQuerySchema, requirePermission, requireSignedInUser, routeError, validationError } from '../_lib';

// nodejs: kvittots objekt läses och städas med service-role-nyckeln.
export const runtime = 'nodejs';

// Traktamenten, utlägg och milersättning. Egna poster med eget datum — de hör inte till ett visst
// arbetspass, och ett utlägg kan finnas en dag man inte jobbat.
//
// Samma avgränsning som tidraderna: RLS ger den egna raden, time.entry.read.all ger allas.

export async function GET(req: Request) {
  try {
    const user = await requireSignedInUser();
    if (user.response || !user.currentUser) return user.response;

    const url = new URL(req.url);
    const parsed = rangeQuerySchema.safeParse({ from: url.searchParams.get('from'), to: url.searchParams.get('to') });
    if (!parsed.success) return validationError(parsed.error);
    if (parsed.data.from > parsed.data.to) return routeError(400, 'invalid_range', 'Från-datum är efter till-datum');

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await listCompensations(supabase, parsed.data, { userId: user.currentUser.id });
    if (error) return routeError(500, 'time_compensations_list_failed', error.message);

    return ok({ items: data ?? [] });
  } catch (e: any) {
    return routeError(500, 'time_compensations_unexpected', e?.message || 'Kunde inte hämta ersättningar');
  }
}

// Steg 3 av tre när ett kvitto följer med: klienten har laddat upp och rapporterar var filen hamnade.
//
// ⚠️ MISSLYCKAS SKRIVNINGEN MÅSTE OBJEKTET BORT. Kvittot ligger redan i bucketen när vi kommer hit —
// utan städningen lämnar varje låst period, varje momsfel och varje nätverkshaveri en bild som ingen
// rad pekar på och som ingen någonsin kan nå. `uploadedPath` nollas så fort ansvaret övergått till
// en sparad rad, så ingen felgren kan råka radera ett kvitto som faktiskt hör till något.
export async function POST(req: Request) {
  const bucket = getReceiptBucket();
  let uploadedPath: string | null = null;

  try {
    const gate = await requirePermission('time.entry.write');
    if (gate.response || !gate.currentUser) return gate.response;

    const parsed = createCompensationSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);

    const { receipt, ...input } = parsed.data;
    const isExpense = parsed.data.kind === 'expense';

    // Utlägg har ingen kvantitet — beloppet är hela sanningen där. Skickas en ändå nollas den, så
    // "3 utlägg" inte råkar bli en siffra någon summerar.
    const quantity = isExpense ? null : (parsed.data.quantity ?? null);
    // Beloppet är utläggets, precis som kvantiteten är milersättningens. Traktamente och
    // milersättning ersätts med fasta satser lönebyrån äger, så ett belopp på dem vore en gissning
    // som går rakt in i löneunderlaget — det nollas i stället för att sparas. Samma tysta nollning
    // som ovan: ett fält som inte betyder något på sorten ska inte gå att fylla i via API:et heller.
    const amount = isExpense ? (parsed.data.amount ?? 0) : 0;

    // Moms och kvitto hör till utlägget och bara dit: traktamente räknas i dagar och milersättning i
    // mil, och ingen av dem bär moms eller papper. Samma nollning som quantity, av samma skäl — ett
    // fält som inte betyder något på sorten ska inte gå att fylla i via API:et heller.
    const vatAmount = isExpense ? (parsed.data.vat_amount ?? null) : null;

    const supabase = createRouteHandlerClient({ cookies });

    let receiptColumns: Partial<CompensationReceiptPatch> = {};
    if (receipt && isExpense) {
      // Redan kopplad? Då bär en annan post objektet och det får inte röras. Svara INNAN
      // `uploadedPath` sätts, så ingen felgren nedanför kan städa bort någon annans kvitto.
      const { data: taken } = await findCompensationByReceiptPath(supabase, receipt.storage_path);
      if (taken) return routeError(409, 'time_receipt_already_used', 'Kvittot är redan kopplat till ett annat utlägg.');

      const resolved = await resolveReceiptAttachment(getSupabaseAdmin(), bucket, gate.currentUser.id, receipt);
      if (!resolved.ok) return routeError(resolved.status, 'time_receipt_invalid', resolved.error);

      uploadedPath = receipt.storage_path;
      receiptColumns = resolved.columns;
    } else if (receipt && isReceiptPath(receipt.storage_path, gate.currentUser.id)) {
      // Ett kvitto på en milersättning är inte ett fel värt att avbryta på — men objektet ska inte
      // bli liggande bara för att det inte hörde hemma.
      //
      // ⚠️ isReceiptPath ÄR INTE VALFRI HÄR. removeReceiptObject kör med service-role och frågar
      // inte vem som äger objektet. Utan kontrollen räcker det med en POST av sorten
      // {kind:"travel", receipt:{storage_path:"Arbetsorder/…/ritning.pdf"}} för att vem som helst
      // med time.entry.write ska radera vad som helst i den delade bucketen — arbetsorderfiler,
      // dokumentbiblioteket, andras kvitton — och få 201 tillbaka. Sökvägen kommer RAKT UR
      // KROPPEN på den här grenen, till skillnad från grenen ovanför där resolveReceiptAttachment
      // redan prövat den. Städningen är destruktiv och får bara röra användarens egen katalog.
      await removeReceiptObject(getSupabaseAdmin(), bucket, receipt.storage_path);
    }

    // Två krav som gör att en post alltid BÄR något. De speglar varandra: det utlägget säger med
    // sitt belopp säger milersättningen med sitt antal, och utan sitt fält är posten tom.
    //
    // ⚠️ Kvantitetskravet är NYTT (2026-09-01) och kom med att beloppsfältet försvann. Innan dess
    // bar en milersättning utan antal åtminstone ett belopp; nu hade den varit en rad som bara säger
    // "en milersättning, någon gång" — omöjlig att ersätta och omöjlig att ifrågasätta.
    //
    // ⚠️ LIGGER EFTER KVITTOBLOCKET, INTE FÖRE. Ovanför har `uploadedPath` satts (eller objektet
    // redan städats av grenen för fel sort), så städningen i `finally` täcker de här utgångarna.
    // Låg kontrollerna före — vilket de gjorde i första utkastet — lämnade ett avvisat anrop med
    // bifogat kvitto en bild i bucketen som ingen rad pekar på och ingen kan nå, med kvittots
    // personuppgifter kvar. Samma fälla som filens rubrikkommentar varnar för.
    if (isExpense && !(amount > 0)) {
      return routeError(400, 'time_compensation_amount_required', 'Ange ett belopp i kronor för utlägget.');
    }
    if (!isExpense && !(Number(quantity) > 0)) {
      const unit = parsed.data.kind === 'travel' ? 'antal mil' : 'antal dagar';
      return routeError(400, 'time_compensation_quantity_required', `Ange ${unit}.`);
    }

    const { data, error } = await createCompensation(supabase, gate.currentUser.id, {
      ...input,
      quantity,
      amount,
      vat_amount: vatAmount,
      ...receiptColumns,
    });
    if (error) {
      // Ersättningar fryser med perioden precis som timmarna — de är också löneunderlag.
      const locked = periodLockError(error);
      if (locked) return routeError(locked.status, locked.code, locked.message);
      // 23505 = unika indexet på receipt_path. Då vann någon annan kapplöpningen om samma sökväg och
      // objektet tillhör DERAS rad — städa inte, det vore att radera ett kvitto som just sparats.
      if ((error as { code?: string }).code === '23505') {
        uploadedPath = null;
        return routeError(409, 'time_receipt_already_used', 'Kvittot är redan kopplat till ett annat utlägg.');
      }
      const constraint = compensationConstraintError(error);
      if (constraint) return routeError(constraint.status, constraint.code, constraint.message);
      return routeError(500, 'time_compensation_create_failed', error.message);
    }

    uploadedPath = null;
    return ok({ item: data }, 201);
  } catch (e: any) {
    return routeError(500, 'time_compensation_create_unexpected', e?.message || 'Kunde inte spara ersättningen');
  } finally {
    // Ligger sökvägen kvar har raden aldrig skrivits — oavsett vilken gren vi lämnade via.
    if (uploadedPath) await removeReceiptObject(getSupabaseAdmin(), bucket, uploadedPath);
  }
}
