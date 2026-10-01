import { z } from 'zod';
import { createSessionClient } from '@/lib/supabase/session';
import { getSupabaseAdmin } from '@/lib/supabase/server';
import { stockholmTodayISO } from '@/lib/domains/planning/timezone';
import { publishPricelist } from '@/lib/domains/portal/pricelistPublish';
import { loadPricelistBatch, pricelistBatchSources } from '@/lib/domains/portal/pricelistBatchSources';
import { ok, routeError, validationError, requirePermission } from '../../../_shared';

// Läsningen av lista 160 och butikernas listor, sparandet och ett första utskick (högst 15 s mot portalen).
export const maxDuration = 60;

const bodySchema = z.object({
  valid_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ange giltig från som ÅÅÅÅ-MM-DD'),
  // Hashen på förhandsvisningen användaren såg. Publiceringen görs bara om listan fortfarande ser ut så.
  expected_hash: z.string().regex(/^[0-9a-f]{64}$/, 'Förhandsvisningen saknas'),
});

// Publicera prislistorna till återförsäljarportalen (RESELLER_PORTAL_CRM_PLAN.md fas 2b, och 10b2: lista 160 och
// butikernas egna, samtidigt). Reglerna bor i publishPricelist; här är bara HTTP.
//
// Två klienter: sessionen för publiceringen och portalfälten (RLS: crm.portal.manage), service-rollen för kön, som
// bara service_role skriver (fas 1b). Se "Reviewed elevations" i SUPABASE_CONVENTIONS.md.
export async function POST(req: Request) {
  try {
    const gate = await requirePermission('crm.portal.manage');
    if (gate.response || !gate.currentUser) return gate.response;

    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return validationError(parsed.error);

    const session = createSessionClient();
    const outcome = await publishPricelist(
      {
        session,
        admin: getSupabaseAdmin(),
        env: process.env,
        loadBatch: () => loadPricelistBatch(pricelistBatchSources(session)),
        today: stockholmTodayISO(),
        actor: { id: gate.currentUser.id, name: gate.currentUser.name ?? null },
      },
      { validFrom: parsed.data.valid_from, expectedHash: parsed.data.expected_hash },
    );

    switch (outcome.kind) {
      case 'integration_off':
        return routeError(409, 'portal_integration_off', `Integrationen med portalen är inte påslagen här. ${outcome.message}`);
      case 'invalid_valid_from':
        return routeError(400, 'portal_pricelist_valid_from', 'Giltig från måste vara i dag eller senare.');
      case 'source_error':
        return routeError(502, 'portal_pricelist_source', outcome.message);
      case 'empty':
        return routeError(422, 'portal_pricelist_empty', 'Ingen artikel kommer med i prislistan. En tom lista publiceras inte.');
      case 'blocked':
        return routeError(
          422,
          'portal_pricelist_blocked',
          `Ingenting publicerades: ${outcome.problems.length === 1 ? 'en lista' : `${outcome.problems.length} listor`} gick inte att läsa. ${outcome.problems.join(' ')}`,
        );
      case 'changed':
        return routeError(
          409,
          'portal_pricelist_changed',
          'Prislistan har ändrats sedan förhandsvisningen. Ladda om sidan och granska den igen.',
        );
      case 'forbidden':
        return routeError(403, 'forbidden', 'Forbidden');
      case 'db_error':
        return routeError(500, 'portal_pricelist_db_error', outcome.message);
      case 'published':
        return ok(
          {
            created: outcome.created,
            idempotency_key: outcome.idempotencyKey,
            article_count: outcome.articleCount,
            delivery: outcome.delivery,
            lists: outcome.lists,
          },
          outcome.created ? 201 : 200,
        );
    }
  } catch (e: any) {
    return routeError(500, 'portal_pricelist_unexpected', e?.message || 'Prislistan kunde inte publiceras');
  }
}
