import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getBlikk } from '@/lib/blikk';
import { ok, routeError } from '../../_admin-resource';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const postCommentSchema = z.object({
  projectId: z.coerce.number().int().positive(),
  text: z.string().trim().min(1),
});

export async function POST(req: NextRequest) {
  const parsedBody = postCommentSchema.safeParse(await req.json().catch(() => null));
  if (!parsedBody.success) {
    return routeError(400, 'validation_error', 'Missing or invalid projectId/text', parsedBody.error.flatten());
  }

  try {
    const { projectId, text } = parsedBody.data;
    // Optionally append default mentions from env (comma-separated, e.g. "@patrikvall,@someone")
    const mentionsRaw = process.env.BLIKK_COMMENT_MENTIONS || '';
    const mentions = mentionsRaw.split(',').map(s => s.trim()).filter(Boolean);
    const finalText = mentions.length ? `${text} ${mentions.join(' ')}` : text;
    console.log('[blikk/comment] posting', { projectId, length: finalText.length });
    const blikk = getBlikk();
    const result = await blikk.addProjectComment(projectId, finalText);
    return ok({ result }, { result });
  } catch (e: any) {
    console.error('[blikk/comment] error', e);
    return routeError(500, 'project_comment_post_failed', e?.message || 'Failed to post comment');
  }
}
