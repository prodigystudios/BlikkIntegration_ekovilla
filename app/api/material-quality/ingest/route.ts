import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST accepts a payload with top-level form metadata plus etapp arrays
// It will extract rows that contain density (installeradDensitet / installerad_densitet equivalents)
// along with batch and rating fields, and store one row per etapp.

type IngestPayload = {
  orderId?: string;
  projectNumber?: string;
  installationDate?: string; // YYYY-MM-DD
  materialUsed?: string;
  flufferUsed?: boolean;
  batchNumber?: string;
  dammighet?: string | number | null;
  klumpighet?: string | number | null;
  etapperOpen?: Array<any>;
  etapperClosed?: Array<any>;
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as IngestPayload;
    const supa = getSupabaseAdmin();

    const damm = body.dammighet === '' || body.dammighet === null || body.dammighet === undefined ? null : Number(body.dammighet);
    const klump = body.klumpighet === '' || body.klumpighet === null || body.klumpighet === undefined ? null : Number(body.klumpighet);

    const rows: any[] = [];
    const pushFrom = (arr: any[] | undefined | null, source: 'open' | 'closed') => {
      if (!Array.isArray(arr)) return;
      arr.forEach((r, idx) => {
        const densStr = source === 'open' ? r.installeradDensitet : r.installeradDensitet; // same key naming currently
        const dens = Number(densStr);
        const hasDensity = Number.isFinite(dens) && dens > 0;
        if (!hasDensity) return; // only store rows with density
        rows.push({
          order_id: body.orderId || null,
          project_number: body.projectNumber || null,
          installation_date: body.installationDate || null,
          material_used: body.materialUsed || null,
          batch_number: body.batchNumber || null,
          fluffer_used: body.flufferUsed === true ? true : (body.flufferUsed === false ? false : null),
          dammighet: Number.isFinite(damm) ? damm : null,
          klumpighet: Number.isFinite(klump) ? klump : null,
          etapp_name: r.etapp || null,
          densitet: dens,
          source_type: source,
          source_row_index: idx,
        });
      });
    };
    pushFrom(body.etapperOpen, 'open');
    pushFrom(body.etapperClosed, 'closed');

    if (rows.length === 0) {
      return NextResponse.json({ stored: 0, reason: 'no-density-rows' });
    }

    let { error } = await supa.from('material_quality_samples').insert(rows);
    if (error) {
      const msg = String(error.message || '');
      // If schema not yet migrated for fluffer_used, retry without that column so we don't lose all rows
      if (/fluffer_used/i.test(msg) || /column.*fluffer_used.*does not exist/i.test(msg)) {
        console.warn('[material-quality/ingest] fluffer_used column missing, retrying without it. Run: alter table public.material_quality_samples add column if not exists fluffer_used boolean null;');
        const fallback = rows.map(r => { const c = { ...r }; delete (c as any).fluffer_used; return c; });
        const retry = await supa.from('material_quality_samples').insert(fallback);
        if (retry.error) throw retry.error;
        return NextResponse.json({ stored: fallback.length, warning: 'missing-fluffer-used-column' });
      }
      throw error;
    }
    return NextResponse.json({ stored: rows.length });
  } catch (e: any) {
    console.error('[material-quality/ingest] failed', e);
    return NextResponse.json({ error: e?.message || 'Failed to ingest samples' }, { status: 500 });
  }
}
