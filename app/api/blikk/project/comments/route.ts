import { NextRequest } from 'next/server';
import { getBlikk } from '@/lib/blikk';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const projectIdStr = searchParams.get('projectId');
    if (!projectIdStr) return new Response(JSON.stringify({ error: 'Missing projectId' }), { status: 400 });
    const projectId = Number(projectIdStr);
    if (!Number.isFinite(projectId) || projectId <= 0) return new Response(JSON.stringify({ error: 'Invalid projectId' }), { status: 400 });
    const blikk = getBlikk();
  const pageStr = searchParams.get('page');
  const page = pageStr ? Math.max(1, Number(pageStr)) : 1;
  const items = await blikk.listProjectComments(projectId, page);
    // Normalize basic shape for UI (author, text, created)
    const normalized = items.map((c: any) => {
      const user = c.user || c.createdBy || c.author || c.creator || c.owner || c.userId || null;
      const userName = typeof user === 'string' ? user : (user && (user.name || user.fullName || user.title)) || c.createdByName || c.authorName || null;
      return {
        id: String(c.id || c.commentId || Math.random().toString(36).slice(2)),
        text: c.text || c.comment || c.body || c.content || c.message || '',
        createdAt: c.createdAt || c.createdDate || c.dateCreated || c.created || null,
        userName,
      };
    }).filter((c: any) => c.text);
    return new Response(JSON.stringify({ ok: true, comments: normalized }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e: any) {
    console.error('[blikk/project/comments] error', e);
    return new Response(JSON.stringify({ error: e.message || 'Failed to fetch comments' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
