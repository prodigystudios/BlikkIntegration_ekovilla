import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { z } from 'zod';
import { getOptionalSupabaseAdmin } from '@/lib/supabase/server';

const createTaskSchema = z.object({
  title: z.string().trim().min(1, 'Titel krävs'),
  description: z.string().optional().default(''),
  dueDate: z.string().trim().min(1).optional(),
  source: z.string().trim().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  requesterName: z.string().optional().default(''),
});

function ok<T>(data: T, legacy?: Record<string, unknown>, status = 200) {
  return NextResponse.json({ ok: true, data, ...(legacy ?? {}) }, { status });
}

function routeError(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json(
    {
      ok: false,
      error: { code, message, ...(details !== undefined ? { details } : {}) },
      legacyError: message,
    },
    { status },
  );
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = createTaskSchema.safeParse(body);
    if (!parsed.success) {
      return routeError(400, 'validation_error', 'Ogiltig förfrågan', parsed.error.flatten());
    }

    const { title, description, dueDate, source, metadata, requesterName } = parsed.data;

    const admin = getOptionalSupabaseAdmin();
    if (!admin) {
      return routeError(500, 'service_role_missing', 'Admin-klient saknas (env)');
    }

    // Who is creating the task? Use the current session user as created_by
    const supabase = createRouteHandlerClient({ cookies });
    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) {
      return routeError(401, 'unauthorized', 'Ej inloggad');
    }

    // Resolve assignee: require env TASKS_DEFAULT_ASSIGNEE_UUID for Patrik Valls
    const assignee = (process.env.TASKS_DEFAULT_ASSIGNEE_UUID || '').trim();
    if (!assignee) {
      return routeError(500, 'default_assignee_missing', 'Saknar mottagarens UUID (TASKS_DEFAULT_ASSIGNEE_UUID)');
    }

    const finalDescriptionParts: string[] = [];
    if (requesterName) {
      const already = /^beställning\s+gäller\s*:/i.test(requesterName);
      finalDescriptionParts.push(already ? requesterName : `Beställning gäller: ${requesterName}`);
    }
    if (description) finalDescriptionParts.push(description);
    const finalDescription = finalDescriptionParts.join('\n\n');

    const { data, error } = await admin
      .from('tasks')
      .insert({
        title,
        description: finalDescription,
        created_by: user.id,
        assigned_to: assignee,
        due_date: dueDate ? dueDate : null,
        status: 'open',
        source: source || 'clothing_order',
        metadata: metadata || null,
      })
      .select('id')
      .single();

    if (error || !data) {
      throw error || new Error('Misslyckades skapa uppgift');
    }

    return ok({ createdId: data.id }, { createdId: data.id }, 201);
  } catch (e: any) {
    console.error('tasks/create failed', e);
    return routeError(500, 'task_create_failed', e?.message || 'Unknown error');
  }
}
