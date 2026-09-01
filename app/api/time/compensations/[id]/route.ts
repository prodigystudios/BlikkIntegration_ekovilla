import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import {
  compensationConstraintError,
  deleteCompensation,
  findCompensationByReceiptPath,
  getCompensationReceiptRef,
  updateCompensation,
  EMPTY_RECEIPT,
  type CompensationReceiptRef,
} from '@/lib/domains/time/compensations';
import { getReceiptBucket, isReceiptPath, removeReceiptObject, resolveReceiptAttachment } from '@/lib/domains/time/receipts';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { explainWriteMiss, invalidUuidParam, ok, periodLockError, requirePermission, routeError, updateCompensationSchema, validationError } from '../../_lib';

// nodejs: kvittots objekt läses och städas med service-role-nyckeln.
export const runtime = 'nodejs';

type RouteContext = { params: { id: string } };

// Kvittot på en post som redan finns — den vanligaste vägen i praktiken. Man rapporterar utlägget på
// plats och fotograferar kvittot när man kommer in i bilen; att tvinga fram båda i samma ögonblick
// hade gjort att det ena blev ogjort.
//
// ERSÄTTNING, INTE TILLÄGG: en post bär ett kvitto (se migreringens huvud). Kopplas ett nytt till en
// post som redan har ett, tas det gamla objektet bort EFTER att raden pekat om — annars kan en
// misslyckad skrivning lämna posten med en sökväg till en bild som just raderats.

export async function PATCH(req: Request, context: RouteContext) {
  try {
    const gate = await requirePermission('time.entry.write');
    if (gate.response || !gate.currentUser) return gate.response;

    const badId = invalidUuidParam(context.params.id);
    if (badId) return badId;

    const rawBody = await req.json().catch(() => null);
    const parsed = updateCompensationSchema.safeParse(rawBody);
    if (!parsed.success) return validationError(parsed.error);

    // Skriv bara det klienten faktiskt skickade — Zod fyller i defaults för utelämnade fält, och att
    // spara dem skulle nolla kolumner ingen rörde. Samma regel som pickProvidedFields i CRM.
    const sentKeys = rawBody && typeof rawBody === 'object' && !Array.isArray(rawBody) ? Object.keys(rawBody) : [];
    const patch = Object.fromEntries(Object.entries(parsed.data).filter(([key]) => sentKeys.includes(key)));
    if ((patch as { kind?: string }).kind === 'expense') (patch as Record<string, unknown>).quantity = null;

    const supabase = createRouteHandlerClient({ cookies });

    // Kvittot är inte ett vanligt fält: kroppens `receipt` är ett PÅSTÅENDE om ett objekt i
    // lagringen och blir sex kolumner först efter att sökvägen prövats mot ägaren och objektet
    // lästs. Plocka därför bort det ur patchen innan den går vidare.
    delete (patch as Record<string, unknown>).receipt;
    const receipt = (parsed.data as { receipt?: { storage_path: string; file_name: string } | null }).receipt;
    const wantsReceipt = sentKeys.includes('receipt') && !!receipt;

    const changesKind = sentKeys.includes('kind');
    const leavingExpense = changesKind && (patch as { kind?: string }).kind !== 'expense';
    // ⚠️ `amount` KOM MED HIT 2026-09-01, när beloppsfältet blev utläggets ensak (carriesAmount).
    // Innan dess var beloppet gemensamt för alla sorter och en ren beloppsrättelse behövde ingen
    // radläsning. Nu är det samma sorts fält som momsen, och lämnas det utanför räcker ett
    // handskrivet `PATCH {"amount": 500}` för att sätta ett belopp på en milersättning som lönen
    // redan ersätter med fast sats — dubbel ersättning, och inget i databasen som hindrar det.
    const touchesExpenseOnly =
      sentKeys.includes('vat_amount') || sentKeys.includes('amount') || sentKeys.includes('receipt');

    /**
     * ⚠️ RADEN LÄSES FÖRE SKRIVNINGEN, av två skäl som båda kräver det.
     *
     * 1. SORTEN. Belopp, moms och kvitto hör till utlägg och bara dit. POST kan avgöra det ur
     *    kroppen, men en PATCH som bara skickar `{"vat_amount": 50}` säger ingenting om vilken sorts
     *    post den träffar — utan den här läsningen hamnar momsen på en milersättning, renderas som
     *    "varav moms" i attesten och summeras in i den sortens momstotal. Databasen har inget
     *    villkor som hindrar det; regeln bor i routen och måste därför också kontrolleras här.
     * 2. DET GAMLA KVITTOT. Efter skrivningen är sökvägen borta ur raden och bilden vore omöjlig att
     *    hitta igen — den hade blivit liggande i bucketen för alltid, med kvittots personuppgifter,
     *    utan att någon rad pekar på den.
     *
     * Läses BARA när något av det spelar roll — en patch som bara flyttar datum eller anteckning
     * ska inte kosta en extra rundtur till databasen. Beloppet låg i den billiga kategorin fram
     * till 2026-09-01; se noten vid touchesExpenseOnly för varför det inte längre går.
     */
    let oldReceipt: CompensationReceiptRef | null = null;
    let currentKind: string | null = null;
    if (touchesExpenseOnly || leavingExpense) {
      const { data: current } = await getCompensationReceiptRef(supabase, context.params.id, { userId: gate.currentUser.id });
      oldReceipt = (current as CompensationReceiptRef | null) ?? null;
      currentKind = (current as { kind?: string } | null)?.kind ?? null;
    }

    // Sorten posten HAMNAR på. Okänd (raden finns inte, eller är inte vår) lämnas därhän — då svarar
    // uppdateringen 404 om en stund ändå, och att gissa här hade bara gett ett sämre felmeddelande.
    const nextKind = changesKind ? ((patch as { kind?: string }).kind ?? null) : currentKind;
    const notExpense = nextKind !== null && nextKind !== 'expense';

    // Skickas moms eller belopp ändå nollas de, precis som quantity på ett utlägg. Tyst och inte som
    // ett fel: samma val som POST gör, och en avvikelse hade betytt två regler för samma sak.
    //
    // Beloppet nollas till 0 och inte till null — kolumnen är `not null` i databasen.
    if (notExpense && sentKeys.includes('vat_amount')) (patch as Record<string, unknown>).vat_amount = null;
    if (notExpense && sentKeys.includes('amount')) (patch as Record<string, unknown>).amount = 0;

    // Byter posten sort BORT från utlägg faller belopp, moms OCH kvitto med den.
    if (leavingExpense) {
      (patch as Record<string, unknown>).vat_amount = null;
      // ⚠️ Måste falla SAMTIDIGT med momsen. Villkoret crm_time_compensations_vat_amount_chk kräver
      // moms <= belopp, så ett kvarlämnat belopp med nollad moms är förvisso lagligt — men raden
      // hade blivit en milersättning som bär utläggets kronor och ersätts två gånger.
      (patch as Record<string, unknown>).amount = 0;
      // EMPTY_RECEIPT och inte sex handskrivna nollor: alla kolumner måste falla samtidigt, annars
      // blir raden kvar med ett receipt_name utan objekt bakom — en post som ser styrkt ut och vars
      // "Visa kvitto" ger 404.
      Object.assign(patch, EMPTY_RECEIPT);
    }

    const bucket = getReceiptBucket();
    let uploadedPath: string | null = null;

    if (wantsReceipt && receipt) {
      if (notExpense) {
        // Objektet ligger redan i bucketen. Utan städningen blir varje felriktat kvitto en oåtkomlig
        // bild med personuppgifter — samma hantering som POST gör på sin motsvarande gren.
        // isReceiptPath först: removeReceiptObject kör med service-role och får bara röra den egna
        // katalogen. Sökvägen är oprövad här, eftersom resolveReceiptAttachment inte hunnit köra.
        if (isReceiptPath(receipt.storage_path, gate.currentUser.id)) {
          await removeReceiptObject(getSupabaseAdmin(), bucket, receipt.storage_path);
        }
        return routeError(400, 'time_receipt_wrong_kind', 'Bara utlägg kan bära kvitto.');
      }

      const { data: taken } = await findCompensationByReceiptPath(supabase, receipt.storage_path);
      // Egen post, samma sökväg = ingenting att göra. Att svara 409 där hade gjort ett ofarligt
      // omtag (dubbeltryck, tappad uppkoppling) till ett fel användaren måste tolka.
      if (taken && taken.id !== context.params.id) {
        return routeError(409, 'time_receipt_already_used', 'Kvittot är redan kopplat till ett annat utlägg.');
      }

      const resolved = await resolveReceiptAttachment(getSupabaseAdmin(), bucket, gate.currentUser.id, receipt);
      if (!resolved.ok) return routeError(resolved.status, 'time_receipt_invalid', resolved.error);

      uploadedPath = receipt.storage_path;
      Object.assign(patch, resolved.columns);
    }

    /**
     * ⚠️ VAD FÅR STÄDAS BORT OM SKRIVNINGEN MISSLYCKAS?
     *
     * Bara ett objekt som (a) vi själva just laddade upp och (b) ingen rad äger. Villkoret nedan är
     * hela skillnaden, och det finns för att omtaget är tillåtet: routen godtar med flit att samma
     * sökväg skickas igen för en post som redan bär den (dubbeltryck, tappad uppkoppling). I det
     * läget pekar den SPARADE raden på objektet — och en misslyckad uppdatering strax efter, till
     * exempel för att månaden hann låsas, hade då raderat kvittot ur en rad som fortfarande
     * refererar det.
     */
    const orphanedOnFailure = uploadedPath !== null && uploadedPath !== oldReceipt?.receipt_path;

    // ⚠️ EFTER kvittohanteringen, inte före. `receipt` är det enda fältet som lämnar patchen tommare
    // än det kom in: en kropp som bara innehåller `{"receipt": null}` ser ut som en uppdatering på
    // vägen in men är ingenting på vägen ut, och en `.update({})` mot PostgREST är inte något att
    // skicka. Kontrollen här fångar båda fallen med samma rad.
    if (Object.keys(patch).length === 0) return routeError(400, 'time_compensation_empty_patch', 'Inget att uppdatera');

    /**
     * Samma två krav som POST ställer: en post måste BÄRA något — utlägget sitt belopp, de fasta
     * sorterna sitt antal. Här gäller det bara de fält patchen faktiskt skickade, så en post inte
     * kan patchas tom på det som är hela dess innehåll.
     *
     * ⚠️ Prövas BARA när sorten är känd, alltså när raden lästs (se touchesExpenseOnly). En patch
     * som bara skickar `{"quantity": 0}` rör inget sortberoende fält, raden läses inte, och då vet vi
     * inte om nollan landar på en milersättning eller ett utlägg — den släpps igenom. Vägen finns
     * inte i något gränssnitt, och att läsa raden för varje kvantitetsändring vore en rundtur för
     * ett fall ingen kan nå av misstag. Databasen håller ändå `quantity >= 0`.
     *
     * ⚠️ STÄDAR KVITTOT SJÄLV. PATCH har inget `finally` som POST — varje felgren ansvarar för det
     * objekt den lämnar bakom sig, och `orphanedOnFailure` säger vilket som får röras.
     */
    const sentAmount = sentKeys.includes('amount') ? Number((patch as { amount?: unknown }).amount) : null;
    const sentQuantity = sentKeys.includes('quantity') ? Number((patch as { quantity?: unknown }).quantity) : null;

    /**
     * ⚠️ ETT SORTBYTE MÅSTE TA MED SIG DEN NYA SORTENS BÄRANDE FÄLT.
     *
     * Ett skickat värde prövas alltid, men bytet ställer ett krav till: att fältet över huvud taget
     * kommer med. Utan det landar posten tom, och båda vägarna dit är korta —
     * `PATCH {"kind":"travel"}` på ett utlägg nollar beloppet (leavingExpense) och ärver
     * kvantiteten `null` som utlägg alltid har, och `PATCH {"kind":"expense"}` på en milersättning
     * nollar kvantiteten och ärver beloppet 0. Båda ger en rad POST hade avvisat.
     *
     * Kravet kostar ingen extra läsning: sorten posten HAMNAR på står i kroppen vid ett byte.
     */
    const wantsAmount = nextKind === 'expense';
    const amountMissing = wantsAmount && (sentAmount === null ? changesKind : !(sentAmount > 0));
    const quantityMissing = notExpense && (sentQuantity === null ? changesKind : !(sentQuantity > 0));
    const bearingError = amountMissing
      ? { code: 'time_compensation_amount_required', message: 'Ange ett belopp i kronor för utlägget.' }
      : quantityMissing
        ? {
            code: 'time_compensation_quantity_required',
            message: nextKind === 'travel' ? 'Ange antal mil.' : 'Ange antal dagar.',
          }
        : null;
    if (bearingError) {
      if (orphanedOnFailure) await removeReceiptObject(getSupabaseAdmin(), bucket, uploadedPath!);
      return routeError(400, bearingError.code, bearingError.message);
    }

    const { data, error } = await updateCompensation(supabase, context.params.id, gate.currentUser.id, patch);
    if (error) {
      // 23505 = kapplöpningen mot unika indexet. Objektet bärs nu av NÅGON ANNANS rad, så det får
      // inte städas — kontrollen måste ligga FÖRE städningen, inte efter den. Låg den efter var
      // koden överens med sig själv i kommentaren och oense i utförandet: objektet var redan borta
      // när grenen som säger "städa INTE" kördes.
      const isDuplicate = (error as { code?: string }).code === '23505';
      if (orphanedOnFailure && !isDuplicate) await removeReceiptObject(getSupabaseAdmin(), bucket, uploadedPath!);

      const locked = periodLockError(error);
      if (locked) return routeError(locked.status, locked.code, locked.message);
      if (isDuplicate) {
        return routeError(409, 'time_receipt_already_used', 'Kvittot är redan kopplat till ett annat utlägg.');
      }
      const constraint = compensationConstraintError(error);
      if (constraint) return routeError(constraint.status, constraint.code, constraint.message);
      return routeError(500, 'time_compensation_update_failed', error.message);
    }
    if (!data) {
      // Noll rader = låst period eller fel ägare. Kvittot vi just laddade upp hör då ingenstans.
      if (orphanedOnFailure) await removeReceiptObject(getSupabaseAdmin(), bucket, uploadedPath!);
      const miss = await explainWriteMiss(supabase, {
        table: 'crm_time_compensations', dateColumn: 'entry_date', id: context.params.id, userId: gate.currentUser.id,
      });
      if (miss.locked) return routeError(409, 'time_period_locked', miss.message);
      return routeError(404, 'time_compensation_not_found', 'Posten hittades inte');
    }

    /**
     * Först nu, när raden bevisligen slutat peka på det gamla kvittot, får objektet försvinna.
     *
     * ⚠️ VILLKORET MÅSTE UTTRYCKA ATT RADEN SLÄPPT BILDEN — inte att vi råkar ha läst den.
     *
     * Det här gick sönder en gång: när radläsningen vidgades till att också täcka sortkontrollen
     * (`touchesExpenseOnly`) laddades `oldReceipt` plötsligt även för en ren momsrättelse. Villkoret
     * "vi har en gammal sökväg och den skiljer sig från den nya" blev då sant för `PATCH
     * {"vat_amount": 25}` på ett utlägg som redan hade kvitto: bilden raderades medan raden behöll
     * sitt receipt_path. Utlägget fortsatte visa "Visa kvitto" i både /tid och attesten, länken
     * svarade 500, och kvittot var borta för gott.
     *
     * `uploadedPath !== null || leavingExpense` är de ENDA två vägar som gör den gamla bilden
     * övergiven. Allt annat läser raden av andra skäl och ska inte röra lagringen.
     *
     * Best-effort: en bild som blir kvar är skräp, men ett fel här får inte göra en lyckad sparning
     * till ett misslyckande i användarens ögon.
     */
    const releasedOldReceipt =
      (uploadedPath !== null || leavingExpense)
      && !!oldReceipt?.receipt_path
      && oldReceipt.receipt_path !== uploadedPath;

    if (releasedOldReceipt && oldReceipt?.receipt_path) {
      await removeReceiptObject(getSupabaseAdmin(), oldReceipt.receipt_bucket || bucket, oldReceipt.receipt_path);
    }

    return ok({ item: data });
  } catch (e: any) {
    return routeError(500, 'time_compensation_update_unexpected', e?.message || 'Kunde inte spara posten');
  }
}

export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const gate = await requirePermission('time.entry.write');
    if (gate.response || !gate.currentUser) return gate.response;

    const badId = invalidUuidParam(context.params.id);
    if (badId) return badId;

    const supabase = createRouteHandlerClient({ cookies });
    const { data, error } = await deleteCompensation(supabase, context.params.id, gate.currentUser.id);
    if (error) {
      const locked = periodLockError(error);
      if (locked) return routeError(locked.status, locked.code, locked.message);
      return routeError(500, 'time_compensation_delete_failed', error.message);
    }
    if (!data) {
      const miss = await explainWriteMiss(supabase, {
        table: 'crm_time_compensations', dateColumn: 'entry_date', id: context.params.id, userId: gate.currentUser.id,
      });
      if (miss.locked) return routeError(409, 'time_period_locked', miss.message);
      return routeError(404, 'time_compensation_not_found', 'Posten hittades inte');
    }

    // Posten är borta — då ska kvittot också vara det. Utan den här raden växer bucketen med en
    // oåtkomlig bild för varje borttaget utlägg, och personuppgifter blir kvar efter att den som
    // äger dem raderat posten. Best-effort och efter radraderingen: lyckas den inte är resultatet
    // skräp, inte ett fel användaren ska stoppas av.
    const removed = data as unknown as CompensationReceiptRef;
    if (removed.receipt_path) {
      await removeReceiptObject(getSupabaseAdmin(), removed.receipt_bucket || getReceiptBucket(), removed.receipt_path);
    }

    return ok({ id: removed.id });
  } catch (e: any) {
    return routeError(500, 'time_compensation_delete_unexpected', e?.message || 'Kunde inte ta bort posten');
  }
}
