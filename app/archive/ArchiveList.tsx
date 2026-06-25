"use client";
import { useEffect, useMemo, useState } from "react";
import { crm } from "@/app/crm/lib/crmTokens";

type FileEntry = { path: string; name: string; url?: string; size?: number; updatedAt?: string };

function formatBytes(n?: number) {
  if (!n && n !== 0) return "";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 10 ? 0 : 1)} ${units[i]}`;
}

function formatDateUTC(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

const ghostBtn =
  'inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[13px] font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-800 disabled:opacity-50';

export default function ArchiveList({ initial }: { initial?: FileEntry[] }) {
  const [files, setFiles] = useState<FileEntry[]>(initial ?? []);
  const [loading, setLoading] = useState(!initial);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"name" | "date" | "size">("date");
  const [dir, setDir] = useState<"desc" | "asc">("desc");
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (initial) return;
      setLoading(true);
      try {
        const res = await fetch('/api/storage/list-all', { cache: 'no-store' });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || 'Kunde inte hämta filer');
        if (!cancelled) setFiles(data.files || []);
      } catch {
        if (!cancelled) setFiles([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => { cancelled = true; };
  }, [initial]);

  async function refreshNow() {
    setRefreshing(true);
    try {
      const res = await fetch(`/api/storage/list-all?ts=${Date.now()}`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Kunde inte uppdatera');
      setFiles(data.files || []);
    } catch {
      // ignore, keep current state
    } finally {
      setRefreshing(false);
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let arr = files;
    if (q) arr = arr.filter((f) => f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q));
    const modifier = dir === "asc" ? 1 : -1;
    const by = (a: FileEntry, b: FileEntry) => {
      if (sort === "name") return a.name.localeCompare(b.name) * modifier;
      if (sort === "size") return ((a.size ?? -1) - (b.size ?? -1)) * modifier;
      const ad = a.updatedAt ? Date.parse(a.updatedAt) : 0;
      const bd = b.updatedAt ? Date.parse(b.updatedAt) : 0;
      return (ad - bd) * modifier;
    };
    return [...arr].sort(by);
  }, [files, query, sort, dir]);

  useEffect(() => {
    if (sort === "name") setDir("asc"); else setDir("desc");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort]);

  return (
    <div className="grid gap-3">
      <div className="grid gap-2">
        <input className={crm.input} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Sök filer (namn eller sökväg)…" />
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-[13px] text-slate-600">
            <span>Sortera:</span>
            <select className={crm.select} value={sort} onChange={(e) => setSort(e.target.value as any)}>
              <option value="date">Datum</option>
              <option value="name">Namn</option>
              <option value="size">Storlek</option>
            </select>
          </label>
          <button className={ghostBtn} type="button" onClick={() => setDir((d) => (d === "asc" ? "desc" : "asc"))}>
            {dir === "asc" ? "⬆️" : "⬇️"}
          </button>
          <div className="ml-auto" />
          <button className={ghostBtn} type="button" onClick={refreshNow} disabled={refreshing}>
            {refreshing ? 'Uppdaterar…' : 'Uppdatera'}
          </button>
        </div>
      </div>

      {loading && (
        <div className="grid gap-2" aria-hidden>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl border border-[#e3e9df] bg-[#f9fbf7]" />
          ))}
        </div>
      )}

      <ul className="grid list-none gap-2 p-0">
        {filtered.map((f) => (
          <li key={f.path} className="flex items-center justify-between gap-3 rounded-xl border border-[#e3e9df] bg-[#f9fbf7] px-3.5 py-3">
            <div className="grid min-w-0 gap-0.5">
              <div className="flex items-center gap-2">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden focusable="false" className="shrink-0 text-rose-600">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M14 2v6h6" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M7 16h10M7 12h10" stroke="currentColor" strokeWidth="1.5" />
                </svg>
                <span className="truncate text-[13px] font-semibold text-slate-900">{f.name}</span>
              </div>
              <div className="truncate text-[11px] text-slate-400">{f.path}</div>
              <div className="text-[11px] text-slate-500">
                {formatDateUTC(f.updatedAt)}
                {f.size != null ? ` · ${formatBytes(f.size)}` : ""}
              </div>
            </div>
            <a
              className="inline-flex shrink-0 items-center justify-center rounded-lg px-3 py-1.5 text-[13px] font-semibold text-white no-underline transition hover:opacity-90"
              style={{ backgroundColor: 'var(--crm-primary)' }}
              href={`/api/storage/download?path=${encodeURIComponent(f.path)}`}
              download={f.name}
            >
              Ladda ned
            </a>
          </li>
        ))}
        {filtered.length === 0 && !loading && (
          <li className="rounded-xl border border-dashed border-slate-200 px-4 py-10 text-center text-sm text-slate-400">Inga matchande resultat.</li>
        )}
      </ul>
    </div>
  );
}
