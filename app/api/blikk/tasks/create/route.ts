import { NextRequest, NextResponse } from 'next/server';
import { getBlikk } from '@/lib/blikk';
import { createTaskBodySchema, routeError } from '../_lib';

export async function POST(req: NextRequest) {
  try {
    const parsedBody = createTaskBodySchema.safeParse(await req.json().catch(() => null));
    if (!parsedBody.success) {
      return routeError(400, 'validation_error', 'Namn på beställaren krävs', parsedBody.error.flatten());
    }

    const title = String(parsedBody.data.title || 'Beställning kläder');
    const description = String(parsedBody.data.description || '');
    const nameRaw = parsedBody.data.comment.trim();
    // Force default project in background (requested)
    const defaultProjectId = Number(process.env.BLIKK_DEFAULT_PROJECT_ID ?? 230354);
    const projectId = defaultProjectId;
    // Ignore assignee for now (support request pending)
    const assignedUserId = undefined;
    const dueDate = parsedBody.data.dueDate ? String(parsedBody.data.dueDate) : undefined;
    const preferredPath = parsedBody.data.preferredPath ? String(parsedBody.data.preferredPath) : undefined;

    const blikk = getBlikk();
    const task = await blikk.createTask({ title, description, projectId, assignedUserId, dueDate, preferredPath });

    let createdId: number | null = null;
    try {
      createdId = Number(task?.data?.id || task?.data?.taskId || task?.data?.todoId);
      if (!Number.isNaN(createdId)) {
        // Always tag @patrikvall. If user supplied a comment, treat it as the name and prefix with "Beställning gäller: {name}".
        const raw = nameRaw;
        const tmpl = process.env.BLIKK_TASK_COMMENT_TEMPLATE || '';
        let intro = '';
        if (raw) {
          const alreadyPrefixed = /^beställning\s+gäller\s*:/i.test(raw);
          intro = alreadyPrefixed ? raw : `Beställning gäller: ${raw}`;
        }
        const parts = [intro, tmpl].filter((p) => p && p.trim().length > 0);
        const base = parts.join('\n\n').trim();
        const mention = '@patrikvall';
        const hasMention = base.toLowerCase().includes(mention.toLowerCase());
        const finalComment = hasMention ? base : base ? `${base}\n\n${mention}` : mention;
        await blikk.addTaskComment(createdId, finalComment, task.usedPath);
      }
    } catch {}
    return NextResponse.json({ ok: true, createdId });
  } catch (e: any) {
    console.error('Create task failed', e);
    return routeError(500, 'task_create_failed', e?.message || 'Unknown error');
  }
}
