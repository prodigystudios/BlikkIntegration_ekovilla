import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/server';

type Body = {
  projectId: string;
  installationDate?: string; // YYYY-MM-DD
  totalBags: number;
  reportKey?: string; // unique key to avoid double-decrement, e.g. archive path
  segmentId?: string;
  materialKind?: 'Ekovilla' | 'Vitull';
};

export async function POST(req: NextRequest) {
  try {
    const json = (await req.json()) as Body;
    const projectId = String(json.projectId || '').trim();
    const totalBags = Number(json.totalBags);
    const installationDate = json.installationDate && /\d{4}-\d{2}-\d{2}/.test(json.installationDate)
      ? json.installationDate
      : undefined;
    const segmentId = json.segmentId && String(json.segmentId).trim() ? String(json.segmentId).trim() : undefined;
  const reportKey = json.reportKey && String(json.reportKey).trim() ? String(json.reportKey).trim() : undefined;
  const materialKind = json.materialKind && String(json.materialKind).trim() ? (String(json.materialKind).trim() as 'Ekovilla'|'Vitull') : undefined;

    if (!projectId || !Number.isFinite(totalBags) || totalBags <= 0) {
      return NextResponse.json({ ok: false, error: 'Missing projectId or invalid totalBags' }, { status: 400 });
    }

    const admin = getSupabaseAdmin();

    // Resolve effective depot id: segment override if any for the given date (or by segmentId), else truck's depot
    let depotId: string | null = null;

    // 1) Try find segment by id or by date window
    try {
      if (segmentId) {
        const { data: seg, error: segErr } = await admin.from('planning_segments').select('*').eq('id', segmentId).maybeSingle();
        if (!segErr && seg) {
          depotId = (seg as any).depot_id || null;
        }
      } else if (installationDate) {
        const { data: segs, error: segErr } = await admin
          .from('planning_segments')
          .select('*')
          .eq('project_id', projectId)
          .lte('start_day', installationDate)
          .gte('end_day', installationDate)
          .order('start_day', { ascending: false })
          .limit(1);
        if (!segErr && Array.isArray(segs) && segs[0]) {
          depotId = (segs[0] as any).depot_id || null;
        }
      }
    } catch (e) {
      // ignore and fallback
    }

    // 2) Fallback via truck assignment (project meta truck name -> planning_trucks.depot_id)
    if (!depotId) {
      try {
        const { data: meta, error: metaErr } = await admin
          .from('planning_project_meta')
          .select('truck')
          .eq('project_id', projectId)
          .maybeSingle();
        const truckName = meta?.truck;
        if (!metaErr && truckName) {
          const { data: truck, error: truckErr } = await admin
            .from('planning_trucks')
            .select('depot_id')
            .eq('name', truckName)
            .maybeSingle();
          if (!truckErr && truck?.depot_id) depotId = truck.depot_id as any;
        }
      } catch (e) {
        // ignore
      }
    }

    if (!depotId) {
      return NextResponse.json({ ok: true, skipped: 'no-depot' });
    }

    // Resolve material kind: prefer explicit; else infer from job_type on meta
    let mat: 'Ekovilla' | 'Vitull' | null = materialKind ?? null;
    if (!mat) {
      try {
        const { data: meta2 } = await admin
          .from('planning_project_meta')
          .select('job_type')
          .eq('project_id', projectId)
          .maybeSingle();
        const jt = (meta2 as any)?.job_type ? String((meta2 as any).job_type).toLowerCase() : '';
        if (jt.startsWith('eko')) mat = 'Ekovilla';
        else if (jt.startsWith('vit')) mat = 'Vitull';
      } catch {}
    }

    // Idempotency: record a usage row keyed by reportKey if provided
    if (reportKey) {
      try {
        const ins = await admin.from('planning_depot_usage').insert({
          project_id: projectId,
          installation_date: installationDate || null,
          depot_id: depotId,
          bags_used: Math.round(totalBags),
          material_kind: mat,
          source_key: mat ? `${reportKey}:${mat}` : reportKey,
        }).select('*').single();
        if (ins.error) {
          // If already recorded (unique violation), treat as already processed
          const msg = String(ins.error.message || '').toLowerCase();
          if (msg.includes('duplicate key') || msg.includes('unique')) {
            return NextResponse.json({ ok: true, alreadyProcessed: true });
          }
          return NextResponse.json({ ok: false, error: 'usage-insert-failed', detail: ins.error.message }, { status: 500 });
        }
      } catch (e: any) {
        const m = String(e?.message || e).toLowerCase();
        if (m.includes('duplicate key') || m.includes('unique')) {
          return NextResponse.json({ ok: true, alreadyProcessed: true });
        }
        return NextResponse.json({ ok: false, error: 'usage-insert-exception', detail: String(e?.message || e) }, { status: 500 });
      }
    }

    // Decrement correct material column
    const col = mat === 'Vitull' ? 'material_vitull_total' : 'material_ekovilla_total';
    // Prefer SQL update to avoid race conditions
    const { error: sqlErr } = await admin.rpc('exec_sql', {
      sql: `update public.planning_depots set ${col} = greatest(0, coalesce(${col},0) - $1) where id = $2`,
      params: [Math.round(totalBags), depotId],
    } as any);
    if (sqlErr) {
      // Fallback to JS-side read-modify-write
      const { data: curRow } = await admin.from('planning_depots').select(`${col}`).eq('id', depotId).maybeSingle();
      const current = Number((curRow as any)?.[col] || 0);
      const next = Math.max(0, Math.round(current) - Math.round(totalBags));
      const updatePayload: any = {}; updatePayload[col] = next;
      await admin.from('planning_depots').update(updatePayload).eq('id', depotId);
    }
    return NextResponse.json({ ok: true, depotId, material_kind: mat ?? 'Ekovilla' });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: 'unexpected', detail: String(e?.message || e) }, { status: 500 });
  }
}
