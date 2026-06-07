"use client";

import { useEffect, useMemo, useState } from 'react';
import Input from '../../../components/ui/Input';
import Textarea from '../../../components/ui/Textarea';
import CrmModal from '../components/CrmModal';
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

      <div className="rounded-2xl border border-[#e0e8dc] bg-[#f9fbf7] p-4 shadow-[0_1px_3px_rgba(20,44,27,0.06),0_18px_36px_-18px_rgba(20,44,27,0.24)]">
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
              <div key={i} className="grid gap-2 rounded-lg border border-[#e3e9df] bg-[#f6f9f3] px-4 py-4">
                <div className="h-3 w-40 rounded-full bg-[#dfe6da]" />
                <div className="h-3 w-24 rounded-full bg-[#dfe6da]" />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="grid gap-2 rounded-xl border border-dashed border-[#cfdcc9] bg-[#f6f9f3] px-5 py-8 text-center">
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
                  'group grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-lg border border-[#e3e9df] bg-white px-4 py-3 text-left shadow-[0_1px_2px_rgba(15,23,42,0.05)] transition hover:border-[#cfdcc9] hover:shadow-[0_8px_20px_-10px_rgba(20,44,27,0.30)]',
                  selectedId === item.id ? 'ring-1 ring-emerald-300' : null,
                )}
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#e3e9df] bg-[#f1f5ee] text-xs font-bold tracking-[0.06em] text-slate-600">
                  {getInitials(item.company_name) || 'P'}
                </div>
                <div className="min-w-0 grid gap-0.5">
                  <strong className="truncate text-sm font-semibold text-slate-900">{item.company_name}</strong>
                  <span className="truncate text-xs text-slate-500">
                    {[item.contact_name, item.city, item.source].filter(Boolean).join(' · ') || 'Ingen ytterligare information'}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="hidden text-xs text-slate-400 sm:inline">{formatDateTime(item.updated_at)}</span>
                  <svg className="shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-400" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Skapa-panel */}
      {createPanelOpen ? (
        <CrmModal
          onClose={() => setCreatePanelOpen(false)}
          ariaLabel="Skapa prospekt"
          maxWidth="sm:max-w-[760px]"
          header={
            <>
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Nytt prospekt</span>
              <strong className="mt-0.5 block text-lg font-bold tracking-tight text-slate-950">Lägg in kunden</strong>
              <p className="m-0 mt-0.5 text-sm leading-6 text-slate-600">
                Registrera kontaktuppgifterna. Du kan skapa affärsmöjligheter härifrån när köpintresse finns.
              </p>
            </>
          }
          footer={
            <>
              <button type="button" onClick={() => setCreatePanelOpen(false)} className="flex-1 rounded-xl border border-slate-200 bg-white py-2.5 text-sm font-semibold text-slate-600 transition hover:border-slate-300 sm:flex-none sm:px-5">
                Avbryt
              </button>
              <button type="button" onClick={createProspect} disabled={creating} className="flex-1 rounded-xl py-2.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60 sm:ml-auto sm:flex-none sm:px-5" style={{ backgroundColor: 'var(--crm-primary)' }}>
                {creating ? 'Sparar…' : 'Skapa prospekt'}
              </button>
            </>
          }
        >
          <div className="grid gap-3">
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
          </div>
        </CrmModal>
      ) : null}

      {/* Detaljpanel */}
      {detailOpen && selected ? (
        <CrmModal
          onClose={() => setDetailOpen(false)}
          ariaLabel={`Prospekt ${selected.company_name}`}
          maxWidth="sm:max-w-[860px]"
          header={
            <>
              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Prospekt</span>
              <strong className="mt-0.5 block truncate text-lg font-bold tracking-tight text-slate-950">{selected.company_name}</strong>
              <p className="m-0 mt-0.5 text-sm text-slate-500">Uppdaterad {formatDateTime(selected.updated_at)}</p>
            </>
          }
          footer={
            detailEditing ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setDetailEditing(false);
                    setDetailDraft({ company_name: selected.company_name, organization_number: selected.organization_number || '', contact_name: selected.contact_name || '', phone: selected.phone || '', email: selected.email || '', street_address: selected.street_address || '', postal_code: selected.postal_code || '', city: selected.city || '', source: selected.source || '', notes: selected.notes || '' });
                  }}
                  className="flex-1 rounded-xl border border-slate-200 bg-white py-2.5 text-sm font-semibold text-slate-600 transition hover:border-slate-300 sm:flex-none sm:px-5"
                >
                  Avbryt
                </button>
                <button type="button" onClick={saveDetail} disabled={savingDetail} className="flex-1 rounded-xl py-2.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-95 disabled:opacity-60 sm:ml-auto sm:flex-none sm:px-5" style={{ backgroundColor: 'var(--crm-primary)' }}>
                  {savingDetail ? 'Sparar…' : 'Spara ändringar'}
                </button>
              </>
            ) : (
              <div className="flex w-full flex-wrap items-center justify-end gap-2">
                <button type="button" onClick={() => setDetailEditing(true)} className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:border-slate-300">
                  Redigera
                </button>
                <a href={`/crm/affarsmojligheter`} className="rounded-xl border border-emerald-600 bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700">
                  + Affärsmöjlighet
                </a>
                <a href={`/crm/samtal?prospect_id=${selected.id}`} className="rounded-xl border border-slate-900 bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-950">
                  Logga samtal
                </a>
              </div>
            )
          }
        >
          <div className="grid gap-4">
            {detailEditing ? (
              <div className="grid gap-3">
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
                  <div key={label} className="rounded-xl border border-[#e3e9df] bg-[#f6f9f3] px-4 py-3">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{label}</div>
                    <div className="mt-1 break-words text-sm font-semibold text-slate-900">{value || '–'}</div>
                  </div>
                ))}
              </div>
            )}

            <div className="grid gap-2 rounded-xl border border-[#e3e9df] bg-[#f6f9f3] px-4 py-4">
              <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Anteckningar</span>
              <p className="m-0 whitespace-pre-wrap break-words text-sm leading-6 text-slate-600">
                {selected.notes || 'Inga anteckningar än.'}
              </p>
            </div>
          </div>
        </CrmModal>
      ) : null}
    </div>
  );
}
