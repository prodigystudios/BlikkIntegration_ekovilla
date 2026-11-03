"use client";

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/shared/cn';
import { workOrderStatusLabel, workOrderStatusClass } from '@/app/crm/lib/crmTokens';
import { TabsList, TabsTrigger } from '@/components/ui/Tabs';
import WorkOrderCommentsTab from '@/app/crm/arbetsorder/WorkOrderCommentsTab';
import WorkOrderArticles, { type ArticleLineItem } from '@/app/crm/arbetsorder/WorkOrderArticles';
import { scopeLineItemsForDisplay } from '@/lib/domains/crm/workOrderStages';
import WorkOrderTimeTab from '@/app/crm/arbetsorder/WorkOrderTimeTab';
import WorkOrderFilesTab from '@/app/crm/arbetsorder/WorkOrderFilesTab';
import WorkOrderSackReportCard from '@/app/crm/arbetsorder/WorkOrderSackReportCard';
import WorkOrderProgressCard from '@/app/crm/arbetsorder/WorkOrderProgressCard';
import WorkOrderSafetyRoundsCard from '@/app/crm/arbetsorder/WorkOrderSafetyRoundsCard';
import { useSackReports } from '@/app/crm/arbetsorder/useSackReports';
import { useProgressReports } from '@/app/crm/arbetsorder/useProgressReports';
import { progressWorkItemsFromLineItems } from '@/lib/domains/crm/workOrderProgress';
import { useWorkOrderActivity } from '@/app/crm/arbetsorder/useWorkOrderActivity';
import { useWorkOrderFiles } from '@/app/crm/arbetsorder/useWorkOrderFiles';
import { useCustomerContact } from '@/app/crm/arbetsorder/useCustomerContact';
import { useAssigneeContact } from '@/app/crm/arbetsorder/useAssigneeContact';
import { formatDate, documentRef, orderLookupRef } from '@/app/crm/lib/format';
import { inferMaterialFromArticle } from '@/lib/domains/crm/materials';
import { callablePhone } from '@/lib/domains/planning/scheduleStops';
import { fieldViewHeading } from './fieldView';
import FieldHeader, { BackToSchedule } from './_components/FieldHeader';
import FieldContactsCard from './_components/FieldContactsCard';
import FieldBeforeLeavingCard from './_components/FieldBeforeLeavingCard';
import { FIELD_CARD, FIELD_DIVIDER, FIELD_SECTION_TITLE, FIELD_SEGMENT_TRACK, FIELD_SHARED_CARD, FIELD_SKELETON } from './_components/fieldUi';

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

/**
 * Etappen den här placeringen utför, eller null.
 *
 * ⚠️ FAILAR ÖPPET, och det är rätt här. Går uppslaget sönder visas HELA ordern — samma sak som
 * besättningen såg innan etapper fanns. Att i stället visa ingenting hade gjort ett trasigt
 * uppslag till ett stoppat jobb.
 */
function useFieldStage(workOrderId: string, segmentId: string | null) {
  const [stage, setStage] = useState<FieldStage | null>(null);
  useEffect(() => {
    if (!segmentId) return;
    let alive = true;
    void (async () => {
      try {
        const r = await fetch(`/api/crm/work-orders/${workOrderId}/field-scope?segment=${encodeURIComponent(segmentId)}`, { cache: 'no-store' });
        const j = await r.json();
        if (alive && j.ok) setStage((j.data?.stage ?? null) as FieldStage | null);
      } catch {
        /* hela ordern visas */
      }
    })();
    return () => {
      alive = false;
    };
  }, [workOrderId, segmentId]);
  return stage;
}

/**
 * "Du ser en DEL av ordern." Visas på varje flik vars innehåll är beskuret.
 *
 * 🧨 Utan den blir beskärningen tyst, och en tyst beskärning är värre än ingen: besättningen ser en
 * kortare order och har inget sätt att veta om det är etappen eller ett fel i underlaget.
 *
 * Överst på Info OCH Artiklar — de två flikar som är beskurna, och man kan stå på Artiklar utan att ha
 * varit på Info. ⚠️ ALDRIG ovanför flikraden: där hade den stått på Filer och Tid också, som visar HELA
 * ordern, och sagt att något är dolt där inget är det. Etappens arbetsbeskrivning bor i "Att göra".
 */
function StageBanner({ stage }: { stage: FieldStage }) {
  return (
    <div className="grid gap-1 rounded-[14px] border border-solid border-amber-200 bg-amber-50 px-3.5 py-3">
      <p className="m-0 text-sm font-bold text-amber-900">
        Etapp {stage.stage_number} · {stage.title}
      </p>
      <p className="m-0 text-[13px] leading-snug text-amber-800">
        Du ser den här etappens del av ordern. Resten av jobbet utförs vid ett annat tillfälle.
      </p>
    </div>
  );
}

type FieldStage = {
  id: string;
  stage_number: number;
  title: string;
  line_quantities: Array<{ line_id: string; quantity: number }> | null;
  work_description: string | null;
};

export default function WorkOrderInstallerClient({
  workOrderId,
  segmentId = null,
  currentUserId,
  canReportTime = false,
  showSafetyRounds = false,
}: {
  workOrderId: string;
  /**
   * Placeringen besättningen kom ifrån (?segment= ur feeden). null vid direktlänk.
   *
   * Utför placeringen en ETAPP visas orderns innehåll beskuret till den — annars hela ordern,
   * precis som förut. Se useFieldStage nedan.
   */
  segmentId?: string | null;
  currentUserId: string | null;
  /** Testfönstret för Tid-fliken — se app/arbetsorder/[id]/page.tsx. */
  canReportTime?: boolean;
  /** Har den som tittar en skyddsrondsnyckel? Se app/arbetsorder/[id]/page.tsx. */
  showSafetyRounds?: boolean;
}) {
  const stage = useFieldStage(workOrderId, segmentId);
  const [workOrder, setWorkOrder] = useState<InstallerWorkOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<InstallerTab>('info');
  const customerInfo = useCustomerContact(workOrderId);
  // Vem på kontoret som äger ordern. Egen hämtning och inte `workOrder.assignee` — den joinen är
  // alltid null här, se app/crm/arbetsorder/useAssigneeContact.ts.
  const assignee = useAssigneeContact(workOrderId);
  const sackReports = useSackReports(workOrderId);
  // Framdriften — meter landgång, antal brandmattor. Egen bok och egen hook, medvetet skild från
  // säckarnas: se lib/domains/crm/workOrderProgress.ts och migreringen.
  const progressReports = useProgressReports(workOrderId);

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
  // Orderns rader beskurna till etappen — VISNINGEN, inget annat. Utan etapp: arrayen orörd.
  //
  // 🧨 SCOPAR BARA DET SOM VISAS, ALDRIG DET SOM GÅR ATT RAPPORTERA. Se progressWorkItems nedan.
  const scopedLineItems = useMemo(() => {
    const rows = (workOrder?.line_items || []) as ArticleLineItem[];
    if (!stage) return rows;
    return scopeLineItemsForDisplay(rows as never, {
      kind: 'stage',
      stage: { id: stage.id, stage_number: stage.stage_number, title: stage.title, line_quantities: stage.line_quantities },
      siblings: [],
    }) as unknown as ArticleLineItem[];
  }, [workOrder?.line_items, stage]);

  // 🧨 LÄSER HELA ORDERN, ALDRIG DEN BESKURNA ARRAYEN — även när placeringen utför en etapp.
  //
  // Säckkortet ställer materialfrågan bara när ordern har MER ÄN ETT material
  // (`needsMaterial = materialOptions.length > 1`). Beskärs listan till etappen får en tvåmaterials-
  // order som råkar ha ett material i den här etappen `length === 1` → frågan ställs inte → raden
  // sparas med `material: null` → attributeReport faller tillbaka på orderns FÖRSTA kända material
  // och debiterar fel material i depån. Det är exakt den brist materialkolumnen infördes för att
  // laga (se 20260820_ops_segment_reports_sack_reporting.sql).
  //
  // Säckboken är per ARBETSORDER, precis som framdriftens momentlista nedan. Beskärningen gäller
  // vad besättningen SER, aldrig vad de kan rapportera.
  const materialOptions = useMemo(() => {
    const shorts = (workOrder?.line_items || []).map((item) => inferMaterialFromArticle(item?.article_name)?.short);
    return [...new Set(shorts.filter((short): short is string => Boolean(short)))];
  }, [workOrder?.line_items]);

  // Orderns rapporterbara moment: antals- och meterraderna. Ytorna hör till säckrapporten, så ett
  // moment kan aldrig dubbelrapporteras i båda korten.
  //
  // Ligger här av samma skäl som memon ovan: `workOrder` är null under laddningen, och en hook
  // efter den tidiga returen körs inte i första rendern.
  //
  // 🧨 LÄSER HELA ORDERN, ALDRIG DEN BESKURNA ARRAYEN — även när placeringen utför en etapp.
  // Exakt samma skäl som att `include_in_description` inte får filtrera listan (se
  // lib/domains/crm/workOrderProgress.ts): bygger besättningen landgång som råkar ligga i en ANNAN
  // etapp försvinner momentet ur deras lista, de skriver fritext, och rapporten flaggas
  // "Ej på ordern". En avvikelse som inte finns är värre än ingen avvikelse.
  const progressWorkItems = useMemo(
    () => progressWorkItemsFromLineItems((workOrder?.line_items || []) as any[]),
    [workOrder?.line_items],
  );

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

  // Sidans yta i full bredd. Fältvyn renderas utan appskal (CHROMELESS_PREFIXES i AppShell), så
  // bakgrunden måste ligga här och inte på den smala spalten — annars står den vita kroppen kvar på
  // sidorna av en platta.
  //
  // 🧨 `grid-cols-1`, inte bara `grid`. Utan explicit kolumn växer rutnätet till sitt bredaste barns
  // minsta bredd — en lång länk i en kommentar räcker — och HELA sidan blöder ut åt höger. Body har
  // overflow-x:hidden, så det syns som avklippta kort, inte som en scrollbar. Samma fälla som
  // CRM-sidornas rötter (grid blowout), och samma lagning: minmax(0,1fr) klamrar kolumnen.
  const page = (children: ReactNode) => (
    <div className="min-h-dvh bg-[var(--ui-surface-muted)]">
      <div className="mx-auto grid max-w-2xl grid-cols-1 gap-4 px-4 pb-10 pt-3">{children}</div>
    </div>
  );

  if (loading) {
    return page(
      <div role="status" className="grid grid-cols-1 gap-4">
        <span className="sr-only">Hämtar arbetsordern…</span>
        <div className={cn('h-11 w-36 rounded-xl', FIELD_SKELETON)} />
        <div className={cn('h-28 rounded-[18px]', FIELD_SKELETON)} />
        <div className={cn('h-[52px] rounded-[14px]', FIELD_SKELETON)} />
      </div>,
    );
  }

  if (error || !workOrder) {
    return page(
      <>
        <div><BackToSchedule /></div>
        <div className="rounded-[18px] border border-solid border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-700">{error || 'Arbetsordern hittades inte.'}</div>
      </>,
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
  // Slutkunden på plats är en ANNAN person än kundens kontakt, och kontaktkortet byter både roll och
  // namnfallback på det. Reserven ovan (snapshoten, när uppslaget inte svarar) bär kundens kontakt,
  // alltså aldrig en slutkund — därför läses flaggan ur `customerInfo` och inte `contact`.
  const onSite = customerInfo?.isOnSiteContact === true;
  const heading = fieldViewHeading(workOrder.project_name, workOrder.work_address);
  const orderRef = documentRef(workOrder.fortnox_order_number, workOrder.order_number);
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

  return page(
    <>
      <FieldHeader
        orderRef={orderRef}
        statusLabel={workOrderStatusLabel[workOrder.status]}
        statusClass={workOrderStatusClass[workOrder.status]}
        heading={heading}
        clientName={workOrder.client_name}
        plannedDate={formatDate(workOrder.desired_installation_date)}
        phone={callablePhone(contact.phone)}
      />

      {/* Filfliken bär antalet först när listan är hämtad — den hämtas när fliken öppnas, inte innan
          (se useWorkOrderFiles ovan). Ett antal före det hade varit en gissning. */}
      <TabsList
        aria-label="Arbetsorderns delar"
        className={cn(FIELD_SEGMENT_TRACK, tabs.length === 4 ? 'grid-cols-4' : 'grid-cols-3')}
      >
        {tabs.map(([value, label]) => (
          <TabsTrigger
            key={value}
            id={`field-tab-${value}`}
            // Bara den aktiva panelen finns i DOM:en — en pekare till en panel som inte renderats är fel.
            aria-controls={activeTab === value ? `field-panel-${value}` : undefined}
            variant="segmented"
            active={activeTab === value}
            onClick={() => setActiveTab(value)}
          >
            {/* min-w-0 + truncate: fyra flikar på en 320 px-telefon får inte spränga raden. */}
            <span className="min-w-0 truncate">
              {value === 'files' && files.files.length > 0 ? `${label} · ${files.files.length}` : label}
            </span>
          </TabsTrigger>
        ))}
      </TabsList>

      {/* Info — i den ordning dagen går: vad som ska göras, vad som rapporteras, vem man ringer, vad
          som görs innan man åker, och sist kommentarerna (dit en @-notis landar). */}
      {activeTab === 'info' ? (
        <div role="tabpanel" id="field-panel-info" aria-labelledby="field-tab-info" className="grid grid-cols-1 gap-4">
          {/* 🧨 ETAPPEN MÅSTE SÄGAS RAKT UT. Beskärningen tar bort rader ur artikellistan och ur
              materialvalet; syns inte VARFÖR läser besättningen en kortare order som om det vore hela
              jobbet — och den som saknar en rad tror att kontoret glömt den. Banderollen säger både
              vilken del de har och att resten finns. */}
          {stage ? <StageBanner stage={stage} /> : null}

          <section className={cn(FIELD_CARD, 'grid gap-3')} aria-labelledby="field-todo-title">
            <h2 id="field-todo-title" className={FIELD_SECTION_TITLE}>Att göra</h2>
            {/* Etappens egen arbetsbeskrivning står FÖRE orderns: den är skriven för just den här
                omgången, medan orderns gäller hela jobbet. Ingen ersätter den andra. */}
            {stage?.work_description ? (
              <div className="grid gap-1">
                <p className="m-0 text-[13px] font-semibold text-slate-600">Den här etappen</p>
                <p className="m-0 whitespace-pre-wrap text-[15px] leading-relaxed text-slate-900">{stage.work_description}</p>
              </div>
            ) : null}
            <div className={cn('grid gap-1.5', stage?.work_description && cn(FIELD_DIVIDER, 'pt-3'))}>
              {stage ? <p className="m-0 text-[13px] font-semibold text-slate-600">För hela ordern</p> : null}
              {workScope ? <p className="m-0 text-base font-semibold leading-snug text-slate-900">{workScope}</p> : null}
              {handoffNotes ? (
                <p className="m-0 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{handoffNotes}</p>
              ) : (!workScope ? <p className="m-0 text-sm text-slate-500">Ingen arbetsbeskrivning angiven.</p> : null)}
            </div>
          </section>

          {/* Säckrapport — dörr 2. Direkt efter "Att göra" (som säger vad som SKA göras): det är den
              besättningen fyller i när dagen tar slut. */}
          <WorkOrderSackReportCard
            className={FIELD_SHARED_CARD}
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

          {/* Framdrift — meter landgång, antal brandmattor, och det som byggts utanför ordern.
              Ligger direkt under säckrapporten: samma ögonblick i dagen, och de två svarar på
              olika halvor av "vad gjorde vi i dag". Säckarna först, eftersom de är det vanliga
              jobbet; framdriften är den som bär flerhusprojekten.

              ⚠️ Kortet är INTE spärrat av egenkontrollen, till skillnad från säckkortet ovanför.
              Där vore en sen delrapport en tyst nolloperation (finalen vinner); här finns ingen
              final, och landgång kan byggas på ett återbesök. */}
          <WorkOrderProgressCard
            className={FIELD_SHARED_CARD}
            reports={progressReports.reports}
            workItems={progressWorkItems}
            loading={progressReports.loading}
            saving={progressReports.saving}
            loadError={progressReports.loadError}
            onCreate={progressReports.create}
            isRemoving={progressReports.isRemoving}
            onDelete={progressReports.remove}
          />

          <FieldContactsCard
            contact={{
              contactName: contact.contactName,
              phone: contact.phone,
              email: contact.email,
              onSite,
              phoneFromCustomer: customerInfo?.phoneFromCustomer === true,
            }}
            clientName={workOrder.client_name}
            assignee={assignee}
          />

          <FieldBeforeLeavingCard lookupNumber={lookupNumber} orderRef={orderRef} />

          {/* Skyddsrond — bara för den som har en skyddsrondsnyckel (rondledaren, ofta en arbetsledare
              med nyckeln personligt). Besättningen ser inget kort alls. Står utanför "Innan ni åker"
              med flit: ronden är chefens arbete, inte något besättningen gör innan de åker (William
              2026-11-03). Kortet delas med kontorsvyn och är orört. */}
          <WorkOrderSafetyRoundsCard workOrderId={workOrderId} visible={showSafetyRounds} />

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
            <div className="grid gap-2 rounded-[18px] border border-solid border-amber-200 bg-amber-50 p-4">
              <p className={cn(FIELD_SECTION_TITLE, 'text-amber-800')}>Tidrapportering</p>
              <p className="m-0 text-sm leading-relaxed text-amber-900">
                Rapportera tiden i <strong className="font-semibold">Tidrapport</strong>. Ordern{' '}
                <strong className="font-semibold">{orderRef}</strong>{' '}
                går att välja direkt där, på den dag du är schemalagd på jobbet.
              </p>
              {/* ⚠️ En länk, inte en knapp med router.push — den hade tappat mittenklick. */}
              <Link
                href="/tid"
                className="inline-flex min-h-11 w-fit items-center text-sm font-semibold text-amber-900 underline underline-offset-2 transition hover:text-amber-700"
              >
                Öppna Tidrapport
              </Link>
            </div>
          ) : null}

          {/* Comments (write) — at the bottom of Info, no longer a separate tab */}
          <WorkOrderCommentsTab
            className={FIELD_SHARED_CARD}
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
        <div role="tabpanel" id="field-panel-articles" aria-labelledby="field-tab-articles" className="grid grid-cols-1 gap-3">
          {/* ⚠️ BANDEROLLEN MÅSTE FINNAS HÄR OCKSÅ. Listan nedan är beskuren till etappen, och man kan
              stå här utan att ha varit på Info. */}
          {stage ? <StageBanner stage={stage} /> : null}
          <WorkOrderArticles
            items={scopedLineItems}
            currencyCode={workOrder.currency_code}
            vatPercent={workOrder.vat_percent}
            quoteType={workOrder.quote_type}
            rotDetails={workOrder.rot_details}
            saving={false}
            fortnoxConnected={false}
            canEdit={false}
            onSave={async () => false}
          />
        </div>
      ) : null}

      {/* Filer — samma komponent som kontorets flik. Interna filer har redan filtrerats bort av
          RLS innan de nådde hit, och `canUpload` kommer från routen (besättning på jobbet). */}
      {activeTab === 'files' ? (
        <div role="tabpanel" id="field-panel-files" aria-labelledby="field-tab-files">
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
        </div>
      ) : null}

      {/* Tid — samma komponent som kontorets flik, alltså samma klockslagskrav och samma
          serveruträkning av minuterna. Fältet ska inte ha en egen variant av regeln. */}
      {activeTab === 'time' && canReportTime ? (
        <div role="tabpanel" id="field-panel-time" aria-labelledby="field-tab-time">
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
        </div>
      ) : null}
    </>,
  );
}
