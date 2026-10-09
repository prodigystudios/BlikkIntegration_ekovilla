import { NextRequest, NextResponse } from 'next/server';
import { getOptionalSupabaseAdmin } from '@/lib/supabase/server';
import { fetchOrderStockRows } from '@/lib/domains/crm/reportKpisLoader';
import { buildStockSnapshot } from '@/lib/domains/crm/orderStockHistory';
import { upsertStockSnapshot } from '@/lib/domains/crm/orderStockHistoryLoader';
import { stockholmTodayISO } from '@/lib/domains/planning/timezone';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Ingen session läses här, så Next 14 hade annars kunnat svara jobbet med en cachad orderstock (se
// project_next14_get_route_fetch_cache). Vaktas av testet.
export const fetchCache = 'force-no-store';

// Orderstockens ögonblicksbild (William 2026-10-09). Körs varje timme via vercel.json; Vercel skickar
// `Authorization: Bearer <CRON_SECRET>`. Skriver om DAGENS rad (svensk dag), så dagens sista körning blir dagens
// läge och veckans sista dag veckans. Vitlistad i middleware.ts — grinden är hemligheten här.
function isAuthorizedCron(req: NextRequest): boolean {
  const cronSecret = (process.env.CRON_SECRET || '').trim();
  const authHeader = String(req.headers.get('authorization') || '').trim();
  const bearer = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : '';
  return Boolean(cronSecret) && bearer === cronSecret;
}

async function run(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const admin = getOptionalSupabaseAdmin();
  if (!admin) {
    return NextResponse.json({ ok: false, error: 'service_role_missing' }, { status: 500 });
  }
  try {
    const now = new Date();
    const snapshot = buildStockSnapshot(await fetchOrderStockRows(admin), stockholmTodayISO(now));
    await upsertStockSnapshot(admin, snapshot, now);
    return NextResponse.json({ ok: true, data: { day: snapshot.day, totalCount: snapshot.totalCount, totalValue: snapshot.totalValue } });
  } catch (e: any) {
    console.error(`[Orderstock] Ögonblicksbilden kunde inte sparas: ${e?.message || e}`);
    return NextResponse.json({ ok: false, error: e?.message || 'snapshot_failed' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return run(req);
}

export async function POST(req: NextRequest) {
  return run(req);
}
