"use client";

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/shared/cn';
import { crm, workOrderStatusLabel, workOrderStatusClass } from '@/app/crm/lib/crmTokens';
import { PhoneLink, EmailLink, AddressLink } from '@/app/crm/components/ContactLinks';
import WorkOrderCommentsTab from '@/app/crm/arbetsorder/WorkOrderCommentsTab';
import WorkOrderArticles, { type ArticleLineItem } from '@/app/crm/arbetsorder/WorkOrderArticles';
import WorkOrderTimeTab from '@/app/crm/arbetsorder/WorkOrderTimeTab';
import WorkOrderFilesTab from '@/app/crm/arbetsorder/WorkOrderFilesTab';
import WorkOrderSackReportCard from '@/app/crm/arbetsorder/WorkOrderSackReportCard';
import { useSackReports } from '@/app/crm/arbetsorder/useSackReports';
import { useWorkOrderActivity } from '@/app/crm/arbetsorder/useWorkOrderActivity';
import { useWorkOrderFiles } from '@/app/crm/arbetsorder/useWorkOrderFiles';
import { useCustomerContact } from '@/app/crm/arbetsorder/useCustomerContact';
import { formatDate, joinAddress, documentRef, orderLookupRef } from '@/app/crm/lib/format';
import { inferMaterialFromArticle } from '@/lib/domains/crm/materials';

const CRM_PRIMARY = '#1a3f26'; // brand green; --crm-primary is scoped to /crm so hardcode here

type WorkOrderStatus = 'draft' | 'scheduled' | 'ready' | 'in_progress' | 'completed' | 'invoiced' | 'cancelled';

type InstallerWorkOrder = {
  id: string;
  order_number: string;
  fortnox_order_number: string | null;
  project_name: string;
  client_name: string;
  quote_type: 'private' | 'business';
  customer_id: string | null;
  customer_snapshot: Record<string, any> | null;
  work_address: { street_address?: string | null; postal_code?: string | null; city?: string | null; delivery_address?: string | null } | null;
  internal_handoff: { work_scope?: string | null; handoff_notes?: string | null } | null;
  line_items: ArticleLineItem[] | null;
  rot_details: Record<string, any> | null;
  currency_code: string;
  vat_percent: number | string;
  desired_installation_date: string | null;
  status: WorkOrderStatus;
};

type InstallerTab = 'info' | 'articles' | 'files' | 'time';

export default function WorkOrderInstallerClient({
  workOrderId,
  currentUserId,
  canReportTime = false,
}: {
  workOrderId: string;
  currentUserId: string | null;
  /** Testfönstret för Tid-fliken — se app/arbetsorder/[id]/page.tsx. */
  canReportTime?: boolean;
}) {
  const router = useRouter();
  const [workOrder, setWorkOrder] = useState<InstallerWorkOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<InstallerTab>('info');
  const customerInfo = useCustomerContact(workOrderId);
  const sackReports = useSackReports(workOrderId);

  // Utan Tid-fliken finns ingen konsument för tidraderna — hämta dem inte då.
  const activity = useWorkOrderActivity(workOrderId, { includeTimeEntries: canReportTime });

  // Ritningar och bilder. Samma hook och samma flikkomponent som kontorsvyn; RLS avgör vad
  // besättningen får se (interna filer filtreras bort i databasen) och routen svarar med om den
  // här personen får ladda upp.
  //
  // Hämtas först när fliken öppnats — samma skäl som `includeTimeEntries` ovan: en telefon i fält
  // ska inte betala en rundtur, plus signering av varje bild på servern, för en lista som ingenting
  // renderar.
  const files = useWorkOrderFiles(workOrderId, { enabled: activeTab === 'files' });

  // ⚠️ ALLA HOOKS MÅSTE LIGGA FÖRE DE TIDIGA RETURERNA NEDAN (`if (loading)`, `if (error)`).
  // Den här summan används först längst ner, men får inte deklareras där: första rendern går ut
  // genom laddningsgrenen, nästa gör det inte, och en hook som bara körs i den andra ger
  // "Rendered more hooks than during the previous render" — en krasch för ALLA som öppnar sidan,
  // inte bara för dem som ser fliken. `npm run lint` fångar det numera
  // (react-hooks/rules-of-hooks) och gjorde det senast 2026-08-20; kör den på varje .tsx-ändring.
  const totalLoggedHours = useMemo(
    () => activity.timeEntries.reduce((sum, item) => sum + Number(item.hours || 0), 0),
    [activity.timeEntries],
  );

  // Distinkta material på ordern. Säckrapportens materialfråga ställs BARA när de är fler än ett —
  // precis det fall rapportens materialkolumn finns för att lösa (depåhärledningen debiterar annars
  // allt på orderns FÖRSTA igenkända material). Ett material = ingen fråga.
  //
  // Ligger här av samma skäl som summan ovan: `workOrder` är null under laddningen, och en hook
  // efter den tidiga returen körs inte i första rendern.
  const materialOptions = useMemo(() => {
    const shorts = (workOrder?.line_items || []).map((item) => inferMaterialFromArticle(item?.article_name)?.short);
    return [...new Set(shorts.filter((short): short is string => Boolean(short)))];
  }, [workOrder?.line_items]);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true); setError(null);
      try {
        const res = await fetch(`/api/crm/work-orders/${workOrderId}`, { cache: 'no-store' });
        const json = await res.json().catch(() => ({}));
        if (!active) return;
        if (!res.ok || !json.ok) { setError(json?.error || 'Kunde inte ladda arbetsorder'); return; }
        setWorkOrder(json.data?.item as InstallerWorkOrder);
      } catch { if (active) setError('Kunde inte ladda arbetsorder'); }
      finally { if (active) setLoading(false); }
    }
    load();
    return () => { active = false; };
  }, [workOrderId]);

  if (loading) {
    return (
      <div className="mx-auto grid max-w-2xl gap-4 px-4 py-6">
        <div className="h-8 w-40 animate-pulse rounded-lg bg-[#dfe6da]" />
        <div className="h-40 animate-pulse rounded-2xl bg-[#dfe6da]" />
      </div>
    );
  }

  if (error || !workOrder) {
    return (
      <div className="mx-auto grid max-w-2xl gap-4 px-4 py-6">
        <button type="button" onClick={() => router.back()} className="w-fit text-sm text-slate-500 hover:text-slate-800">← Tillbaka</button>
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">{error || 'Arbetsordern hittades inte.'}</div>
      </div>
    );
  }

  const snapshot = workOrder.customer_snapshot || {};
  // EN KÄLLA I TAGET, aldrig fält för fält mellan två personer. Ordningen — slutkunden på plats,
  // annars orderns egen kontakt, annars kundkortet — sätts av `getWorkOrderCustomerContact`, och
  // där avgörs också vad som får lånas mellan stegen: numret ja, adressen nej.
  //
  // ⚠️ Detta är INTE samma svar som CRM-vyn ger. Finns en slutkund på plats visar fältvyn hen och
  // CRM kundens kontakt — med flit, det är olika personer för olika mottagare. Parity gäller
  // orderns egen kontakt och kundkortet, inte slutkunden.
  //
  // Blandningen som stod här tog namnet från en källa och e-posten från nästa: en slutkund med
  // bara namn och telefon fick kundens adress under sig. Snapshoten är kvar som HEL reserv, för
  // det fallet att uppslaget inte svarar — aldrig som ifyllnad av enstaka fält.
  const contact = customerInfo ?? {
    contactName: snapshot.contact_name || null,
    phone: snapshot.phone || null,
    email: snapshot.email || null,
  };
  const phone: string | null = contact.phone;
  const email: string | null = contact.email;
  const contactName: string | null = contact.contactName;
  // Slutkunden på plats är en ANNAN person än kundens kontakt, och kortet nedan byter både rubrik
  // och namnfallback på det. Reserven ovan (snapshoten, när uppslaget inte svarar) bär kundens
  // kontakt, alltså aldrig en slutkund — därför läses flaggan ur `customerInfo` och inte `contact`.
  const onSite = customerInfo?.isOnSiteContact === true;
  const addressText = joinAddress([workOrder.work_address?.street_address, workOrder.work_address?.postal_code, workOrder.work_address?.city]);
  const workScope = workOrder.internal_handoff?.work_scope || '';
  const handoffNotes = workOrder.internal_handoff?.handoff_notes || '';

  // Numret egenkontrollen slås upp med — RÅTT, aldrig documentRef. Se orderLookupRef i
  // app/crm/lib/format.ts: visningsvarianten sätter en brädgård framför Fortnox-numret och
  // /api/crm/work-orders/lookup matchar exakt, så '#6579' hade gett "Ordern hittades inte" på just
  // de ordrar som HAR synkats. null = ingenting att slå upp på, och då renderas ingen länk.
  const lookupNumber = orderLookupRef(workOrder.fortnox_order_number, workOrder.order_number);

  // Comments render at the bottom of the Info tab (not a separate tab) so an @-mention notification
  // lands straight on the thread.
  //
  // TID-FLIKEN ÄR STÄNGD FÖR BESÄTTNINGEN, öppen bara för attestansvariga (`canReportTime`).
  //
  // Skälet är inte längre tekniskt: fas 4 är byggd, klockslag är obligatoriska och CRM kan bära
  // hela bilden. Skälet är att besättningen fortfarande rapporterar i Blikk, som läses ut för hand
  // före varje lönekörning. En flik här hade blivit en ANDRA plats att rapportera på — och timmar
  // som hamnar i CRM i stället för i Blikk når aldrig lönen. Att flytta någon från Blikk ger samma
  // utfall som att stänga vägen.
  //
  // Villkoret är alltså ett testfönster (William 2026-08-14: "jag måste ändå kunna testa"), inte en
  // behörighetsmodell. Vid cutovern tas `canReportTime` bort härifrån och ur page.tsx, och den gula
  // rutan nedan med den.
  //
  // Filer-fliken är däremot ALLTID med. Den är hela skälet till att besättningen öppnar ordern
  // kvällen före — ritningen och förberedelserna ligger där — och den har ingen motsvarighet till
  // Blikk-problemet ovan.
  const tabs: Array<[InstallerTab, string]> = [
    ['info', 'Info'], ['articles', 'Artiklar'], ['files', 'Filer'],
    ...(canReportTime ? [['time', 'Tid'] as [InstallerTab, string]] : []),
  ];

  return (
    <div className="mx-auto grid max-w-2xl gap-5 px-4 py-6" style={{ minHeight: '100dvh', backgroundColor: '#e5ede5' }}>
      {/* Header */}
      <div>
        <button type="button" onClick={() => router.back()} className="mb-2 inline-flex w-fit items-center gap-1.5 text-sm text-slate-500 transition hover:text-slate-800">← Tillbaka</button>
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn(crm.badge, workOrderStatusClass[workOrder.status])}>{workOrderStatusLabel[workOrder.status]}</span>
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">{documentRef(workOrder.fortnox_order_number, workOrder.order_number)}</span>
        </div>
        <h1 className="m-0 mt-1 text-xl font-bold tracking-tight text-slate-900">{workOrder.project_name}</h1>
        <p className="m-0 text-sm text-slate-500">{workOrder.client_name} · Planerad {formatDate(workOrder.desired_installation_date)}</p>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2">
        {tabs.map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setActiveTab(value)}
            className={cn('rounded-full border px-3.5 py-1.5 text-sm font-semibold transition', activeTab === value ? 'text-white' : 'border-[#e0e8dc] bg-[#f9fbf7] text-slate-600')}
            style={activeTab === value ? { backgroundColor: CRM_PRIMARY, borderColor: CRM_PRIMARY } : undefined}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Info */}
      {activeTab === 'info' ? (
        <div className="grid gap-4">
          {(phone || email || contactName) ? (
            <div className={cn(crm.cardInner, 'grid gap-3')}>
              {/* ⚠️ RUBRIKEN MÅSTE FÖLJA VEM UPPGIFTERNA GÄLLER. `getWorkOrderCustomerContact`
                  svarar med slutkunden när ordern har en, och hen är en ANNAN person än kundens
                  kontakt — en byggare beställer, fastighetsägaren står på plats. Kortet skrev
                  "Kundkontakt" över båda, så besättningen kunde ringa och presentera sig för fel
                  person, eller lämna ett meddelande hos någon som inte beställt jobbet. */}
              <p className={crm.sectionTitle}>{onSite ? 'Kontakt på plats' : 'Kundkontakt'}</p>
              {/* ⚠️ Kundnamnet får INTE fylla i för en namnlös SLUTKUND. Både offerten och ordervyn
                  släpper igenom en slutkund med bara telefon, och då skrev kortet ut byggarens
                  bolagsnamn över fastighetsägarens nummer — alltså en påhittad identitet, inte en
                  saknad. För kundens egen kontakt är fallbacken däremot rätt: där ÄR kunden den
                  personen när ingen kontakt fångats. */}
              <p className="text-sm font-semibold text-slate-900">
                {contactName || (onSite ? 'Namn saknas' : workOrder.client_name)}
              </p>
              <div className="grid gap-1.5 text-sm">
                {phone ? <PhoneLink value={phone} /> : null}
                {email ? <EmailLink value={email} /> : null}
              </div>
              {/* Lånat nummer måste säga vems det är. Slutkunden fångas ofta med bara namn, och då
                  lånar uppslaget kundens nummer så att besättningen kan nå NÅGON — men utan den här
                  raden läses det som slutkundens, och man ringer och frågar efter fel person. */}
              {onSite && customerInfo?.phoneFromCustomer && phone ? (
                <p className="text-xs text-slate-500">Numret går till kundens kontakt – kontakten på plats har inget eget.</p>
              ) : null}
            </div>
          ) : null}

          <div className={cn(crm.cardInner, 'grid gap-2')}>
            <div className="flex items-center justify-between gap-2">
              <p className={crm.sectionTitle}>Arbetsadress</p>
              {addressText ? <AddressLink value={addressText} className="text-xs" /> : null}
            </div>
            <p className="text-sm leading-relaxed text-slate-700">{addressText || '–'}</p>
            {workOrder.work_address?.delivery_address ? (
              <p className="text-xs text-slate-500">Leverans: {workOrder.work_address.delivery_address}</p>
            ) : null}
          </div>

          <div className={cn(crm.cardInner, 'grid gap-2')}>
            <p className={crm.sectionTitle}>Arbetsbeskrivning</p>
            {workScope ? <p className="text-sm font-medium text-slate-800">{workScope}</p> : null}
            {handoffNotes ? (
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{handoffNotes}</p>
            ) : (!workScope ? <p className="text-sm text-slate-400">Ingen arbetsbeskrivning angiven.</p> : null)}
          </div>

          {/* Säckrapport — dörr 2. Ligger efter arbetsbeskrivningen (som säger vad som SKA göras)
              och före tidrapporteringen, alltså där dagen faktiskt tar slut. */}
          <WorkOrderSackReportCard
            reports={sackReports.reports}
            loading={sackReports.loading}
            hasFinal={sackReports.hasFinal}
            saving={sackReports.saving}
            loadError={sackReports.loadError}
            materialOptions={materialOptions}
            onCreate={sackReports.create}
            isRemoving={sackReports.isRemoving}
            onDelete={sackReports.remove}
          />

          {/* Egenkontroll — de två vägarna till pappersarbetet, båda med ordernumret ifyllt.
              Ligger efter säckrapporten med flit: det är samma ögonblick i dagen, och sambandet
              står redan skrivet på kortet ovanför (egenkontrollens säckar ERSÄTTER
              delrapporterna). Innan detta fanns fick installatören lämna ordern, leta upp
              Egenkontroll i menyn och skriva av numret hen just tittade på.

              ⚠️ LÄNKAR, INTE KNAPPAR. Båda navigerar. En <button onClick={router.push}> hade
              sett likadan ut men tappat mittenklick, "öppna i ny flik" och skärmläsarens
              länkroll — och den som fyller i en egenkontroll vill ofta ha arbetsordern kvar i
              en flik bredvid.

              ⚠️ var(--ek-green), INTE var(--crm-primary). Den senare är scopad till CRM-skalet
              och når inte hit — samma skäl som CRM_PRIMARY-konstanten högst upp i filen. */}
          <div className={cn(crm.cardInner, 'grid gap-3')}>
            <p className={crm.sectionTitle}>Egenkontroll</p>
            {lookupNumber ? (
              <>
                <p className="m-0 text-sm leading-relaxed text-slate-700">
                  Formuläret öppnas med order{' '}
                  <strong className="font-semibold">{documentRef(workOrder.fortnox_order_number, workOrder.order_number)}</strong>{' '}
                  ifyllt — kund, adress, datum och etapper hämtas automatiskt.
                </p>
                <Link
                  href={`/egenkontroll?orderId=${encodeURIComponent(lookupNumber)}`}
                  // min-h-11 och inte h-11: etiketten radbryts på en smal telefon i stående läge,
                  // och en fast höjd hade kapat andra raden. 44 px är golvet för en hand i handske.
                  className="inline-flex min-h-11 w-full items-center justify-center rounded-xl px-4 py-2 text-center text-sm font-semibold text-white no-underline transition active:scale-[0.99]"
                  style={{ backgroundColor: 'var(--ek-green)' }}
                >
                  Skapa egenkontroll
                </Link>
                {/* ⚠️ "Sök i arkivet", inte "egenkontrollen för den här ordern". Arkivet filtrerar
                    på FILNAMNET, som bär det nummer installatören skrev in när rapporten lämnades
                    — med knappen ovan blir det alltid det här numret, men äldre filer kan bära det
                    andra (internt kontra Fortnox). Länken får inte lova en exakthet den inte har.

                    Den visas ALLTID, aldrig gömd bakom sackReports.hasFinal: en egenkontroll utan
                    säckrader skriver inga final-rader alls, så hasFinal === false bevisar inte att
                    ingen egenkontroll finns. Arkivet svarar självt "Inga matchande resultat". */}
                <Link
                  href={`/archive?q=${encodeURIComponent(lookupNumber)}`}
                  className="inline-flex min-h-11 w-fit items-center text-sm font-semibold text-slate-600 no-underline transition hover:text-slate-900"
                >
                  Sök i arkivet efter den här ordern →
                </Link>
              </>
            ) : (
              // Utan nummer skulle båda länkarna garanterat landa på "Ordern hittades inte"
              // respektive ett tomt arkiv. Säg det i stället för att erbjuda en väg som inte finns.
              <p className="m-0 text-sm leading-relaxed text-slate-600">
                Ordern saknar ordernummer, så egenkontrollen kan inte hämta jobbet automatiskt.
                Öppna <strong className="font-semibold">Ny egenkontroll</strong> i menyn och fyll i
                uppgifterna för hand.
              </p>
            )}
          </div>

          {/* Var tiden rapporteras. Besättningen har ingen Tid-flik här (den är öppen bara för
              attestansvariga), så utan den här rutan öppnar de jobbet, hittar ingen tidyta och
              gissar.

              Texten sa tidigare "rapportera som INTERNT PROJEKT och skriv ordernumret i
              kommentaren" — Blikk-omvägen, som fanns för att ett CRM-planerat jobb inte gick att
              välja där. Den omvägen är borta sedan genvägarna pekar på vår egen tidrapport: /tid
              listar personens egna schemalagda CRM-jobb för dagen, alltså den här ordern.

              Döljs för den som HAR Tid-fliken: två anvisningar som pekar åt olika håll är värre än
              ingen alls. */}
          {!canReportTime ? (
            <div className="grid gap-2 rounded-2xl border border-solid border-amber-200 bg-amber-50 p-3.5">
              <p className={cn(crm.sectionTitle, 'text-amber-700')}>Tidrapportering</p>
              <p className="m-0 text-sm leading-relaxed text-amber-900">
                Rapportera tiden i <strong className="font-semibold">Tidrapport</strong>. Ordern{' '}
                <strong className="font-semibold">{documentRef(workOrder.fortnox_order_number, workOrder.order_number)}</strong>{' '}
                går att välja direkt där, på den dag du är schemalagd på jobbet.
              </p>
              {/* ⚠️ var(--ek-green) finns inte i den här rutan att luta sig mot — länken ärver
                  bärnstensfärgen och står kvar som text, understruken. Samma skäl som
                  egenkontrollänkarna ovan: en <button> med router.push hade tappat mittenklick. */}
              <Link
                href="/tid"
                className="inline-flex min-h-11 w-fit items-center text-sm font-semibold text-amber-900 underline underline-offset-2 transition hover:text-amber-700"
              >
                Öppna Tidrapport →
              </Link>
            </div>
          ) : null}

          {/* Comments (write) — at the bottom of Info, no longer a separate tab */}
          <WorkOrderCommentsTab
            comments={activity.comments}
            loading={activity.commentsLoading}
            currentUserId={currentUserId}
            mentionUsers={activity.mentionUsers}
            namesById={activity.namesById}
            onCreate={activity.createComment}
            onUpdate={activity.updateComment}
            onDelete={activity.deleteComment}
          />
        </div>
      ) : null}

      {/* Articles (read-only) */}
      {activeTab === 'articles' ? (
        <WorkOrderArticles
          items={(workOrder.line_items || []) as ArticleLineItem[]}
          currencyCode={workOrder.currency_code}
          vatPercent={workOrder.vat_percent}
          quoteType={workOrder.quote_type}
          rotDetails={workOrder.rot_details}
          saving={false}
          fortnoxConnected={false}
          canEdit={false}
          onSave={async () => false}
        />
      ) : null}

      {/* Filer — samma komponent som kontorets flik. Interna filer har redan filtrerats bort av
          RLS innan de nådde hit, och `canUpload` kommer från routen (besättning på jobbet). */}
      {activeTab === 'files' ? (
        <WorkOrderFilesTab
          workOrderId={workOrderId}
          files={files.files}
          loading={files.loading}
          currentUserId={currentUserId}
          canUpload={files.canUpload}
          canMarkInternal={files.canMarkInternal}
          canDeleteAny={files.canDeleteAny}
          uploadProgress={files.uploadProgress}
          onUpload={files.uploadFiles}
          onDelete={files.deleteFile}
        />
      ) : null}

      {/* Tid — samma komponent som kontorets flik, alltså samma klockslagskrav och samma
          serveruträkning av minuterna. Fältet ska inte ha en egen variant av regeln. */}
      {activeTab === 'time' && canReportTime ? (
        <WorkOrderTimeTab
          entries={activity.timeEntries}
          loading={activity.timeEntriesLoading}
          totalHours={totalLoggedHours}
          currentUserId={currentUserId}
          namesById={activity.namesById}
          onCreate={activity.createTimeEntry}
          onUpdate={activity.updateTimeEntry}
          onDelete={activity.deleteTimeEntry}
        />
      ) : null}

    </div>
  );
}
