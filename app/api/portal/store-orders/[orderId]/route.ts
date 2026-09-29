import type { NextRequest } from 'next/server';
import { ok, routeError } from '@/lib/api/responses';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { portalStoreOrderChangeSchema } from '@/lib/domains/portal/storeOrderIntake';
import { changeStoreOrder, notifyStoreOrder } from '@/lib/domains/portal/storeOrdersStore';
import { parsePortalBody, portalPathIdMismatch, runIdempotentPortalRequest, verifyPortalRequest } from '../../_shared';

type RouteContext = { params: { orderId: string } };

// Butiken har ändrat en butiksbeställning (RESELLER_PORTAL_CRM_PLAN.md fas 8, kontraktets "Flöde 3"). Samma kropp som
// en ny, plus updatedAt. Idempotency-Key: store-order-<orderId>-<updatedAt>.
//
//   200 { status: "updated" }   ändringen gäller; den ansvarige får en notis efter svaret
//   200 { status: "ignored" }   ett äldre eller samma updatedAt (ett sent omförsök), eller en beställning som butiken
//                               dragit tillbaka eller Ekovilla makulerat: ingenting ändras
//   400 invalid_json, invalid_text, validation_error   kroppen följer inte kontraktet, eller orderId är inte sökvägens
//   400 store_order_mismatch    en annan butik eller ett annat nummer än beställningens
//   404 unknown_order           ingen beställning med det id:t (sparas inte i svarscachen: den kan komma fram senare)
//   409 store_order_confirmed   redan bekräftad av Ekovilla: det enda ett 409 betyder (kontraktet)
//
// Service-rollen: anropet har ingen användare bakom sig. Se "Reviewed elevations" i SUPABASE_CONVENTIONS.md.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// 🧨 Utan den här raden cachar Next 14 varje fetch i routen, också supabase-js läsningar: en route med bara PUT får
// revalidate = false (hasNonStaticMethods i app-route/module.js räknar POST två gånger och glömmer PUT), och en
// portalroute läser aldrig kakan. En andra ändring läste då radens första version om och om igen och gav upp med 500
// (prövat lokalt, fas 8). Samma fälla som cron-routen (fas 4b).
export const fetchCache = 'force-no-store';

export async function PUT(req: NextRequest, context: RouteContext) {
  const verified = await verifyPortalRequest(req);
  if (!verified.ok) return verified.response;

  const admin = getSupabaseAdmin();
  return runIdempotentPortalRequest(req, verified.rawBody, admin, async () => {
    const body = parsePortalBody(verified.rawBody, portalStoreOrderChangeSchema);
    if (!body.ok) return { response: body.response };
    const mismatch = portalPathIdMismatch('orderId', body.data.orderId, context.params.orderId);
    if (mismatch) return { response: mismatch };

    const result = await changeStoreOrder(admin, body.data);
    switch (result.kind) {
      case 'updated':
        return {
          response: ok({ status: 'updated' }),
          after: async () => {
            const outcome = await notifyStoreOrder(admin, result.id);
            console.info('[portal-store-orders] efter ändringen', { orderId: body.data.orderId, outcome });
          },
        };
      case 'ignored':
        return { response: ok({ status: 'ignored' }) };
      case 'confirmed':
        return { response: routeError(409, 'store_order_confirmed', 'Beställningen är redan bekräftad av Ekovilla.') };
      case 'mismatch':
        return {
          response: routeError(400, 'store_order_mismatch', `${result.field}: inte samma som i beställningen.`, {
            issues: [{ path: result.field, message: 'Inte samma som i beställningen.' }],
          }),
        };
      case 'unknown_order':
        // Inte bestående: kommer beställningen fram senare ska samma nyckel köras igen, inte få samma 404.
        return { response: routeError(404, 'unknown_order', 'Ingen beställning med det id:t.'), cacheable: false };
    }
  });
}
