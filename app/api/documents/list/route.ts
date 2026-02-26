import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { getCurrentUser } from '../_util';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type FolderRow = { id: string; parent_id: string | null; name: string; color: string | null; created_at: string };
type FileRow = { id: string; folder_id: string | null; file_name: string; content_type: string | null; size_bytes: number | null; created_at: string };

export async function GET(req: NextRequest) {
  const current = await getCurrentUser();
  if (!current) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  const supabase = createRouteHandlerClient({ cookies });
  const { searchParams } = new URL(req.url);
  const folderId = (searchParams.get('folderId') || '').trim() || null;

  let folder: Pick<FolderRow, 'id' | 'parent_id' | 'name' | 'color'> | null = null;
  if (folderId) {
    const { data, error } = await supabase
      .from('documents_folders')
      .select('id, parent_id, name, color')
      .eq('id', folderId)
      .maybeSingle();
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ ok: false, error: 'folder_not_found' }, { status: 404 });
    folder = data as any;
  }

  const folderQuery = supabase
    .from('documents_folders')
    .select('id, parent_id, name, color, created_at')
    .order('name', { ascending: true });
  const filesQuery = supabase
    .from('documents_files')
    .select('id, folder_id, file_name, content_type, size_bytes, created_at')
    .order('file_name', { ascending: true });

  const { data: folders, error: fErr } = folderId
    ? await folderQuery.eq('parent_id', folderId)
    : await folderQuery.is('parent_id', null);
  if (fErr) return NextResponse.json({ ok: false, error: fErr.message }, { status: 500 });

  const { data: files, error: fileErr } = folderId
    ? await filesQuery.eq('folder_id', folderId)
    : await filesQuery.is('folder_id', null);
  if (fileErr) return NextResponse.json({ ok: false, error: fileErr.message }, { status: 500 });

  // Build breadcrumbs (root -> ... -> current)
  const breadcrumbs: Array<{ id: string; name: string }> = [];
  if (folder) {
    let cur: any = folder;
    let guard = 0;
    while (cur && guard++ < 30) {
      breadcrumbs.push({ id: cur.id, name: cur.name });
      if (!cur.parent_id) break;
      const { data: parent } = await supabase
        .from('documents_folders')
        .select('id, parent_id, name, color')
        .eq('id', cur.parent_id)
        .maybeSingle();
      cur = parent;
      if (!cur) break;
    }
    breadcrumbs.reverse();
  }

  return NextResponse.json(
    {
      ok: true,
      canEdit: current.role === 'admin',
      folder,
      breadcrumbs,
      folders: (folders || []) as FolderRow[],
      files: (files || []) as FileRow[],
    },
    { status: 200, headers: new Headers({ 'Cache-Control': 'no-store' }) }
  );
}
