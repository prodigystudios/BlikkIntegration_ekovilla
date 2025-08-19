export const dynamic = 'force-dynamic';
import { headers } from 'next/headers';
import nextDynamic from 'next/dynamic';
const ArchiveList = nextDynamic(() => import('./ArchiveList'), { ssr: false });

async function fetchFiles() {
  const h = headers();
  const host = h.get('x-forwarded-host') || h.get('host');
  const proto = h.get('x-forwarded-proto') || 'http';
  const base = host ? `${proto}://${host}` : '';
  const url = base ? `${base}/api/storage/list-all` : '/api/storage/list-all';
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    try { const j = await res.json(); throw new Error(j?.error || 'Failed'); } catch { throw new Error('Failed to load'); }
  }
  return res.json() as Promise<{ files: Array<{ path: string; name: string; url?: string; size?: number; updatedAt?: string }> }>;
}

export default async function ArchivePage() {
  const { files } = await fetchFiles();
  return (
    <main className="archive">
      <h1>Egenkontroller</h1>
  <ArchiveList initial={files as any} />
    </main>
  );
}
