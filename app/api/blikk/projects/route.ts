import { NextRequest, NextResponse } from 'next/server';
import { getBlikk } from '@/lib/blikk';

// Legacy POST removed
export async function POST() {
  return NextResponse.json({ error: 'This endpoint has been removed.' }, { status: 410 });
}

// Temporary GET: mock latest projects (replace with real Blikk fetch later)
export async function GET(req: NextRequest) {
  const useMock = req.nextUrl.searchParams.get('mock') === '1';
  const orderNumberQuery = req.nextUrl.searchParams.get('orderNumber') || req.nextUrl.searchParams.get('ordernumber');
  if (useMock) {
    const now = Date.now();
    const projects = Array.from({ length: 10 }).map((_, i) => ({
      id: `mock-${i + 1}`,
      name: `Projekt ${i + 1}`,
      orderNumber: String(5000 + i),
      customer: `Kund ${i + 1}`,
      createdAt: new Date(now - i * 86400000).toISOString(),
      status: 'new',
    }));
    return NextResponse.json({ projects, source: 'mock' });
  }

  try {
    const blikk = getBlikk();
    const debug = req.nextUrl.searchParams.get('debug') === '1';
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
        const mapped = {
          id: String(found.id ?? found.projectId ?? found.orderNumber ?? found.Id ?? found.ProjectId ?? 'unknown'),
          name: found.title || found.name || found.projectName || found.orderName || `Projekt ${found.id}`,
          orderNumber: found.orderNumber || found.projectNumber || found.number || null,
          customer: (found.customer && (found.customer.name || found.customer.title)) || found.customerName || found.clientName || found.customer || 'Okänd kund',
          createdAt: found.createdDate || found.created || found.createdAt || found.creationDate || new Date().toISOString(),
          status: (found.status && (found.status.name || found.status.title)) || found.status || found.state || 'unknown',
          salesResponsible: salesResponsible,
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
        createdAt: p.createdDate || p.created || p.createdAt || p.creationDate || new Date().toISOString(),
        status: (p.status && (p.status.name || p.status.title)) || p.status || p.state || 'unknown',
        salesResponsible: salesResponsible,
      };
    });
    // Client-side stable sort by createdAt desc if present
    mapped.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    const projects = mapped.slice(0, 10);
    return NextResponse.json({ projects, source: 'blikk', ...(debug ? { debug: { usedUrl: meta.usedUrl, attempts: meta.attempts, officialTried: meta.officialTried } } : {}) });
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
    }));
    return NextResponse.json({ projects, source: 'mock', error: String(e?.message || e) }, { status: 200 });
  }
}
