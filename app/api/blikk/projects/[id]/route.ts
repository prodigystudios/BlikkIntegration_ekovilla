import { NextRequest, NextResponse } from 'next/server';
import { getBlikk } from '@/lib/blikk';

// Fetch detailed project (single) to recover missing customerId or other fields.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const idNum = Number(params.id);
  if (!Number.isFinite(idNum) || idNum <= 0) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }
  const debug = req.nextUrl.searchParams.get('debug') === '1';
  try {
    const blikk = getBlikk();
    const data: any = await blikk.getProjectById(idNum);
    // Heuristic extraction for customerId across multiple possible shapes
    const candidates: Array<any> = [];
    const pushNum = (v: any) => { if (v != null && v !== '' && Number.isFinite(Number(v))) candidates.push(Number(v)); };
    if (data) {
      pushNum(data.customerId);
      pushNum(data.contactId);
      pushNum(data.clientId);
      pushNum(data.ClientId);
      pushNum(data.CustomerId);
      pushNum(data.customerID);
      pushNum(data.CustomerID);
      pushNum(data.customer_id);
      pushNum(data.contact_id);
      // nested objects
      const nestedObjs = [data.customer, data.contact, data.client, data.owner, data.company, data.organisation, data.organization];
      for (const o of nestedObjs) {
        if (!o || typeof o !== 'object') continue;
        pushNum(o.id);
        pushNum(o.Id);
        pushNum(o.customerId);
      }
    }
    const customerId = candidates.find(v => v > 0) ?? null;

    // Extract address and description fields (tolerant to schema variants)
    const addressObj = data?.address || data?.Address || null;
    const street = addressObj?.street || addressObj?.Street || data?.street || data?.addressLine1 || data?.Address1 || data?.line1 || null;
    const postalCode = addressObj?.postalCode || addressObj?.Zip || data?.postalCode || data?.zip || data?.zipCode || data?.postal || null;
    const city = addressObj?.city || addressObj?.City || data?.city || data?.town || data?.locality || null;
    const address = [street, postalCode, city].filter(Boolean).join(', ') || null;
    const description = data?.description || data?.notes || data?.note || data?.comment || data?.projectDescription || null;
    const status = (() => {
      const s: any = data?.status || data?.state;
      if (!s) return null;
      if (typeof s === 'string') return s;
      if (typeof s === 'object') return s.name || s.title || s.status || null;
      return null;
    })();
    const salesResponsible = (() => {
      const sr: any = data?.salesResponsible || data?.salesResponsibleUser || data?.salesUser || data?.salesRep || data?.responsibleSalesUser;
      if (Array.isArray(sr)) return sr.map(s => (s && (s.name || s.fullName || s.title)) || '').filter(Boolean).join(', ') || null;
      if (typeof sr === 'string') return sr;
      if (sr && typeof sr === 'object') return sr.name || sr.fullName || sr.title || null;
      const alt = data?.salesResponsibleName || data?.salesResponsibleFullName;
      return alt || null;
    })();
    const orderNumber = data?.orderNumber || data?.projectNumber || data?.number || null;
    const name = data?.title || data?.name || data?.projectName || data?.orderName || null;

    const response: any = {
      customerId,
      project: {
        id: String(idNum),
        name,
        orderNumber,
        salesResponsible,
        status,
        street,
        postalCode,
        city,
        address,
        description,
      }
    };
    if (debug) response.raw = data;
    return NextResponse.json(response);
  } catch (e: any) {
    const msg = String(e?.message || e);
    const status = / 404: /.test(msg) ? 404 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

// Update project description in Blikk
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const idNum = Number(params.id);
    if (!Number.isFinite(idNum) || idNum <= 0) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }
    const json = await req.json().catch(() => ({}));
    const description = typeof json.description === 'string' ? json.description : '';
    const blikk = getBlikk();
    const result = await (blikk as any).updateProjectDescription(idNum, description);
    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    console.error('[api/blikk/projects/:id PUT] error', e);
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
