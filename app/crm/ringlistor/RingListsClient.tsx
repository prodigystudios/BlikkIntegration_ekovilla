'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import Input from '../../../components/ui/Input';
import MetricCard from '../components/MetricCard';
import { useToast } from '@/lib/Toast';
import { cn } from '@/lib/shared/cn';
import { crm } from '@/app/crm/lib/crmTokens';

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

type RoutingRule = {
  id: string;
  county: string;
  user_id: string;
  created_at: string;
};

type AssignmentFilter = 'all' | 'unassigned' | 'assigned';

const SWEDISH_COUNTIES = [
  'Blekinge','Dalarna','Gävleborg','Gotland','Halland','Jämtland','Jönköping',
  'Kalmar','Kronoberg','Norrbotten','Skåne','Stockholm','Södermanland',
  'Uppsala','Värmland','Västerbotten','Västernorrland','Västmanland',
  'Västra Götaland','Örebro','Östergötland',
] as const;
type StatusFilter = 'all' | ProspectItem['status'];

const assignmentFilterMeta: Record<AssignmentFilter, { label: string; hint: string }> = {
  unassigned: { label: 'Ej tilldelade', hint: 'Riktig ringkö' },
  all:        { label: 'Alla',          hint: 'Hela leadbasen' },
  assigned:   { label: 'Tilldelade',    hint: 'Redan ägda leads' },
};

const statusLabel: Record<ProspectItem['status'], string> = {
  new:       'Ny',
  contacted: 'Kontaktad',
  qualified: 'Kvalificerad',
  quoted:    'Offert',
  won:       'Vunnen',
  lost:      'Förlorad',
};

const statusClass: Record<ProspectItem['status'], string> = {
  new:       'border-slate-200 bg-slate-50 text-slate-600',
  contacted: 'border-sky-200 bg-sky-50 text-sky-700',
  qualified: 'border-amber-200 bg-amber-50 text-amber-700',
  quoted:    'border-violet-200 bg-violet-50 text-violet-700',
  won:       'border-emerald-200 bg-emerald-50 text-emerald-700',
  lost:      'border-rose-200 bg-rose-50 text-rose-700',
};

const stripClass: Record<ProspectItem['status'], string> = {
  new:       'bg-slate-300',
  contacted: 'bg-sky-400',
  qualified: 'bg-amber-400',
  quoted:    'bg-violet-400',
  won:       'bg-emerald-400',
  lost:      'bg-rose-300',
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

function compareProspects(a: ProspectItem, b: ProspectItem) {
  return b.updated_at.localeCompare(a.updated_at);
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
  const [importCounty, setImportCounty] = useState('');
  const [error, setError] = useState<string | null>(null);

  const [rules, setRules] = useState<RoutingRule[]>([]);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [newRuleCounty, setNewRuleCounty] = useState('');
  const [newRuleUserId, setNewRuleUserId] = useState('');
  const [savingRule, setSavingRule] = useState(false);
  const [deletingRuleId, setDeletingRuleId] = useState<string | null>(null);

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

        const rulesRes = await fetch('/api/crm/routing-rules', { cache: 'no-store' });
        const rulesJson = await rulesRes.json().catch(() => ({}));
        if (rulesRes.ok && rulesJson.ok) {
          setRules(Array.isArray(rulesJson?.data?.items) ? rulesJson.data.items : []);
        }
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
    }).sort(compareProspects);
  }, [assignmentFilter, prospects, statusFilter]);

  const stats = useMemo(() => ({
    total: prospects.length,
    unassigned: prospects.filter((item) => !item.assigned_to).length,
    new: prospects.filter((item) => item.status === 'new').length,
    qualified: prospects.filter((item) => item.status === 'qualified' || item.status === 'quoted').length,
  }), [prospects]);

  const assignmentCounts = useMemo(() => ({
    unassigned: prospects.filter((item) => !item.assigned_to && (statusFilter === 'all' || item.status === statusFilter)).length,
    all: prospects.filter((item) => statusFilter === 'all' || item.status === statusFilter).length,
    assigned: prospects.filter((item) => Boolean(item.assigned_to) && (statusFilter === 'all' || item.status === statusFilter)).length,
  }), [prospects, statusFilter]);

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

  async function saveRoutingRule() {
    if (!newRuleCounty || !newRuleUserId) { toast.error('Välj ett län och en säljare'); return; }
    setSavingRule(true);
    try {
      const res = await fetch('/api/crm/routing-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ county: newRuleCounty, user_id: newRuleUserId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) { toast.error(json?.error || 'Kunde inte spara routingregel'); return; }
      const item = json?.data?.item as RoutingRule | undefined;
      if (item) setRules((c) => [...c.filter((r) => r.county !== item.county), item].sort((a, b) => a.county.localeCompare(b.county, 'sv')));
      setNewRuleCounty('');
      setNewRuleUserId('');
      toast.success(`Regel sparad: ${newRuleCounty}`);
    } catch {
      toast.error('Fel vid sparande av routingregel');
    } finally {
      setSavingRule(false);
    }
  }

  async function deleteRoutingRule(id: string) {
    setDeletingRuleId(id);
    try {
      const res = await fetch(`/api/crm/routing-rules/${id}`, { method: 'DELETE' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) { toast.error(json?.error || 'Kunde inte ta bort regel'); return; }
      setRules((c) => c.filter((r) => r.id !== id));
      toast.success('Regel borttagen');
    } catch {
      toast.error('Fel vid borttagning av routingregel');
    } finally {
      setDeletingRuleId(null);
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
          county: importCounty || null,
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
    <div className="grid gap-6">
      {/* Page header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className={crm.pageTitle}>Ringlistor</h1>
          <p className={cn('mt-1', crm.pageSubtitle)}>
            Oklaimad lead-kö — vilka leads saknar ägare, vilka är nya och vad behöver fördelas nu.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {adminName ? (
            <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700">
              {adminName}
            </span>
          ) : null}
          <label className={cn(crm.ghostButton, 'cursor-pointer')}>
            {importFileName ? `Fil: ${importFileName}` : 'Välj fil'}
            <input type="file" accept=".xlsx,.xls,.csv" onChange={handleImportFile} className="sr-only" />
          </label>
          <button
            type="button"
            onClick={importPreparedRows}
            disabled={importing || importRows.length === 0}
            className={cn(crm.primaryButton, 'disabled:cursor-not-allowed disabled:opacity-60')}
            style={{ backgroundColor: 'var(--crm-primary)' }}
          >
            {importing ? 'Importerar…' : importRows.length > 0 ? `Importera ${importRows.length}` : 'Importera'}
          </button>
        </div>
      </div>

      {/* Metrics */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="I kö just nu" value={visibleProspects.length} helper="Poster i nuvarande vy" />
        <MetricCard label="Ej tilldelade" value={stats.unassigned} helper="Leads utan ägare" />
        <MetricCard label="Nya" value={stats.new} helper="Första kontakt kvar" />
        <MetricCard label="Varma" value={stats.qualified} helper="Kvalificerade eller offert" />
      </div>

      {/* Main list card */}
      <div className={crm.card}>
        {/* Toolbar */}
        <div className="border-b border-slate-100 px-5 py-3">
          <div className="flex flex-wrap items-center gap-3">
            {/* Assignment filter pills */}
            <div className="flex flex-wrap gap-2">
              {(Object.keys(assignmentFilterMeta) as AssignmentFilter[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setAssignmentFilter(value)}
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-sm font-semibold transition',
                    assignmentFilter === value
                      ? 'text-white'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50',
                  )}
                  style={assignmentFilter === value ? { backgroundColor: 'var(--crm-primary)', borderColor: 'var(--crm-primary)' } : undefined}
                >
                  {assignmentFilterMeta[value].label}
                  <span className={cn('ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold', assignmentFilter === value ? 'bg-white/20' : 'bg-slate-100 text-slate-500')}>
                    {assignmentCounts[value]}
                  </span>
                </button>
              ))}
            </div>

            {/* Status select */}
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
              className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-600 outline-none transition hover:border-slate-300"
            >
              <option value="all">Alla statusar</option>
              {Object.entries(statusLabel).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>

            {/* Search */}
            <div className="ml-auto">
              <Input
                value={search}
                onChange={(event: ChangeEvent<HTMLInputElement>) => setSearch(event.target.value)}
                placeholder="Sök på företag, kontakt eller ort"
                className="w-64"
              />
            </div>

            <span className="text-xs text-slate-400">{visibleProspects.length} i vy</span>
          </div>
        </div>

        {/* Assignment controls */}
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 bg-slate-50/60 px-5 py-3">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <input type="checkbox" checked={visibleAllSelected} onChange={toggleSelectAll} className="h-4 w-4 rounded border-slate-300" />
            Markera alla i vyn
          </label>

          <select
            value={selectedUserId}
            onChange={(event) => setSelectedUserId(event.target.value)}
            className="min-h-9 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 outline-none transition focus:border-slate-300"
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
            className={cn(crm.saveButton, 'h-9 w-auto px-4 text-xs')}
          >
            {assigning ? 'Tilldelar…' : `Tilldela markerade (${selectedIds.length})`}
          </button>

          <div className="ml-auto flex flex-wrap items-center gap-2 text-xs text-slate-400">
            {importFileName ? (
              <span className={cn(crm.badge, 'border-sky-200 bg-sky-50 text-sky-700')}>Fil: {importFileName}</span>
            ) : null}
            <span>{stats.total} leads totalt</span>
            <span>·</span>
            <span>{stats.unassigned} utan ägare</span>
          </div>
        </div>

        {/* Import county selector — shown when file is loaded */}
        {importRows.length > 0 ? (
          <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 bg-amber-50/40 px-5 py-3">
            <span className={crm.sectionTitle}>Vilket län gäller denna import?</span>
            <select
              value={importCounty}
              onChange={(e) => setImportCounty(e.target.value)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 outline-none transition focus:border-slate-300"
            >
              <option value="">Inget specifikt län</option>
              {SWEDISH_COUNTIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            {importCounty ? (() => {
              const rule = rules.find((r) => r.county === importCounty);
              const user = rule ? usersById.get(rule.user_id) : null;
              return rule ? (
                <span className={cn(crm.badge, 'border-emerald-200 bg-emerald-50 text-emerald-700')}>
                  Tilldelas automatiskt: {user?.full_name || 'Okänd säljare'}
                </span>
              ) : (
                <span className={cn(crm.badge, 'border-amber-200 bg-amber-50 text-amber-700')}>
                  Ingen routingregel för {importCounty} — välj säljare manuellt
                </span>
              );
            })() : null}
          </div>
        ) : null}

        {error ? (
          <div className="mx-4 mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
        ) : null}

        {/* Prospect list */}
        <div className="divide-y divide-slate-100">
          {loading ? (
            Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="flex gap-3 px-5 py-4">
                <div className="h-9 w-9 animate-pulse rounded-full bg-slate-100" />
                <div className="flex-1 grid gap-2">
                  <div className="h-3 w-40 animate-pulse rounded-full bg-slate-100" />
                  <div className="h-3 w-24 animate-pulse rounded-full bg-slate-100" />
                </div>
              </div>
            ))
          ) : visibleProspects.length === 0 ? (
            <div className="grid gap-2 px-5 py-8 text-center">
              <strong className="text-base font-bold text-slate-900">Ingen oallokerad lead i kön</strong>
              <p className="m-0 text-sm text-slate-500">Importera fler leads eller ändra filter om du vill se redan tilldelade poster.</p>
            </div>
          ) : (
            visibleProspects.map((prospect) => {
              const assignedUser = prospect.assigned_to ? usersById.get(prospect.assigned_to) || null : null;
              const selected = selectedIds.includes(prospect.id);

              return (
                <div
                  key={prospect.id}
                  className={cn(
                    'relative flex items-center gap-3 px-5 py-3.5 transition',
                    selected ? 'bg-emerald-50/40' : 'hover:bg-slate-50/60',
                  )}
                >
                  {/* Left color strip */}
                  <span className={cn('absolute inset-y-0 left-0 w-1', stripClass[prospect.status])} />

                  {/* Checkbox */}
                  <label className="flex shrink-0 items-center justify-center pl-2">
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleSelected(prospect.id)}
                      className="h-4 w-4 rounded border-slate-300"
                      aria-label={`Välj ${prospect.company_name}`}
                    />
                  </label>

                  {/* Initials */}
                  <div className={cn(
                    'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                    selected ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500',
                  )}>
                    {getInitials(prospect.company_name) || 'P'}
                  </div>

                  {/* Info */}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="truncate text-sm font-semibold text-slate-900">{prospect.company_name}</strong>
                      <span className={cn(crm.badge, statusClass[prospect.status])}>
                        {statusLabel[prospect.status]}
                      </span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-slate-400">
                      {prospect.contact_name ? <span>{prospect.contact_name}</span> : null}
                      {prospect.phone ? <span>{prospect.phone}</span> : null}
                      {prospect.email ? <span className="max-w-[200px] truncate">{prospect.email}</span> : null}
                      {prospect.city ? <span>{prospect.city}</span> : null}
                      {prospect.source ? <span>Källa: {prospect.source}</span> : null}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <span className={cn(
                        'rounded-full border px-2 py-0.5 text-[11px] font-semibold',
                        assignedUser ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-500',
                      )}>
                        {assignedUser ? `Tilldelad: ${assignedUser.full_name}` : 'Ej tilldelad'}
                      </span>
                      <span className="text-[11px] text-slate-400">Uppdaterad {formatDateTime(prospect.updated_at)}</span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    <Link
                      href={`/crm/samtal?prospect_id=${prospect.id}`}
                      className={cn(crm.primaryButton, 'text-xs')}
                      style={{ backgroundColor: 'var(--crm-primary)' }}
                    >
                      Logga samtal
                    </Link>
                    <Link
                      href="/crm/prospekt"
                      className={cn(crm.ghostButton, 'h-8 text-xs')}
                    >
                      Öppna
                    </Link>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Import section */}
      <div className={crm.cardInner}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className={cn(crm.badge, 'border-emerald-200 bg-emerald-50 text-emerald-700')}>Excel-import</span>
              <span className={cn(crm.badge, 'border-slate-200 bg-slate-50 text-slate-500')}>.xlsx och .csv</span>
            </div>
            <p className="m-0 text-sm text-slate-500">
              Fyll på kön med nya listor, deduplicera mot befintliga prospekt och håll importen som ett sekundärt flöde under den dagliga ringningen.
            </p>
            {importRows.length > 0 ? (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span className={cn(crm.badge, 'border-emerald-200 bg-emerald-50 text-emerald-700')}>{importRows.length} rader klara</span>
                <span>Förhandsvisar de första {Math.min(importRows.length, 5)} raderna nedan.</span>
              </div>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className={cn(crm.ghostButton, 'cursor-pointer')}>
              Välj fil
              <input type="file" accept=".xlsx,.xls,.csv" onChange={handleImportFile} className="sr-only" />
            </label>
            <button
              type="button"
              onClick={importPreparedRows}
              disabled={importing || importRows.length === 0}
              className={cn(crm.saveButton, 'h-9 w-auto px-4')}
            >
              {importing ? 'Importerar…' : `Importera ${importRows.length || ''}`.trim()}
            </button>
          </div>
        </div>

        {importRows.length > 0 ? (
          <div className="mt-4 grid gap-2">
            {importRows.slice(0, 5).map((row, index) => (
              <div key={`${row.company_name}-${index}`} className="grid gap-2 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 md:grid-cols-[minmax(0,1.15fr)_minmax(0,0.95fr)_auto] md:items-center">
                <div className="grid gap-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="text-sm font-semibold text-slate-900">{row.company_name}</strong>
                    <span className={cn(crm.badge, 'border-slate-200 bg-white text-slate-400')}>Rad {index + 1}</span>
                  </div>
                  <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-slate-400">
                    {row.contact_name ? <span>{row.contact_name}</span> : null}
                    {row.organization_number ? <span>{row.organization_number}</span> : null}
                    {row.city ? <span>{row.city}</span> : null}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 text-xs text-slate-500">
                  {row.phone ? <span className={cn(crm.badge, 'border-slate-200 bg-white text-slate-500')}>{row.phone}</span> : null}
                  {row.email ? <span className={cn(crm.badge, 'border-slate-200 bg-white text-slate-500')}>{row.email}</span> : null}
                  {row.source ? <span className={cn(crm.badge, 'border-emerald-200 bg-emerald-50 text-emerald-700')}>Källa: {row.source}</span> : null}
                </div>
                <div className="text-xs font-semibold text-slate-400 md:text-right">Klar för import</div>
              </div>
            ))}
          </div>
        ) : null}

        {importResults.length > 0 ? (
          <div className="mt-4 grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <strong className="text-sm font-semibold text-slate-900">Importresultat per rad</strong>
              <span className="text-xs text-slate-400">{importResults.length} rader med utfall</span>
            </div>
            <div className="grid gap-2">
              {importResults.slice(0, 12).map((result) => (
                <div key={`${result.row_number}-${result.company_name}-${result.action}`} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 px-4 py-2.5 text-sm">
                  <div className="grid gap-0.5">
                    <strong className="text-slate-900">Rad {result.row_number}: {result.company_name}</strong>
                    <span className="text-xs text-slate-400">
                      {result.action === 'updated' && result.matched_on === 'orgnummer' ? 'Matchad på orgnummer' : null}
                      {result.action === 'updated' && result.matched_on === 'foretag_epost' ? 'Matchad på företag + e-post' : null}
                      {result.action === 'updated' && result.matched_on === 'foretag_kontakt' ? 'Matchad på företag + kontakt' : null}
                      {result.action === 'updated' && result.matched_on === 'foretag' ? 'Matchad på företagsnamn' : null}
                      {result.action === 'skipped_empty' ? 'Föll bort eftersom företagsnamn saknades' : null}
                    </span>
                  </div>
                  <span className={cn(
                    crm.badge,
                    result.action === 'created' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : null,
                    result.action === 'updated' ? 'border-sky-200 bg-sky-50 text-sky-700' : null,
                    result.action === 'skipped_empty' ? 'border-slate-200 bg-slate-50 text-slate-500' : null,
                  )}>
                    {result.action === 'created' ? 'Skapad' : result.action === 'updated' ? 'Uppdaterad' : 'Tom rad'}
                  </span>
                </div>
              ))}
            </div>
            {importResults.length > 12 ? <div className="text-xs text-slate-400">Visar de första 12 raderna med utfall.</div> : null}
          </div>
        ) : null}
      </div>

      {/* Routing rules */}
      <div className={crm.cardInner}>
        <div className="flex items-center justify-between gap-3">
          <div className="grid gap-0.5">
            <strong className="text-sm font-semibold text-slate-900">Länbaserad routing</strong>
            <p className="m-0 text-sm text-slate-500">Koppla ett län till en säljare — leads tilldelas automatiskt vid import.</p>
          </div>
          <button
            type="button"
            onClick={() => setRulesOpen((c) => !c)}
            className={crm.ghostButton}
          >
            {rulesOpen ? 'Dölj' : `Hantera (${rules.length})`}
          </button>
        </div>

        {rulesOpen ? (
          <div className="mt-4 grid gap-4">
            {/* New rule */}
            <div className="grid gap-3 rounded-xl border border-slate-100 bg-slate-50/60 p-4 sm:grid-cols-[1fr_1fr_auto]">
              <select
                value={newRuleCounty}
                onChange={(e) => setNewRuleCounty(e.target.value)}
                className="min-h-11 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-slate-300"
              >
                <option value="">Välj län…</option>
                {SWEDISH_COUNTIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <select
                value={newRuleUserId}
                onChange={(e) => setNewRuleUserId(e.target.value)}
                className="min-h-11 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-slate-300"
              >
                <option value="">Välj säljare…</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.full_name || 'Okänd'}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={saveRoutingRule}
                disabled={savingRule || !newRuleCounty || !newRuleUserId}
                className={cn(crm.saveButton, 'h-11 w-auto px-4')}
              >
                {savingRule ? 'Sparar…' : 'Spara regel'}
              </button>
            </div>

            {/* Existing rules */}
            {rules.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                Inga routingregler konfigurerade ännu.
              </div>
            ) : (
              <div className="grid gap-2">
                {rules.map((rule) => {
                  const user = usersById.get(rule.user_id);
                  return (
                    <div key={rule.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-white px-4 py-3">
                      <div className="flex flex-wrap items-center gap-3">
                        <span className={cn(crm.badge, 'border-slate-200 bg-slate-50 text-slate-700')}>
                          {rule.county}
                        </span>
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" className="text-slate-300">
                          <path d="M2 7h10M8 4l4 3-4 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        <span className="text-sm font-semibold text-slate-900">{user?.full_name || 'Okänd säljare'}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => deleteRoutingRule(rule.id)}
                        disabled={deletingRuleId === rule.id}
                        className="text-xs font-semibold text-slate-400 transition hover:text-rose-600 disabled:opacity-50"
                      >
                        {deletingRuleId === rule.id ? 'Tar bort…' : 'Ta bort'}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
