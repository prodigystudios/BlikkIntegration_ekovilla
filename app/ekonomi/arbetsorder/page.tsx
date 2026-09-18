import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import PageShell from '@/components/ui/PageShell';
import { crm } from '@/app/crm/lib/crmTokens';
import { cn } from '@/lib/shared/cn';
import WorkOrdersClient from '@/app/crm/arbetsorder/WorkOrdersClient';
import EkonomiTabs from '../EkonomiTabs';
import { readEkonomiAccess, canReadPayroll, canReadWorkOrders } from '../_lib/access';

export const dynamic = 'force-dynamic';

// Fakturaunderlaget — arbetsordrarna, som lönebyrån läser för att fakturera i Fortnox.
//
// SAMMA komponent som /crm/arbetsorder renderar, med canEdit={false}. Ingen ny lista byggdes: en
// kopia hade sett likadan ut i en vecka och sedan glidit isär, och det är två vyer av samma ordrar
// som ska visa samma siffror. Precis som attestvyn delas mellan /ekonomi och Admin -> Attest.
//
// ⚠️ ÅTKOMSTEN ÄR EN BEHÖRIGHET, INTE EN ROLL — samma konstruktion som /ekonomi. Rollen `ekonomi`
// bär MENYRADEN (app/_lib/appNav.ts gatar på roll), medan nycklarna avgör vem som faktiskt släpps
// in. Följden, medveten och samma som resten av ytan: den som får nycklarna per användarundantag
// (set_user_permission) når sidan via adressen men får ingen menyrad.
export default async function EkonomiWorkOrdersPage() {
  const { userId, held } = await readEkonomiAccess();
  if (!userId) redirect('/auth/sign-in');

  if (!canReadWorkOrders(held)) {
    // ⚠️ Till /ekonomi, INTE till `/`. app/page.tsx skickar varje ekonomianvändare till /ekonomi,
    // så en studs dit är alltid framåt: den sidan renderar sitt eget nekande i stället för att
    // skicka vidare, och ingen cykel kan uppstå. En redirect till `/` hade för en ekonomianvändare
    // blivit `/` -> `/ekonomi` och för en trasig behörighetsläsning en rundgång utan utgång.
    redirect('/ekonomi');
  }

  // Samma regel som på /ekonomi och i appNav.ts: arbetsorderfliken hör till den som INTE redan har
  // en väg till ordrarna via CRM. En admin som skrivit adressen hit ser därför ingen flikrad —
  // EkonomiTabs döljer sig själv under två flikar — och går tillbaka via sidomenyn. Två dörrar till
  // samma ordrar, varav den ena tyst saknar knappar, är en fälla att gå i, inte en genväg.
  const tabs = [
    ...(canReadPayroll(held) ? [{ href: '/ekonomi', label: 'Tid & lön' }] : []),
    ...(held.has('crm.access') ? [] : [{ href: '/ekonomi/arbetsorder', label: 'Arbetsordrar' }]),
  ];

  return (
    <PageShell className="max-w-[1460px]">
      <section className={cn(crm.cardInner, 'grid gap-4')}>
        <div className="grid gap-1">
          <h1 className={cn('m-0', crm.pageTitle)}>Arbetsordrar</h1>
          <p className={cn('m-0', crm.pageSubtitle)}>
            Underlag för fakturering. Ordrarna visas som de är — faktureringen görs i Fortnox.
          </p>
        </div>
        <EkonomiTabs tabs={tabs} />
      </section>
      <Suspense>
        {/* canEdit={false} stänger "+ Ny order"; basePath håller raderna kvar på den här ytan.
            Skickar man någon till /crm/arbetsorder/<id> kastar CRM-layoutens rollgrind ut dem
            till startsidan — en länk som loggar ut dig ur din egen yta. */}
        <WorkOrdersClient currentUserId={userId} canEdit={false} basePath="/ekonomi/arbetsorder" />
      </Suspense>
    </PageShell>
  );
}
