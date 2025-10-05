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
    const push = (v: any) => { if (v != null && v !== '' && Number.isFinite(Number(v))) candidates.push(Number(v)); };
    if (data) {
      push(data.customerId);
      push(data.contactId);
      push(data.clientId);
      push(data.ClientId);
      push(data.CustomerId);
      push(data.customerID);
      push(data.CustomerID);
      push(data.customer_id);
      push(data.contact_id);
      // nested objects
      const nestedObjs = [data.customer, data.contact, data.client, data.owner, data.company, data.organisation, data.organization];
      for (const o of nestedObjs) {
        if (!o || typeof o !== 'object') continue;
        push(o.id);
        push(o.Id);
        push(o.customerId);
      }
    }
    const customerId = candidates.find(v => v > 0) ?? null;
    const response: any = { customerId };
    if (debug) response.raw = data;
    return NextResponse.json(response);
  } catch (e: any) {
    const msg = String(e?.message || e);
    const status = / 404: /.test(msg) ? 404 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
