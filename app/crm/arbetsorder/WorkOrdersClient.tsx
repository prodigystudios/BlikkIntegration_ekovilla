"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Input from '../../../components/ui/Input';
import { cn } from '@/lib/shared/cn';
import { crm, syncStatusLabel, workOrderStatusLabel, workOrderStatusClass, type SyncStatus } from '@/app/crm/lib/crmTokens';
import { formatDate, formatCurrency, isWorkOrderOverdue, documentRef } from '@/app/crm/lib/format';
import AssigneeFilter, { assigneeQueryParam, defaultAssigneeFilter, type AssigneeFilterValue, type AssigneeOption } from '@/app/crm/components/AssigneeFilter';
import SortFilter from '@/app/crm/components/SortFilter';
import StatusFilter from '@/app/crm/components/StatusFilter';
import {
  DEFAULT_WORK_ORDER_STATUS_FILTER,
  WORK_ORDER_STATUS_FILTER_OPTIONS,
  isStatusFilterChanged,
  statusFilterParam,
  type WorkOrderStatusFilterOption,
} from '@/lib/domains/crm/listStatusFilter';
import { RowAssignee } from '@/app/crm/components/RowAssignee';
import { CrmTable, CustomerCell, type CrmTableColumn } from '@/app/crm/components/CrmTable';
import CrmModal from '@/app/crm/components/CrmModal';
import EntityCombobox from '@/app/crm/components/EntityCombobox';
import { searchCustomerOptions } from '@/app/crm/lib/customerSearch';
import { formatPersonalNumber, isValidPersonalNumber, PERSONAL_NUMBER_ERROR } from '@/lib/domains/crm/personalNumber';
import { useToast } from '@/lib/Toast';
import { useWorkOrderMargins, type WorkOrderMargin } from './useWorkOrderMargins';

type WorkOrderStatus = 'draft' | 'scheduled' | 'ready' | 'in_progress' | 'completed' | 'partially_invoiced' | 'invoiced' | 'cancelled';
type FortnoxSyncStatus = 'not_synced' | 'pending' | 'synced' | 'failed';

type WorkOrderItem = {
  id: string;
  order_number: string;
  project_name: string;
  client_name: string;
  pricing_summary: { total?: number } | null;
  line_items: Array<unknown> | null;
  amount: number | string;
  currency_code: string;
  desired_installation_date: string | null;
  status: WorkOrderStatus;
  assigned_to: string | null;
  assignee: { id: string; full_name: string | null } | null;
  fortnox_order_number: string | null;
  fortnox_order_sync_status: FortnoxSyncStatus;
  // Sätts vid första delfakturan. Faktureringsläget är skilt från arbetsstatusen, så listan visar
  // det som en egen badge när statusen inte redan säger det.
  partial_invoicing_started_at?: string | null;
};

// Status labels/classes are centralised in crmTokens (shared with detail + card).

// Radordning. Samma två val som offertlistan har, med arbetsorderns egna datum: 'created_desc' är
// senast skapad först — samma default som offertlistan, så den order du nyss lade upp ligger
// överst — och 'installation_asc' är brädans arbetskö, närmast installation först med de
// försenade överst. Arbetsordern har inget uppföljningsdatum att sortera på; det fältet finns
// bara på offerten.
//
// Defaulten sätts här och skickas alltid med i frågan. Domänens egen default är fortfarande
// 'installation_asc' — den gäller andra anropare (arbetskön), och den ska den fortsätta göra.
type WorkOrderSort = 'created_desc' | 'installation_asc';

const WORK_ORDER_SORTS: ReadonlyArray<{ value: WorkOrderSort; label: string }> = [
  { value: 'created_desc', label: 'Senast skapad' },
  { value: 'installation_asc', label: 'Närmast installation' },
];

// Status filtering and pagination are server-side (see lib/domains/crm/work-orders.ts). The list
// fetches one page per status selection and accumulates via "Visa fler".
const PAGE_SIZE = 100;

// Statusfiltrets etiketter — samma ord som statuspillret i tabellen (Planerad täcker också `ready`).
const workOrderStatusFilterLabel = (option: WorkOrderStatusFilterOption) => workOrderStatusLabel[option];



// Kolumnbredderna — kunden tar resten och håller sig kring 180 px eller mer i varje bredd. På
// telefon står kund och status kvar: namnet går före beloppet, som i kortlistan tabellen ersatte.
// Resten kommer in med bredden: numret, ansvarigs bricka och beloppet från 640 px, planerat datum
// från 768, täckningsgraden från 1024 (där sidomenyn tar sin plats), ansvarigs namn från 1280.
//
// Beloppet står längst ut och statusen bredvid (William, 2026-10-06). På telefon är beloppet dolt
// och statusen sista synliga kolumn: där ligger den mot högerkanten utan eget indrag (`last:pr-0`
// träffar den dolda beloppscellen, inte statusen), från 640 px vänsterställd i sin kolumn.
const orderWidth = {
  number: 'hidden w-[7rem] break-words tabular-nums text-slate-500 sm:table-cell',
  customer: '',
  assignee: 'hidden w-[2.75rem] sm:table-cell xl:w-[10rem]',
  planned: 'hidden w-[8rem] whitespace-nowrap tabular-nums md:table-cell',
  margin: 'hidden w-[6.5rem] whitespace-nowrap tabular-nums lg:table-cell',
  amount: 'hidden w-[7rem] whitespace-nowrap text-right tabular-nums sm:table-cell',
  status: 'w-[6.75rem] pr-0 text-right sm:w-[8rem] sm:pr-4 sm:text-left',
} as const;

// Fortnox-avvikelsens färg under statusen. Bara textfärgen: raden bär redan statuspillret, och en
// andra ram under den hade tävlat med det.
const syncDeviationText: Record<Exclude<SyncStatus, 'synced'>, string> = {
  not_synced: 'text-slate-500',
  pending: 'text-amber-700',
  failed: 'text-rose-700',
};

/**
 * En täckningsgrad i kolumnen TG.
 *
 * ⚠️ VARJE RAD BÄR SITT EGET NAMN. De två talen mäter olika saker — TG1 vad som är kvar efter
 * materialet, TG2 vad som är kvar efter arbetet också — och etiketten är det som gör dem
 * jämförbara mellan rader. Det som INTE får hända är en tyst reserv: samma plats får aldrig betyda
 * TG1 på en rad och TG2 på nästa, för då jämförs två jobb som om talen mätte samma sak. Med
 * utskrivna namn finns den tvetydigheten inte, och saknas ett av talen uteblir bara dess rad.
 *
 * ⚠️ INGA TRÖSKLAR. Offertens 25/40 är satta för förkalkylens TG och TB2 ligger per definition
 * lägre — återanvänds de lyser varje rad rött. Bara förlust färgas, för den är sann utan att någon
 * behöver dra en gräns.
 *
 * ⚠️ INGEN "prel."-MÄRKNING BEHÖVS. Talen räknas bara när materialkostnaden är KOMPLETT — går någon
 * del inte att prissätta blir den null och raden uteblir. Ett tal som syns är alltså ett tal som
 * stämmer, och det är hela skälet till att kolumnen går att lita på.
 */
function MarginLine({ label, percent }: { label: string; percent: number }) {
  const loss = percent < 0;
  return (
    <span
      title={label === 'TG1' ? 'Täckningsgrad efter material' : 'Täckningsgrad efter material och arbete'}
      className={cn('block', loss ? 'font-semibold text-rose-700' : 'text-slate-600')}
    >
      {label} {percent.toFixed(1).replace('.', ',')} %
    </span>
  );
}

/**
 * Radens täckningsgrader. Båda visas när de finns; ingen ersätter den andra. Tom medan svaret inte
 * kommit (talen hämtas i en egen rutt efter listan), streck när inget av talen går att räkna.
 */
function MarginCell({ margin }: { margin: WorkOrderMargin | undefined }) {
  if (!margin) return null;
  if (margin.tg1 == null && margin.tg2 == null) return <span className="text-slate-400">–</span>;
  return (
    <>
      {margin.tg1 != null ? <MarginLine label="TG1" percent={margin.tg1} /> : null}
      {margin.tg2 != null ? <MarginLine label="TG2" percent={margin.tg2} /> : null}
    </>
  );
}

export default function WorkOrdersClient({
  currentUserId,
  canEdit = true,
  basePath = '/crm/arbetsorder',
  canBeAssignee = true,
  canSeeMargins,
}: {
  currentUserId: string | null;
  /**
   * Får den som tittar skapa en order? False tar bort "+ Ny order".
   *
   * Finns för ekonomiytans läslista (/ekonomi/arbetsorder): byrån läser ordrarna för att ta fram
   * fakturaunderlag men äger dem inte. POST /api/crm/work-orders kräver crm.workorder.write, som de
   * inte har — knappen hade slutat i ett 403 efter att formuläret fyllts i.
   */
  canEdit?: boolean;
  /**
   * Vart en rad leder. Ekonomiytan har en egen detaljvy på sin egen adress; skickar man dit någon
   * till /crm/... kastar CRM-layoutens rollgrind ut dem till startsidan.
   */
  basePath?: string;
  /**
   * Kan den som tittar stå som ansvarig på en arbetsorder?
   *
   * 🧨 False för lönebyrån. Listan startar annars på "Mina" (se defaultAssigneeFilter), och för
   * dem är det ett urval som ALDRIG matchar något — de äger ingen order. Sidan hade öppnats tom
   * och sett ut som att det inte finns några arbetsordrar. Flaggan sätter startvärdet till alla
   * och tar bort "Mina" ur menyn.
   */
  canBeAssignee?: boolean;
  /**
   * Får den som tittar läsa täckningsgraden (crm.report.read, samma nyckel som kostnadsrutten
   * kräver)? Läses på servern av samma skäl som offertlistans behörigheter: en klient som frågar
   * själv hade visat en tom TG-kolumn tills 403-svaret kom, och sedan ritat om hela tabellen utan
   * den. Utan nyckeln hämtas inga kostnader alls.
   */
  canSeeMargins: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const searchParams = useSearchParams();
  const [workOrders, setWorkOrders] = useState<WorkOrderItem[]>([]);
  // Täckningsgraden per order — egen rutt, se useWorkOrderMargins. Ingen fråga utan behörigheten.
  const { margins: workOrderMargins, forbidden: marginsForbidden } = useWorkOrderMargins(canSeeMargins ? workOrders.map((item) => item.id) : []);
  const [total, setTotal] = useState(0);
  // Antal per status, för statusfiltrets meny. null tills första svaret kommit.
  const [counts, setCounts] = useState<Partial<Record<WorkOrderStatusFilterOption, number>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  // Startar på allt utom Avslutad och Avbruten (listStatusFilter.ts) och börjar om vid varje besök.
  const [statusFilter, setStatusFilter] = useState<WorkOrderStatusFilterOption[]>(() => [...DEFAULT_WORK_ORDER_STATUS_FILTER]);
  // null = allt ikryssat (ingen parameter), '' = inget ikryssat (inga rader).
  const statusParam = statusFilterParam(statusFilter, WORK_ORDER_STATUS_FILTER_OPTIONS);
  const [sort, setSort] = useState<WorkOrderSort>('created_desc');
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Startar på den inloggades egna ordrar — samma val som offertlistan och säljtavlan.
  // 🧨 `assigned_to` på en order är SÄLJAREN (ärvd från offerten), inte den som planerar. En
  // planerare utan egna ordrar möter alltså en tom tavla tills filtret rensas — därför bär tomma
  // läget en knapp som gör just det.
  const [assigneeFilter, setAssigneeFilter] = useState<AssigneeFilterValue>(() => defaultAssigneeFilter(currentUserId, { canBeAssignee }));
  const [assignees, setAssignees] = useState<AssigneeOption[]>([]);

  // 'mine' → id före frågan, så status, ansvarig och räknare alla avgörs server-side (listan kan
  // överstiga PostgREST:s radtak). Regeln delas med offertlistan.
  const assigneeParam = useMemo(
    () => assigneeQueryParam(assigneeFilter, currentUserId),
    [assigneeFilter, currentUserId],
  );

  // What the visible list is a page of. Held in a ref as well as in the render closure: a function
  // only sees the values captured when it was created, so comparing two closure reads across an
  // await would compare a string with itself. The ref is written by the first-page effect, which
  // runs on every change to the scope.
  const listScope = `${search.trim()}|${statusParam}|${sort}|${assigneeParam}`;
  const listScopeRef = useRef(listScope);

  // Vad statusräknarna är räknade över. Varken ordningen eller statusvalet kan ändra dem — varje
  // status räknas alltid — så ett byte av någon av dem skulle annars dra sju exakta COUNT-scan för
  // siffror som inte kan röra sig (samma spärr som offertlistan har, av samma skäl).
  const countScope = `${search.trim()}|${assigneeParam}`;
  const countedScope = useRef<string | null>(null);

  function buildListQuery(nextOffset: number, withCounts: boolean) {
    const query = new URLSearchParams();
    if (search.trim()) query.set('q', search.trim());
    if (statusParam !== null) query.set('statuses', statusParam);
    query.set('sort', sort);
    if (assigneeParam) query.set('assignee', assigneeParam);
    query.set('offset', String(nextOffset));
    query.set('limit', String(PAGE_SIZE));
    // Chip counts only need recomputing on a fresh first page, not on "Visa fler" — and not when
    // only the row order changed.
    if (withCounts) query.set('counts', '1');
    return query.toString();
  }

  async function loadMore() {
    if (loadingMore || workOrders.length >= total) return;
    setLoadingMore(true);
    // Sidan som läggs till hör till den fråga den beställdes för. Byt sortering mitt i flykten och
    // förstasidan ersätter listan under den; att då lägga till blandar två ordningar och dubblerar
    // rader. Ett svar vars fråga inte längre beskriver den synliga listan kastas därför.
    const requestedFor = listScope;
    try {
      const res = await fetch(`/api/crm/work-orders?${buildListQuery(workOrders.length, false)}`, { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (listScopeRef.current !== requestedFor) return;
      if (!res.ok || !json.ok) { toast.error(json?.error || 'Kunde inte ladda fler arbetsorder.'); return; }
      const items = Array.isArray(json?.data?.items) ? json.data.items : [];
      setWorkOrders((prev) => [...prev, ...items]);
      setTotal(json?.data?.total ?? total);
    } catch {
      toast.error('Kunde inte ladda fler arbetsorder.');
    } finally {
      setLoadingMore(false);
    }
  }

  // "Ny order" (standalone, no quote) — requires a linked customer.
  const [newOrderOpen, setNewOrderOpen] = useState(false);
  const [newOrderCustomerId, setNewOrderCustomerId] = useState('');
  const [newOrderCustomerLabel, setNewOrderCustomerLabel] = useState('');
  const [newOrderName, setNewOrderName] = useState('');
  const [newOrderDate, setNewOrderDate] = useState('');
  const [creatingOrder, setCreatingOrder] = useState(false);
  // A private customer may lack a personnummer (optional at create); Fortnox needs it to invoice
  // the order. The server rejects with 409 missing_personal_number — we then reveal a field and
  // save it on the customer before retrying.
  const [needsPersonalNumber, setNeedsPersonalNumber] = useState(false);
  const [newOrderPersonalNumber, setNewOrderPersonalNumber] = useState('');

  function resetNewOrder() {
    setNewOrderOpen(false);
    setNewOrderCustomerId('');
    setNewOrderCustomerLabel('');
    setNewOrderName('');
    setNewOrderDate('');
    setNeedsPersonalNumber(false);
    setNewOrderPersonalNumber('');
  }

  async function createOrder() {
    // Dubbelt skydd: knappen är borta i läsläge, men en funktion som kan köras utan den är en
    // dörr som står på glänt. Samma mönster som detaljvyns mutationer.
    if (!canEdit) return;
    if (!newOrderCustomerId) { toast.error('Välj en kund'); return; }
    if (!newOrderName.trim()) { toast.error('Ange ett ordernamn'); return; }
    if (needsPersonalNumber && !newOrderPersonalNumber.trim()) { toast.error('Fyll i personnummer för privatkunden'); return; }
    // Tolv siffror krävs — tio ger trasiga ROT-uppgifter i Fortnox. Fångas här så användaren
    // slipper en runda till servern för att få veta det.
    if (needsPersonalNumber && !isValidPersonalNumber(newOrderPersonalNumber)) { toast.error(PERSONAL_NUMBER_ERROR); return; }
    setCreatingOrder(true);
    try {
      // If a prior attempt flagged a missing personnummer, save it on the customer first so the
      // order (and its Fortnox push) has it.
      if (needsPersonalNumber && newOrderPersonalNumber.trim()) {
        const patch = await fetch(`/api/crm/customers/${newOrderCustomerId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ personal_number: newOrderPersonalNumber.trim() }),
        });
        const pj = await patch.json().catch(() => ({}));
        if (!patch.ok || !pj.ok) { toast.error(pj?.error || 'Kunde inte spara personnummer'); return; }
      }
      const res = await fetch('/api/crm/work-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: newOrderCustomerId,
          project_name: newOrderName.trim(),
          desired_installation_date: newOrderDate || null,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        if (json?.errorDetails?.code === 'crm_work_order_missing_personal_number') {
          setNeedsPersonalNumber(true);
          toast.error('Privatkunden saknar personnummer – fyll i det för att skapa ordern.');
          return;
        }
        toast.error(json?.error || 'Kunde inte skapa order');
        return;
      }
      const item = json?.data?.item as { id?: string; order_number?: string } | undefined;
      toast.success(item?.order_number ? `Order skapad: ${item.order_number}` : 'Order skapad');
      resetNewOrder();
      if (item?.id) router.push(`${basePath}/${item.id}`);
    } catch {
      toast.error('Kunde inte skapa order');
    } finally {
      setCreatingOrder(false);
    }
  }

  useEffect(() => {
    let active = true;
    fetch('/api/crm/work-orders/assignees', { cache: 'no-store' })
      .then((r) => r.json().catch(() => ({})))
      .then((json) => { if (active) setAssignees(json?.ok ? json.data?.items || [] : []); })
      .catch(() => { if (active) setAssignees([]); });
    return () => { active = false; };
  }, []);

  // Legacy deep-link: /crm/arbetsorder?work_order_id=X now lives at its own page.
  //
  // ⚠️ `basePath`, inte en hårdkodad /crm-adress. De två andra navigeringarna i filen flyttades när
  // ekonomiytan tillkom men den här missades — och på den ytan hade den skickat en läsande
  // användare rakt in i /crm, vars layout studsar ut dem till startsidan. En djuplänk som loggar ut
  // dig ur din egen yta.
  const deepLinkId = searchParams.get('work_order_id') || '';
  useEffect(() => {
    if (deepLinkId) router.replace(`${basePath}/${deepLinkId}`);
  }, [deepLinkId, router, basePath]);

  // Reset + first page whenever the search, status filter, sort or assignee scope changes. The
  // server filters, orders and paginates; the chip counts come back on the first page (offset 0).
  useEffect(() => {
    let active = true;
    listScopeRef.current = listScope;
    const wantCounts = countedScope.current !== countScope;
    async function load() {
      setLoading(true); setError(null);
      try {
        const res = await fetch(`/api/crm/work-orders?${buildListQuery(0, wantCounts)}`, { cache: 'no-store' });
        const json = await res.json().catch(() => ({}));
        if (!active) return;
        if (!res.ok || !json.ok) { setError(json?.error || 'Kunde inte ladda arbetsorder.'); setWorkOrders([]); setTotal(0); return; }
        setWorkOrders(Array.isArray(json?.data?.items) ? json.data.items : []);
        setTotal(json?.data?.total ?? 0);
        if (json?.data?.statusCounts) { setCounts(json.data.statusCounts); countedScope.current = countScope; }
      } catch { if (active) { setError('Kunde inte ladda arbetsorder.'); setWorkOrders([]); setTotal(0); } }
      finally { if (active) setLoading(false); }
    }
    void load();
    return () => { active = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, statusParam, sort, assigneeParam]);

  const hasMore = workOrders.length < total;

  // Resolve the responsible user's name from the admin-sourced assignees list. The
  // work-order list is read with the session client, whose profiles RLS only returns the
  // current user's own profile — so `item.assignee` (the joined profile) is null for
  // colleagues' orders. Map by assigned_to instead (same approach as the quotes list).
  const assigneeNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of assignees) if (a.full_name) map.set(a.id, a.full_name);
    return map;
  }, [assignees]);

  // Count of active filters (status + assignee) — shown as a badge on the mobile toggle.
  // Statusen räknas när den avviker från startvalet — startvalet i sig är inget val användaren gjort.
  const activeFilterCount = (isStatusFilterChanged(statusFilter, DEFAULT_WORK_ORDER_STATUS_FILTER) ? 1 : 0) + (assigneeFilter.length > 0 ? 1 : 0);
  const narrowedByStatus = statusParam !== null;

  // Radens adress — ekonomiytan har sin egen detaljvy under sin egen basePath.
  const orderHref = (item: WorkOrderItem) => `${basePath}/${item.id}`;

  const columns: Array<CrmTableColumn<WorkOrderItem>> = [
    // Numret via documentRef: Fortnox-numret först, det interna bara som reserv.
    { header: 'Ordernr', className: orderWidth.number, cell: (item) => documentRef(item.fortnox_order_number, item.order_number) },
    {
      header: 'Kund',
      className: orderWidth.customer,
      cell: (item) => <CustomerCell href={orderHref(item)} customer={item.client_name} project={item.project_name} />,
    },
    {
      header: 'Ansvarig',
      // Smal kolumn med bara brickan (namnet i title) tills det finns plats för namnet vid 1280 px.
      // Rubrikordet ryms inte i den smala kolumnen, så där hörs det bara av skärmläsaren.
      headerContent: <span className="sr-only xl:not-sr-only">Ansvarig</span>,
      className: orderWidth.assignee,
      cell: (item) => (
        <RowAssignee
          name={item.assigned_to ? (assigneeNameById.get(item.assigned_to) ?? item.assignee?.full_name ?? null) : null}
          assigned={Boolean(item.assigned_to)}
          nameClassName="hidden xl:inline"
        />
      ),
    },
    {
      // "Planerad" är ett MEDVETET VAL (William, 2026-08-23) — ändra inte. Prövat som "Installation"
      // och backat: "Planerad" är ordet verksamheten använder. Att det sammanfaller med statusen
      // `scheduled` är känt och accepterat; en rad kan alltså läsa "Ej planerad" i statusen och ett
      // streck under Planerad.
      header: 'Planerad',
      className: orderWidth.planned,
      cell: (item) => {
        const overdue = isWorkOrderOverdue(item.desired_installation_date, item.status);
        return (
          <span className={overdue ? 'font-semibold text-rose-600' : 'text-slate-500'} title={overdue ? 'Försenad' : undefined}>
            {overdue ? '⚠ ' : ''}{formatDate(item.desired_installation_date)}
          </span>
        );
      },
    },
    // Kolumnen finns bara för den som får läsa kostnaderna (canSeeMargins, från servern). 403 från
    // rutten tar också bort den — behörigheten kan ha dragits in sedan sidan laddades.
    ...(!canSeeMargins || marginsForbidden ? [] : [{
      header: 'TG',
      className: orderWidth.margin,
      cell: (item: WorkOrderItem) => <MarginCell margin={workOrderMargins[item.id]} />,
    }]),
    {
      header: 'Status',
      className: orderWidth.status,
      cell: (item) => (
        <>
          <span className={cn(crm.badge, workOrderStatusClass[item.status] ?? 'border-slate-200 bg-slate-50 text-slate-700')}>
            {workOrderStatusLabel[item.status] ?? item.status}
          </span>
          {/* Faktureringsläget är skilt från arbetsstatusen: sätts vid första delfakturan. */}
          {item.partial_invoicing_started_at && item.status !== 'invoiced' && item.status !== 'partially_invoiced' ? (
            <span className="mt-1 block text-[11px] font-semibold text-amber-700">Delfakturerad</span>
          ) : null}
          {/* Planerad-kolumnen är dold under 768 px — där bär statusen förseningen i stället. */}
          {isWorkOrderOverdue(item.desired_installation_date, item.status) ? (
            <span className="mt-1 block text-[11px] font-semibold text-rose-700 md:hidden">Försenad</span>
          ) : null}
          {/* Bara AVVIKELSEN. "Fortnox: Synkad" hade stått på i stort sett varje rad, och mitt bland
              dem hade den enda som betydde något försvunnit. Att raden saknas betyder alltså att
              ordern ÄR synkad. */}
          {item.fortnox_order_sync_status !== 'synced' ? (
            <span className={cn('mt-1 block text-[11px] font-semibold', syncDeviationText[item.fortnox_order_sync_status])}>
              Fortnox: {syncStatusLabel[item.fortnox_order_sync_status]}
            </span>
          ) : null}
        </>
      ),
    },
    { header: 'Belopp', className: orderWidth.amount, cell: (item) => <span className="font-semibold text-slate-900">{formatCurrency(item.pricing_summary?.total ?? item.amount, item.currency_code)}</span> },
  ];

  return (
    <div className="grid grid-cols-1 gap-4">
      {/* Page header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className={crm.pageTitle}>Arbetsorder</h1>
          {/* Sublinen räknade upp "översikt, ekonomi, artiklar, tid och kommentarer" — en
              flikstruktur som inte finns längre. Ekonomi och Artiklar är INTE egna flikar — de
              ligger i Ekonomi-kortet på översikten, och kommentarerna längst ner på samma
              översikt. Kvarvarande flikar är Översikt, Filer och Tid. */}
          <p className={cn('mt-1', crm.pageSubtitle)}>
            Öppna en order för status, ekonomi, filer, tid och kommentarer.
          </p>
        </div>
        {canEdit ? (
          <button
            type="button"
            onClick={() => setNewOrderOpen(true)}
            className="inline-flex items-center rounded-xl px-3 py-1.5 text-sm font-semibold text-white transition hover:opacity-90"
            style={{ backgroundColor: 'var(--crm-primary)' }}
          >
            + Ny order
          </button>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      ) : null}

      {/* List card */}
      <div className="grid gap-2 rounded-2xl border border-[#e0e8dc] bg-[#f9fbf7] p-2.5 shadow-[0_1px_3px_rgba(20,44,27,0.06),0_18px_36px_-18px_rgba(20,44,27,0.24)] md:p-3">
        {/* Sök och filter på en rad (William, 2026-10-06): statusflikarna blev ett filter bredvid
            Sortera och Ansvarig, och sökrutan tar platsen. Smalare än ~1000 px står filtren på en
            egen rad, och på mobilen fälls de ihop bakom filterknappen. */}
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="flex min-w-0 items-center gap-2 sm:min-w-[16rem] sm:flex-1">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Sök på ordernummer, projekt eller kund"
              className="flex-1"
            />
            <button
              type="button"
              onClick={() => setFiltersOpen((o) => !o)}
              aria-expanded={filtersOpen}
              aria-label="Filter"
              className={cn(
                'relative inline-flex h-[2.6rem] w-[2.6rem] shrink-0 items-center justify-center rounded-lg border p-0 transition sm:hidden',
                filtersOpen || activeFilterCount > 0
                  ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                  : 'border-[#dce4d8] bg-white text-slate-600',
              )}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 6h16M7 12h10M10 18h4" />
              </svg>
              {activeFilterCount > 0 ? (
                <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-600 px-1 text-[10px] font-bold text-white">
                  {activeFilterCount}
                </span>
              ) : null}
            </button>
          </div>

          {/* Status, sortering och ansvarig är alla server-side: listan är paginerad, så att gallra
              eller ordna den laddade sidan skulle bara röra de första hundra. */}
          <div className={cn('flex-col gap-2 sm:flex sm:flex-row sm:items-center', filtersOpen ? 'flex' : 'hidden')}>
            <StatusFilter
              value={statusFilter}
              onChange={setStatusFilter}
              options={WORK_ORDER_STATUS_FILTER_OPTIONS}
              defaultValue={DEFAULT_WORK_ORDER_STATUS_FILTER}
              labelOf={workOrderStatusFilterLabel}
              counts={counts}
              className="w-full sm:w-[190px]"
            />
            <SortFilter
              value={sort}
              onChange={setSort}
              options={WORK_ORDER_SORTS}
              label="Sortera arbetsorder"
              className="w-full sm:w-[170px]"
            />
            <AssigneeFilter value={assigneeFilter} onChange={setAssigneeFilter} users={assignees} showMine={canBeAssignee} className="w-full sm:w-[190px]" />
          </div>
        </div>

        {/* List */}
        {loading ? <div className="py-4 text-sm text-slate-500">Laddar arbetsorder…</div> : null}
          {/* Tomläget gatas på felet också: efter ett misslyckat anrop är listan tom, och "inga
              arbetsorder matchar" under felrutan hade pekat åt fel håll (FRONTEND_SYSTEM.md). */}
          {!loading && !error && workOrders.length === 0 ? (
            // 🧨 Samma skäl som i offertlistan, och skarpare här: `assigned_to` är SÄLJAREN, så en
            // planerare ser en tom tavla tills filtret rensas. Statusfiltret döljer dessutom Avslutad
            // och Avbruten från start, så en sådan order som söks fram syns inte. Knapparna är vägen ut.
            <div className="grid justify-items-center gap-3 rounded-2xl border border-dashed border-[#cfdcc9] bg-[#f1f5ee] px-4 py-8 text-center text-sm text-slate-500">
              <span>
                {narrowedByStatus || assigneeFilter.length > 0
                  ? `Inga arbetsorder matchar just nu — listan visar bara ett urval av ${narrowedByStatus && assigneeFilter.length > 0 ? 'statusar och ansvariga' : narrowedByStatus ? 'statusar' : 'ansvariga'}.`
                  : 'Inga arbetsorder matchar just nu.'}
              </span>
              {narrowedByStatus || assigneeFilter.length > 0 ? (
                <span className="flex flex-wrap justify-center gap-2">
                  {narrowedByStatus ? (
                    <button
                      type="button"
                      onClick={() => setStatusFilter([...WORK_ORDER_STATUS_FILTER_OPTIONS])}
                      className="px-3 py-1.5 rounded-lg border border-solid border-[#dce4d8] bg-white text-sm font-semibold text-slate-700 transition hover:border-[#c8d4c3]"
                    >
                      Visa alla statusar
                    </button>
                  ) : null}
                  {assigneeFilter.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => setAssigneeFilter([])}
                      className="px-3 py-1.5 rounded-lg border border-solid border-[#dce4d8] bg-white text-sm font-semibold text-slate-700 transition hover:border-[#c8d4c3]"
                    >
                      Visa alla ansvariga
                    </button>
                  ) : null}
                </span>
              ) : null}
            </div>
          ) : null}

          {!loading && workOrders.length > 0 ? (
            <CrmTable size="regular" label="Arbetsorder" columns={columns} rows={workOrders} rowHref={orderHref} />
          ) : null}

          {/* Visa fler — server-side pagination so the board never silently truncates */}
          {!loading && hasMore ? (
            <div className="flex flex-col items-center gap-1 pt-1">
              <button
                type="button"
                onClick={() => void loadMore()}
                disabled={loadingMore}
                className="rounded-full border border-[#dce4d8] bg-white px-4 py-1.5 text-[13px] font-semibold text-slate-600 transition hover:border-[#c8d4c3] disabled:opacity-60"
              >
                {loadingMore ? 'Laddar…' : 'Visa fler'}
              </button>
              <span className="text-[11px] text-slate-400">Visar {workOrders.length} av {total}</span>
            </div>
          ) : null}
      </div>

      {/* ── Ny order (standalone) ── */}
      {newOrderOpen ? (
        <CrmModal
          onClose={resetNewOrder}
          ariaLabel="Ny order"
          maxWidth="sm:max-w-[520px]"
          header={
            <>
              <h2 className="text-lg font-bold text-slate-900">Ny order</h2>
              <p className="m-0 mt-0.5 text-sm text-slate-500">Skapa en order utan offert. Lägg till artiklar efteråt på ordern.</p>
            </>
          }
          footer={
            <>
              <button
                type="button"
                onClick={resetNewOrder}
                className="flex-1 rounded-xl border border-slate-200 bg-white py-2.5 text-sm font-semibold text-slate-600 transition hover:border-slate-300 sm:flex-none sm:px-5"
              >
                Avbryt
              </button>
              <button
                type="button"
                onClick={() => void createOrder()}
                disabled={creatingOrder || !newOrderCustomerId || !newOrderName.trim()}
                className="flex-1 rounded-xl py-2.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60 sm:ml-auto sm:flex-none sm:px-5"
                style={{ backgroundColor: 'var(--crm-primary)' }}
              >
                {creatingOrder ? 'Skapar…' : 'Skapa order'}
              </button>
            </>
          }
        >
          <div className="grid gap-4">
            <div>
              <p className={cn('mb-1.5', crm.sectionTitle)}>Kund</p>
              <EntityCombobox
                value={newOrderCustomerId}
                valueLabel={newOrderCustomerLabel}
                onChange={(id, label) => { setNewOrderCustomerId(id); setNewOrderCustomerLabel(label); }}
                onClear={() => { setNewOrderCustomerId(''); setNewOrderCustomerLabel(''); }}
                search={searchCustomerOptions}
                placeholder="Sök kund…"
              />
            </div>
            <div>
              <p className={cn('mb-1.5', crm.sectionTitle)}>Ordernamn / projekt</p>
              <Input value={newOrderName} onChange={(e) => setNewOrderName(e.target.value)} placeholder="Ex. Lösull vind, Lindberg" />
            </div>
            <div>
              <p className={cn('mb-1.5', crm.sectionTitle)}>Önskat installationsdatum (valfritt)</p>
              <Input value={newOrderDate} onChange={(e) => setNewOrderDate(e.target.value)} type="date" lang="sv-SE" />
            </div>
            {needsPersonalNumber ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                <p className={cn('mb-1.5', crm.sectionTitle)}>Personnummer (privatkund)</p>
                <Input
                  value={newOrderPersonalNumber}
                  onChange={(e) => setNewOrderPersonalNumber(formatPersonalNumber(e.target.value))}
                  placeholder="ÅÅÅÅMMDD-XXXX"
                  inputMode="numeric"
                  autoFocus
                />
                <p className="mt-1.5 text-[11px] leading-snug text-amber-700">
                  Privatkunden saknar ett fullständigt personnummer. Fortnox behöver det med fullt årtal för att fakturera ordern och för att ROT ska fungera – det sparas på kundkortet.
                </p>
              </div>
            ) : null}
          </div>
        </CrmModal>
      ) : null}
    </div>
  );
}
