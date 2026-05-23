import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getBlikk } from '@/lib/blikk';
import { ok, routeError } from '../../_admin-resource';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const commentsQuerySchema = z.object({
  projectId: z.coerce.number().int().positive(),
  page: z.coerce.number().int().positive().default(1),
});

export async function GET(req: NextRequest) {
  const parsedQuery = commentsQuerySchema.safeParse({
    projectId: req.nextUrl.searchParams.get('projectId') || undefined,
    page: req.nextUrl.searchParams.get('page') || '1',
  });
  if (!parsedQuery.success) {
    return routeError(400, 'validation_error', 'Missing or invalid projectId', parsedQuery.error.flatten());
  }

  try {
    const blikk = getBlikk();
    const items = await blikk.listProjectComments(parsedQuery.data.projectId, parsedQuery.data.page);
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
    return ok({ comments: normalized }, { comments: normalized });
  } catch (e: any) {
    console.error('[blikk/project/comments] error', e);
    return routeError(500, 'project_comments_fetch_failed', e?.message || 'Failed to fetch comments');
  }
}
