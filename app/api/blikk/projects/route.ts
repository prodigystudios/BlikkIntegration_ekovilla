import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getBlikk } from '@/lib/blikk';
import { routeError } from '../_admin-resource';

// Simple in-memory cache for project statuses to avoid repeated lookups
// Key: project id (string) -> { status, ts }
const STATUS_TTL_MS = 10 * 60_000; // 10 minutes
const statusCache: Map<string, { status: string; ts: number }> = new Map();

const projectsQuerySchema = z.object({
  mock: z.enum(['1']).optional(),
  raw: z.enum(['1']).optional(),
  includeraw: z.enum(['1']).optional(),
  orderNumber: z.string().trim().optional(),
  ordernumber: z.string().trim().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(50).optional(),
  limit: z.coerce.number().int().positive().max(50).optional(),
});

function mapProject(found: any, includeRaw: boolean) {
  const salesResponsible = (() => {
    const sr: any = found?.salesResponsible || found?.salesResponsibleUser || found?.salesUser || found?.salesRep || found?.responsibleSalesUser;
    if (Array.isArray(sr)) {
      return sr.map(s => (s && (s.name || s.fullName || s.title)) || '').filter(Boolean).join(', ') || null;
    }
    if (typeof sr === 'string') return sr;
    if (sr && typeof sr === 'object') return sr.name || sr.fullName || sr.title || null;
    return found?.salesResponsibleName || found?.salesResponsibleFullName || null;
  })();
  const addressObj: any = found?.address || found?.Address || null;
  const street = addressObj?.street || addressObj?.Street || found?.street || found?.addressLine1 || found?.Address1 || found?.line1 || null;
  const postalCode = addressObj?.postalCode || addressObj?.Zip || found?.postalCode || found?.zip || found?.zipCode || found?.postal || null;
  const city = addressObj?.city || addressObj?.City || found?.city || found?.town || found?.locality || null;
  const address = [street, postalCode, city].filter(Boolean).join(', ') || null;
  const description = found?.description || found?.notes || found?.note || found?.comment || found?.projectDescription || null;

  return {
    id: String(found?.id ?? found?.projectId ?? found?.orderNumber ?? found?.Id ?? found?.ProjectId ?? 'unknown'),
    name: found?.title || found?.name || found?.projectName || found?.orderName || `Projekt ${found?.id}`,
    orderNumber: found?.orderNumber || found?.projectNumber || found?.number || null,
    customer: (found?.customer && (found.customer.name || found.customer.title)) || found?.customerName || found?.clientName || found?.customer || 'Okänd kund',
    customerId: (found?.customer && (found.customer.id || found.customer.Id)) || found?.customerId || found?.contactId || null,
    createdAt: found?.createdDate || found?.created || found?.createdAt || found?.creationDate || new Date().toISOString(),
    status: (found?.status && (found.status.name || found.status.title)) || found?.status || found?.state || 'unknown',
    salesResponsible,
    street,
    postalCode,
    city,
    address,
    description,
    ...(includeRaw ? { _raw: found } : {}),
  };
}

function buildMockProjects(limit: number, includeRaw: boolean) {
  const now = Date.now();
  return Array.from({ length: limit }).map((_, i) => ({
    id: `mock-${i + 1}`,
    name: `Projekt ${i + 1}`,
    orderNumber: String(5000 + i),
    customer: `Kund ${i + 1}`,
    createdAt: new Date(now - i * 86400000).toISOString(),
    status: 'new',
    ...(includeRaw ? { _raw: { mock: true } } : {}),
  }));
}

// Legacy POST removed
export async function POST() {
  return routeError(410, 'endpoint_removed', 'This endpoint has been removed.');
}

// Temporary GET: mock latest projects (replace with real Blikk fetch later)
export async function GET(req: NextRequest) {
  const parsedQuery = projectsQuerySchema.safeParse({
    mock: req.nextUrl.searchParams.get('mock') || undefined,
    raw: req.nextUrl.searchParams.get('raw') || undefined,
    includeraw: req.nextUrl.searchParams.get('includeraw') || undefined,
    orderNumber: req.nextUrl.searchParams.get('orderNumber') || undefined,
    ordernumber: req.nextUrl.searchParams.get('ordernumber') || undefined,
    page: req.nextUrl.searchParams.get('page') || '1',
    pageSize: req.nextUrl.searchParams.get('pageSize') || undefined,
    limit: req.nextUrl.searchParams.get('limit') || undefined,
  });
  if (!parsedQuery.success) {
    return routeError(400, 'validation_error', 'Invalid query', parsedQuery.error.flatten());
  }

  const useMock = parsedQuery.data.mock === '1';
  const orderNumberQuery = parsedQuery.data.orderNumber || parsedQuery.data.ordernumber;
  const includeRaw = parsedQuery.data.raw === '1' || parsedQuery.data.includeraw === '1';
  const page = parsedQuery.data.page;
  const pageSize = parsedQuery.data.pageSize || parsedQuery.data.limit || 10;

  if (useMock) {
    const projects = buildMockProjects(pageSize, includeRaw);
    return NextResponse.json({ projects, source: 'mock' });
  }

  try {
    const blikk = getBlikk();
    // If specific order number requested, attempt direct lookup first
    if (orderNumberQuery) {
      const found = await blikk.getProjectByOrderNumber(orderNumberQuery);
      if (found) {
        const mapped = mapProject(found, includeRaw);
        return NextResponse.json({ projects: [mapped], source: 'blikk:orderNumber' });
      }
      // If not found, continue to normal latest list (could also return empty)
    }
    const meta = await blikk.listProjectsWithMeta({ page, pageSize, sortDesc: true });
    const raw = meta.data;
    const items: any[] = Array.isArray(raw) ? raw : (raw.items || raw.data || []);
    const mapped = items.map((project) => mapProject(project, includeRaw));
    // Client-side stable sort by createdAt desc if present
    mapped.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    const projects = mapped.slice(0, pageSize);

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
    const projects = buildMockProjects(pageSize, includeRaw);
    return NextResponse.json({ projects, source: 'mock', error: String(e?.message || e) }, { status: 200 });
  }
}
