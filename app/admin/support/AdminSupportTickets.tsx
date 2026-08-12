"use client";

import React from 'react';
import { cn } from '../../../lib/shared/cn';
import { crm } from '../../crm/lib/crmTokens';
import Textarea from '../../../components/ui/Textarea';
import Select from '../../../components/ui/Select';
import { ticketKindGlyph, ticketKindGlyphClass, ticketStatusMeta } from '../../_lib/supportTokens';
import {
  TICKET_KINDS,
  TICKET_STATUSES,
  kindLabel,
  statusLabel,
  type AppTicketDetailView,
  type AppTicketView,
  type TicketKind,
  type TicketStatus,
} from '../../../lib/domains/support/types';

// Admin → Ärenden. Backloggen för buggar och önskemål om appen.
//
// VAD VYN ÄR TILL FÖR: att svara på "vad är kvar" utan att någon behöver minnas. Därför öppnar den
// på det som ÄR kvar (state=open) i stället för allt — en lista där klart och blir-inte-av ligger
// blandat med nytt blir en logg, inte en backlog. Klara ärenden finns ett klick bort.
//
// OBS preflight är av (tailwind.config.js): `border` på en <div>/<span> ritar ingen linje utan
// `border-solid`. <button> får däremot `border: 1px solid transparent` från globals.css, så
// listraderna (som ÄR knappar) ritar sina kanter utan tillägget.

type StateFilter = 'open' | 'closed' | 'any';

const STATE_LABEL: Record<StateFilter, string> = {
  open: 'Kvar att göra',
  closed: 'Avslutade',
  any: 'Alla',
};

export default function AdminSupportTickets() {
  const [items, setItems] = React.useState<AppTicketView[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [stateFilter, setStateFilter] = React.useState<StateFilter>('open');
  const [kindFilter, setKindFilter] = React.useState<TicketKind | 'all'>('all');
  const [openId, setOpenId] = React.useState<string | null>(null);

  // Samma kapplöpningsvakt som attestvyn: byter man filter snabbt kan ett tidigare svar landa
  // sist och rita fel urval.
  const loadSeq = React.useRef(0);

  const load = React.useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ scope: 'all', state: stateFilter });
      if (kindFilter !== 'all') params.set('kind', kindFilter);
      const res = await fetch(`/api/support/tickets?${params.toString()}`, { cache: 'no-store', credentials: 'same-origin' });
      const body = await res.json().catch(() => null);
      if (seq !== loadSeq.current) return;
      if (!res.ok || !body?.ok) throw new Error(body?.error || `Fel (${res.status})`);
      setItems((body.data.items || []) as AppTicketView[]);
    } catch (e) {
      if (seq !== loadSeq.current) return;
      setError((e as Error).message);
      // Töm listan vid fel. Står gamla rader kvar under felrutan ser vyn ut att ha svarat.
      setItems([]);
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [stateFilter, kindFilter]);

  React.useEffect(() => { load(); }, [load]);

  // Djuplänk ur notisen: /admin?tab=arenden&arende=<id>. Öppnas en gång per id, inte vid varje
  // omladdning — en sparning laddar om listan och hade annars slagit upp panelen igen.
  const openedDeepLink = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const id = new URLSearchParams(window.location.search).get('arende');
    if (!id || openedDeepLink.current === id) return;
    openedDeepLink.current = id;
    setOpenId(id);
    // Ett djuplänkat ärende kan vara avslutat — visa allt, annars öppnas en panel för en rad som
    // inte finns i urvalet.
    setStateFilter('any');
  }, []);

  const counts = React.useMemo(() => {
    const byStatus = new Map<TicketStatus, number>();
    for (const t of items) byStatus.set(t.status, (byStatus.get(t.status) || 0) + 1);
    return byStatus;
  }, [items]);

  return (
    // p-5 matchar de andra adminflikarna (Behörigheter, Tidkoder) — AdminTabsClient lägger inget
    // innerutrymme i sitt kort.
    <div className="grid gap-4 p-5">
      <div className="grid gap-1">
        <h2 className="m-0 text-lg font-bold text-slate-900">Ärenden</h2>
        <p className="m-0 text-sm text-slate-600">
          Buggar och önskemål som rapporterats i appen via Rapportera-knappen. Sätt status, svara
          rapportören, och publicera det som är klart i changeloggen.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(['open', 'closed', 'any'] as StateFilter[]).map((s) => (
          <FilterChip key={s} active={stateFilter === s} onClick={() => setStateFilter(s)}>
            {STATE_LABEL[s]}
          </FilterChip>
        ))}
        <span className="mx-1 h-5 w-px shrink-0 bg-slate-200" aria-hidden />
        <FilterChip active={kindFilter === 'all'} onClick={() => setKindFilter('all')}>
          Allt
        </FilterChip>
        {TICKET_KINDS.map((k) => (
          <FilterChip key={k} active={kindFilter === k} onClick={() => setKindFilter(k)}>
            {kindLabel[k]}
          </FilterChip>
        ))}
      </div>

      {error ? (
        <div className="rounded-xl border border-solid border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      ) : null}

      {!loading && !error && items.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {TICKET_STATUSES.filter((s) => (counts.get(s) || 0) > 0).map((s) => (
            <span key={s} className={cn(crm.badge, 'border-solid', ticketStatusMeta[s].badge)}>
              {counts.get(s)} {statusLabel[s].toLowerCase()}
            </span>
          ))}
        </div>
      ) : null}

      {loading ? (
        <p className="m-0 text-sm text-slate-400">Laddar…</p>
      ) : items.length === 0 && !error ? (
        <div className="rounded-2xl border border-dashed border-[#d5e0cf] bg-[#f4f8f1] px-4 py-8 text-center">
          <p className="m-0 text-sm text-slate-500">
            {stateFilter === 'open' ? 'Inget kvar att göra just nu.' : 'Inga ärenden att visa.'}
          </p>
        </div>
      ) : (
        <ul role="list" className="m-0 grid list-none gap-1 p-0">
          {items.map((ticket) => (
            <li key={ticket.id}>
              <TicketRow
                ticket={ticket}
                open={openId === ticket.id}
                onToggle={() => setOpenId(openId === ticket.id ? null : ticket.id)}
                onSaved={load}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full border px-2.5 py-1 text-[13px] font-semibold transition-colors',
        active
          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
          : 'border-[#e0e8dc] bg-white text-slate-600 hover:border-emerald-200',
      )}
    >
      {children}
    </button>
  );
}

function TicketRow({
  ticket,
  open,
  onToggle,
  onSaved,
}: {
  ticket: AppTicketView;
  open: boolean;
  onToggle: () => void;
  onSaved: () => void;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-solid border-[#e0e8dc] bg-white">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-stretch !border-0 bg-white text-left transition-colors hover:bg-[#f9fbf7]"
      >
        <span className={cn('w-1.5 shrink-0', ticketStatusMeta[ticket.status].accent)} aria-hidden />
        <span className="grid flex-1 gap-0.5 px-3 py-2">
          <span className="flex flex-wrap items-center gap-2">
            <span
              aria-hidden
              className={cn(
                'grid h-4 w-4 shrink-0 place-items-center rounded-full text-[11px] font-bold',
                ticketKindGlyphClass[ticket.kind],
              )}
            >
              {ticketKindGlyph[ticket.kind]}
            </span>
            <span className="text-[13px] font-bold text-slate-900">{ticket.title}</span>
            <span className={cn(crm.badge, 'border-solid', ticketStatusMeta[ticket.status].badge)}>
              {ticket.status_label}
            </span>
            {ticket.changelog_published_at ? (
              <span className={cn(crm.badge, 'border-solid border-emerald-200 bg-white text-emerald-700')}>
                I changeloggen
              </span>
            ) : null}
          </span>
          <span className="text-[11px] text-slate-400">
            {ticket.reporter_name} · {ticket.area_label} · {formatDate(ticket.created_at)}
            {ticket.has_screenshot ? ' · Skärmbild' : ''}
          </span>
        </span>
      </button>

      {open ? <TicketPanel ticket={ticket} onSaved={onSaved} /> : null}
    </div>
  );
}

function TicketPanel({ ticket, onSaved }: { ticket: AppTicketView; onSaved: () => void }) {
  const [detail, setDetail] = React.useState<AppTicketDetailView | null>(null);
  const [status, setStatus] = React.useState<TicketStatus>(ticket.status);
  const [resolution, setResolution] = React.useState(ticket.resolution || '');
  const [changelogNote, setChangelogNote] = React.useState(ticket.changelog_note || '');
  const [publish, setPublish] = React.useState(!!ticket.changelog_published_at);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  // Detaljhämtningen ger beskrivningen, sökvägen och en signerad URL till skärmbilden.
  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/support/tickets/${ticket.id}`, { cache: 'no-store', credentials: 'same-origin' });
        const body = await res.json().catch(() => null);
        if (!alive || !res.ok || !body?.ok) return;
        const item = body.data.item as AppTicketDetailView;
        setDetail(item);
        // Formulärets fält synkas mot det färska svaret — listraden kan vara någon minut gammal.
        setStatus(item.status);
        setResolution(item.resolution || '');
        setChangelogNote(item.changelog_note || '');
        setPublish(!!item.changelog_published_at);
      } catch {
        /* listradens data räcker för att visa panelen */
      }
    })();
    return () => { alive = false; };
  }, [ticket.id]);

  const save = async () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/support/tickets/${ticket.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          status,
          resolution: resolution.trim() || null,
          changelog_note: changelogNote.trim() || null,
          publish_to_changelog: publish,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) throw new Error(body?.error || `Fel (${res.status})`);
      setNotice('Sparat.');
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const description = detail?.description ?? ticket.description;
  const pagePath = detail?.page_path ?? ticket.page_path;

  return (
    <div className="grid gap-4 border-t border-solid border-slate-100 bg-[#f9fbf7] px-3 py-3">
      <div className="grid gap-1">
        <span className={crm.label}>{ticket.kind === 'bug' ? 'Vad händer' : 'Önskemål'}</span>
        <p className="m-0 whitespace-pre-wrap text-sm text-slate-800">{description}</p>
      </div>

      {pagePath ? (
        <div className="grid gap-1">
          <span className={crm.label}>Rapporterat från</span>
          <code className="w-fit max-w-full overflow-x-auto rounded border border-solid border-[#dce4d8] bg-white px-1.5 py-0.5 font-mono text-[11px] text-slate-600">
            {pagePath}
          </code>
        </div>
      ) : null}

      {detail?.screenshot_url ? (
        <div className="grid gap-1">
          <span className={crm.label}>Skärmbild</span>
          <a href={detail.screenshot_url} target="_blank" rel="noreferrer" className="block w-fit max-w-full">
            {/* eslint-disable-next-line @next/next/no-img-element -- signerad storage-URL, kan inte
                gå genom bildoptimeringen */}
            <img
              src={detail.screenshot_url}
              alt={`Skärmbild från ${ticket.reporter_name}`}
              className="max-h-72 rounded-lg border border-solid border-[#dce4d8] bg-white object-contain"
            />
          </a>
        </div>
      ) : ticket.has_screenshot ? (
        <p className="m-0 text-[12px] text-slate-400">Skärmbilden kunde inte hämtas.</p>
      ) : null}

      <div className="grid gap-3 border-t border-solid border-[#e0e8dc] pt-3 sm:grid-cols-[10rem_1fr] sm:items-start">
        <div className="grid gap-1.5">
          <label htmlFor={`status-${ticket.id}`} className={crm.label}>Status</label>
          <Select
            id={`status-${ticket.id}`}
            value={status}
            onChange={(e) => setStatus(e.target.value as TicketStatus)}
            disabled={saving}
          >
            {TICKET_STATUSES.map((s) => (
              <option key={s} value={s}>{statusLabel[s]}</option>
            ))}
          </Select>
        </div>

        <div className="grid gap-1.5">
          <label htmlFor={`resolution-${ticket.id}`} className={crm.label}>Svar till rapportören</label>
          <Textarea
            id={`resolution-${ticket.id}`}
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
            placeholder="Vad gjordes, eller varför blir det inte av?"
            className="min-h-[80px]"
            disabled={saving}
          />
        </div>
      </div>

      <div className="grid gap-2 border-t border-solid border-[#e0e8dc] pt-3">
        <label htmlFor={`changelog-${ticket.id}`} className={crm.label}>Changelog-text</label>
        <Textarea
          id={`changelog-${ticket.id}`}
          value={changelogNote}
          onChange={(e) => setChangelogNote(e.target.value)}
          placeholder="En rad som beskriver ändringen för alla i appen."
          className="min-h-[60px]"
          maxLength={500}
          disabled={saving}
        />
        <label className="flex items-center gap-2 text-[13px] text-slate-700">
          <input
            type="checkbox"
            checked={publish}
            onChange={(e) => setPublish(e.target.checked)}
            disabled={saving}
            className="!w-4 shrink-0"
          />
          Visa i changeloggen
        </label>
        <p className="m-0 text-[12px] text-slate-500">
          Kräver status <strong>Klar</strong> och en text. Changelog-vyn byggs härnäst — texten
          sparas redan nu.
        </p>
      </div>

      {error ? (
        <div className="rounded-xl border border-solid border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
      ) : null}
      {notice ? (
        <div className="rounded-xl border border-solid border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</div>
      ) : null}

      <div>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className={cn(crm.formButton)}
          style={{ backgroundColor: 'var(--crm-primary)' }}
        >
          {saving ? 'Sparar…' : 'Spara ärendet'}
        </button>
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('sv-SE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date);
}
