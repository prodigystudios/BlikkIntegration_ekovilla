"use client";
import { useEffect, useMemo, useState } from "react";

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

export default function ArchiveList({ initial }: { initial: FileEntry[] }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"name" | "date" | "size">("date");
  const [dir, setDir] = useState<"desc" | "asc">("desc");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let arr = initial;
    if (q) arr = arr.filter(f => f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q));
    const modifier = dir === "asc" ? 1 : -1;
    const by = (a: FileEntry, b: FileEntry) => {
      if (sort === "name") return a.name.localeCompare(b.name) * modifier;
      if (sort === "size") return ((a.size ?? -1) - (b.size ?? -1)) * modifier;
      // date default
      const ad = a.updatedAt ? Date.parse(a.updatedAt) : 0;
      const bd = b.updatedAt ? Date.parse(b.updatedAt) : 0;
      return (ad - bd) * modifier;
    };
    return [...arr].sort(by);
  }, [initial, query, sort, dir]);

  useEffect(() => {
    // Keep desc for date/size, asc for name as a sensible default
    if (sort === "name") setDir("asc"); else setDir("desc");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort]);

  return (
    <div>
      <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Sök filer (namn eller sökväg)…"
          style={{ padding: 10, border: "1px solid #e5e7eb", borderRadius: 8 }}
        />
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span>Sortera:</span>
            <select className="select-field" value={sort} onChange={(e) => setSort(e.target.value as any)}>
              <option value="date">Datum</option>
              <option value="name">Namn</option>
              <option value="size">Storlek</option>
            </select>
          </label>
          <button className="btn--plain" type="button" onClick={() => setDir(d => d === "asc" ? "desc" : "asc")}>
            {dir === "asc" ? "⬆️" : "⬇️"}
          </button>
        </div>
      </div>

      <ul className="archive-list">
        {filtered.map((f) => (
          <li key={f.path} className="archive-item">
            <div className="archive-meta">
              <div className="file-name">{f.name}</div>
              <div className="file-path">{f.path}</div>
              <div style={{ color: "#6b7280", fontSize: 12 }}>
                {formatDateUTC(f.updatedAt)}
                {f.size != null ? ` · ${formatBytes(f.size)}` : ""}
              </div>
            </div>
            <div className="archive-actions">
              {f.url ? (
                <a
                  className="btn--success btn--sm"
                  href={`/api/storage/download?path=${encodeURIComponent(f.path)}`}
                  download={f.name}
                >
                  Ladda ned
                </a>
              ) : (
                <span className="text-error">Ingen länk</span>
              )}
            </div>
          </li>
        ))}
        {filtered.length === 0 && <li style={{ color: "#6b7280" }}>Inga matchande resultat.</li>}
      </ul>
    </div>
  );
}
