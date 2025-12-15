import { NextRequest, NextResponse } from 'next/server';
import { getBlikk } from '@/lib/blikk';

// Simple in-memory cache for project statuses to avoid repeated lookups
// Key: project id (string) -> { status, ts }
const STATUS_TTL_MS = 10 * 60_000; // 10 minutes
const statusCache: Map<string, { status: string; ts: number }> = new Map();

// Legacy POST removed
export async function POST() {
  return NextResponse.json({ error: 'This endpoint has been removed.' }, { status: 410 });
}

// Temporary GET: mock latest projects (replace with real Blikk fetch later)
export async function GET(req: NextRequest) {
  const useMock = req.nextUrl.searchParams.get('mock') === '1';
  const orderNumberQuery = req.nextUrl.searchParams.get('orderNumber') || req.nextUrl.searchParams.get('ordernumber');
  const includeRaw = req.nextUrl.searchParams.get('raw') === '1' || req.nextUrl.searchParams.get('includeraw') === '1';
  if (useMock) {
    const now = Date.now();
    const projects = Array.from({ length: 10 }).map((_, i) => ({
      id: `mock-${i + 1}`,
      name: `Projekt ${i + 1}`,
      orderNumber: String(5000 + i),
      customer: `Kund ${i + 1}`,
      createdAt: new Date(now - i * 86400000).toISOString(),
      status: 'new',
      ...(includeRaw ? { _raw: { mock: true } } : {}),
    }));
    return NextResponse.json({ projects, source: 'mock' });
  }

  try {
    const blikk = getBlikk();
    // If specific order number requested, attempt direct lookup first
    if (orderNumberQuery) {
      const found = await blikk.getProjectByOrderNumber(orderNumberQuery);
      if (found) {
        const salesResponsible = (() => {
          const sr: any = (found as any).salesResponsible || (found as any).salesResponsibleUser || (found as any).salesUser || (found as any).salesRep || (found as any).responsibleSalesUser;
          if (Array.isArray(sr)) {
            return sr.map(s => (s && (s.name || s.fullName || s.title)) || '').filter(Boolean).join(', ') || null;
          }
          if (typeof sr === 'string') return sr;
          if (sr && typeof sr === 'object') return sr.name || sr.fullName || sr.title || null;
          const alt = (found as any).salesResponsibleName || (found as any).salesResponsibleFullName;
          return alt || null;
        })();
        const addressObj: any = (found as any).address || (found as any).Address || null;
        const street = addressObj?.street || addressObj?.Street || (found as any).street || (found as any).addressLine1 || (found as any).Address1 || (found as any).line1 || null;
        const postalCode = addressObj?.postalCode || addressObj?.Zip || (found as any).postalCode || (found as any).zip || (found as any).zipCode || (found as any).postal || null;
        const city = addressObj?.city || addressObj?.City || (found as any).city || (found as any).town || (found as any).locality || null;
        const address = [street, postalCode, city].filter(Boolean).join(', ') || null;
        const description = (found as any).description || (found as any).notes || (found as any).note || (found as any).comment || (found as any).projectDescription || null;
        const mapped = {
          id: String(found.id ?? found.projectId ?? found.orderNumber ?? found.Id ?? found.ProjectId ?? 'unknown'),
          name: found.title || found.name || found.projectName || found.orderName || `Projekt ${found.id}`,
          orderNumber: found.orderNumber || found.projectNumber || found.number || null,
          customer: (found.customer && (found.customer.name || found.customer.title)) || found.customerName || found.clientName || found.customer || 'Okänd kund',
          customerId: (found.customer && (found.customer.id || found.customer.Id)) || found.customerId || found.contactId || null,
          createdAt: found.createdDate || found.created || found.createdAt || found.creationDate || new Date().toISOString(),
          status: (found.status && (found.status.name || found.status.title)) || found.status || found.state || 'unknown',
          salesResponsible: salesResponsible,
          street,
          postalCode,
          city,
          address,
          description,
          ...(includeRaw ? { _raw: found } : {}),
        };
        return NextResponse.json({ projects: [mapped], source: 'blikk:orderNumber' });
      }
      // If not found, continue to normal latest list (could also return empty)
    }
    const meta = await blikk.listProjectsWithMeta({ page: 1, pageSize: 10, sortDesc: true });
    const raw = meta.data;
    const items: any[] = Array.isArray(raw) ? raw : (raw.items || raw.data || []);
    const mapped = items.map((p) => {
      const salesResponsible = (() => {
        const sr: any = (p as any).salesResponsible || (p as any).salesResponsibleUser || (p as any).salesUser || (p as any).salesRep || (p as any).responsibleSalesUser;
        if (Array.isArray(sr)) {
          return sr.map(s => (s && (s.name || s.fullName || s.title)) || '').filter(Boolean).join(', ') || null;
        }
        if (typeof sr === 'string') return sr;
        if (sr && typeof sr === 'object') return sr.name || sr.fullName || sr.title || null;
        const alt = (p as any).salesResponsibleName || (p as any).salesResponsibleFullName;
        return alt || null;
      })();
      return {
        id: String(p.id ?? p.projectId ?? p.orderNumber ?? p.Id ?? p.ProjectId ?? 'unknown'),
        name: p.title || p.name || p.projectName || p.orderName || `Projekt ${p.id}`,
        orderNumber: p.orderNumber || p.projectNumber || p.number || null,
        customer: (p.customer && (p.customer.name || p.customer.title)) || p.customerName || p.clientName || p.customer || 'Okänd kund',
        customerId: (p.customer && (p.customer.id || p.customer.Id)) || p.customerId || p.contactId || null,
        createdAt: p.createdDate || p.created || p.createdAt || p.creationDate || new Date().toISOString(),
        status: (p.status && (p.status.name || p.status.title)) || p.status || p.state || 'unknown',
        salesResponsible: salesResponsible,
        ...(includeRaw ? { _raw: p } : {}),
      };
    });
    // Client-side stable sort by createdAt desc if present
    mapped.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    const projects = mapped.slice(0, 10);

    // Hydrate missing statuses (unknown) with a small server-side lookup, cached
    const now = Date.now();
    const unknowns = projects
      .map((p, idx) => ({ p, idx }))
      .filter(({ p }) => (p.status === 'unknown' || !p.status) && /^\d+$/.test(String(p.id)));
    const toHydrate = unknowns.slice(0, 6); // cap to avoid bursts
    // Apply cached values immediately if present and fresh
    for (const it of toHydrate) {
      const key = String(it.p.id);
      const cached = statusCache.get(key);
      if (cached && (now - cached.ts) < STATUS_TTL_MS) {
        projects[it.idx].status = cached.status;
      }
    }
    // Fetch details for those still unknown after cache
    const stillUnknown = toHydrate.filter(({ idx }) => projects[idx].status === 'unknown' || !projects[idx].status);
    if (stillUnknown.length > 0) {
      // Limit concurrency by doing small batches
      const batch = stillUnknown.slice(0, 6);
      await Promise.all(batch.map(async ({ p, idx }) => {
        try {
          const data: any = await blikk.getProjectById(Number(p.id));
          const raw = data?.status ?? data?.state;
          const label = typeof raw === 'string' ? raw : (raw?.name || raw?.title || null);
          if (label) {
            const normalized = String(label);
            projects[idx].status = normalized;
            statusCache.set(String(p.id), { status: normalized, ts: Date.now() });
          }
        } catch (e) {
          // Ignore errors; keep 'unknown'
        }
      }));
    }

    return NextResponse.json({ projects, source: 'blikk' });
  } catch (e: any) {
    console.error('GET /api/blikk/projects failed, falling back to mock', e);
    const now = Date.now();
    const projects = Array.from({ length: 10 }).map((_, i) => ({
      id: `mock-${i + 1}`,
      name: `Projekt ${i + 1}`,
      orderNumber: String(5000 + i),
      customer: `Kund ${i + 1}`,
      createdAt: new Date(now - i * 86400000).toISOString(),
      status: 'new',
      ...(includeRaw ? { _raw: { mock: true } } : {}),
    }));
    return NextResponse.json({ projects, source: 'mock', error: String(e?.message || e) }, { status: 200 });
  }
}
