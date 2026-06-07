'use client';

import { useEffect, useMemo, useState } from 'react';
import Input from '../../../components/ui/Input';
import MetricCard from '../components/MetricCard';
import Textarea from '../../../components/ui/Textarea';
import { useToast } from '@/lib/Toast';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';

type SuggestionStatus = 'pending' | 'approved' | 'rejected';

type ApprovedProspect = {
  id: string;
  company_name: string;
} | null;

type SuggestionItem = {
  id: string;
  company_name: string;
  organization_number: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  website: string | null;
  source: string | null;
  rationale: string | null;
  notes: string | null;
  status: SuggestionStatus;
  review_note: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
  approved_prospect: ApprovedProspect;
};

type DraftState = {
  company_name: string;
  organization_number: string;
  contact_name: string;
  phone: string;
  email: string;
  city: string;
  website: string;
  source: string;
  rationale: string;
  notes: string;
};

const initialDraft: DraftState = {
  company_name: '',
  organization_number: '',
  contact_name: '',
  phone: '',
  email: '',
  city: '',
  website: '',
  source: '',
  rationale: '',
  notes: '',
};

const statusLabel: Record<SuggestionStatus, string> = {
  pending: 'Väntar granskning',
  approved: 'Godkänd',
  rejected: 'Avvisad',
};

const statusClass: Record<SuggestionStatus, string> = {
  pending: 'border-amber-200 bg-amber-50 text-amber-800',
  approved: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  rejected: 'border-rose-200 bg-rose-50 text-rose-700',
};

const filterMeta: Record<'all' | SuggestionStatus, { label: string; hint: string }> = {
  pending:  { label: 'Väntar',   hint: 'Klara för granskning' },
  approved: { label: 'Godkända', hint: 'Redan till prospekt' },
  rejected: { label: 'Avvisade', hint: 'Sparade för spårbarhet' },
  all:      { label: 'Alla',     hint: 'Hela granskningskön' },
};

function formatDateTime(value: string | null | undefined) {
  if (!value) return '–';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '–';
  return new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function buildMeta(item: SuggestionItem) {
  return [
    item.contact_name ? `Kontakt: ${item.contact_name}` : null,
    item.city ? `Ort: ${item.city}` : null,
    item.source ? `Källa: ${item.source}` : null,
    item.website ? `Webb: ${item.website}` : null,
  ].filter(Boolean) as string[];
}

export default function AiProspectsClient({ userName }: { userName: string | null }) {
  const toast = useToast();
  const [items, setItems] = useState<SuggestionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | SuggestionStatus>('pending');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftState>(initialDraft);
  const [reviewNote, setReviewNote] = useState('');

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const query = new URLSearchParams();
        if (search.trim()) query.set('q', search.trim());
        if (status) query.set('status', status);

        const res = await fetch(`/api/crm/ai-prospekt?${query.toString()}`, { cache: 'no-store' });
        const json = await res.json().catch(() => ({}));
        if (!active) return;

        if (!res.ok || !json.ok) {
          setError(json?.error || 'Kunde inte ladda AI Prospekt. Har migrationen körts i databasen?');
          setItems([]);
          return;
        }

        const nextItems = Array.isArray(json?.data?.items) ? (json.data.items as SuggestionItem[]) : [];
        setItems(nextItems);
        setSelectedId((current) => {
          if (current && nextItems.some((item) => item.id === current)) return current;
          return nextItems[0]?.id || null;
        });
      } catch {
        if (!active) return;
        setError('Kunde inte ladda AI Prospekt.');
        setItems([]);
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, [search, status]);

  const selected = useMemo(() => items.find((item) => item.id === selectedId) || null, [items, selectedId]);
  const stats = useMemo(() => ({
    pending: items.filter((item) => item.status === 'pending').length,
    approved: items.filter((item) => item.status === 'approved').length,
    rejected: items.filter((item) => item.status === 'rejected').length,
  }), [items]);

  const filterCounts = useMemo(() => ({
    all: items.length,
    pending: items.filter((item) => item.status === 'pending').length,
    approved: items.filter((item) => item.status === 'approved').length,
    rejected: items.filter((item) => item.status === 'rejected').length,
  }), [items]);

  useEffect(() => {
    setReviewNote(selected?.review_note || '');
  }, [selected?.id, selected?.review_note]);

  async function reloadPreservingFilters(nextSelectedId?: string | null) {
    const query = new URLSearchParams();
    if (search.trim()) query.set('q', search.trim());
    if (status) query.set('status', status);

    const res = await fetch(`/api/crm/ai-prospekt?${query.toString()}`, { cache: 'no-store' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) {
      throw new Error(json?.error || 'Kunde inte uppdatera listan');
    }
    const nextItems = Array.isArray(json?.data?.items) ? (json.data.items as SuggestionItem[]) : [];
    setItems(nextItems);
    setSelectedId((current) => {
      const preferred = nextSelectedId ?? current;
      if (preferred && nextItems.some((item) => item.id === preferred)) return preferred;
      return nextItems[0]?.id || null;
    });
  }

  async function createSuggestion() {
    if (!draft.company_name.trim()) {
      setError('Företagsnamn krävs.');
      return;
    }

    setCreating(true);
    setError(null);

    try {
      const res = await fetch('/api/crm/ai-prospekt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        setError(json?.error || 'Kunde inte skapa förslaget.');
        return;
      }

      setDraft(initialDraft);
      toast.success('Förslaget sparades och ligger nu i kön för granskning.');
      await reloadPreservingFilters(json?.data?.item?.id || null);
    } catch {
      setError('Kunde inte skapa förslaget.');
    } finally {
      setCreating(false);
    }
  }

  async function reviewSelected(action: 'approve' | 'reject') {
    if (!selected) return;

    setReviewing(true);
    setError(null);

    try {
      const res = await fetch(`/api/crm/ai-prospekt/${selected.id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, review_note: reviewNote }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        setError(json?.error || 'Kunde inte uppdatera förslaget.');
        return;
      }

      await reloadPreservingFilters(selected.id);
      if (action === 'approve') {
        toast.success(
          json?.data?.approved_prospect?.company_name
            ? `${json.data.approved_prospect.company_name} skapades som nytt prospekt.`
            : 'Förslaget importerades till prospektlistan.',
        );
      } else {
        toast.success('Förslaget avvisades och ligger kvar som granskat för spårbarhet.');
      }
    } catch {
      setError('Kunde inte uppdatera förslaget.');
    } finally {
      setReviewing(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6">
      {/* Page header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className={crm.pageTitle}>AI Prospekt</h1>
          <p className={cn('mt-1', crm.pageSubtitle)}>
            Samla AI-förslag, kvalitetssäkra dem snabbt och släpp bara in det som bör bli riktiga prospekt i CRM-flödet.
          </p>
        </div>
        {userName ? (
          <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700">
            {userName}
          </span>
        ) : null}
      </div>

      {/* Metrics */}
      <div className="hidden gap-4 sm:grid sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Väntar granskning" value={stats.pending} helper="Redo för mänsklig review" />
        <MetricCard label="Godkända" value={stats.approved} helper="Har blivit riktiga prospekt" />
        <MetricCard label="Avvisade" value={stats.rejected} helper="Behålls för spårbarhet" />
        <MetricCard label="Totalt" value={items.length} helper="Alla förslag i kön" />
      </div>

      {/* Filter + search toolbar */}
      <div className={crm.card}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
          <div className="flex flex-wrap gap-2">
            {(['pending', 'approved', 'rejected', 'all'] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setStatus(value)}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-sm font-semibold transition',
                  status === value
                    ? 'text-white'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50',
                )}
                style={status === value ? { backgroundColor: 'var(--crm-primary)', borderColor: 'var(--crm-primary)' } : undefined}
              >
                {filterMeta[value].label}
                <span className={cn('ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold', status === value ? 'bg-white/20' : 'bg-slate-100 text-slate-500')}>
                  {filterCounts[value]}
                </span>
              </button>
            ))}
          </div>
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Sök på företag, kontakt, ort eller webb"
            className="max-w-xs"
          />
        </div>
      </div>

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_420px] xl:items-start">
        {/* Suggestion queue */}
        <div className={crm.card}>
          <div className="border-b border-slate-100 px-5 py-4">
            <h2 className="m-0 text-base font-bold text-slate-900">Förslagskö</h2>
            <p className="m-0 mt-0.5 text-xs text-slate-500">Granska inkomna prospektförslag innan de blir en del av ordinarie CRM-flöde.</p>
          </div>

          <div className="p-4">
            {loading ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-5 py-8 text-center text-sm text-slate-500">
                Laddar AI Prospekt…
              </div>
            ) : items.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-5 py-8 text-center text-sm text-slate-500">
                Inga förslag matchar filtret ännu.
              </div>
            ) : (
              <div className="grid gap-3">
                {items.map((item) => {
                  const active = item.id === selectedId;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSelectedId(item.id)}
                      className={cn(
                        'relative block w-full rounded-2xl border px-4 py-3 text-left transition',
                        active
                          ? 'border-slate-300 bg-slate-50 shadow-[0_2px_8px_rgba(0,0,0,0.06)]'
                          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/60',
                      )}
                    >
                      <span className={cn(
                        'absolute inset-y-0 left-0 w-1 rounded-l-2xl',
                        item.status === 'approved' ? 'bg-emerald-400' : item.status === 'rejected' ? 'bg-rose-300' : 'bg-amber-400',
                      )} />
                      <div className="flex flex-wrap items-center justify-between gap-2 pl-2">
                        <strong className="text-sm font-semibold text-slate-900">{item.company_name}</strong>
                        <span className={cn(crm.badge, active ? 'border-slate-200 bg-white text-slate-700' : statusClass[item.status])}>
                          {statusLabel[item.status]}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 pl-2 text-xs text-slate-400">
                        {buildMeta(item).map((entry) => <span key={entry}>{entry}</span>)}
                      </div>
                      {item.rationale ? (
                        <p className="m-0 mt-1.5 pl-2 text-sm leading-5 text-slate-600">{item.rationale}</p>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right panel */}
        <div className="grid gap-4">
          {/* Add suggestion */}
          <div className={crm.cardInner}>
            <p className="mb-1 text-base font-bold text-slate-900">Lägg till förslag manuellt</p>
            <p className="m-0 mb-4 text-sm text-slate-500">Använd detta som första arbetsyta innan live-AI eller externa källor kopplas på.</p>

            <div className="grid gap-3">
              <Input value={draft.company_name} onChange={(event) => setDraft((current) => ({ ...current, company_name: event.target.value }))} placeholder="Företagsnamn" />
              <div className="grid gap-3 md:grid-cols-2">
                <Input value={draft.contact_name} onChange={(event) => setDraft((current) => ({ ...current, contact_name: event.target.value }))} placeholder="Kontaktperson" />
                <Input value={draft.organization_number} onChange={(event) => setDraft((current) => ({ ...current, organization_number: event.target.value }))} placeholder="Org.nr" />
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <Input value={draft.phone} onChange={(event) => setDraft((current) => ({ ...current, phone: event.target.value }))} placeholder="Telefon" />
                <Input value={draft.email} onChange={(event) => setDraft((current) => ({ ...current, email: event.target.value }))} placeholder="E-post" type="email" />
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <Input value={draft.city} onChange={(event) => setDraft((current) => ({ ...current, city: event.target.value }))} placeholder="Ort" />
                <Input value={draft.website} onChange={(event) => setDraft((current) => ({ ...current, website: event.target.value }))} placeholder="Webbplats" />
              </div>
              <Input value={draft.source} onChange={(event) => setDraft((current) => ({ ...current, source: event.target.value }))} placeholder="Källa, t.ex. research eller tips" />
              <Textarea value={draft.rationale} onChange={(event) => setDraft((current) => ({ ...current, rationale: event.target.value }))} placeholder="Varför känns detta som ett relevant prospekt?" rows={4} />
              <Textarea value={draft.notes} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} placeholder="Anteckningar eller saker att dubbelkolla i granskningen" rows={3} />
              <button
                type="button"
                onClick={createSuggestion}
                disabled={creating}
                className={crm.saveButton}
              >
                {creating ? 'Sparar…' : 'Spara förslag'}
              </button>
            </div>
          </div>

          {/* Review panel */}
          <div className={crm.cardInner}>
            <p className="mb-1 text-base font-bold text-slate-900">Granskning</p>
            <p className="m-0 mb-4 text-sm text-slate-500">Godkänn förslaget till ett riktigt prospekt eller avvisa det med kommentar.</p>

            {!selected ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                Välj ett förslag i kön för att se detaljer och granska det.
              </div>
            ) : (
              <div className="grid gap-4">
                <div className="grid gap-2 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong className="text-base font-bold text-slate-900">{selected.company_name}</strong>
                    <span className={cn(crm.badge, statusClass[selected.status])}>
                      {statusLabel[selected.status]}
                    </span>
                  </div>

                  <div className="grid gap-1 text-sm leading-6 text-slate-600">
                    {selected.organization_number ? <div>Org.nr: {selected.organization_number}</div> : null}
                    {selected.contact_name ? <div>Kontakt: {selected.contact_name}</div> : null}
                    {selected.phone ? <div>Telefon: {selected.phone}</div> : null}
                    {selected.email ? <div>E-post: {selected.email}</div> : null}
                    {selected.city ? <div>Ort: {selected.city}</div> : null}
                    {selected.website ? <div>Webb: {selected.website}</div> : null}
                    {selected.source ? <div>Källa: {selected.source}</div> : null}
                    <div>Skapad: {formatDateTime(selected.created_at)}</div>
                    {selected.reviewed_at ? <div>Granskad: {formatDateTime(selected.reviewed_at)}</div> : null}
                    {selected.approved_prospect ? <div>Importerat som prospekt: {selected.approved_prospect.company_name}</div> : null}
                  </div>
                </div>

                {selected.rationale ? (
                  <div className="grid gap-1.5 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                    <strong className="text-sm font-semibold text-slate-900">Motivering</strong>
                    <p className="m-0 text-sm leading-5 text-slate-600">{selected.rationale}</p>
                  </div>
                ) : null}

                {selected.notes ? (
                  <div className="grid gap-1.5 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
                    <strong className="text-sm font-semibold text-slate-900">Anteckningar</strong>
                    <p className="m-0 text-sm leading-5 text-slate-600">{selected.notes}</p>
                  </div>
                ) : null}

                <Textarea
                  value={reviewNote}
                  onChange={(event) => setReviewNote(event.target.value)}
                  placeholder="Kommentar till granskningen, t.ex. varför förslaget godkändes eller avvisades"
                  rows={4}
                />

                {selected.status === 'pending' ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => reviewSelected('approve')}
                      disabled={reviewing}
                      className={crm.saveButton}
                    >
                      {reviewing ? 'Arbetar…' : 'Godkänn till prospekt'}
                    </button>
                    <button
                      type="button"
                      onClick={() => reviewSelected('reject')}
                      disabled={reviewing}
                      className={crm.ghostButton}
                    >
                      {reviewing ? 'Arbetar…' : 'Avvisa förslaget'}
                    </button>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                    Förslaget är redan granskat. Status och granskningsspår ligger kvar för uppföljning.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
