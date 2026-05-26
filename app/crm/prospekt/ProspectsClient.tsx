"use client";

import { useEffect, useMemo, useState } from 'react';
import SectionCard from '../../../components/ui/SectionCard';
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
  status: 'new' | 'contacted' | 'qualified' | 'quoted' | 'won' | 'lost';
  source: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

const statusLabel: Record<ProspectItem['status'], string> = {
  new: 'Ny',
  contacted: 'Kontaktad',
  qualified: 'Kvalificerad',
  quoted: 'Offert',
  won: 'Vunnen',
  lost: 'Förlorad',
};

const statusClass: Record<ProspectItem['status'], string> = {
  new: 'border-slate-200 bg-slate-100 text-slate-700',
  contacted: 'border-sky-200 bg-sky-50 text-sky-700',
  qualified: 'border-violet-200 bg-violet-50 text-violet-700',
  quoted: 'border-amber-200 bg-amber-50 text-amber-700',
  won: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  lost: 'border-rose-200 bg-rose-50 text-rose-700',
};

type CreateProspectDraft = {
  company_name: string;
  organization_number: string;
  contact_name: string;
  phone: string;
  email: string;
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
  city: '',
  source: '',
  notes: '',
};

function formatDateTime(value: string | null | undefined) {
  if (!value) return '–';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '–';
  return new Intl.DateTimeFormat('sv-SE', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export default function ProspectsClient() {
  const toast = useToast();
  const [items, setItems] = useState<ProspectItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<CreateProspectDraft>(initialDraft);
  const [selectedId, setSelectedId] = useState<string | null>(null);

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
          setError(json?.error || 'Kunde inte ladda prospekt. Har migrationen körts i databasen?');
          setItems([]);
          return;
        }
        const nextItems = Array.isArray(json?.data?.items) ? json.data.items as ProspectItem[] : [];
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
    return () => {
      active = false;
    };
  }, [search]);

  const selected = useMemo(() => items.find((item) => item.id === selectedId) || null, [items, selectedId]);

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
        body: JSON.stringify(draft),
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
      toast.success('Prospekt skapat');
    } catch {
      toast.error('Fel vid skapande av prospekt');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
      <div className="grid gap-4">
        <SectionCard className="grid gap-4 p-5 md:p-6">
          <div className="grid gap-1">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">CRM / Prospekt</span>
            <h1 className="m-0 text-2xl font-bold tracking-[-0.03em] text-slate-900 md:text-3xl">Prospekt</h1>
            <p className="m-0 max-w-3xl text-sm leading-6 text-slate-600 md:text-[15px]">
              Första verkliga CRM-slicen. Här får ni en prospektlista, enkel registrering och en detailvy som senare kan bära samtal, uppgifter, offerter och kundsynk.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Sök på företag, kontakt, e-post eller ort"
              className="rounded-2xl"
            />
            <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-500">
              {items.length} prospekt
            </div>
          </div>

          {error ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
          ) : null}

          <div className="grid gap-3">
            {loading ? (
              <div className="grid gap-3">
                {Array.from({ length: 3 }).map((_, index) => (
                  <div key={index} className="grid gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                    <div className="h-3 w-40 rounded-full bg-slate-200" />
                    <div className="h-3 w-24 rounded-full bg-slate-200" />
                    <div className="h-2.5 w-56 rounded-full bg-slate-200" />
                  </div>
                ))}
              </div>
            ) : items.length === 0 ? (
              <div className="grid gap-2 rounded-[24px] border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-center">
                <strong className="text-base font-bold text-slate-900">Inga prospekt än</strong>
                <p className="m-0 text-sm leading-6 text-slate-600">
                  Börja med att lägga in första prospektet i formuläret till höger. När import och ringlistor byggs vidare kommer samma kärnobjekt användas här.
                </p>
              </div>
            ) : (
              items.map((item) => {
                const active = selectedId === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelectedId(item.id)}
                    className={cn(
                      'grid min-w-0 gap-2 rounded-[24px] border px-4 py-4 text-left transition-[border-color,box-shadow,transform]',
                      active
                        ? 'border-emerald-300 bg-emerald-50/70 shadow-[0_14px_28px_rgba(16,185,129,0.10)]'
                        : 'border-slate-200 bg-white hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_10px_24px_rgba(15,23,42,0.06)]'
                    )}
                  >
                    <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                      <div className="grid min-w-0 gap-1">
                        <strong className="break-words text-base font-bold tracking-[-0.02em] text-slate-900">{item.company_name}</strong>
                        <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-slate-500">
                          {item.contact_name ? <span className="break-words">Kontakt: {item.contact_name}</span> : null}
                          {item.city ? <span className="break-words">Ort: {item.city}</span> : null}
                        </div>
                      </div>
                      <span className={cn('rounded-full border px-2 py-1 text-[11px] font-semibold', statusClass[item.status])}>
                        {statusLabel[item.status]}
                      </span>
                    </div>
                    <div className="flex min-w-0 flex-wrap gap-2 text-xs text-slate-600">
                      {item.phone ? <span className="break-words rounded-full border border-slate-200 bg-slate-50 px-2 py-1">{item.phone}</span> : null}
                      {item.email ? <span className="break-words rounded-full border border-slate-200 bg-slate-50 px-2 py-1">{item.email}</span> : null}
                      {item.organization_number ? <span className="break-words rounded-full border border-slate-200 bg-slate-50 px-2 py-1">Org.nr: {item.organization_number}</span> : null}
                    </div>
                    <span className="text-xs text-slate-400">Uppdaterad {formatDateTime(item.updated_at)}</span>
                  </button>
                );
              })
            )}
          </div>
        </SectionCard>
      </div>

      <div className="grid gap-4">
        <SectionCard className="grid gap-4 p-5 md:p-6">
          <div className="grid gap-1">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Skapa prospekt</span>
            <strong className="text-lg font-bold text-slate-900">Lägg in första datan</strong>
            <p className="m-0 text-sm leading-6 text-slate-600">
              Första versionen skapar prospekt som tilldelas den inloggade användaren. Admin-tilldelning, import och Fortnox-kunddata kommer senare.
            </p>
          </div>
          <div className="grid gap-3">
            <Input value={draft.company_name} onChange={(event) => setDraft((current) => ({ ...current, company_name: event.target.value }))} placeholder="Företagsnamn" />
            <div className="grid gap-3 sm:grid-cols-2">
              <Input value={draft.contact_name} onChange={(event) => setDraft((current) => ({ ...current, contact_name: event.target.value }))} placeholder="Kontaktperson" />
              <Input value={draft.organization_number} onChange={(event) => setDraft((current) => ({ ...current, organization_number: event.target.value }))} placeholder="Org.nr" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input value={draft.phone} onChange={(event) => setDraft((current) => ({ ...current, phone: event.target.value }))} placeholder="Telefon" />
              <Input value={draft.email} onChange={(event) => setDraft((current) => ({ ...current, email: event.target.value }))} placeholder="E-post" type="email" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input value={draft.city} onChange={(event) => setDraft((current) => ({ ...current, city: event.target.value }))} placeholder="Ort" />
              <Input value={draft.source} onChange={(event) => setDraft((current) => ({ ...current, source: event.target.value }))} placeholder="Källa, t.ex. Excel eller manuell" />
            </div>
            <Textarea value={draft.notes} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} placeholder="Anteckning eller sammanhang" className="min-h-[132px]" />
            <button
              type="button"
              onClick={createProspect}
              disabled={creating}
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-emerald-600 bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_12px_24px_rgba(16,185,129,0.16)] transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {creating ? 'Sparar…' : 'Skapa prospekt'}
            </button>
          </div>
        </SectionCard>

        <SectionCard className="grid gap-4 p-5 md:p-6">
          <div className="grid gap-1">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Detaljvy</span>
            <strong className="text-lg font-bold text-slate-900">Valt prospekt</strong>
          </div>

          {selected ? (
            <div className="grid gap-4">
              <div className="grid gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="grid gap-1">
                    <strong className="break-words text-lg font-bold tracking-[-0.02em] text-slate-900">{selected.company_name}</strong>
                    <span className="text-sm text-slate-500">Skapad {formatDateTime(selected.created_at)}</span>
                  </div>
                  <span className={cn('rounded-full border px-2.5 py-1 text-xs font-semibold', statusClass[selected.status])}>
                    {statusLabel[selected.status]}
                  </span>
                </div>
                <div className="grid gap-2 text-sm text-slate-600">
                  <div className="grid gap-1 sm:grid-cols-2">
                    <span className="break-words"><strong className="text-slate-900">Kontakt:</strong> {selected.contact_name || '–'}</span>
                    <span className="break-words"><strong className="text-slate-900">Org.nr:</strong> {selected.organization_number || '–'}</span>
                  </div>
                  <div className="grid gap-1 sm:grid-cols-2">
                    <span className="break-words"><strong className="text-slate-900">Telefon:</strong> {selected.phone || '–'}</span>
                    <span className="break-words"><strong className="text-slate-900">E-post:</strong> {selected.email || '–'}</span>
                  </div>
                  <div className="grid gap-1 sm:grid-cols-2">
                    <span className="break-words"><strong className="text-slate-900">Ort:</strong> {selected.city || '–'}</span>
                    <span className="break-words"><strong className="text-slate-900">Källa:</strong> {selected.source || '–'}</span>
                  </div>
                </div>
              </div>

              <div className="grid gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-4">
                <strong className="text-sm font-semibold text-slate-900">Anteckningar</strong>
                <p className="m-0 whitespace-pre-wrap break-words text-sm leading-6 text-slate-600">
                  {selected.notes || 'Inga anteckningar än.'}
                </p>
              </div>

              <div className="grid gap-2 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-600">
                <strong className="text-slate-900">Nästa naturliga steg</strong>
                <span>Samtal, uppgifter och offerter ska senare kopplas direkt till det här prospektet.</span>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm leading-6 text-slate-600">
              Välj ett prospekt i listan för att se detaljer här.
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}