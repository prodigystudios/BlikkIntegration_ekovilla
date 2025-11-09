import { getSupabaseAdmin } from '@/lib/supabase/server';
import { getBlikk } from '@/lib/blikk';

// Configurable cache TTL (milliseconds) via env; default 24h
const TTL_MS = Math.max(5 * 60_000, Number(process.env.BLIKK_CACHE_TTL_MS || 24 * 60 * 60 * 1000));

type RefItem = { id: string; code: string | null; name: string | null; billable: boolean | null; active: boolean | null; _raw?: any };

function now() { return Date.now(); }

async function isStale(table: 'blikk_timecodes' | 'blikk_activities') {
  const supa = getSupabaseAdmin();
  const { data, error } = await supa
    .from(table)
    .select('updated_at')
    .order('updated_at', { ascending: false })
    .limit(1);
  if (error) return true;
  if (!data || data.length === 0) return true;
  const latest = new Date(data[0].updated_at).getTime();
  return (now() - latest) > TTL_MS;
}

function toId(v: any): string | null {
  const c = v?.id ?? v?.timecodeId ?? v?.activityId ?? v?.Id ?? v?.ActivityId ?? v?.TimecodeId ?? v?.code ?? v?.number ?? v?.Code;
  return c == null ? null : String(c);
}

function mapTimecode(raw: any): RefItem | null {
  const id = toId(raw);
  if (!id) return null;
  return {
    id,
    name: raw.name ?? raw.title ?? raw.displayName ?? raw.code ?? `Tidkod ${raw.id ?? ''}`,
    code: raw.code ?? raw.number ?? raw.Code ?? null,
    billable: raw.billable ?? raw.isBillable ?? null,
    active: raw.active ?? raw.isActive ?? null,
    _raw: raw,
  };
}

function mapActivity(raw: any): RefItem | null {
  const id = toId(raw);
  if (!id) return null;
  return {
    id,
    name: raw.name ?? raw.title ?? raw.displayName ?? raw.code ?? `Aktivitet ${raw.id ?? ''}`,
    code: raw.code ?? raw.Code ?? null,
    billable: raw.billable ?? raw.isBillable ?? null,
    active: raw.active ?? raw.isActive ?? null,
    _raw: raw,
  };
}

async function fetchAllFromBlikk(basePath: string) {
  const blikk = getBlikk();
  const pageSize = 50;
  const maxPages = 10; // safety cap: 2000 rows
  const gathered: any[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const qs = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    const url = `${basePath}?${qs.toString()}`;
    const res: any = await (blikk as any).request(url.replace(/^https?:\/\/[^/]+/, ''));
    const items: any[] = Array.isArray(res) ? res : (res.items || res.data || []);
    if (!items.length) break;
    gathered.push(...items);
    if (items.length < pageSize) break;
  }
  return { usedBase: basePath, items: gathered };
}

export async function refreshTimecodesCache() {
  // Use explicit admin endpoint (confirmed working) with env override
  const base = process.env.BLIKK_TIMECODES_PATH || '/v1/Admin/Timecodes';
  const { items } = await fetchAllFromBlikk(base);
  const mapped = items.map(mapTimecode).filter(Boolean) as RefItem[];
  const supa = getSupabaseAdmin();
  // Upsert in chunks to avoid payload limits
  const chunk = 500;
  for (let i = 0; i < mapped.length; i += chunk) {
    const slice = mapped.slice(i, i + chunk);
    const rows = slice.map(r => ({
      id: r.id,
      code: r.code,
      name: r.name,
      billable: r.billable,
      active: r.active,
      source: r._raw ?? null,
      updated_at: new Date().toISOString(),
    }));
    const { error } = await supa.from('blikk_timecodes').upsert(rows, { onConflict: 'id' });
    if (error) throw error;
  }
  return { count: mapped.length };
}

export async function refreshActivitiesCache() {
  const base = process.env.BLIKK_ACTIVITIES_PATH || '/v1/Admin/Activities';
  const { items } = await fetchAllFromBlikk(base);
  const mapped = items.map(mapActivity).filter(Boolean) as RefItem[];
  const supa = getSupabaseAdmin();
  const chunk = 500;
  for (let i = 0; i < mapped.length; i += chunk) {
    const slice = mapped.slice(i, i + chunk);
    const rows = slice.map(r => ({
      id: r.id,
      code: r.code,
      name: r.name,
      billable: r.billable,
      active: r.active,
      source: r._raw ?? null,
      updated_at: new Date().toISOString(),
    }));
    const { error } = await supa.from('blikk_activities').upsert(rows, { onConflict: 'id' });
    if (error) throw error;
  }
  return { count: mapped.length };
}

function applyQueryFilter<T extends { name: string | null; code: string | null }>(rows: T[], q: string) {
  if (!q) return rows;
  const needle = q.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter(r => (r.name || '').toLowerCase().includes(needle) || (r.code || '').toLowerCase().includes(needle));
}

export async function getTimecodesFromCache(opts: { q?: string; page?: number; pageSize?: number; forceRefresh?: boolean }) {
  const supa = getSupabaseAdmin();
  const shouldRefresh = opts.forceRefresh || await isStale('blikk_timecodes');
  if (shouldRefresh) {
    // Fire and forget
    refreshTimecodesCache().catch(err => console.warn('refreshTimecodesCache failed', err));
  }
  const { data, error } = await supa.from('blikk_timecodes').select('id, code, name, billable, active').order('name', { ascending: true });
  if (error) throw error;
  const filtered = applyQueryFilter(data || [], opts.q || '');
  const page = Math.max(1, opts.page || 1);
  const pageSize = Math.max(1, Math.min(500, opts.pageSize || 200));
  const start = (page - 1) * pageSize;
  const end = start + pageSize;
  return filtered.slice(start, end);
}

export async function getActivitiesFromCache(opts: { q?: string; page?: number; pageSize?: number; forceRefresh?: boolean }) {
  const supa = getSupabaseAdmin();
  const shouldRefresh = opts.forceRefresh || await isStale('blikk_activities');
  if (shouldRefresh) {
    refreshActivitiesCache().catch(err => console.warn('refreshActivitiesCache failed', err));
  }
  const { data, error } = await supa.from('blikk_activities').select('id, code, name, billable, active').order('name', { ascending: true });
  if (error) throw error;
  const filtered = applyQueryFilter(data || [], opts.q || '');
  const page = Math.max(1, opts.page || 1);
  const pageSize = Math.max(1, Math.min(500, opts.pageSize || 200));
  const start = (page - 1) * pageSize;
  const end = start + pageSize;
  return filtered.slice(start, end);
}
