export const dynamic = 'force-dynamic';
import { headers } from 'next/headers';
import nextDynamic from 'next/dynamic';
const ArchiveList = nextDynamic(() => import('./ArchiveList'), { ssr: false });

async function fetchFiles(search: string) {
  const h = headers();
  const host = h.get('x-forwarded-host') || h.get('host');
  const proto = h.get('x-forwarded-proto') || 'http';
  const base = host ? `${proto}://${host}` : '';
  const qs = search ? (search.startsWith('?') ? search : `?${search}`) : '';
  const url = base ? `${base}/api/storage/list-all${qs}` : `/api/storage/list-all${qs}`;
  // IMPORTANT: Forward cookies so authenticated middleware + Supabase session works on internal fetch.
  const cookie = h.get('cookie') || '';
  const res = await fetch(url, {
    cache: 'no-store',
    next: { tags: ['archive-list'] },
    headers: cookie ? { cookie } : undefined,
  });
  if (!res.ok) {
    try { const j = await res.json(); throw new Error(j?.error || 'Failed'); } catch { throw new Error('Failed to load'); }
  }
  return res.json() as Promise<{ files: Array<{ path: string; name: string; url?: string; size?: number; updatedAt?: string }> }>;
}

export default async function ArchivePage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams || {})) {
    if (Array.isArray(v)) {
      for (const val of v) sp.append(k, val);
    } else if (v != null) {
      sp.set(k, v);
    }
  }
  const { files } = await fetchFiles(sp.toString());
  return (
    <main className="archive">
      <h1>Egenkontroller</h1>
  <ArchiveList initial={files as any} />
    </main>
  );
}
