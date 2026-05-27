'use client';

import { useEffect, useMemo, useState } from 'react';
import Input from '../../../components/ui/Input';
import SectionCard from '../../../components/ui/SectionCard';
import Textarea from '../../../components/ui/Textarea';
import { useToast } from '@/lib/Toast';

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
    <div className="grid gap-4">
      <SectionCard className="overflow-hidden border-slate-200 bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.12),_transparent_30%),radial-gradient(circle_at_top_right,_rgba(16,185,129,0.10),_transparent_28%),linear-gradient(180deg,#fbfeff_0%,#f8fafc_100%)] p-5 shadow-[0_24px_70px_rgba(15,23,42,0.08)] md:p-6">
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start">
          <div className="grid gap-4">
            <div className="inline-flex w-fit items-center rounded-full border border-sky-200/80 bg-white/85 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-sky-900 shadow-[0_8px_18px_rgba(255,255,255,0.35)]">
              CRM / AI Prospekt
            </div>
            <div className="grid gap-2">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="m-0 text-[clamp(2rem,4vw,3.2rem)] font-bold tracking-[-0.06em] text-slate-950">AI Prospekt</h1>
                <div className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-900">Mänsklig granskningskö</div>
              </div>
              <p className="m-0 max-w-3xl text-sm leading-6 text-slate-600 md:text-[15px]">
                Den här första versionen bygger inte live-AI ännu. I stället skapas och granskas prospektförslag i en separat kö innan de godkänns in i vanliga prospekt.
              </p>
            </div>
          </div>

          <div className="grid gap-3 rounded-[28px] border border-slate-200/80 bg-[linear-gradient(180deg,rgba(15,23,42,0.94)_0%,rgba(30,41,59,0.92)_100%)] p-4 text-white shadow-[0_22px_44px_rgba(15,23,42,0.22)]">
            <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-sky-100/80">I detta pass</span>
            <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-slate-200">
              <strong className="block text-white">{userName || 'CRM-användare'}</strong>
              Fokus ligger på att kvalitetssäkra vilka förslag som faktiskt ska bli riktiga prospekt.
            </div>
            <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3 backdrop-blur-sm">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-300">Väntar</div>
                <div className="mt-1 text-xl font-bold tracking-[-0.04em] text-white">{stats.pending}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3 backdrop-blur-sm">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-300">Godkända</div>
                <div className="mt-1 text-xl font-bold tracking-[-0.04em] text-white">{stats.approved}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3 backdrop-blur-sm">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-300">Avvisade</div>
                <div className="mt-1 text-xl font-bold tracking-[-0.04em] text-white">{stats.rejected}</div>
              </div>
            </div>
          </div>
        </div>
      </SectionCard>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_420px] xl:items-start">
        <SectionCard className="grid gap-4 border-slate-200 bg-white/90 p-5 md:p-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="grid gap-1">
              <strong className="text-base font-bold text-slate-950">Förslagskö</strong>
              <p className="m-0 text-sm leading-6 text-slate-600">Här granskar du inkomna prospektförslag innan de blir en del av ordinarie CRM-flöde.</p>
            </div>

            <div className="flex flex-wrap gap-2">
              {([
                ['pending', 'Väntar'],
                ['approved', 'Godkända'],
                ['rejected', 'Avvisade'],
                ['all', 'Alla'],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setStatus(value)}
                  className={status === value
                    ? 'rounded-full border border-slate-900 bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white'
                    : 'rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50'}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Sök på företag, kontakt, e-post, ort eller webb"
            className="border-slate-200 bg-white"
          />

          {error ? <div className="rounded-[20px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

          {loading ? (
            <div className="rounded-[24px] border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-center text-sm text-slate-600">
              Laddar AI Prospekt…
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-[24px] border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-center text-sm text-slate-600">
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
                    className={active
                      ? 'grid gap-2 rounded-[24px] border border-slate-900 bg-slate-900 px-4 py-4 text-left text-white shadow-[0_16px_30px_rgba(15,23,42,0.14)]'
                      : 'grid gap-2 rounded-[24px] border border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] px-4 py-4 text-left text-slate-900 shadow-[0_12px_24px_rgba(15,23,42,0.05)] transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_18px_32px_rgba(15,23,42,0.08)]'}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <strong className="text-base font-bold tracking-[-0.03em]">{item.company_name}</strong>
                      <span className={active ? 'rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold text-white' : `rounded-full border px-3 py-1 text-xs font-semibold ${statusClass[item.status]}`}>
                        {statusLabel[item.status]}
                      </span>
                    </div>
                    <div className={active ? 'flex flex-wrap gap-x-2 gap-y-1 text-xs text-slate-300' : 'flex flex-wrap gap-x-2 gap-y-1 text-xs text-slate-500'}>
                      {buildMeta(item).map((entry) => <span key={entry}>{entry}</span>)}
                    </div>
                    {item.rationale ? (
                      <p className={active ? 'm-0 text-sm leading-6 text-slate-200' : 'm-0 text-sm leading-6 text-slate-600'}>
                        {item.rationale}
                      </p>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
        </SectionCard>

        <div className="grid gap-4">
          <SectionCard className="grid gap-4 border-slate-200 bg-white/90 p-5 md:p-6">
            <div className="grid gap-1">
              <strong className="text-base font-bold text-slate-950">Lägg till förslag manuellt</strong>
              <p className="m-0 text-sm leading-6 text-slate-600">Använd detta som första arbetsyta innan live-AI eller externa källor kopplas på.</p>
            </div>

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
              <Textarea value={draft.notes} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} placeholder="Anteckningar eller saker att dubbelkolla i granskningen" rows={4} />
              <button
                type="button"
                onClick={createSuggestion}
                disabled={creating}
                className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-sky-600 bg-[linear-gradient(180deg,#0ea5e9_0%,#0284c7_100%)] px-4 py-2 text-sm font-semibold text-white shadow-[0_16px_26px_rgba(2,132,199,0.22)] transition hover:brightness-[0.97] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {creating ? 'Sparar…' : 'Spara förslag'}
              </button>
            </div>
          </SectionCard>

          <SectionCard className="grid gap-4 border-slate-200 bg-white/90 p-5 md:p-6">
            <div className="grid gap-1">
              <strong className="text-base font-bold text-slate-950">Granskning</strong>
              <p className="m-0 text-sm leading-6 text-slate-600">Godkänn förslaget till ett riktigt prospekt eller avvisa det med kommentar.</p>
            </div>

            {!selected ? (
              <div className="rounded-[22px] border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-600">
                Välj ett förslag i kön för att se detaljer och granska det.
              </div>
            ) : (
              <div className="grid gap-4">
                <div className="grid gap-2 rounded-[24px] border border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] px-4 py-4 shadow-[0_12px_24px_rgba(15,23,42,0.05)]">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong className="text-base font-bold tracking-[-0.03em] text-slate-950">{selected.company_name}</strong>
                    <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusClass[selected.status]}`}>
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
                  <div className="grid gap-2 rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4">
                    <strong className="text-sm font-semibold text-slate-950">Motivering</strong>
                    <p className="m-0 text-sm leading-6 text-slate-600">{selected.rationale}</p>
                  </div>
                ) : null}

                {selected.notes ? (
                  <div className="grid gap-2 rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4">
                    <strong className="text-sm font-semibold text-slate-950">Anteckningar</strong>
                    <p className="m-0 text-sm leading-6 text-slate-600">{selected.notes}</p>
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
                      className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-emerald-600 bg-[linear-gradient(180deg,#10b981_0%,#059669_100%)] px-4 py-2 text-sm font-semibold text-white shadow-[0_16px_26px_rgba(5,150,105,0.18)] transition hover:brightness-[0.97] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {reviewing ? 'Arbetar…' : 'Godkänn till prospekt'}
                    </button>
                    <button
                      type="button"
                      onClick={() => reviewSelected('reject')}
                      disabled={reviewing}
                      className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 transition hover:border-rose-300 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {reviewing ? 'Arbetar…' : 'Avvisa förslaget'}
                    </button>
                  </div>
                ) : (
                  <div className="rounded-[22px] border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-600">
                    Förslaget är redan granskat. Status och granskningsspår ligger kvar för uppföljning.
                  </div>
                )}
              </div>
            )}
          </SectionCard>
        </div>
      </div>
    </div>
  );
}