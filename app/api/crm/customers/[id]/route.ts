import { createSessionClient } from '@/lib/supabase/session';
import { FortnoxNotConnectedError, friendlyFortnoxMessage } from '@/lib/domains/fortnox/client';
import { getCrmCustomer, updateCrmCustomer } from '@/lib/domains/crm/customers';
import { deriveVatNumberForWrite } from '@/lib/domains/crm/orgNumber';
import { updateFortnoxCustomer, fortnoxCustomerFieldsChanged } from '@/lib/domains/fortnox/customers';
import {
  CustomerFortnoxDeleteError,
  CustomerLocalDeleteError,
  customerDeleteDeps,
  deleteCrmCustomerWithFortnox,
  describeCustomerDeletionBlockers,
} from '@/lib/domains/fortnox/customerDelete';
import { invalidUuidParam, ok, pickProvidedFields, requireCrmAdmin, requireCrmUser, requirePermission, routeError, updateCrmCustomerSchema, validationError } from '../_lib';

type RouteContext = { params: { id: string } };

// Fortnox egna meddelanden slutar oftast med punkt, men inte alla; beskedet nedan fortsätter med en ny mening.
function asSentence(text: string): string {
  const trimmed = text.trim();
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

export async function GET(_req: Request, context: RouteContext) {
  try {
    const crmUser = await requireCrmUser();
    if (crmUser.response) return crmUser.response;

    const badId = invalidUuidParam(context.params.id);
    if (badId) return badId;

    const supabase = createSessionClient();
    const { data, error } = await getCrmCustomer(supabase, context.params.id);

    if (error) {
      return routeError(404, 'crm_customer_not_found', error.message);
    }

    return ok({ item: data });
  } catch (e: any) {
    return routeError(500, 'crm_customer_get_unexpected', e?.message || 'Failed to get customer');
  }
}

export async function PATCH(req: Request, context: RouteContext) {
  try {
    const crmUser = await requirePermission('crm.customer.write');
    if (crmUser.response || !crmUser.currentUser) return crmUser.response;

    const badId = invalidUuidParam(context.params.id);
    if (badId) return badId;

    const rawBody = await req.json().catch(() => null);
    const parsedBody = updateCrmCustomerSchema.safeParse(rawBody);
    if (!parsedBody.success) return validationError(parsedBody.error);

    const supabase = createSessionClient();

    // Persist only fields the client actually sent, so a partial PATCH (e.g. an
    // account-manager-only or personnummer-only change) doesn't wipe untouched columns
    // (addresses default to null in the schema) — mirrors the work-order PATCH route.
    const updateInput = pickProvidedFields(parsedBody.data, rawBody);

    // Snapshot the pre-update row so we can tell whether any Fortnox-relevant field
    // actually changed (avoids pushing to Fortnox on notes/status/owner-only edits).
    const { data: before } = await getCrmCustomer(supabase, context.params.id);

    // ⚠️ Utan raden kan ingen av spärrarna nedan resonera, och alla tre faller till sin
    // TILLÅTANDE gren: identitetslåset hoppas över, momshärledningen tror att org.numret är
    // nytt (och kan skriva över ett handsatt SE...02), och Fortnox-jämförelsen ser "ändrat".
    // Dessutom svarar en UPDATE som inte matchar någon rad `error: null` under RLS, så felet
    // hade blivit tyst. Saknas raden ska det synas här.
    if (!before) {
      return routeError(404, 'crm_customer_not_found', 'Kunden hittades inte.');
    }

    // NOTE: a private customer may lack personal_number (sales sometimes get it only once the
    // job is booked). It is no longer required here — it is enforced when a work order is
    // created for the customer. This PATCH is also the path the "Ny order" / quote→order flows
    // use to save the personnummer the seller supplies at that point.

    // Guard: don't let a Fortnox-synced customer's identity number be EMPTIED — clearing the
    // personnummer (private) or org.nr (business) would push an empty OrganisationNumber to
    // Fortnox and break invoicing/ROT. Keyed off the MERGED type so a real business→private
    // switch (which swaps which number applies) is still allowed; only clearing the number
    // that stays relevant is blocked.
    if (before.fortnox_customer_id) {
      const effectiveType = updateInput.customer_type ?? before.customer_type;
      const clearsPersonal = effectiveType === 'private'
        && 'personal_number' in updateInput && !updateInput.personal_number && !!before.personal_number;
      const clearsOrg = effectiveType === 'business'
        && 'organization_number' in updateInput && !updateInput.organization_number && !!before.organization_number;
      if (clearsPersonal || clearsOrg) {
        return routeError(409, 'crm_customer_identity_locked',
          'Personnummer/org.nr kan inte tömmas på en kund som är synkad med Fortnox.');
      }
    }

    // Momsnumret härleds ur org.numret när ett sådant SÄTTS eller ÄNDRAS (SE + tio siffror +
    // 01). Aldrig ovanpå ett ifyllt momsnummer, och aldrig när org.numret står stilla — annars
    // gick det inte att tömma fältet på en kund som inte är momsregistrerad, eftersom editorn
    // skickar med org.numret i varje PATCH. Se noten i deriveVatNumberForWrite.
    const { data, error } = await updateCrmCustomer(
      supabase,
      context.params.id,
      deriveVatNumberForWrite(updateInput, before),
    );

    if (error) {
      return routeError(500, 'crm_customer_update_failed', error.message);
    }

    // Keep Fortnox in sync for already-linked customers so invoicing data stays
    // correct. Only push when a synced field changed. Failures are surfaced as a
    // warning – the DB update already succeeded.
    if (data?.fortnox_customer_id && fortnoxCustomerFieldsChanged(before, data)) {
      try {
        await updateFortnoxCustomer(context.params.id);
        const { data: synced } = await getCrmCustomer(supabase, context.params.id);
        return ok({ item: synced ?? data });
      } catch (fortnoxErr: any) {
        // Se kundskapandet: svaret bär bara det begripliga beskedet, loggen bär Fortnox egen text.
        console.error('[fortnox] Kunduppdatering misslyckades:', (fortnoxErr as Error)?.message);
        const { data: latest } = await getCrmCustomer(supabase, context.params.id);
        return ok({
          item: latest ?? data,
          fortnox_error: friendlyFortnoxMessage(fortnoxErr),
        });
      }
    }

    return ok({ item: data });
  } catch (e: any) {
    return routeError(500, 'crm_customer_update_unexpected', e?.message || 'Failed to update customer');
  }
}

// Tar bort kunden hos oss och i Fortnox, eller ingenstans. Reglerna och ordningen står i
// lib/domains/fortnox/customerDelete.ts. Bara admin: samma nyckel som tabellens raderingspolicy.
export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const crmAdmin = await requireCrmAdmin();
    if (crmAdmin.response) return crmAdmin.response;

    const badId = invalidUuidParam(context.params.id);
    if (badId) return badId;

    const supabase = createSessionClient();
    let outcome: Awaited<ReturnType<typeof deleteCrmCustomerWithFortnox>>;
    try {
      outcome = await deleteCrmCustomerWithFortnox(context.params.id, customerDeleteDeps(supabase));
    } catch (e) {
      if (e instanceof CustomerFortnoxDeleteError) {
        // Beskedet till användaren är det begripliga; loggen bär Fortnox egen text.
        console.error('[fortnox] Kunden togs inte bort i Fortnox:', (e.fortnoxError as Error)?.message);
        if (e.fortnoxError instanceof FortnoxNotConnectedError) {
          return routeError(409, 'fortnox_not_connected', friendlyFortnoxMessage(e.fortnoxError));
        }
        const reason = asSentence(friendlyFortnoxMessage(e.fortnoxError));
        if (e.deleted === 'no') {
          return routeError(502, 'crm_customer_fortnox_delete_failed',
            `Fortnox tog inte bort kund ${e.fortnoxCustomerNumber}: ${reason} Ingenting är borttaget.`);
        }
        // Inget "försök igen" här: hann borttagningen fram står vår rad kvar med ett nummer Fortnox kan ge en ny kund,
        // och efter en import går jämförelsen igenom mot den (lib/domains/fortnox/customerDelete.ts, OMFÖRSÖK).
        return routeError(502, 'crm_customer_fortnox_delete_uncertain',
          `Fortnox svarade inte, och det går inte att se om kund ${e.fortnoxCustomerNumber} hann tas bort där: ${reason} `
          + 'Kunden står kvar här. Försök inte igen — kontakta support, så att kunden kontrolleras i Fortnox först.');
      }
      if (e instanceof CustomerLocalDeleteError) {
        console.error('[crm] Kunden togs inte bort efter Fortnox:', e.message);
        if (!e.fortnoxCustomerNumber) {
          return routeError(500, 'crm_customer_delete_failed', `Kunden kunde inte tas bort: ${e.message}`);
        }
        // Lösgjort nummer: ett nytt försök rör inte Fortnox alls. Kvar: numret kan gå till en ny kund, och efter en import
        // går jämförelsen igenom mot den — då inget "försök igen" (customerDelete.ts, OMFÖRSÖK).
        return routeError(500, 'crm_customer_delete_failed', e.detached
          ? `Kunden är borttagen i Fortnox (kund ${e.fortnoxCustomerNumber}) men inte här (${e.message}). Försök igen.`
          : `Kunden är borttagen i Fortnox (kund ${e.fortnoxCustomerNumber}) men inte här (${e.message}). `
            + 'Försök inte igen — kontakta support. Numret står kvar på kortet, och Fortnox kan ge det till en ny kund.');
      }
      throw e;
    }

    if (outcome.kind === 'not_found') {
      return routeError(404, 'crm_customer_not_found', 'Kunden hittades inte.');
    }
    if (outcome.kind === 'blocked') {
      return routeError(409, 'crm_customer_has_links',
        describeCustomerDeletionBlockers(outcome.blockers) ?? 'Kunden kan inte tas bort.', outcome.blockers);
    }
    if (outcome.kind === 'fortnox_mismatch') {
      return routeError(409, 'crm_customer_fortnox_mismatch',
        `Kund ${outcome.fortnoxCustomerNumber} i Fortnox${outcome.fortnoxName ? ` ("${outcome.fortnoxName}")` : ''} `
        + 'stämmer inte med det här kundkortet — numret kan ha gått till en annan kund. Ingenting är borttaget.');
    }

    return ok({ deleted: true, fortnox_customer_number: outcome.fortnoxCustomerNumber });
  } catch (e: any) {
    return routeError(500, 'crm_customer_delete_unexpected', e?.message || 'Failed to delete customer');
  }
}
