import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { ok, routeError, requireCrmWriter } from '../../../_shared';

type RouteContext = { params: { articleNumber: string } };

// Växla om en artikel normalt hör hemma i arbetsbeskrivningen installatören läser. Delad
// inställning (inte per användare) — vilken CRM-skribent som helst kuraterar den; RLS
// (has_permission('crm.write')) är den verkliga grinden, requireCrmWriter speglar den i app-lagret.
//
// Bara en STANDARD för nya offertrader. Valet fryses på raden när artikeln väljs
// (line_items[].include_in_description) och appliceras aldrig retroaktivt: en registertoggle som
// ändrade redan sparade offerters arbetsbeskrivning hade låst deras måttblock på inaktuella mått.

export async function POST(_req: Request, context: RouteContext) {
  try {
    const crmUser = await requireCrmWriter();
    if (crmUser.response || !crmUser.currentUser) return crmUser.response;

    const articleNumber = decodeURIComponent(context.params.articleNumber);
    const supabase = createRouteHandlerClient({ cookies });
    // 🧨 `ignoreDuplicates` → ON CONFLICT DO NOTHING, inte DO UPDATE. En vanlig upsert kräver
    // UPDATE-rättighet och en UPDATE-policy, och migreringen ger med flit bara select/insert/delete
    // — att kryssa i en redan ikryssad artikel hade då gett 500 och en tillbakarullad kryssruta.
    // Närvaron ÄR hela värdet, så "finns redan" är ett lyckat utfall. Första skribenten står kvar
    // som created_by, vilket är informationellt.
    const { error } = await supabase
      .from('fortnox_article_work_description_defaults')
      .upsert(
        { article_number: articleNumber, created_by: crmUser.currentUser.id },
        { onConflict: 'article_number', ignoreDuplicates: true },
      );

    if (error) return routeError(500, 'fortnox_article_work_description_failed', error.message);
    return ok({ article_number: articleNumber, include_in_work_description: true });
  } catch (e: any) {
    return routeError(500, 'fortnox_article_work_description_unexpected', e?.message || 'Kunde inte spara inställningen');
  }
}

export async function DELETE(_req: Request, context: RouteContext) {
  try {
    const crmUser = await requireCrmWriter();
    if (crmUser.response || !crmUser.currentUser) return crmUser.response;

    const articleNumber = decodeURIComponent(context.params.articleNumber);
    const supabase = createRouteHandlerClient({ cookies });
    const { error } = await supabase
      .from('fortnox_article_work_description_defaults')
      .delete()
      .eq('article_number', articleNumber);

    if (error) return routeError(500, 'fortnox_article_work_description_failed', error.message);
    return ok({ article_number: articleNumber, include_in_work_description: false });
  } catch (e: any) {
    return routeError(500, 'fortnox_article_work_description_unexpected', e?.message || 'Kunde inte spara inställningen');
  }
}
