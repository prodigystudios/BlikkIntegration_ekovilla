import { NextRequest, NextResponse } from 'next/server';
import { getBlikk } from '@/lib/blikk';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const title = String(body.title || 'Beställning kläder');
    const description = String(body.description || '');
    const nameRaw = typeof body.comment === 'string' ? body.comment.trim() : '';
    if (!nameRaw) {
      return NextResponse.json({ ok: false, error: 'Namn på beställaren krävs' }, { status: 400 });
    }
  // Force default project in background (requested)
  const defaultProjectId = Number(process.env.BLIKK_DEFAULT_PROJECT_ID ?? 230354);
  const projectId = defaultProjectId;
  // Ignore assignee for now (support request pending)
  const assignedUserId = undefined;
    const dueDate = body.dueDate ? String(body.dueDate) : undefined;
  const preferredPath = body.preferredPath ? String(body.preferredPath) : undefined;

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
    return NextResponse.json({ ok: false, error: e?.message || 'Unknown error' }, { status: 500 });
  }
}
