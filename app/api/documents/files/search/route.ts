import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { getCurrentUser } from '../../_util';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type FileRow = {
  id: string;
  folder_id: string | null;
  file_name: string;
  content_type: string | null;
  size_bytes: number | null;
  created_at: string;
};

type FolderRow = { id: string; name: string; parent_id: string | null };

export async function GET(req: NextRequest) {
  const current = await getCurrentUser();
  if (!current) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const q = (searchParams.get('q') || '').trim();
  const limitRaw = Number(searchParams.get('limit') || 50);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, Math.floor(limitRaw))) : 50;

  if (!q) return NextResponse.json({ ok: true, q, results: [] as any[] }, { status: 200 });
  if (q.length < 2) return NextResponse.json({ ok: true, q, results: [] as any[] }, { status: 200 });

  const supabase = createRouteHandlerClient({ cookies });

  const { data: files, error } = await supabase
    .from('documents_files')
    .select('id, folder_id, file_name, content_type, size_bytes, created_at')
    .ilike('file_name', `%${q}%`)
    .order('file_name', { ascending: true })
    .limit(limit);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const rows = (files || []) as FileRow[];
  const folderIds = Array.from(new Set(rows.map(r => r.folder_id).filter(Boolean))) as string[];

  let folderById = new Map<string, FolderRow>();
  if (folderIds.length) {
    const { data: folders, error: fErr } = await supabase
      .from('documents_folders')
      .select('id, name, parent_id')
      .in('id', folderIds);
    if (fErr) return NextResponse.json({ ok: false, error: fErr.message }, { status: 500 });
    folderById = new Map(((folders || []) as FolderRow[]).map(f => [f.id, f]));
  }

  const results = rows.map(r => {
    const folder = r.folder_id ? folderById.get(r.folder_id) : null;
    return {
      ...r,
      folder_name: folder?.name ?? null,
    };
  });

  return NextResponse.json(
    { ok: true, q, results },
    { status: 200, headers: new Headers({ 'Cache-Control': 'no-store' }) }
  );
}
