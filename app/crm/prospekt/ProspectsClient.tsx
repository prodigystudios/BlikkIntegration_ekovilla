"use client";

import { useEffect, useMemo, useState } from 'react';
import Input from '../../../components/ui/Input';
import Textarea from '../../../components/ui/Textarea';
import { useToast } from '@/lib/Toast';
import { cn } from '@/lib/shared/cn';

type ProspectItem = {
  id: string;
  company_name: string;
  organization_number: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  street_address: string | null;
  postal_code: string | null;
  city: string | null;
  source: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type CreateProspectDraft = {
  company_name: string;
  organization_number: string;
  contact_name: string;
  phone: string;
  email: string;
  street_address: string;
  postal_code: string;
  city: string;
  source: string;
  notes: string;
};

const initialDraft: CreateProspectDraft = {
  company_name: '',
  organization_number: '',
  contact_name: '',
  phone: '',
  email: '',
  street_address: '',
  postal_code: '',
  city: '',
  source: '',
  notes: '',
};

function formatDateTime(value: string | null | undefined) {
  if (!value) return '–';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '–';
  return new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function getInitials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('');
}

export default function ProspectsClient() {
  const toast = useToast();
  const [items, setItems] = useState<ProspectItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [createPanelOpen, setCreatePanelOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<CreateProspectDraft>(initialDraft);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailEditing, setDetailEditing] = useState(false);
  const [savingDetail, setSavingDetail] = useState(false);
  const [detailDraft, setDetailDraft] = useState<CreateProspectDraft>(initialDraft);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const query = new URLSearchParams();
        if (search.trim()) query.set('q', search.trim());
        const res = await fetch(`/api/crm/prospects${query.size > 0 ? `?${query.toString()}` : ''}`, { cache: 'no-store' });
        const json = await res.json().catch(() => ({}));
        if (!active) return;
        if (!res.ok || !json.ok) {
          setError(json?.error || 'Kunde inte ladda prospekt.');
          setItems([]);
          return;
        }
        const nextItems = Array.isArray(json?.data?.items) ? (json.data.items as ProspectItem[]) : [];
        setItems(nextItems);
        setSelectedId((current) => {
          if (current && nextItems.some((item) => item.id === current)) return current;
          return nextItems[0]?.id || null;
        });
      } catch {
        if (!active) return;
        setError('Kunde inte ladda prospekt.');
        setItems([]);
      } finally {
        if (active) setLoading(false);
      }
    }

    load();
    return () => { active = false; };
  }, [search]);

  const selected = useMemo(() => items.find((item) => item.id === selectedId) || null, [items, selectedId]);

  useEffect(() => {
    if (!selected) return;
    setDetailDraft({
      company_name: selected.company_name,
      organization_number: selected.organization_number || '',
      contact_name: selected.contact_name || '',
      phone: selected.phone || '',
      email: selected.email || '',
      street_address: selected.street_address || '',
      postal_code: selected.postal_code || '',
      city: selected.city || '',
      source: selected.source || '',
      notes: selected.notes || '',
    });
  }, [selected]);

  useEffect(() => {
    if (!(createPanelOpen || detailOpen)) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [createPanelOpen, detailOpen]);

  async function createProspect() {
    if (!draft.company_name.trim()) {
      toast.error('Företagsnamn krävs');
      return;
    }
    setCreating(true);
    try {
      const res = await fetch('/api/crm/prospects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...draft, status: undefined }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        toast.error(json?.error || 'Kunde inte skapa prospekt');
        return;
      }
      const item = json?.data?.item as ProspectItem | undefined;
      if (item) {
        setItems((current) => [item, ...current]);
        setSelectedId(item.id);
      }
      setDraft(initialDraft);
      setCreatePanelOpen(false);
      toast.success('Prospekt skapat');
    } catch {
      toast.error('Fel vid skapande av prospekt');
    } finally {
      setCreating(false);
    }
  }

  async function saveDetail() {
    if (!selected) return;
    if (!detailDraft.company_name.trim()) {
      toast.error('Företagsnamn krävs');
      return;
    }
    setSavingDetail(true);
    try {
      const res = await fetch(`/api/crm/prospects/${selected.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(detailDraft),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        toast.error(json?.error || 'Kunde inte uppdatera prospekt');
        return;
      }
      const item = json?.data?.item as ProspectItem | undefined;
      if (item) {
        setItems((current) => current.map((entry) => (entry.id === item.id ? item : entry)));
      }
      setDetailEditing(false);
      toast.success('Prospekt uppdaterat');
    } catch {
      toast.error('Fel vid uppdatering av prospekt');
    } finally {
      setSavingDetail(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="m-0 text-2xl font-bold tracking-tight text-slate-900">Prospekt</h1>
          <p className="m-0 mt-1 text-sm text-slate-500">Kundregister över potentiella kunder</p>
        </div>
        <button
          type="button"
          onClick={() => setCreatePanelOpen(true)}
          className="inline-flex items-center rounded-xl px-4 py-2 text-sm font-semibold text-white transition"
          style={{ backgroundColor: 'var(--crm-primary)' }}
        >
          + Lägg till prospekt
        </button>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_2px_12px_rgba(0,0,0,0.04)]">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Sök på företag, kontakt, e-post eller ort"
            className="max-w-sm"
          />
          <span className="text-sm text-slate-500">{items.length} prospekt</span>
        </div>

        {error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        ) : null}

        {loading ? (
          <div className="grid gap-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="grid gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                <div className="h-3 w-40 rounded-full bg-slate-200" />
                <div className="h-3 w-24 rounded-full bg-slate-200" />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="grid gap-2 rounded-[24px] border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-center">
            <strong className="text-base font-bold text-slate-900">Inga prospekt registrerade</strong>
            <p className="m-0 text-sm leading-6 text-slate-600">
              Lägg till ditt första prospekt för att komma igång.
            </p>
          </div>
        ) : (
          <div className="grid gap-2">
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => { setSelectedId(item.id); setDetailOpen(true); }}
                className={cn(
                  'grid grid-cols-[auto_1fr_auto] items-center gap-4 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left shadow-[0_4px_12px_rgba(15,23,42,0.04)] transition hover:border-slate-300 hover:shadow-[0_8px_20px_rgba(15,23,42,0.07)]',
                  selectedId === item.id ? 'ring-1 ring-emerald-300' : null,
                )}
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-xs font-bold tracking-[0.06em] text-slate-700">
                  {getInitials(item.company_name) || 'P'}
                </div>
                <div className="min-w-0 grid gap-0.5">
                  <strong className="truncate text-sm font-semibold text-slate-900">{item.company_name}</strong>
                  <span className="truncate text-xs text-slate-500">
                    {[item.contact_name, item.city, item.source].filter(Boolean).join(' · ') || 'Ingen ytterligare information'}
                  </span>
                </div>
                <div className="shrink-0 text-right">
                  <span className="text-xs text-slate-400">{formatDateTime(item.updated_at)}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Skapa-panel */}
      {createPanelOpen ? (
        <div className="fixed inset-0 z-[2800] flex items-end justify-center bg-slate-950/45 p-3 [backdrop-filter:blur(4px)] sm:items-center sm:p-4" onClick={() => setCreatePanelOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Skapa prospekt"
            onClick={(e) => e.stopPropagation()}
            className="grid w-full max-w-[760px] gap-4 rounded-[28px] border border-white/70 bg-[linear-gradient(180deg,#ffffff_0%,#f5faf8_100%)] p-4 shadow-[0_30px_80px_rgba(15,23,42,0.28)] sm:max-h-[88vh] sm:overflow-y-auto sm:p-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="grid gap-1">
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Nytt prospekt</span>
                <strong className="text-[1.6rem] font-bold tracking-[-0.05em] text-slate-950">Lägg in kunden</strong>
                <p className="m-0 max-w-2xl text-sm leading-6 text-slate-600">
                  Registrera kontaktuppgifterna. Du kan skapa affärsmöjligheter härifrån när köpintresse finns.
                </p>
              </div>
              <button type="button" onClick={() => setCreatePanelOpen(false)} className="inline-flex min-h-10 items-center justify-center rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 hover:border-slate-300 hover:text-slate-900">
                Stäng
              </button>
            </div>
            <div className="grid gap-3 rounded-[28px] border border-white/80 bg-white/92 p-4 shadow-[0_20px_44px_rgba(15,23,42,0.06)]">
              <Input value={draft.company_name} onChange={(e) => setDraft((c) => ({ ...c, company_name: e.target.value }))} placeholder="Företagsnamn" />
              <div className="grid gap-3 sm:grid-cols-2">
                <Input value={draft.contact_name} onChange={(e) => setDraft((c) => ({ ...c, contact_name: e.target.value }))} placeholder="Kontaktperson" />
                <Input value={draft.organization_number} onChange={(e) => setDraft((c) => ({ ...c, organization_number: e.target.value }))} placeholder="Org.nr" />
                <Input value={draft.phone} onChange={(e) => setDraft((c) => ({ ...c, phone: e.target.value }))} placeholder="Telefon" />
                <Input value={draft.email} onChange={(e) => setDraft((c) => ({ ...c, email: e.target.value }))} placeholder="E-post" type="email" />
                <Input value={draft.city} onChange={(e) => setDraft((c) => ({ ...c, city: e.target.value }))} placeholder="Ort" />
                <Input value={draft.source} onChange={(e) => setDraft((c) => ({ ...c, source: e.target.value }))} placeholder="Källa, t.ex. Excel eller manuell" />
              </div>
              <Textarea value={draft.notes} onChange={(e) => setDraft((c) => ({ ...c, notes: e.target.value }))} placeholder="Anteckning eller sammanhang" className="min-h-[100px]" />
              <div className="flex flex-wrap items-center justify-end gap-2">
                <button type="button" onClick={() => setCreatePanelOpen(false)} className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 hover:border-slate-300 hover:text-slate-900">
                  Avbryt
                </button>
                <button type="button" onClick={createProspect} disabled={creating} className="inline-flex min-h-12 items-center justify-center rounded-2xl border border-emerald-600 bg-[linear-gradient(180deg,#14b87a_0%,#0f9f6c_100%)] px-4 py-3 text-sm font-semibold text-white shadow-[0_20px_34px_rgba(16,185,129,0.22)] transition hover:brightness-[0.97] disabled:cursor-not-allowed disabled:opacity-60">
                  {creating ? 'Sparar…' : 'Skapa prospekt'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Detaljpanel */}
      {detailOpen && selected ? (
        <div className="fixed inset-0 z-[2800] flex items-end justify-center bg-slate-950/45 p-3 [backdrop-filter:blur(4px)] sm:items-center sm:p-4" onClick={() => setDetailOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Prospekt ${selected.company_name}`}
            onClick={(e) => e.stopPropagation()}
            className="grid w-full max-w-[860px] gap-4 rounded-[28px] border border-white/70 bg-[linear-gradient(180deg,#ffffff_0%,#f6faf8_100%)] p-4 shadow-[0_30px_80px_rgba(15,23,42,0.28)] sm:max-h-[88vh] sm:overflow-y-auto sm:p-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="grid gap-1">
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Prospekt</span>
                <strong className="text-[1.45rem] font-bold tracking-[-0.05em] text-slate-950">{selected.company_name}</strong>
                <p className="m-0 text-sm text-slate-500">Uppdaterad {formatDateTime(selected.updated_at)}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setDetailEditing((c) => !c)}
                  className="inline-flex min-h-10 items-center justify-center rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 hover:border-slate-300 hover:text-slate-900"
                >
                  {detailEditing ? 'Avsluta redigering' : 'Redigera'}
                </button>
                <a
                  href={`/crm/affarsmojligheter`}
                  className="inline-flex min-h-10 items-center justify-center rounded-full border border-emerald-600 bg-[linear-gradient(180deg,#14b87a_0%,#0f9f6c_100%)] px-3 py-2 text-sm font-semibold text-white transition hover:brightness-[0.97]"
                >
                  + Affärsmöjlighet
                </a>
                <a
                  href={`/crm/samtal?prospect_id=${selected.id}`}
                  className="inline-flex min-h-10 items-center justify-center rounded-full border border-slate-900 bg-slate-900 px-3 py-2 text-sm font-semibold text-white transition hover:bg-slate-950"
                >
                  Logga samtal
                </a>
                <button type="button" onClick={() => setDetailOpen(false)} className="inline-flex min-h-10 items-center justify-center rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 hover:border-slate-300 hover:text-slate-900">
                  Stäng
                </button>
              </div>
            </div>

            {detailEditing ? (
              <div className="grid gap-3 rounded-[20px] border border-white/80 bg-white/90 p-3 shadow-[0_12px_24px_rgba(15,23,42,0.04)]">
                <Input value={detailDraft.company_name} onChange={(e) => setDetailDraft((c) => ({ ...c, company_name: e.target.value }))} placeholder="Företagsnamn" />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input value={detailDraft.contact_name} onChange={(e) => setDetailDraft((c) => ({ ...c, contact_name: e.target.value }))} placeholder="Kontaktperson" />
                  <Input value={detailDraft.organization_number} onChange={(e) => setDetailDraft((c) => ({ ...c, organization_number: e.target.value }))} placeholder="Org.nr" />
                  <Input value={detailDraft.phone} onChange={(e) => setDetailDraft((c) => ({ ...c, phone: e.target.value }))} placeholder="Telefon" />
                  <Input value={detailDraft.email} onChange={(e) => setDetailDraft((c) => ({ ...c, email: e.target.value }))} placeholder="E-post" type="email" />
                  <Input value={detailDraft.city} onChange={(e) => setDetailDraft((c) => ({ ...c, city: e.target.value }))} placeholder="Ort" />
                  <Input value={detailDraft.source} onChange={(e) => setDetailDraft((c) => ({ ...c, source: e.target.value }))} placeholder="Källa" />
                  <Input value={detailDraft.street_address} onChange={(e) => setDetailDraft((c) => ({ ...c, street_address: e.target.value }))} placeholder="Adress" />
                  <Input value={detailDraft.postal_code} onChange={(e) => setDetailDraft((c) => ({ ...c, postal_code: e.target.value }))} placeholder="Postnummer" />
                </div>
                <Textarea value={detailDraft.notes} onChange={(e) => setDetailDraft((c) => ({ ...c, notes: e.target.value }))} placeholder="Anteckningar" className="min-h-[100px]" />
                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setDetailEditing(false);
                      setDetailDraft({ company_name: selected.company_name, organization_number: selected.organization_number || '', contact_name: selected.contact_name || '', phone: selected.phone || '', email: selected.email || '', street_address: selected.street_address || '', postal_code: selected.postal_code || '', city: selected.city || '', source: selected.source || '', notes: selected.notes || '' });
                    }}
                    className="inline-flex min-h-11 items-center justify-center rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 hover:border-slate-300"
                  >
                    Avbryt
                  </button>
                  <button type="button" onClick={saveDetail} disabled={savingDetail} className="inline-flex min-h-11 items-center justify-center rounded-full border border-emerald-600 bg-[linear-gradient(180deg,#14b87a_0%,#0f9f6c_100%)] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_20px_34px_rgba(16,185,129,0.22)] transition hover:brightness-[0.97] disabled:opacity-60">
                    {savingDetail ? 'Sparar…' : 'Spara ändringar'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  { label: 'Kontakt', value: selected.contact_name },
                  { label: 'Org.nr', value: selected.organization_number },
                  { label: 'Telefon', value: selected.phone },
                  { label: 'E-post', value: selected.email },
                  { label: 'Ort', value: selected.city },
                  { label: 'Källa', value: selected.source },
                ].map(({ label, value }) => (
                  <div key={label} className="rounded-[20px] border border-slate-200/80 bg-white px-4 py-3 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{label}</div>
                    <div className="mt-1 break-words text-sm font-semibold text-slate-900">{value || '–'}</div>
                  </div>
                ))}
              </div>
            )}

            <div className="grid gap-2 rounded-[20px] border border-slate-200/85 bg-white px-4 py-4 shadow-[0_14px_26px_rgba(15,23,42,0.04)]">
              <div className="grid gap-0.5">
                <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Anteckningar</span>
              </div>
              <p className="m-0 whitespace-pre-wrap break-words text-sm leading-6 text-slate-600">
                {selected.notes || 'Inga anteckningar än.'}
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
