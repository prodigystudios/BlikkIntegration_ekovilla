import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { adminSupabase } from '@/lib/adminSupabase';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const title = String(body.title || '').trim();
    const description = typeof body.description === 'string' ? body.description : '';
    const dueDate = body.dueDate ? String(body.dueDate) : undefined;
    const source = body.source ? String(body.source) : undefined;
    const metadata = body.metadata && typeof body.metadata === 'object' ? body.metadata : undefined;
    const requesterName = typeof body.requesterName === 'string' ? body.requesterName.trim() : '';

    if (!title) {
      return NextResponse.json({ ok: false, error: 'Titel krävs' }, { status: 400 });
    }

    if (!adminSupabase) {
      return NextResponse.json({ ok: false, error: 'Admin-klient saknas (env)' }, { status: 500 });
    }

    // Who is creating the task? Use the current session user as created_by
    const supabase = createServerComponentClient({ cookies });
    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) {
      return NextResponse.json({ ok: false, error: 'Ej inloggad' }, { status: 401 });
    }

    // Resolve assignee: require env TASKS_DEFAULT_ASSIGNEE_UUID for Patrik Valls
    const assignee = (process.env.TASKS_DEFAULT_ASSIGNEE_UUID || '').trim();
    if (!assignee) {
      return NextResponse.json({ ok: false, error: 'Saknar mottagarens UUID (TASKS_DEFAULT_ASSIGNEE_UUID)' }, { status: 500 });
    }

    const finalDescriptionParts: string[] = [];
    if (requesterName) {
      const already = /^beställning\s+gäller\s*:/i.test(requesterName);
      finalDescriptionParts.push(already ? requesterName : `Beställning gäller: ${requesterName}`);
    }
    if (description) finalDescriptionParts.push(description);
    const finalDescription = finalDescriptionParts.join('\n\n');

    const { data, error } = await adminSupabase
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

    return NextResponse.json({ ok: true, createdId: data.id });
  } catch (e: any) {
    console.error('tasks/create failed', e);
    return NextResponse.json({ ok: false, error: e?.message || 'Unknown error' }, { status: 500 });
  }
}
