'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import Input from '../../../components/ui/Input';
import SectionCard from '../../../components/ui/SectionCard';
import { useToast } from '@/lib/Toast';
import { cn } from '@/lib/shared/cn';

type ProspectItem = {
  id: string;
  company_name: string;
  organization_number: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  status: 'new' | 'contacted' | 'qualified' | 'quoted' | 'won' | 'lost';
  source: string | null;
  assigned_to: string | null;
  updated_at: string;
};

type AssignableUser = {
  id: string;
  full_name: string | null;
  role: 'sales' | 'admin' | 'konsult';
};

type ImportRow = {
  row_number: number;
  company_name: string;
  organization_number: string;
  contact_name: string;
  phone: string;
  email: string;
  city: string;
  source: string;
  notes: string;
};

type ImportResult = {
  row_number: number;
  company_name: string;
  action: 'created' | 'updated' | 'skipped_empty';
  matched_on: 'orgnummer' | 'foretag_epost' | 'foretag_kontakt' | 'foretag' | null;
};

type AssignmentFilter = 'all' | 'unassigned' | 'assigned';
type StatusFilter = 'all' | ProspectItem['status'];

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
  qualified: 'border-amber-200 bg-amber-50 text-amber-800',
  quoted: 'border-violet-200 bg-violet-50 text-violet-800',
  won: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  lost: 'border-rose-200 bg-rose-50 text-rose-800',
};

function getInitials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('');
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '–';
  return new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function normalizeHeader(value: unknown) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[åä]/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function mapImportKey(header: string) {
  const normalized = normalizeHeader(header);
  if (['foretag', 'foretagsnamn', 'company', 'company_name', 'bolag', 'kund'].includes(normalized)) return 'company_name';
  if (['orgnr', 'organisationsnummer', 'organization_number', 'org_nummer'].includes(normalized)) return 'organization_number';
  if (['kontakt', 'kontaktperson', 'contact', 'contact_name', 'namn'].includes(normalized)) return 'contact_name';
  if (['telefon', 'phone', 'mobile', 'mobil'].includes(normalized)) return 'phone';
  if (['email', 'e_post', 'epost', 'mail'].includes(normalized)) return 'email';
  if (['ort', 'stad', 'city'].includes(normalized)) return 'city';
  if (['kalla', 'source', 'lead_source'].includes(normalized)) return 'source';
  if (['anteckning', 'anteckningar', 'notes', 'kommentar'].includes(normalized)) return 'notes';
  return null;
}

function toImportValue(value: unknown) {
  return String(value ?? '').trim();
}

export default function RingListsClient({ adminName }: { adminName: string | null }) {
  const toast = useToast();
  const [prospects, setProspects] = useState<ProspectItem[]>([]);
  const [users, setUsers] = useState<AssignableUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [assigning, setAssigning] = useState(false);
  const [search, setSearch] = useState('');
  const [assignmentFilter, setAssignmentFilter] = useState<AssignmentFilter>('unassigned');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('new');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [importRows, setImportRows] = useState<ImportRow[]>([]);
  const [importResults, setImportResults] = useState<ImportResult[]>([]);
  const [importing, setImporting] = useState(false);
  const [importFileName, setImportFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const usersById = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const query = new URLSearchParams();
        if (search.trim()) query.set('q', search.trim());

        const [prospectsRes, usersRes] = await Promise.all([
          fetch(`/api/crm/prospects${query.size > 0 ? `?${query.toString()}` : ''}`, { cache: 'no-store' }),
          fetch('/api/crm/ringlists/users', { cache: 'no-store' }),
        ]);

        const [prospectsJson, usersJson] = await Promise.all([
          prospectsRes.json().catch(() => ({})),
          usersRes.json().catch(() => ({})),
        ]);

        if (!active) return;

        if (!prospectsRes.ok || !prospectsJson.ok) {
          setError(prospectsJson?.error || 'Kunde inte ladda ringlistans prospekt.');
          setProspects([]);
          setUsers([]);
          return;
        }

        if (!usersRes.ok || !usersJson.ok) {
          setError(usersJson?.error || 'Kunde inte ladda säljare för tilldelning.');
          setProspects(Array.isArray(prospectsJson?.data?.items) ? prospectsJson.data.items : []);
          setUsers([]);
          return;
        }

        setProspects(Array.isArray(prospectsJson?.data?.items) ? prospectsJson.data.items : []);
        setUsers(Array.isArray(usersJson?.data?.items) ? usersJson.data.items : []);
      } catch {
        if (!active) return;
        setError('Kunde inte ladda ringlistor.');
        setProspects([]);
        setUsers([]);
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, [search]);

  const visibleProspects = useMemo(() => {
    return prospects.filter((prospect) => {
      if (assignmentFilter === 'unassigned' && prospect.assigned_to) return false;
      if (assignmentFilter === 'assigned' && !prospect.assigned_to) return false;
      if (statusFilter !== 'all' && prospect.status !== statusFilter) return false;
      return true;
    });
  }, [assignmentFilter, prospects, statusFilter]);

  const stats = useMemo(() => ({
    total: prospects.length,
    unassigned: prospects.filter((item) => !item.assigned_to).length,
    new: prospects.filter((item) => item.status === 'new').length,
    qualified: prospects.filter((item) => item.status === 'qualified' || item.status === 'quoted').length,
  }), [prospects]);

  useEffect(() => {
    setSelectedIds((current) => current.filter((id) => visibleProspects.some((item) => item.id === id)));
  }, [visibleProspects]);

  function toggleSelected(id: string) {
    setSelectedIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  function toggleSelectAll() {
    if (visibleProspects.length === 0) return;
    const visibleIds = visibleProspects.map((item) => item.id);
    const allSelected = visibleIds.every((id) => selectedIds.includes(id));
    setSelectedIds(allSelected ? selectedIds.filter((id) => !visibleIds.includes(id)) : Array.from(new Set([...selectedIds, ...visibleIds])));
  }

  async function assignSelected() {
    if (selectedIds.length === 0) {
      toast.info('Välj minst ett prospekt först.');
      return;
    }

    setAssigning(true);
    try {
      const res = await fetch('/api/crm/ringlists/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prospect_ids: selectedIds, assigned_to: selectedUserId || null }),
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok || !json.ok) {
        toast.error(json?.error || 'Kunde inte tilldela prospekten.');
        return;
      }

      const updatedItems = Array.isArray(json?.data?.items) ? json.data.items as ProspectItem[] : [];
      const updatedById = new Map(updatedItems.map((item) => [item.id, item]));

      setProspects((current) => current.map((item) => updatedById.get(item.id) || item));
      setSelectedIds([]);

      const assignedLabel = selectedUserId ? usersById.get(selectedUserId)?.full_name || 'vald säljare' : 'ingen ägare';
      toast.success(`Tilldelning uppdaterad: ${assignedLabel}`);
    } catch {
      toast.error('Fel vid tilldelning av prospekt.');
    } finally {
      setAssigning(false);
    }
  }

  async function handleImportFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const XLSX = await import('xlsx');
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const firstSheet = workbook.Sheets[firstSheetName];

      if (!firstSheet) {
        toast.error('Kunde inte läsa första bladet i filen.');
        return;
      }

      const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(firstSheet, { header: 1, defval: '' });
      const [headerRow, ...dataRows] = rows;

      if (!headerRow || headerRow.length === 0) {
        toast.error('Filen saknar rubrikrad.');
        return;
      }

      const mappedHeaders = headerRow.map((header) => mapImportKey(String(header)));

      if (!mappedHeaders.includes('company_name')) {
        toast.error('Filen måste innehålla en kolumn för företagsnamn.');
        return;
      }

      const parsedRows = dataRows
        .map((row) => {
          const nextRow: ImportRow = {
            row_number: 0,
            company_name: '',
            organization_number: '',
            contact_name: '',
            phone: '',
            email: '',
            city: '',
            source: 'excel-import',
            notes: '',
          };

          nextRow.row_number = dataRows.indexOf(row) + 2;

          mappedHeaders.forEach((mappedHeader, index) => {
            if (!mappedHeader) return;
            nextRow[mappedHeader] = toImportValue(row[index]);
          });

          return nextRow;
        });

      const skippedResults = parsedRows
        .filter((row) => row.company_name.length === 0)
        .map((row) => ({
          row_number: row.row_number,
          company_name: 'Tom rad',
          action: 'skipped_empty' as const,
          matched_on: null,
        }));

      const normalizedRows = parsedRows.filter((row) => row.company_name.length > 0);

      if (normalizedRows.length === 0) {
        toast.error('Filen innehöll inga importerbara rader.');
        setImportResults(skippedResults);
        return;
      }

      setImportRows(normalizedRows.slice(0, 500));
      setImportResults(skippedResults);
      setImportFileName(file.name);
      toast.success(`${Math.min(normalizedRows.length, 500)} rader klara för import`);
    } catch {
      toast.error('Kunde inte tolka filen. Prova .xlsx eller .csv med rubrikrad.');
    } finally {
      event.target.value = '';
    }
  }

  async function importPreparedRows() {
    if (importRows.length === 0) {
      toast.info('Ladda upp en fil först.');
      return;
    }

    setImporting(true);
    try {
      const res = await fetch('/api/crm/ringlists/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assigned_to: selectedUserId || null,
          rows: importRows,
        }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        toast.error(json?.error || 'Kunde inte importera filen.');
        return;
      }

      const updatedItems = Array.isArray(json?.data?.items) ? (json.data.items as ProspectItem[]) : [];
      const rowResults = Array.isArray(json?.data?.results) ? (json.data.results as ImportResult[]) : [];
      const updatedById = new Map(updatedItems.map((item) => [item.id, item]));
      setProspects((current) => {
        const merged = current.map((item) => updatedById.get(item.id) || item);
        const newItems = updatedItems.filter((item) => !current.some((existing) => existing.id === item.id));
        return [...newItems, ...merged];
      });
      setImportResults((current) => [...current.filter((item) => item.action === 'skipped_empty'), ...rowResults].sort((a, b) => a.row_number - b.row_number));
      setImportRows([]);
      setImportFileName(null);
      toast.success(`Import klar: ${json?.data?.created || 0} skapade, ${json?.data?.updated || 0} uppdaterade`);
    } catch {
      toast.error('Fel vid import av filen.');
    } finally {
      setImporting(false);
    }
  }

  const visibleAllSelected = visibleProspects.length > 0 && visibleProspects.every((item) => selectedIds.includes(item.id));

  return (
    <div className="grid gap-4">
      <SectionCard className="overflow-hidden border-slate-200 bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.12),_transparent_30%),radial-gradient(circle_at_top_right,_rgba(16,185,129,0.10),_transparent_28%),linear-gradient(180deg,#fbfeff_0%,#f8fafc_100%)] p-5 shadow-[0_24px_70px_rgba(15,23,42,0.08)] md:p-6">
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start">
          <div className="grid gap-4">
            <div className="inline-flex w-fit items-center rounded-full border border-sky-200/80 bg-white/85 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-sky-900 shadow-[0_8px_18px_rgba(255,255,255,0.35)]">
              CRM / Ringlistor
            </div>
            <div className="grid gap-2">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="m-0 text-[clamp(2rem,4vw,3.2rem)] font-bold tracking-[-0.06em] text-slate-950">Ringlistor</h1>
                <div className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-900">Oklaimad lead-kö</div>
              </div>
              <p className="m-0 max-w-3xl text-sm leading-6 text-slate-600 md:text-[15px]">
                Här styr du vilka potentiella kunder som ännu inte tagits upp av någon säljare. Ytan är nu förvald mot ej tilldelade nya leads, så ringlistan beter sig mer som en verklig kö än en bred prospektlista.
              </p>
            </div>
          </div>

          <div className="grid gap-3 rounded-[28px] border border-slate-200/80 bg-[linear-gradient(180deg,rgba(15,23,42,0.94)_0%,rgba(30,41,59,0.92)_100%)] p-4 text-white shadow-[0_22px_44px_rgba(15,23,42,0.22)]">
            <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-sky-100/80">Snapshot</span>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3 backdrop-blur-sm">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-300">Totalt</div>
                <div className="mt-1 text-xl font-bold tracking-[-0.04em] text-white">{stats.total}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3 backdrop-blur-sm">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-300">Ej tilldelade</div>
                <div className="mt-1 text-xl font-bold tracking-[-0.04em] text-white">{stats.unassigned}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3 backdrop-blur-sm">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-300">Nya</div>
                <div className="mt-1 text-xl font-bold tracking-[-0.04em] text-white">{stats.new}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3 backdrop-blur-sm">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-300">Varma</div>
                <div className="mt-1 text-xl font-bold tracking-[-0.04em] text-white">{stats.qualified}</div>
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-slate-200">
              <strong className="block text-white">{adminName || 'Admin'}</strong>
              Fokus här är leads som ännu inte har en ägare. Excel-import och listnamn blir nästa logiska utbyggnad.
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard className="grid gap-4 border-slate-200 bg-[linear-gradient(180deg,rgba(248,250,252,0.98),rgba(241,245,249,0.98))] p-5 md:p-6">
        <div className="grid gap-4 rounded-[24px] border border-slate-200 bg-white/85 p-4 shadow-[0_14px_30px_rgba(15,23,42,0.05)] xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
          <div className="grid gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <strong className="text-sm font-semibold text-slate-900">Excel-import</strong>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-600">.xlsx och .csv</span>
              {importFileName ? <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-semibold text-sky-700">{importFileName}</span> : null}
            </div>
            <p className="m-0 text-sm leading-6 text-slate-600">
              Ladda upp en lista med rubriker som företagsnamn, orgnr, kontakt, telefon, e-post och ort. Importen deduplicerar explicit mot befintliga prospekt innan den skapar eller uppdaterar poster.
            </p>
            {importRows.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 font-semibold text-slate-600">{importRows.length} rader klara</span>
                <span>Förhandsvisar de första {Math.min(importRows.length, 5)} raderna nedan.</span>
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2 xl:justify-end">
            <label className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50">
              Välj fil
              <input type="file" accept=".xlsx,.xls,.csv" onChange={handleImportFile} className="sr-only" />
            </label>
            <button
              type="button"
              onClick={importPreparedRows}
              disabled={importing || importRows.length === 0}
              className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-emerald-600 bg-[linear-gradient(180deg,#10b981_0%,#059669_100%)] px-4 py-2 text-sm font-semibold text-white shadow-[0_16px_26px_rgba(5,150,105,0.18)] transition hover:brightness-[0.97] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {importing ? 'Importerar…' : `Importera ${importRows.length || ''}`.trim()}
            </button>
          </div>
        </div>

        {importRows.length > 0 ? (
          <div className="grid gap-2 rounded-[24px] border border-slate-200 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.95))] p-4 shadow-[0_14px_30px_rgba(15,23,42,0.05)]">
            {importRows.slice(0, 5).map((row, index) => (
              <div key={`${row.company_name}-${index}`} className="grid gap-1 rounded-2xl border border-slate-200 bg-white px-4 py-3 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto] md:items-center">
                <div className="grid gap-1">
                  <strong className="text-sm font-semibold text-slate-900">{row.company_name}</strong>
                  <div className="flex flex-wrap gap-x-2 gap-y-1 text-xs text-slate-500">
                    {row.contact_name ? <span>Kontakt: {row.contact_name}</span> : null}
                    {row.organization_number ? <span>Org.nr: {row.organization_number}</span> : null}
                    {row.city ? <span>Ort: {row.city}</span> : null}
                  </div>
                </div>
                <div className="flex flex-wrap gap-x-2 gap-y-1 text-xs text-slate-500">
                  {row.phone ? <span>{row.phone}</span> : null}
                  {row.email ? <span>{row.email}</span> : null}
                  {row.source ? <span>Källa: {row.source}</span> : null}
                </div>
                <div className="text-xs font-semibold text-slate-400">Rad {index + 1}</div>
              </div>
            ))}
          </div>
        ) : null}

        {importResults.length > 0 ? (
          <div className="grid gap-2 rounded-[24px] border border-slate-200 bg-white/90 p-4 shadow-[0_14px_30px_rgba(15,23,42,0.05)]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <strong className="text-sm font-semibold text-slate-900">Importresultat per rad</strong>
              <span className="text-xs text-slate-500">{importResults.length} rader med utfall</span>
            </div>
            <div className="grid gap-2">
              {importResults.slice(0, 12).map((result) => (
                <div key={`${result.row_number}-${result.company_name}-${result.action}`} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
                  <div className="grid gap-0.5">
                    <strong className="text-slate-900">Rad {result.row_number}: {result.company_name}</strong>
                    <span className="text-xs text-slate-500">
                      {result.action === 'updated' && result.matched_on === 'orgnummer' ? 'Matchad på orgnummer' : null}
                      {result.action === 'updated' && result.matched_on === 'foretag_epost' ? 'Matchad på företag + e-post' : null}
                      {result.action === 'updated' && result.matched_on === 'foretag_kontakt' ? 'Matchad på företag + kontakt' : null}
                      {result.action === 'updated' && result.matched_on === 'foretag' ? 'Matchad på företagsnamn' : null}
                      {result.action === 'skipped_empty' ? 'Föll bort eftersom företagsnamn saknades' : null}
                    </span>
                  </div>
                  <span className={cn(
                    'rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em]',
                    result.action === 'created' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : null,
                    result.action === 'updated' ? 'border-sky-200 bg-sky-50 text-sky-800' : null,
                    result.action === 'skipped_empty' ? 'border-slate-200 bg-slate-100 text-slate-700' : null,
                  )}>
                    {result.action === 'created' ? 'Skapad' : result.action === 'updated' ? 'Uppdaterad' : 'Tom rad'}
                  </span>
                </div>
              ))}
            </div>
            {importResults.length > 12 ? <div className="text-xs text-slate-500">Visar de första 12 raderna med utfall.</div> : null}
          </div>
        ) : null}

        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto_auto] xl:items-center">
          <Input
            value={search}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setSearch(event.target.value)}
            placeholder="Sök på företag, kontakt, telefon, e-post eller ort"
            className="max-w-xl"
          />

          <div className="flex flex-wrap gap-2">
            {([
              ['unassigned', 'Ej tilldelade'],
              ['all', 'Alla'],
              ['assigned', 'Tilldelade'],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setAssignmentFilter(value)}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-sm font-semibold transition',
                  assignmentFilter === value ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50',
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
            className="min-h-11 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-slate-300"
          >
            <option value="all">Alla statusar</option>
            {Object.entries(statusLabel).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>

        <div className="grid gap-3 rounded-[24px] border border-slate-200 bg-white/80 p-4 shadow-[0_14px_30px_rgba(15,23,42,0.05)] xl:grid-cols-[auto_minmax(200px,280px)_auto_1fr] xl:items-center">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <input type="checkbox" checked={visibleAllSelected} onChange={toggleSelectAll} className="h-4 w-4 rounded border-slate-300" />
            Markera alla i vyn
          </label>

          <select
            value={selectedUserId}
            onChange={(event) => setSelectedUserId(event.target.value)}
            className="min-h-11 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-slate-300"
          >
            <option value="">Ingen ägare</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>{user.full_name || 'Okänd användare'}</option>
            ))}
          </select>

          <button
            type="button"
            onClick={assignSelected}
            disabled={assigning || selectedIds.length === 0}
            className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-slate-900 bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {assigning ? 'Tilldelar…' : `Tilldela markerade (${selectedIds.length})`}
          </button>

          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 xl:justify-end">
            <span className="rounded-full border border-slate-200 bg-white px-3 py-2 font-semibold text-slate-600">Default: ej tilldelade nya leads</span>
            <span className="rounded-full border border-slate-200 bg-white px-3 py-2 font-semibold text-slate-600">Excel-import nästa slice</span>
          </div>
        </div>

        {error ? <div className="rounded-[20px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

        <div className="grid gap-3">
          {loading ? (
            Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="grid gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                <div className="h-3 w-40 rounded-full bg-slate-200" />
                <div className="h-3 w-24 rounded-full bg-slate-200" />
              </div>
            ))
          ) : visibleProspects.length === 0 ? (
            <div className="grid gap-2 rounded-[24px] border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-center">
              <strong className="text-base font-bold text-slate-900">Ingen oallokerad lead i kön</strong>
              <p className="m-0 text-sm leading-6 text-slate-600">Importera fler leads eller ändra filter om du vill se redan tilldelade poster.</p>
            </div>
          ) : (
            visibleProspects.map((prospect) => {
              const assignedUser = prospect.assigned_to ? usersById.get(prospect.assigned_to) || null : null;
              const selected = selectedIds.includes(prospect.id);

              return (
                <div
                  key={prospect.id}
                  className={cn(
                    'grid gap-3 rounded-[24px] border px-3.5 py-3 shadow-[0_16px_30px_rgba(15,23,42,0.06)] md:grid-cols-[auto_auto_minmax(0,1fr)_auto] md:items-center',
                    selected
                      ? 'border-sky-300 bg-[linear-gradient(135deg,rgba(240,249,255,0.98)_0%,rgba(255,255,255,0.98)_55%,rgba(236,254,255,0.95)_100%)] ring-1 ring-sky-100'
                      : 'border-slate-200 bg-[linear-gradient(180deg,rgba(255,255,255,0.98)_0%,rgba(248,250,252,0.95)_100%)]'
                  )}
                >
                  <label className="flex items-center justify-center">
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleSelected(prospect.id)}
                      className="h-4 w-4 rounded border-slate-300"
                      aria-label={`Välj ${prospect.company_name}`}
                    />
                  </label>

                  <div className={cn(
                    'flex h-10 w-10 items-center justify-center rounded-xl border text-xs font-bold tracking-[0.08em] shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] md:h-11 md:w-11 md:text-sm',
                    selected ? 'border-sky-200 bg-white text-sky-800' : 'border-slate-200 bg-white text-slate-700',
                  )}>
                    {getInitials(prospect.company_name) || 'P'}
                  </div>

                  <div className="grid min-w-0 gap-2">
                    <div className="flex min-w-0 flex-wrap items-start justify-between gap-2 md:flex-nowrap">
                      <div className="grid min-w-0 gap-1">
                        <strong className="break-words text-base font-bold tracking-[-0.03em] text-slate-950 md:text-[17px]">{prospect.company_name}</strong>
                        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500 md:text-xs">
                          {prospect.contact_name ? <span>Kontakt: {prospect.contact_name}</span> : null}
                          {prospect.phone ? <span>{prospect.phone}</span> : null}
                          {prospect.email ? <span>{prospect.email}</span> : null}
                          {prospect.city ? <span>Ort: {prospect.city}</span> : null}
                          {prospect.source ? <span>Källa: {prospect.source}</span> : null}
                        </div>
                      </div>
                      <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-semibold md:px-2.5 md:py-1 md:text-[11px]', statusClass[prospect.status])}>
                        {statusLabel[prospect.status]}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span className={cn(
                        'rounded-full border px-2.5 py-1 font-semibold',
                        assignedUser ? 'border-sky-200 bg-sky-50 text-sky-700' : 'border-slate-200 bg-slate-100 text-slate-600',
                      )}>
                        {assignedUser ? `Tilldelad: ${assignedUser.full_name}` : 'Ej tilldelad'}
                      </span>
                      <span>Senast uppdaterad {formatDateTime(prospect.updated_at)}</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-start gap-2 md:justify-end">
                    <Link href={`/crm/samtal?prospect_id=${prospect.id}`} className="inline-flex min-h-10 items-center justify-center rounded-2xl border border-sky-600 bg-[linear-gradient(180deg,#0ea5e9_0%,#0284c7_100%)] px-3 py-2 text-sm font-semibold text-white shadow-[0_16px_26px_rgba(2,132,199,0.18)] transition hover:brightness-[0.97]">
                      Logga samtal
                    </Link>
                    <Link href="/crm/prospekt" className="inline-flex min-h-10 items-center justify-center rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50">
                      Öppna prospekt
                    </Link>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </SectionCard>
    </div>
  );
}