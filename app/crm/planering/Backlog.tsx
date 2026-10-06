import { useMemo, useState } from 'react';
import type React from 'react';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';
import type { BacklogPlacement, OpsTruck, SchedulableWorkOrder } from '@/lib/domains/planning/types';
import { placementDayLabel } from './planningDates';
import { statusMeta, SackBadge, JobRef, MapLink } from './jobCard';
import { formatDate } from '@/app/crm/lib/format';
import SearchField from './SearchField';
import SelectMenu from '@/components/ui/SelectMenu';

type BacklogFilter = 'unplanned' | 'planned' | 'all';

type BacklogProps = {
  items: SchedulableWorkOrder[];
  loading: boolean;
  canWrite: boolean;
  /** Scope-NYCKELN för den valda posten (`scopeKey`), inte arbetsorder-id:t. */
  selectedKey: string | null;
  filter: BacklogFilter;
  onFilterChange: (f: BacklogFilter) => void;
  counts: { unplanned: number; planned: number; all: number };
  // Set when the list failed to load. Without it an empty panel is indistinguishable from a panel
  // whose fetch died, and the empty state would tell you to go create a work order you already have.
  loadError: string | null;
  // The backlog owns its own search + sales filter. Both live here rather than in the toolbar
  // because they scope this list alone — the schedule beside it has its own search box.
  search: string;
  onSearchChange: (value: string) => void;
  salesFilter: string | null;
  onSalesFilterChange: (value: string | null) => void;
  salesOptions: ReadonlyArray<{ id: string; name: string }>;
  onSelect: (id: string) => void;
  /** Bilarna på tavlan, för namn och färg på placeringsraderna. */
  trucks: ReadonlyArray<OpsTruck>;
  /** Hoppa tavlan till kortet och markera det. */
  onJumpToPlacement: (item: SchedulableWorkOrder, placement: BacklogPlacement) => void;
  onDragStartItem: (e: React.DragEvent, item: SchedulableWorkOrder) => void;
  onDropUnschedule: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  dropActive: boolean;
};

const FILTER_TABS: ReadonlyArray<readonly [BacklogFilter, string]> = [
  ['unplanned', 'Oplanerade'],
  ['planned', 'Planerade'],
  ['all', 'Alla'],
];

function shortDate(value: string | null): string | null {
  if (!value) return null;
  const formatted = formatDate(value);
  return formatted || value;
}

export default function Backlog({
  items, loading, canWrite, selectedKey, filter, onFilterChange, counts, loadError,
  search, onSearchChange, salesFilter, onSalesFilterChange, salesOptions,
  onSelect, trucks, onJumpToPlacement, onDragStartItem, onDropUnschedule, onDragOver, dropActive,
}: BacklogProps) {
  const truckById = useMemo(() => new Map(trucks.map((t) => [t.id, t])), [trucks]);
  // An empty panel has four different meanings and only one instruction fits each. Ordered by which
  // outranks which:
  //
  // 1. The load failed — the orders may well exist, we just don't have them. This has to come first:
  //    "skapa en order i CRM:et" here would send you off to create a duplicate of one you own.
  // 2. A filter matched nothing. counts.all comes from the already search/sales-filtered set, so
  //    counts.all === 0 is precisely that — and the zero check matters, because with matches that
  //    all sit under another tab (a search hits 3 jobs, every one of them planned, while Oplanerade
  //    is open) the panel would otherwise claim nothing matched while the badge beside it reads
  //    "Planerade 3".
  // 3. Everything is scheduled — the good outcome, worth saying so.
  // 4. There is genuinely nothing to plan.
  const filtered = search.trim().length > 0 || salesFilter !== null;
  const emptyText = loadError
    ? `${loadError}. Ladda om sidan för att försöka igen.`
    : filtered && counts.all === 0
      ? 'Ingen arbetsorder matchar sökningen eller vald säljare. Rensa filtret för att se alla.'
      : filter === 'planned'
        ? 'Inga inplanerade jobb än.'
        : filter === 'unplanned' && counts.planned > 0
          ? 'Alla jobb är inplanerade. 🎉'
          : 'Inga arbetsordrar att planera. Skapa en order i CRM:et så dyker den upp här.';
  return (
    <section
      className={cn(
        crm.card,
        // Sticky on desktop so the backlog follows the board down — no scrolling back up to grab a
        // card when planning a job on a later week. Capped under viewport height with its own scroll.
        'flex max-h-[calc(100dvh-220px)] flex-col lg:sticky lg:top-3 lg:self-start',
        dropActive && 'ring-2 ring-rose-300',
      )}
      onDragOver={onDragOver}
      onDrop={onDropUnschedule}
    >
      <div className="flex items-center justify-between px-3.5 pb-2 pt-3.5">
        <h2 className={crm.sectionTitle}>Att planera</h2>
        <span className="text-[11px] tabular-nums text-slate-400">{items.length} st</span>
      </div>

      {/* Search + sales filter, scoped to this list only. Both sit outside the scrolling area
          below, so they stay put while the cards scroll under them. */}
      <div className="grid gap-1.5 px-3.5 pb-2.5">
        <SearchField
          value={search}
          onChange={onSearchChange}
          placeholder="Sök i backloggen…"
          ariaLabel="Sök bland arbetsordrar att planera"
        />
        {salesOptions.length > 0 && (
          // `SelectMenu`, inte `crm.select` och inte heller `<Select>`: båda är i grunden en
          // `<select>`, och LISTAN som fälls ut ur en sådan ritas av operativsystemet. På macOS är
          // den grå och fyrkantig mitt i sagepanelen, och ingen CSS når den — `appearance: none`
          // stylar bara den stängda rutan. `SelectMenu` ritar även listan.
          // `min-h-9` (inte `h-9`) för att matcha sökfältet — se noten i Select.tsx.
          <SelectMenu
            value={salesFilter ?? ''}
            onChange={(v) => onSalesFilterChange(v || null)}
            aria-label="Filtrera backloggen på säljare"
            className="min-h-9 py-0 text-[12.5px]"
            options={[{ value: '', label: 'Alla säljare' }, ...salesOptions.map((s) => ({ value: s.id, label: s.name }))]}
          />
        )}
      </div>

      {/* Filter — defaults to "Oplanerade" so scheduled jobs don't clutter the backlog. */}
      <div className="flex gap-1 px-3.5 pb-2.5">
        {FILTER_TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => onFilterChange(key)}
            className={cn(
              'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-bold transition',
              filter === key ? 'border-[#1a3f26] bg-[#1a3f26] text-white' : 'border-[#e0e8dc] bg-white text-slate-500 hover:border-[#c8d4c3]',
            )}
          >
            {label}
            <span className={cn('tabular-nums', filter === key ? 'text-white/70' : 'text-slate-400')}>{counts[key]}</span>
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-3">
        {loading ? (
          <p className="py-6 text-center text-sm text-slate-400">Laddar…</p>
        ) : items.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-slate-400">{emptyText}</p>
        ) : (
          <div className="grid gap-2">
            {items.map((item) => {
              // Identiteten är `key`, inte `id`: en uppdelad order ger flera poster som delar id.
              const isSelected = item.key === selectedKey;
              return (
                  // Kortet är dragbart; det VALBARA (role=button) är bara innehållet ovanför
                  // placeringsraderna. Raderna är egna knappar och får inte ligga inuti en annan
                  // knapp — det är ogiltigt för skärmläsare, och kortets Enter/klick hade valt
                  // posten samtidigt som raden hoppade.
                  <div
                    key={item.key}
                    draggable={canWrite}
                    onDragStart={(e) => onDragStartItem(e, item)}
                    className={cn(
                      'relative rounded-xl border bg-white p-2.5 pl-3.5 text-left shadow-[0_1px_2px_rgba(20,44,27,0.06)] transition',
                      isSelected ? 'border-emerald-400 ring-2 ring-emerald-500/20' : 'border-[#e0e8dc] hover:border-[#c8d4c3]',
                      canWrite ? 'cursor-grab active:cursor-grabbing' : 'cursor-default',
                    )}
                  >
                    <span className={cn('absolute bottom-2.5 left-0 top-2.5 w-[3px] rounded-full', statusMeta(item.status).rail)} />
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => canWrite && onSelect(item.key)}
                      onKeyDown={(e) => {
                        if ((e.key === 'Enter' || e.key === ' ') && canWrite) {
                          e.preventDefault();
                          onSelect(item.key);
                        }
                      }}
                      className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/30"
                    >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[11px] font-bold text-slate-900">{item.project_name}</span>
                      <JobRef job={item} />
                    </div>
                    {/* Etappen som eget chip, ALDRIG inbakad i referensen: `ref` är Fortnox-numret,
                        det matchas av sökningen och går in i orderbekräftelser. */}
                    {(item.stage || item.is_rest) && (
                      <div className="mt-1">
                        {/* Rest-posten märks lika tydligt som en etapp. Utan den syns bara
                            kundnamnet och ett säckantal, och två poster för samma order såg ut som
                            en dubblett i stället för två olika saker att planera. */}
                        <span
                          className={cn(
                            'whitespace-nowrap rounded-full border px-2 py-px text-[10px] font-bold',
                            item.stage ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-slate-200 bg-slate-50 text-slate-600',
                          )}
                        >
                          {item.stage ? `Etapp ${item.stage.number} · ${item.stage.title}` : 'Resten av ordern'}
                        </span>
                      </div>
                    )}
                    <div className="mt-0.5 text-[10px] text-slate-500">{item.client_name}</div>
                    {item.address && (
                      <div className="flex items-center gap-1 text-[9.5px] text-slate-400">
                        <span className="truncate">{item.address}</span>
                        <MapLink address={item.address} />
                      </div>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <SackBadge sacks={item.total_sacks} />
                      {item.desired_installation_date && (
                        <span className="whitespace-nowrap rounded-full border border-sky-200 bg-sky-50 px-2 py-px text-[10px] font-bold text-sky-700">
                          Önskat {shortDate(item.desired_installation_date)}
                        </span>
                      )}
                      <span className={cn('whitespace-nowrap rounded-full border px-2 py-px text-[10px] font-bold', statusMeta(item.status).pill)}>
                        {statusMeta(item.status).label}
                      </span>
                    </div>
                    </div>
                    <PlacementRows item={item} truckById={truckById} onJump={onJumpToPlacement} />
                  </div>
              );
            })}
          </div>
        )}
      </div>

      {canWrite && (
        <p className="border-t border-[#e8efe5] px-3.5 py-2 text-[10px] text-slate-400">
          Dra ett kort till schemat för att planera — eller dra ett planerat jobb hit för att avplanera.
        </p>
      )}
    </section>
  );
}

// Hur många rader som syns innan resten fälls in bakom "+N till". Två räcker för det vanliga
// (ett jobb, eller ett jobb på två bilar) utan att kortet växer så att backloggen blir svår att skumma.
const VISIBLE_PLACEMENTS = 2;

/**
 * VAR posten ligger på schemat: en rad per kort, med bilens färg som på tavlan. Klick hoppar tavlan
 * dit (PlanningClient → jumpToPlacement).
 *
 * En bil som tagits ur bruk har ingen rad på tavlan, så dess kort går inte att visa där. Raden står
 * kvar — kortet finns — men är inte klickbar och säger varför.
 */
function PlacementRows({
  item,
  truckById,
  onJump,
}: {
  item: SchedulableWorkOrder;
  truckById: ReadonlyMap<string, OpsTruck>;
  onJump: (item: SchedulableWorkOrder, placement: BacklogPlacement) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const list = item.placements;
  if (list.length === 0) return null;
  const shown = expanded ? list : list.slice(0, VISIBLE_PLACEMENTS);
  const rest = list.length - VISIBLE_PLACEMENTS;
  const row = 'flex w-full min-w-0 items-center gap-1.5 rounded-md border-0 px-1 py-[3px] text-left text-[10px] leading-tight';
  return (
    <div className="-mx-1 mt-2 grid gap-px border-t border-[#e8efe5] pt-1.5">
      {shown.map((p) => {
        const truck = truckById.get(p.truck_id);
        const { week, days } = placementDayLabel(p.start_day, p.end_day);
        const body = (
          <>
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: truck?.color || '#cbd5e1' }} />
            <span className={cn('min-w-0 flex-1 truncate font-semibold', truck ? 'text-slate-700' : 'text-slate-400')}>
              {truck?.name ?? 'Bil ur bruk'}
            </span>
            {p.on_hold && (
              <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-1.5 text-[9px] font-bold text-amber-700">Pausad</span>
            )}
            <span className="shrink-0 tabular-nums text-slate-600">
              <span className="text-slate-400">{week}</span> {days}
            </span>
          </>
        );
        if (!truck) {
          return (
            <div key={p.segment_id} className={row} title="Bilen är inte i bruk, så kortet visas inte på tavlan.">
              {body}
              <span className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
            </div>
          );
        }
        return (
          <button
            key={p.segment_id}
            type="button"
            onClick={() => onJump(item, p)}
            title="Visa på tavlan"
            aria-label={`Visa på tavlan: ${truck.name}, ${week} ${days}${p.on_hold ? ', pausad' : ''}`}
            className={cn(row, 'group/row transition hover:bg-[#f3f6f1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/30')}
          >
            {body}
            <svg className="h-2.5 w-2.5 shrink-0 text-slate-300 transition group-hover/row:text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m9 6 6 6-6 6" />
            </svg>
          </button>
        );
      })}
      {rest > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="justify-self-start rounded border-0 px-1 py-0.5 text-[10px] font-semibold text-slate-500 transition hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/30"
        >
          {expanded ? 'Visa färre' : `+${rest} till`}
        </button>
      )}
    </div>
  );
}
